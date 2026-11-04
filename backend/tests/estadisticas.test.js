// Pruebas de GET /estadisticas/resumen contra la base de datos REAL. Crean sus propios
// usuarios y llamadas y los borran al terminar. Necesitan SEED_ADMIN_* en backend/.env.
// El SuperAdmin tambien ve datos de otras pruebas, asi que con el se revisa solo la fila
// de cada agente de prueba; los totales exactos se revisan con Supervisor y Agente.
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
  supervisor: `test.est.supervisor.${SUFIJO}@ejemplo.test`,
  ana: `test.est.ana.${SUFIJO}@ejemplo.test`,
  beto: `test.est.beto.${SUFIJO}@ejemplo.test`,
  ajeno: `test.est.ajeno.${SUFIJO}@ejemplo.test`,
  sinLlamadas: `test.est.sin.llamadas.${SUFIJO}@ejemplo.test`,
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

async function iniciarSesion(correo, password) {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: correo, password },
  });
  assert.equal(estado, 200, `no se pudo iniciar sesion con ${correo}`);
  return datos.token_acceso;
}

async function insertarLlamada(idAgente, estado, haceDias, hora, puntaje = 0, clasificacion = 'NEUTRO', baja = 0) {
  const resultado = await consultar(
    `INSERT INTO TB_Llamada
       (id_agente, estado_procesamiento, fecha_inicio, puntaje_final, clasificacion_final, baja_confianza_audio)
     VALUES (?, ?, TIMESTAMP(CURDATE() - INTERVAL ? DAY, ?), ?, ?, ?)`,
    [idAgente, estado, haceDias, hora, puntaje, clasificacion, baja]
  );
  return resultado.insertId;
}

const insertarAlerta = (idLlamada, tipo) =>
  consultar(
    `INSERT INTO TB_Alerta (id_llamada, tipo_alerta, origen_evento, timestamp_evento) VALUES (?, ?, 'CLIENTE', 1)`,
    [idLlamada, tipo]
  );

const pedirResumen = (token, consulta = '') => llamar(`/api/v1/estadisticas/resumen${consulta}`, { token });

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  const crear = async (clave, rol, nombre) => {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: nombre, correo_electronico: CORREOS[clave], password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    ids[clave] = datos.id_usuario;
    tokens[clave] = await iniciarSesion(CORREOS[clave], PASSWORD);
  };
  await crear('supervisor', 'SUPERVISOR', 'Prueba Supervisor');
  await crear('ana', 'AGENTE', `Ana Prueba ${SUFIJO}`);
  await crear('beto', 'AGENTE', `Beto Prueba ${SUFIJO}`);
  await crear('ajeno', 'AGENTE', `Ajeno Prueba ${SUFIJO}`);
  await crear('sinLlamadas', 'AGENTE', `Sin Llamadas ${SUFIJO}`);
  for (const agente of [ids.ana, ids.beto, ids.sinLlamadas]) {
    await consultar('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [
      ids.supervisor,
      agente,
    ]);
  }

  // Ana: dos completadas dentro de 7 dias (una justo en el borde), una justo fuera y otras en cola.
  const positiva = await insertarLlamada(ids.ana, 'COMPLETADO', 0, '00:00:01', 80, 'POSITIVO');
  const critica = await insertarLlamada(ids.ana, 'COMPLETADO', 6, '00:00:00', 15.55, 'CRITICO', 1);
  await insertarLlamada(ids.ana, 'COMPLETADO', 7, '23:59:59', 50, 'NEUTRO');
  await insertarLlamada(ids.ana, 'PENDIENTE', 0, '00:00:02');
  const conError = await insertarLlamada(ids.ana, 'ERROR', 0, '00:00:03');
  await insertarLlamada(ids.ana, 'COMPLETADO', 90, '12:00:00', 99, 'POSITIVO'); // fuera de 90 dias
  await insertarAlerta(positiva, 'EXCESO_VOLUMEN');
  await insertarAlerta(positiva, 'EXCESO_VOLUMEN');
  await insertarAlerta(critica, 'OMISION_SCRIPT');
  await insertarAlerta(conError, 'ALTERACION_TONO'); // no cuenta: la llamada no esta COMPLETADO

  // Beto: solo en cola. Ajeno: no lo ve el supervisor.
  await insertarLlamada(ids.beto, 'PENDIENTE', 1, '10:00:00');
  await insertarLlamada(ids.ajeno, 'COMPLETADO', 1, '10:00:00', 10, 'CRITICO');
});

after(async () => {
  try {
    const agentes = [ids.ana, ids.beto, ids.ajeno].filter(Boolean);
    for (const agente of agentes) {
      await consultar('DELETE FROM TB_Llamada WHERE id_agente = ?', [agente]); // alertas en cascada
    }
    if (ids.supervisor) {
      await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ?', [ids.supervisor]);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?, ?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('sin token: 401', async () => {
  const { estado, datos } = await pedirResumen(undefined);
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'NO_AUTENTICADO');
});

test('dias invalido: 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  for (const consulta of ['?dias=15', '?dias=abc', '?dias=', '?dias=7&dias=30']) {
    const { estado, datos } = await pedirResumen(tokens.ana, consulta);
    assert.equal(estado, 400, consulta);
    assert.equal(datos.error.codigo, 'DATOS_INVALIDOS', consulta);
  }
});

