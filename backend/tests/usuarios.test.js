// Pruebas de gestion de usuarios (docs/api.md): campo "supervisor" de GET /usuarios,
// PUT /usuarios/:id_usuario/supervisor, PATCH /usuarios/:id_usuario y PATCH .../estado.
// Crean sus propios usuarios y los borran al terminar.
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
  editable: `test.editable.${SUFIJO}@ejemplo.test`,
  // Segundo SuperAdmin: las pruebas de "sobre si mismo" se hacen con el, nunca con el real.
  otroAdmin: `test.superadmin.${SUFIJO}@ejemplo.test`,
};
const CORREO_EDITADO = `test.editado.${SUFIJO}@ejemplo.test`;

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

function editar(idUsuario, cuerpo, token = tokens.admin) {
  return llamar(`/api/v1/usuarios/${idUsuario}`, { metodo: 'PATCH', token, cuerpo });
}

function cambiarEstado(idUsuario, estado, token = tokens.admin) {
  return llamar(`/api/v1/usuarios/${idUsuario}/estado`, { metodo: 'PATCH', token, cuerpo: { estado } });
}

async function iniciarSesion(correo) {
  return llamar('/api/v1/auth/login', { metodo: 'POST', cuerpo: { correo_electronico: correo, password: PASSWORD } });
}

async function ultimaAuditoria(accion, idUsuario) {
  const filas = await consultar(
    `SELECT detalle_cambio FROM TB_LogAuditoria
      WHERE accion_ejecutada = ? AND JSON_EXTRACT(detalle_cambio, '$.id_usuario') = ?
      ORDER BY id_log DESC LIMIT 1`,
    [accion, idUsuario]
  );
  return filas[0]?.detalle_cambio;
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
  ids.editable = await crear(CORREOS.editable, 'AGENTE');
  ids.otroAdmin = await crear(CORREOS.otroAdmin, 'SUPERADMIN');
  await consultar("UPDATE TB_Usuario SET estado = 'INACTIVO' WHERE id_usuario = ?", [ids.supervisorInactivo]);

  tokens.agente = (await iniciarSesion(CORREOS.agente)).datos.token_acceso;
  tokens.otroAdmin = (await iniciarSesion(CORREOS.otroAdmin)).datos.token_acceso;
});

after(async () => {
  try {
    const creados = Object.values(ids);
    if (creados.length > 0) {
      const lista = creados.map(() => '?').join(', ');
      await consultar(
        `DELETE FROM TB_AsignacionSupervisor WHERE id_agente IN (${lista}) OR id_supervisor IN (${lista})`,
        [...creados, ...creados]
      );
      // El segundo SuperAdmin hizo cambios: su auditoria impide borrarlo (clave foranea).
      await consultar('DELETE FROM TB_LogAuditoria WHERE id_usuario = ?', [ids.otroAdmin ?? 0]);
      await consultar(`DELETE FROM TB_Usuario WHERE id_usuario IN (${lista})`, creados);
    }
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

// --- PATCH /usuarios/:id_usuario ---

test('PATCH usuario: edita nombre y correo (el correo se guarda en minusculas)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await editar(ids.editable, {
    nombre_completo: 'Nombre Editado',
    correo_electronico: CORREO_EDITADO.toUpperCase(),
  });
  assert.equal(estado, 200);
  assert.equal(datos.id_usuario, ids.editable);
  assert.equal(datos.nombre_completo, 'Nombre Editado');
  assert.equal(datos.correo_electronico, CORREO_EDITADO);
  assert.deepEqual(datos.roles, ['AGENTE']);
});

test('PATCH usuario: la auditoria guarda solo lo que cambio', { skip: SIN_ADMIN }, async () => {
  // El nombre es el mismo de antes: solo debe auditarse el correo.
  const correoNuevo = `test.editado.otra.vez.${SUFIJO}@ejemplo.test`;
  const { estado } = await editar(ids.editable, { nombre_completo: 'Nombre Editado', correo_electronico: correoNuevo });
  assert.equal(estado, 200);
  assert.deepEqual(await ultimaAuditoria('EDICION_USUARIO', ids.editable), {
    id_usuario: ids.editable,
    cambios: { correo_electronico: { anterior: CORREO_EDITADO, nuevo: correoNuevo } },
  });
});

test('PATCH usuario: el correo de otro usuario responde 409 CORREO_DUPLICADO', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await editar(ids.editable, { correo_electronico: CORREOS.agente });
  assert.equal(estado, 409);
  assert.equal(datos.error.codigo, 'CORREO_DUPLICADO');
});

test('PATCH usuario: cuerpo vacio o con campos no permitidos responde 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  const vacio = await editar(ids.editable, {});
  assert.equal(vacio.estado, 400);
  assert.equal(vacio.datos.error.codigo, 'DATOS_INVALIDOS');

  const conPassword = await editar(ids.editable, { password: 'OtraClave123' });
  assert.equal(conPassword.estado, 400);
  assert.equal(conPassword.datos.error.codigo, 'DATOS_INVALIDOS');
});

