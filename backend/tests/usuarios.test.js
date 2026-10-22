// Pruebas de gestion de usuarios (docs/api.md): campo "supervisor" de GET /usuarios
// y PUT /usuarios/:id_usuario/supervisor. Crean sus propios usuarios y los borran al terminar.
// Necesitan SEED_ADMIN_* en backend/.env, igual que api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { crearApp } from '../src/app.js';
import { consultar, pool } from '../src/db.js';

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const SUFIJO = Date.now();
const PASSWORD = 'ClaveDePrueba123';
const CORREOS = {
  supervisor: `test.supervisor.uno.${SUFIJO}@ejemplo.test`,
  otroSupervisor: `test.supervisor.dos.${SUFIJO}@ejemplo.test`,
  supervisorInactivo: `test.supervisor.inactivo.${SUFIJO}@ejemplo.test`,
  agente: `test.agente.${SUFIJO}@ejemplo.test`,
};

let servidor;
let base;
const ids = {};
const tokens = {};

async function llamar(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: respuesta.status, datos: await respuesta.json() };
}

function asignar(idAgente, idSupervisor, token = tokens.admin) {
  return llamar(`/api/v1/usuarios/${idAgente}/supervisor`, {
    metodo: 'PUT',
    token,
    cuerpo: { id_supervisor: idSupervisor },
  });
}

async function auditoriasDelAgente() {
  return consultar(
    `SELECT detalle_cambio FROM TB_LogAuditoria
      WHERE accion_ejecutada = 'ASIGNACION_SUPERVISOR'
        AND JSON_EXTRACT(detalle_cambio, '$.id_agente') = ?
      ORDER BY id_log`,
    [ids.agente]
  );
}

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  const login = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: CORREO_ADMIN, password: PASSWORD_ADMIN },
  });
  tokens.admin = login.datos.token_acceso;

  const crear = async (correo, rol) => {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba ${rol} ${correo.split('.')[2]}`, correo_electronico: correo, password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    return datos.id_usuario;
  };
  ids.supervisor = await crear(CORREOS.supervisor, 'SUPERVISOR');
  ids.otroSupervisor = await crear(CORREOS.otroSupervisor, 'SUPERVISOR');
  ids.supervisorInactivo = await crear(CORREOS.supervisorInactivo, 'SUPERVISOR');
  ids.agente = await crear(CORREOS.agente, 'AGENTE');
  await consultar("UPDATE TB_Usuario SET estado = 'INACTIVO' WHERE id_usuario = ?", [ids.supervisorInactivo]);

  const loginAgente = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: CORREOS.agente, password: PASSWORD },
  });
  tokens.agente = loginAgente.datos.token_acceso;
});

after(async () => {
  try {
    if (ids.agente) {
      await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_agente = ?', [ids.agente]);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('GET /usuarios incluye "supervisor" (null si no tiene)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/usuarios', { token: tokens.admin });
  assert.equal(estado, 200);
  const agente = datos.find((usuario) => usuario.id_usuario === ids.agente);
  assert.equal(agente.supervisor, null);
});

test('PUT supervisor: asigna un supervisor a un agente', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(ids.agente, ids.supervisor);
  assert.equal(estado, 200);
  assert.equal(datos.id_usuario, ids.agente);
  assert.equal(datos.supervisor.id_usuario, ids.supervisor);
  assert.ok(datos.supervisor.nombre_completo);

  const lista = await llamar('/api/v1/usuarios', { token: tokens.admin });
  const agente = lista.datos.find((usuario) => usuario.id_usuario === ids.agente);
  assert.equal(agente.supervisor.id_usuario, ids.supervisor);
});

test('PUT supervisor: la asignacion quedo en la auditoria', { skip: SIN_ADMIN }, async () => {
  const filas = await auditoriasDelAgente();
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].detalle_cambio, {
    id_agente: ids.agente,
    id_supervisor_anterior: null,
    id_supervisor_nuevo: ids.supervisor,
  });
});

test('PUT supervisor: repetir el mismo supervisor no cambia nada ni audita', { skip: SIN_ADMIN }, async () => {
  const { estado } = await asignar(ids.agente, ids.supervisor);
  assert.equal(estado, 200);
  assert.equal((await auditoriasDelAgente()).length, 1);
});

test('PUT supervisor: asignar otro reemplaza al anterior (maximo uno)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(ids.agente, ids.otroSupervisor);
  assert.equal(estado, 200);
  assert.equal(datos.supervisor.id_usuario, ids.otroSupervisor);
  const filas = await consultar('SELECT id_supervisor FROM TB_AsignacionSupervisor WHERE id_agente = ?', [ids.agente]);
  assert.deepEqual(
    filas.map((fila) => fila.id_supervisor),
    [ids.otroSupervisor]
  );
});

test('PUT supervisor: null quita el supervisor', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(ids.agente, null);
  assert.equal(estado, 200);
  assert.equal(datos.supervisor, null);
  const filas = await consultar('SELECT 1 FROM TB_AsignacionSupervisor WHERE id_agente = ?', [ids.agente]);
  assert.equal(filas.length, 0);
});

test('PUT supervisor a alguien que no es agente responde 400 NO_ES_AGENTE', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(ids.otroSupervisor, ids.supervisor);
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'NO_ES_AGENTE');
});

test('PUT supervisor con un id que no es supervisor activo responde 400 SUPERVISOR_INVALIDO', { skip: SIN_ADMIN }, async () => {
  for (const idInvalido of [ids.agente, ids.supervisorInactivo, 999999999]) {
    const { estado, datos } = await asignar(ids.agente, idInvalido);
    assert.equal(estado, 400, `id_supervisor ${idInvalido}`);
    assert.equal(datos.error.codigo, 'SUPERVISOR_INVALIDO');
  }
});

test('PUT supervisor de un usuario que no existe responde 404', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(999999999, ids.supervisor);
  assert.equal(estado, 404);
  assert.equal(datos.error.codigo, 'NO_ENCONTRADO');
});

test('PUT supervisor con datos mal formados responde 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  const idNoNumerico = await asignar('abc', ids.supervisor);
  assert.equal(idNoNumerico.estado, 400);
  assert.equal(idNoNumerico.datos.error.detalles[0].campo, 'id_usuario');

  const sinCampo = await llamar(`/api/v1/usuarios/${ids.agente}/supervisor`, { metodo: 'PUT', token: tokens.admin, cuerpo: {} });
  assert.equal(sinCampo.estado, 400);
  assert.equal(sinCampo.datos.error.detalles[0].campo, 'id_supervisor');

  const texto = await asignar(ids.agente, String(ids.supervisor));
  assert.equal(texto.estado, 400);
  assert.equal(texto.datos.error.codigo, 'DATOS_INVALIDOS');
});

test('PUT supervisor: un Agente no tiene permiso (403)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await asignar(ids.agente, ids.supervisor, tokens.agente);
  assert.equal(estado, 403);
  assert.equal(datos.error.codigo, 'PROHIBIDO');
});
