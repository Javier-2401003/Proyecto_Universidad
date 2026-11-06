// Pruebas de GET /roles contra la base de datos REAL. Crean un usuario de cada rol que
// no debe poder verlos y lo borran al terminar. Necesitan SEED_ADMIN_* en backend/.env.
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
  SUPERVISOR: `test.rol.supervisor.${SUFIJO}@ejemplo.test`,
  AGENTE: `test.rol.agente.${SUFIJO}@ejemplo.test`,
};

let servidor;
let base;
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

async function iniciarSesion(correo, password) {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: correo, password },
  });
  assert.equal(estado, 200, `no se pudo iniciar sesion con ${correo}`);
  return datos.token_acceso;
}

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  for (const [rol, correo] of Object.entries(CORREOS)) {
    const { estado } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba ${rol}`, correo_electronico: correo, password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    tokens[rol] = await iniciarSesion(correo, PASSWORD);
  }
});

after(async () => {
  try {
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('sin token: 401', async () => {
  const { estado, datos } = await llamar('/api/v1/roles');
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'NO_AUTENTICADO');
});

test('SuperAdmin: lista los roles de TB_Rol, ordenados por nombre', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/roles', { token: tokens.admin });
  assert.equal(estado, 200);

  const nombres = datos.map((rol) => rol.nombre_rol);
  assert.deepEqual(nombres, [...nombres].sort());
  for (const rol of ['AGENTE', 'SUPERADMIN', 'SUPERVISOR']) {
    assert.ok(nombres.includes(rol), `falta el rol ${rol}`);
  }
  assert.deepEqual(Object.keys(datos[0]).sort(), ['descripcion', 'id_rol', 'nombre_rol']);
  assert.equal(typeof datos[0].id_rol, 'number');

  const enBase = await consultar('SELECT COUNT(*) AS total FROM TB_Rol');
  assert.equal(datos.length, enBase[0].total);
});

test('quien no tiene GESTION_USUARIOS: 403', { skip: SIN_ADMIN }, async () => {
  for (const rol of ['SUPERVISOR', 'AGENTE']) {
    const { estado, datos } = await llamar('/api/v1/roles', { token: tokens[rol] });
    assert.equal(estado, 403, rol);
    assert.equal(datos.error.codigo, 'PROHIBIDO', rol);
  }
});
