// Pruebas de la API contra la base de datos REAL (Wamp debe estar en verde y
// los scripts 01 y 02 ejecutados). Ejecutar desde backend/:  npm test
//
// Las pruebas que necesitan un SuperAdmin usan SEED_ADMIN_CORREO y
// SEED_ADMIN_PASSWORD de backend/.env (el usuario creado con crear-superadmin).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { crearApp } from '../src/app.js';
import { consultar, pool } from '../src/db.js';

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const CORREO_AGENTE = `test.agente.${Date.now()}@ejemplo.test`;
const PASSWORD_AGENTE = 'ClaveDePrueba123';

let servidor;
let base;
let tokenAdmin;

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

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  // Si la base de datos falla, igual se cierran servidor y pool para que el proceso termine.
  try {
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico = ?', [CORREO_AGENTE]);
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('GET /health confirma que la base de datos responde', async () => {
  const { estado, datos } = await llamar('/health');
  assert.equal(estado, 200);
  assert.equal(datos.base_de_datos, true);
});

test('el esquema tiene las 12 tablas TB_ y los 3 roles base', async () => {
  const tablas = await consultar(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'TB\\_%'"
  );
  assert.equal(tablas[0].total, 12);
  const roles = await consultar("SELECT COUNT(*) AS total FROM TB_Rol WHERE nombre_rol IN ('SUPERADMIN','SUPERVISOR','AGENTE')");
  assert.equal(roles[0].total, 3);
});

test('login con contrasena incorrecta responde 401', async () => {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: 'no.existe@ejemplo.test', password: 'cualquiera' },
  });
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'CREDENCIALES_INVALIDAS');
});

test('login con datos mal formados responde 400', async () => {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: 'esto-no-es-un-correo', password: 'x' },
  });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'DATOS_INVALIDOS');
});

test('una ruta protegida sin token responde 401', async () => {
  const { estado } = await llamar('/api/v1/usuarios');
  assert.equal(estado, 401);
});

test('un token manipulado responde 401', async () => {
  const { estado } = await llamar('/api/v1/auth/me', { token: 'abc.def.ghi' });
  assert.equal(estado, 401);
});

test('el SuperAdmin inicia sesion y recibe token, roles y permisos', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: CORREO_ADMIN, password: PASSWORD_ADMIN },
  });
  assert.equal(estado, 200);
  assert.equal(datos.tipo_token, 'Bearer');
  assert.ok(datos.token_acceso);
  assert.ok(datos.usuario.roles.includes('SUPERADMIN'));
  const gestion = datos.usuario.permisos.find((p) => p.modulo === 'GESTION_USUARIOS');
  assert.equal(gestion.escribir, true);
  tokenAdmin = datos.token_acceso;
});

test('GET /auth/me devuelve al usuario autenticado', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/auth/me', { token: tokenAdmin });
  assert.equal(estado, 200);
  assert.equal(datos.correo, CORREO_ADMIN);
});

test('crear usuario con contrasena corta responde 400', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/usuarios', {
    metodo: 'POST',
    token: tokenAdmin,
    cuerpo: { nombre_completo: 'Agente Prueba', correo_electronico: CORREO_AGENTE, password: 'corta', rol: 'AGENTE' },
  });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'DATOS_INVALIDOS');
});

test('crear usuario con un rol inexistente responde 400', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/usuarios', {
    metodo: 'POST',
    token: tokenAdmin,
    cuerpo: { nombre_completo: 'Agente Prueba', correo_electronico: CORREO_AGENTE, password: PASSWORD_AGENTE, rol: 'NO_EXISTE' },
  });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'ROL_INEXISTENTE');
});

test('el SuperAdmin crea un agente y el correo repetido responde 409', { skip: SIN_ADMIN }, async () => {
  const cuerpo = { nombre_completo: 'Agente Prueba', correo_electronico: CORREO_AGENTE, password: PASSWORD_AGENTE, rol: 'AGENTE' };
  const creado = await llamar('/api/v1/usuarios', { metodo: 'POST', token: tokenAdmin, cuerpo });
  assert.equal(creado.estado, 201);
  assert.ok(creado.datos.id_usuario);

  const repetido = await llamar('/api/v1/usuarios', { metodo: 'POST', token: tokenAdmin, cuerpo });
  assert.equal(repetido.estado, 409);
  assert.equal(repetido.datos.error.codigo, 'CORREO_DUPLICADO');
});

test('la creacion del usuario quedo registrada en la auditoria', { skip: SIN_ADMIN }, async () => {
  const filas = await consultar(
    `SELECT l.direccion_ip, l.detalle_cambio
       FROM TB_LogAuditoria l JOIN TB_Usuario u ON u.id_usuario = l.id_usuario
      WHERE u.correo_electronico = ? AND l.accion_ejecutada = 'CREACION_USUARIO'
      ORDER BY l.id_log DESC LIMIT 1`,
    [CORREO_ADMIN]
  );
  assert.equal(filas.length, 1);
  assert.ok(filas[0].direccion_ip);
  assert.ok(!JSON.stringify(filas[0].detalle_cambio).includes(PASSWORD_AGENTE));
});

test('RBAC: un Agente no puede listar usuarios (403) y solo ve su propio panel', { skip: SIN_ADMIN }, async () => {
  const login = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: CORREO_AGENTE, password: PASSWORD_AGENTE },
  });
  assert.equal(login.estado, 200);
  assert.deepEqual(login.datos.usuario.roles, ['AGENTE']);
  assert.deepEqual(login.datos.usuario.permisos.map((p) => p.modulo), ['PANEL_AGENTE']);

  const prohibido = await llamar('/api/v1/usuarios', { token: login.datos.token_acceso });
  assert.equal(prohibido.estado, 403);
  assert.equal(prohibido.datos.error.codigo, 'PROHIBIDO');
});

test('un usuario desactivado ya no puede usar su token', { skip: SIN_ADMIN }, async () => {
  const login = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: CORREO_AGENTE, password: PASSWORD_AGENTE },
  });
  await consultar("UPDATE TB_Usuario SET estado = 'INACTIVO' WHERE correo_electronico = ?", [CORREO_AGENTE]);
  const { estado } = await llamar('/api/v1/auth/me', { token: login.datos.token_acceso });
  assert.equal(estado, 401);
});