test('PATCH usuario: un rol inexistente responde 400 ROL_INEXISTENTE', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await editar(ids.editable, { rol: 'NO_EXISTE' });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'ROL_INEXISTENTE');
});

test('PATCH usuario: si un agente pasa a supervisor, pierde su supervisor', { skip: SIN_ADMIN }, async () => {
  assert.equal((await asignar(ids.editable, ids.supervisor)).estado, 200);
  const { estado, datos } = await editar(ids.editable, { rol: 'supervisor' }); // en minusculas a proposito
  assert.equal(estado, 200);
  assert.deepEqual(datos.roles, ['SUPERVISOR']);
  assert.equal(datos.supervisor, null);
  const filas = await consultar('SELECT 1 FROM TB_AsignacionSupervisor WHERE id_agente = ?', [ids.editable]);
  assert.equal(filas.length, 0);
  assert.deepEqual((await ultimaAuditoria('EDICION_USUARIO', ids.editable)).cambios, {
    rol: { anterior: 'AGENTE', nuevo: 'SUPERVISOR' },
  });
});

test('PATCH usuario: si un supervisor pasa a agente, sus agentes quedan sin supervisor', { skip: SIN_ADMIN }, async () => {
  assert.equal((await asignar(ids.agente, ids.otroSupervisor)).estado, 200);
  const { estado } = await editar(ids.otroSupervisor, { rol: 'AGENTE' });
  assert.equal(estado, 200);
  const lista = await llamar('/api/v1/usuarios', { token: tokens.admin });
  assert.equal(lista.datos.find((usuario) => usuario.id_usuario === ids.agente).supervisor, null);
});

test('PATCH usuario: nadie puede cambiar su propio rol, pero si su nombre', { skip: SIN_ADMIN }, async () => {
  const rol = await editar(ids.otroAdmin, { rol: 'AGENTE' }, tokens.otroAdmin);
  assert.equal(rol.estado, 400);
  assert.equal(rol.datos.error.codigo, 'OPERACION_NO_PERMITIDA');

  const nombre = await editar(ids.otroAdmin, { nombre_completo: 'Admin Renombrado' }, tokens.otroAdmin);
  assert.equal(nombre.estado, 200);
  assert.deepEqual(nombre.datos.roles, ['SUPERADMIN']);
});

test('PATCH usuario que no existe responde 404', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await editar(999999999, { nombre_completo: 'Nadie' });
  assert.equal(estado, 404);
  assert.equal(datos.error.codigo, 'NO_ENCONTRADO');
});

// --- PATCH /usuarios/:id_usuario/estado ---

test('PATCH estado: desactivar corta la sesion de inmediato y no deja iniciar otra', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiarEstado(ids.agente, 'INACTIVO');
  assert.equal(estado, 200);
  assert.equal(datos.estado, 'INACTIVO');

  const conTokenViejo = await llamar('/api/v1/auth/me', { token: tokens.agente });
  assert.equal(conTokenViejo.estado, 401);
  assert.equal((await iniciarSesion(CORREOS.agente)).estado, 401);

  assert.deepEqual(await ultimaAuditoria('CAMBIO_ESTADO_USUARIO', ids.agente), {
    id_usuario: ids.agente,
    estado_anterior: 'ACTIVO',
    estado_nuevo: 'INACTIVO',
  });
});

test('PATCH estado: reactivar permite volver a iniciar sesion', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiarEstado(ids.agente, 'ACTIVO');
  assert.equal(estado, 200);
  assert.equal(datos.estado, 'ACTIVO');
  const login = await iniciarSesion(CORREOS.agente);
  assert.equal(login.estado, 200);
  tokens.agente = login.datos.token_acceso;
});

test('PATCH estado: nadie puede desactivarse a si mismo', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiarEstado(ids.otroAdmin, 'INACTIVO', tokens.otroAdmin);
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'OPERACION_NO_PERMITIDA');
  const filas = await consultar('SELECT estado FROM TB_Usuario WHERE id_usuario = ?', [ids.otroAdmin]);
  assert.equal(filas[0].estado, 'ACTIVO');
});

test('PATCH estado con un valor invalido responde 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiarEstado(ids.agente, 'BORRADO');
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'DATOS_INVALIDOS');
  assert.equal(datos.error.detalles[0].campo, 'estado');
});

test('PATCH usuario y PATCH estado: un Agente no tiene permiso (403)', { skip: SIN_ADMIN }, async () => {
  assert.equal((await editar(ids.editable, { nombre_completo: 'Intento' }, tokens.agente)).estado, 403);
  assert.equal((await cambiarEstado(ids.editable, 'INACTIVO', tokens.agente)).estado, 403);
});
