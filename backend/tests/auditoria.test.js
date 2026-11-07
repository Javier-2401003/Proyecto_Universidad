// Pruebas de GET /auditoria contra la base de datos REAL. Crean sus usuarios y sus propios
// registros de auditoria (con fechas fijas) y los borran al terminar. Para no depender de
// los registros que dejan otras pruebas, casi todas filtran por el usuario de prueba.
// Necesitan SEED_ADMIN_* en backend/.env.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const { crearApp } = await import('../src/app.js');
const { consultar, pool } = await import('../src/db.js');

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const SUFIJO = Date.now();
const PASSWORD = 'ClaveDePrueba123';
const CORREOS = {
  autor: `test.aud.autor.${SUFIJO}@ejemplo.test`,
  supervisor: `test.aud.supervisor.${SUFIJO}@ejemplo.test`,
  agente: `test.aud.agente.${SUFIJO}@ejemplo.test`,
};

let servidor;
let base;
const ids = {};
const tokens = {};
const registros = {};

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

async function iniciarSesion(correo, password) {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: correo, password },
  });
  assert.equal(estado, 200, `no se pudo iniciar sesion con ${correo}`);
  return datos.token_acceso;
}

async function registrar(accion, modulo, fecha, detalle = { prueba: true }) {
  const resultado = await consultar(
    `INSERT INTO TB_LogAuditoria (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip, fecha_evento)
     VALUES (?, ?, ?, ?, '10.0.0.7', ?)`,
    [ids.autor, accion, modulo, JSON.stringify(detalle), fecha]
  );
  return resultado.insertId;
}

