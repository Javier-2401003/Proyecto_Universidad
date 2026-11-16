// Pruebas de PATCH /auth/password y PUT /usuarios/:id_usuario/password contra la base de datos REAL.
// Nunca cambian la contrasena del SuperAdmin de SEED_ADMIN_*: los cambios se prueban con usuarios
// creados aqui, que se borran al terminar. Necesitan SEED_ADMIN_* en backend/.env.
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
  propio: `test.pwd.propio.${SUFIJO}@ejemplo.test`,
  olvido: `test.pwd.olvido.${SUFIJO}@ejemplo.test`,
  agente: `test.pwd.agente.${SUFIJO}@ejemplo.test`,
  intentos: `test.pwd.intentos.${SUFIJO}@ejemplo.test`,
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
  return { estado: respuesta.status, datos: await respuesta.json(), texto: '' };
}

const login = (correo, password) =>
  llamar('/api/v1/auth/login', { metodo: 'POST', cuerpo: { correo_electronico: correo, password } });

async function iniciarSesion(correo, password) {
  const { estado, datos } = await login(correo, password);
  assert.equal(estado, 200, `no se pudo iniciar sesion con ${correo}`);
  return datos.token_acceso;
}

const cambiar = (token, cuerpo) => llamar('/api/v1/auth/password', { metodo: 'PATCH', token, cuerpo });
const restablecer = (id, cuerpo, token = tokens.admin) =>
  llamar(`/api/v1/usuarios/${id}/password`, { metodo: 'PUT', token, cuerpo });