test('Supervisor: la respuesta completa, solo de sus agentes y del periodo', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await pedirResumen(tokens.supervisor, '?dias=7');
  assert.equal(estado, 200);
  const [hoy] = await consultar(
    `SELECT DATE_FORMAT(CURDATE() - INTERVAL 6 DAY, '%Y-%m-%d') AS desde, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hasta`
  );
  assert.deepEqual(datos, {
    periodo: { dias: 7, desde: hoy.desde, hasta: hoy.hasta },
    llamadas: { total: 5, por_estado: { PENDIENTE: 2, PROCESANDO: 0, COMPLETADO: 2, ERROR: 1 } },
    sentimiento: {
      puntaje_promedio: 47.8, // (80 + 15,55) / 2: los pendientes con puntaje 0 no cuentan
      por_clasificacion: { POSITIVO: 1, NEUTRO: 0, NEGATIVO: 0, CRITICO: 1 },
      baja_confianza_audio: 1,
    },
    alertas: {
      total: 3,
      por_tipo: { EXCESO_VOLUMEN: 2, ALTERACION_TONO: 0, VOCABULARIO_INADECUADO: 0, OMISION_SCRIPT: 1 },
    },
    agentes: [
      {
        id_usuario: ids.ana,
        nombre_completo: `Ana Prueba ${SUFIJO}`,
        llamadas_completadas: 2,
        puntaje_promedio: 47.8,
        llamadas_criticas: 1,
        alertas: 3,
      },
      {
        id_usuario: ids.beto,
        nombre_completo: `Beto Prueba ${SUFIJO}`,
        llamadas_completadas: 0,
        puntaje_promedio: null,
        llamadas_criticas: 0,
        alertas: 0,
      },
    ],
  });
});

test('por defecto son 30 dias e incluyen el dia justo fuera de 7', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedirResumen(tokens.ana);
  assert.equal(datos.periodo.dias, 30);
  assert.equal(datos.llamadas.por_estado.COMPLETADO, 3);
  assert.equal(datos.sentimiento.puntaje_promedio, 48.5);
});

test('90 dias: el dia 90 hacia atras queda fuera', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedirResumen(tokens.ana, '?dias=90');
  assert.equal(datos.llamadas.por_estado.COMPLETADO, 3);
});

test('Agente: solo el mismo', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedirResumen(tokens.beto);
  assert.deepEqual(datos.agentes.map((agente) => agente.id_usuario), [ids.beto]);
  assert.equal(datos.llamadas.total, 1);
  assert.equal(datos.sentimiento.puntaje_promedio, null);
  assert.equal(datos.sentimiento.baja_confianza_audio, 0);
  assert.equal(datos.alertas.total, 0);
});

test('sin llamadas: todas las claves en 0 y agentes vacio', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await pedirResumen(tokens.sinLlamadas);
  assert.equal(estado, 200);
  assert.deepEqual(datos.llamadas, { total: 0, por_estado: { PENDIENTE: 0, PROCESANDO: 0, COMPLETADO: 0, ERROR: 0 } });
  assert.deepEqual(datos.sentimiento, {
    puntaje_promedio: null,
    por_clasificacion: { POSITIVO: 0, NEUTRO: 0, NEGATIVO: 0, CRITICO: 0 },
    baja_confianza_audio: 0,
  });
  assert.deepEqual(datos.alertas.por_tipo, { EXCESO_VOLUMEN: 0, ALTERACION_TONO: 0, VOCABULARIO_INADECUADO: 0, OMISION_SCRIPT: 0 });
  assert.deepEqual(datos.agentes, []);
});

test('SuperAdmin: ve a todos, tambien a un agente que no es de su equipo', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedirResumen(tokens.admin, '?dias=7');
  const fila = (id) => datos.agentes.find((agente) => agente.id_usuario === id);
  assert.equal(fila(ids.ajeno).llamadas_criticas, 1);
  assert.equal(fila(ids.ana).alertas, 3);
  assert.equal(fila(ids.beto).puntaje_promedio, null);
  assert.equal(fila(ids.sinLlamadas), undefined);
  assert.ok(datos.llamadas.total >= 6); // Ana 4, Beto 1, Ajeno 1, mas las de otras pruebas
});

test('un supervisor deja de ver a un agente cuando se lo reasignan', { skip: SIN_ADMIN }, async () => {
  await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ? AND id_agente = ?', [ids.supervisor, ids.beto]);
  const { datos } = await pedirResumen(tokens.supervisor, '?dias=7');
  assert.deepEqual(datos.agentes.map((agente) => agente.id_usuario), [ids.ana]);
  await consultar('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [ids.supervisor, ids.beto]);
});