const pedir = (consulta, token = tokens.admin) => llamar(`/api/v1/auditoria${consulta}`, { token });
const delAutor = (extra = '') => pedir(`?id_usuario=${ids.autor}${extra}`);

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  for (const [clave, rol] of [['autor', 'AGENTE'], ['supervisor', 'SUPERVISOR'], ['agente', 'AGENTE']]) {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba Auditoria ${clave}`, correo_electronico: CORREOS[clave], password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    ids[clave] = datos.id_usuario;
  }
  tokens.supervisor = await iniciarSesion(CORREOS.supervisor, PASSWORD);
  tokens.agente = await iniciarSesion(CORREOS.agente, PASSWORD);

  // Del mas antiguo al mas reciente. Dos con la misma fecha: el desempate es id_log.
  registros.antes = await registrar('CARGA_LOTE', 'CARGA_LOTES', '2026-10-31 23:59:59');
  registros.primero = await registrar('EDICION_USUARIO', 'GESTION_USUARIOS', '2026-11-01 00:00:00', {
    id_usuario: 9,
    cambios: { nombre_completo: { anterior: 'Ana', nuevo: 'Ana Torres' } },
  });
  registros.empateA = await registrar('CREACION_USUARIO', 'GESTION_USUARIOS', '2026-11-02 10:00:00');
  registros.empateB = await registrar('CREACION_USUARIO', 'GESTION_USUARIOS', '2026-11-02 10:00:00');
  registros.ultimo = await registrar('CARGA_LOTE', 'CARGA_LOTES', '2026-11-03 23:59:59');
  registros.despues = await registrar('EDICION_USUARIO', 'GESTION_USUARIOS', '2026-11-04 00:00:00');
});

after(async () => {
  try {
    const usuarios = Object.values(ids);
    if (usuarios.length > 0) {
      await consultar(`DELETE FROM TB_LogAuditoria WHERE id_usuario IN (${usuarios.map(() => '?').join(', ')})`, usuarios);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('sin token: 401', async () => {
  const { estado, datos } = await llamar('/api/v1/auditoria');
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'NO_AUTENTICADO');
});

test('Supervisor y Agente no tienen AUDITORIA: 403', { skip: SIN_ADMIN }, async () => {
  for (const rol of ['supervisor', 'agente']) {
    const { estado, datos } = await pedir('', tokens[rol]);
    assert.equal(estado, 403, rol);
    assert.equal(datos.error.codigo, 'PROHIBIDO', rol);
  }
});

test('SuperAdmin: forma de la respuesta, sin contrasenas ni hashes', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await delAutor(`&accion=EDICION_USUARIO&hasta=2026-11-01`);
  assert.equal(estado, 200);
  assert.deepEqual(datos, {
    pagina: 1,
    tamano_pagina: 50,
    total: 1,
    total_paginas: 1,
    registros: [
      {
        id_log: registros.primero,
        fecha_evento: datos.registros[0].fecha_evento,
        usuario: { id_usuario: ids.autor, nombre_completo: 'Prueba Auditoria autor', correo_electronico: CORREOS.autor },
        accion_ejecutada: 'EDICION_USUARIO',
        modulo_afectado: 'GESTION_USUARIOS',
        detalle_cambio: { id_usuario: 9, cambios: { nombre_completo: { anterior: 'Ana', nuevo: 'Ana Torres' } } },
        direccion_ip: '10.0.0.7',
      },
    ],
  });
  assert.ok(!Number.isNaN(Date.parse(datos.registros[0].fecha_evento)));
  assert.doesNotMatch(JSON.stringify(datos), /password|hash/i);
});

test('del mas reciente al mas antiguo; con la misma fecha, por id_log', { skip: SIN_ADMIN }, async () => {
  const { datos } = await delAutor();
  assert.equal(datos.total, 6);
  assert.deepEqual(
    datos.registros.map((registro) => registro.id_log),
    [registros.despues, registros.ultimo, registros.empateB, registros.empateA, registros.primero, registros.antes]
  );
});

test('desde y hasta incluyen el dia completo', { skip: SIN_ADMIN }, async () => {
  const { datos } = await delAutor('&desde=2026-11-01&hasta=2026-11-03');
  assert.deepEqual(
    datos.registros.map((registro) => registro.id_log),
    [registros.ultimo, registros.empateB, registros.empateA, registros.primero]
  );
  const soloDesde = await delAutor('&desde=2026-11-04');
  assert.deepEqual(soloDesde.datos.registros.map((registro) => registro.id_log), [registros.despues]);
});

test('accion y modulo sin importar mayusculas', { skip: SIN_ADMIN }, async () => {
  const porAccion = await delAutor('&accion=carga_lote');
  assert.deepEqual(porAccion.datos.registros.map((registro) => registro.id_log), [registros.ultimo, registros.antes]);
  const porModulo = await delAutor('&modulo=Gestion_Usuarios');
  assert.equal(porModulo.datos.total, 4);
  const combinados = await delAutor('&modulo=GESTION_USUARIOS&accion=CREACION_USUARIO');
  assert.deepEqual(combinados.datos.registros.map((registro) => registro.id_log), [registros.empateB, registros.empateA]);
});

test('paginacion: total, total_paginas y una pagina despues de la ultima', { skip: SIN_ADMIN }, async () => {
  const segunda = await delAutor('&tamano_pagina=4&pagina=2');
  assert.equal(segunda.datos.total, 6);
  assert.equal(segunda.datos.total_paginas, 2);
  assert.deepEqual(segunda.datos.registros.map((registro) => registro.id_log), [registros.primero, registros.antes]);

  const fuera = await delAutor('&tamano_pagina=4&pagina=3');
  assert.equal(fuera.estado, 200);
  assert.deepEqual(fuera.datos.registros, []);
  assert.equal(fuera.datos.total, 6);
});

test('sin resultados: total 0 y total_paginas 0', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await pedir(`?id_usuario=${ids.supervisor}&accion=NO_EXISTE`);
  assert.equal(estado, 200);
  assert.deepEqual(datos, { pagina: 1, tamano_pagina: 50, total: 0, total_paginas: 0, registros: [] });
});

test('sin filtros responde con todo el registro, paginado', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await pedir('?tamano_pagina=3');
  assert.equal(estado, 200);
  assert.equal(datos.registros.length, 3);
  assert.ok(datos.total >= 6);
  const fechas = datos.registros.map((registro) => Date.parse(registro.fecha_evento));
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
});

test('parametros invalidos: 400 DATOS_INVALIDOS con el campo', { skip: SIN_ADMIN }, async () => {
  const casos = [
    ['?tamano_pagina=101', 'tamano_pagina'],
    ['?tamano_pagina=0', 'tamano_pagina'],
    ['?pagina=0', 'pagina'],
    ['?pagina=abc', 'pagina'],
    ['?id_usuario=abc', 'id_usuario'],
    ['?desde=2026-13-01', 'desde'],
    ['?hasta=2026-02-30', 'hasta'],
    ['?desde=01-11-2026', 'desde'],
    ['?desde=2026-11-05&hasta=2026-11-01', 'desde'],
    ['?accion=', 'accion'],
    ['?accion=A&accion=B', 'accion'],
  ];
  for (const [consulta, campo] of casos) {
    const { estado, datos } = await pedir(consulta);
    assert.equal(estado, 400, consulta);
    assert.equal(datos.error.codigo, 'DATOS_INVALIDOS', consulta);
    assert.ok(datos.error.detalles.some((detalle) => detalle.campo === campo), `${consulta}: ${JSON.stringify(datos.error.detalles)}`);
  }
});