async function auditoria(accion, idUsuario) {
  return consultar(
    `SELECT id_usuario, modulo_afectado, detalle_cambio FROM TB_LogAuditoria
      WHERE accion_ejecutada = ? AND JSON_EXTRACT(detalle_cambio, '$.id_usuario') = ?`,
    [accion, idUsuario]
  );
}

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  for (const clave of Object.keys(CORREOS)) {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba Password ${clave}`, correo_electronico: CORREOS[clave], password: PASSWORD, rol: 'AGENTE' },
    });
    assert.equal(estado, 201);
    ids[clave] = datos.id_usuario;
    tokens[clave] = await iniciarSesion(CORREOS[clave], PASSWORD);
  }
});

after(async () => {
  try {
    const usuarios = Object.values(ids);
    if (usuarios.length > 0) {
      const marcas = usuarios.map(() => '?').join(', ');
      await consultar(`DELETE FROM TB_LogAuditoria WHERE id_usuario IN (${marcas})`, usuarios);
      await consultar(`DELETE FROM TB_Usuario WHERE id_usuario IN (${marcas})`, usuarios);
    }
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('cambiar la propia: sin token, 401', async () => {
  const { estado, datos } = await cambiar(undefined, { password_actual: 'x', password_nueva: 'ClaveNueva456' });
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'NO_AUTENTICADO');
});

test('cambiar la propia: datos invalidos, 400 con el campo', { skip: SIN_ADMIN }, async () => {
  const casos = [
    [{ password_nueva: 'ClaveNueva456' }, 'password_actual'],
    [{ password_actual: PASSWORD }, 'password_nueva'],
    [{ password_actual: PASSWORD, password_nueva: 'corta1' }, 'password_nueva'],
    [{ password_actual: PASSWORD, password_nueva: 'ñ'.repeat(37) }, 'password_nueva'], // 74 bytes
  ];
  for (const [cuerpo, campo] of casos) {
    const { estado, datos } = await cambiar(tokens.propio, cuerpo);
    assert.equal(estado, 400, JSON.stringify(cuerpo));
    assert.equal(datos.error.codigo, 'DATOS_INVALIDOS');
    assert.ok(datos.error.detalles.some((detalle) => detalle.campo === campo), JSON.stringify(datos.error.detalles));
  }
});

test('cambiar la propia: la actual equivocada da 400 PASSWORD_INCORRECTA, no 401', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiar(tokens.propio, { password_actual: 'NoEsLaClave1', password_nueva: 'ClaveNueva456' });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'PASSWORD_INCORRECTA');
  assert.equal(datos.error.detalles[0].campo, 'password_actual');
});

test('cambiar la propia: igual a la actual da 400 PASSWORD_REPETIDA', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await cambiar(tokens.propio, { password_actual: PASSWORD, password_nueva: PASSWORD });
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'PASSWORD_REPETIDA');
});

test('cambiar la propia: funciona, la vieja deja de servir y queda auditado sin contrasenas', { skip: SIN_ADMIN }, async () => {
  const nueva = 'ClaveNueva456ñ';
  const { estado, datos } = await cambiar(tokens.propio, { password_actual: PASSWORD, password_nueva: nueva });
  assert.equal(estado, 200);
  assert.deepEqual(datos, { mensaje: 'La contraseña se cambió correctamente.' });

  assert.equal((await login(CORREOS.propio, PASSWORD)).estado, 401);
  assert.equal((await login(CORREOS.propio, nueva)).estado, 200);

  const [registro, ...otros] = await auditoria('CAMBIO_PASSWORD', ids.propio);
  assert.equal(otros.length, 0);
  assert.equal(registro.id_usuario, ids.propio);
  assert.equal(registro.modulo_afectado, 'AUTENTICACION');
  assert.deepEqual(registro.detalle_cambio, { id_usuario: ids.propio });
});

test('restablecer: un Agente no tiene GESTION_USUARIOS escribir, 403', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await restablecer(ids.olvido, { password_nueva: 'ClaveNueva456' }, tokens.agente);
  assert.equal(estado, 403);
  assert.equal(datos.error.codigo, 'PROHIBIDO');
});

test('restablecer: errores (propio usuario, no existe, id invalido, contrasena corta)', { skip: SIN_ADMIN }, async () => {
  const [{ id_usuario: idAdmin }] = await consultar('SELECT id_usuario FROM TB_Usuario WHERE correo_electronico = ?', [CORREO_ADMIN]);
  const propio = await restablecer(idAdmin, { password_nueva: 'NoSeAplica123' });
  assert.equal(propio.estado, 400);
  assert.equal(propio.datos.error.codigo, 'OPERACION_NO_PERMITIDA');

  const noExiste = await restablecer(999999999, { password_nueva: 'ClaveNueva456' });
  assert.equal(noExiste.estado, 404);
  assert.equal(noExiste.datos.error.codigo, 'NO_ENCONTRADO');

  const idInvalido = await restablecer('abc', { password_nueva: 'ClaveNueva456' });
  assert.equal(idInvalido.estado, 400);
  const corta = await restablecer(ids.olvido, { password_nueva: 'corta' });
  assert.equal(corta.estado, 400);
  assert.equal(corta.datos.error.codigo, 'DATOS_INVALIDOS');

  // Nada de lo anterior cambio la contrasena del SuperAdmin.
  assert.equal((await login(CORREO_ADMIN, PASSWORD_ADMIN)).estado, 200);
});

test('restablecer: funciona tambien con un usuario inactivo y responde con el usuario', { skip: SIN_ADMIN }, async () => {
  await llamar(`/api/v1/usuarios/${ids.olvido}/estado`, { metodo: 'PATCH', token: tokens.admin, cuerpo: { estado: 'INACTIVO' } });
  const nueva = 'Restablecida789';
  const { estado, datos } = await restablecer(ids.olvido, { password_nueva: nueva });
  assert.equal(estado, 200);
  assert.equal(datos.id_usuario, ids.olvido);
  assert.equal(datos.estado, 'INACTIVO');
  assert.deepEqual(Object.keys(datos).sort(), ['correo_electronico', 'estado', 'fecha_creacion', 'id_usuario', 'nombre_completo', 'roles', 'supervisor']);
  assert.doesNotMatch(JSON.stringify(datos), /"password[^"]*"\s*:|hash|\$2[aby]\$/i); // ni campo ni hash bcrypt

  await llamar(`/api/v1/usuarios/${ids.olvido}/estado`, { metodo: 'PATCH', token: tokens.admin, cuerpo: { estado: 'ACTIVO' } });
  assert.equal((await login(CORREOS.olvido, PASSWORD)).estado, 401);
  assert.equal((await login(CORREOS.olvido, nueva)).estado, 200);

  const [registro] = await auditoria('RESTABLECIMIENTO_PASSWORD', ids.olvido);
  assert.equal(registro.modulo_afectado, 'GESTION_USUARIOS');
  assert.deepEqual(registro.detalle_cambio, { id_usuario: ids.olvido });
});

// Al final: deja el limite de intentos agotado para esta IP en este proceso.
test('cambiar la propia: tras 10 intentos con la actual equivocada, 429 aunque luego acierte', { skip: SIN_ADMIN }, async () => {
  let estado;
  for (let intento = 0; intento < 12 && estado !== 429; intento += 1) {
    ({ estado } = await cambiar(tokens.intentos, { password_actual: 'NoEsLaClave1', password_nueva: 'ClaveNueva456' }));
  }
  assert.equal(estado, 429);
  const acierta = await cambiar(tokens.intentos, { password_actual: PASSWORD, password_nueva: 'ClaveNueva456' });
  assert.equal(acierta.estado, 429);
  assert.equal(acierta.datos.error.codigo, 'DEMASIADOS_INTENTOS');
  assert.equal((await login(CORREOS.intentos, PASSWORD)).estado, 200); // no cambio
});
