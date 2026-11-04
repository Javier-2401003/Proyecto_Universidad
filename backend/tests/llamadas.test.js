// Pruebas de GET /llamadas/:id_llamada y GET /llamadas/:id_llamada/audio contra la
// base de datos REAL. Crean sus propios usuarios, un lote y sus llamadas (con
// transcripcion, alertas y audio en disco) y los borran al terminar.
// Necesitan SEED_ADMIN_* en backend/.env, igual que api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { crearApp } = await import('../src/app.js');
const { consultar, pool } = await import('../src/db.js');
const { config } = await import('../src/config.js');

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const SUFIJO = Date.now();
const PASSWORD = 'ClaveDePrueba123';
const CORREOS = {
  supervisor: `test.det.supervisor.${SUFIJO}@ejemplo.test`,
  agente: `test.det.agente.${SUFIJO}@ejemplo.test`,
  agenteAjeno: `test.det.agente.ajeno.${SUFIJO}@ejemplo.test`,
  supervisorAjeno: `test.det.supervisor.ajeno.${SUFIJO}@ejemplo.test`,
};

// MP3 de prueba (cabecera ID3 + bytes al azar): basta para comprobar que llega igual.
const AUDIO = Buffer.concat([Buffer.from('ID3', 'latin1'), randomBytes(3000)]);

let servidor;
let base;
const ids = {};
const tokens = {};
const llamadas = {};
let idLote;

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

async function insertarLlamada(idAgente, campos) {
  const columnas = Object.keys(campos);
  const [resultado] = await pool.execute(
    `INSERT INTO TB_Llamada (id_agente, id_lote, ${columnas.join(', ')})
     VALUES (?, ?, ${columnas.map(() => '?').join(', ')})`,
    [idAgente, idLote, ...Object.values(campos)]
  );
  return resultado.insertId;
}

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  const crear = async (correo, rol) => {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba ${rol}`, correo_electronico: correo, password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    return datos.id_usuario;
  };
  ids.supervisor = await crear(CORREOS.supervisor, 'SUPERVISOR');
  ids.agente = await crear(CORREOS.agente, 'AGENTE');
  ids.agenteAjeno = await crear(CORREOS.agenteAjeno, 'AGENTE');
  ids.supervisorAjeno = await crear(CORREOS.supervisorAjeno, 'SUPERVISOR');
  await consultar('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [
    ids.supervisor,
    ids.agente,
  ]);

  // Un lote con llamadas ya "procesadas": el analisis de audio aun no existe.
  const [lote] = await pool.execute(
    'INSERT INTO TB_LoteAudio (codigo_lote, id_usuario_carga, total_archivos) VALUES (?, ?, 3)',
    [`TEST-DET-${SUFIJO}`.slice(0, 30), ids.supervisor]
  );
  idLote = lote.insertId;

  llamadas.completada = await insertarLlamada(ids.agente, {
    nombre_archivo_original: 'llamada señora Pérez.mp3',
    estado_procesamiento: 'COMPLETADO',
    duracion_segundos: 184,
    baja_confianza_audio: 1,
    score_global_nlp: 0.41,
    score_acustico: -0.125,
    puntaje_final: 72.5,
    clasificacion_final: 'POSITIVO',
    diagnostico_conflicto: 'SIN_CONFLICTO',
  });
  const ruta = `lotes/${idLote}/${llamadas.completada}.mp3`;
  await mkdir(path.join(config.lotes.carpetaUploads, 'lotes', String(idLote)), { recursive: true });
  await writeFile(path.join(config.lotes.carpetaUploads, ruta), AUDIO);
  await consultar('UPDATE TB_Llamada SET ruta_audio_storage = ? WHERE id_llamada = ?', [ruta, llamadas.completada]);

  // Insertadas fuera de orden para comprobar que la respuesta las ordena por tiempo.
  await consultar(
    `INSERT INTO TB_Transcripcion
       (id_llamada, hablante, texto_transcrito, timestamp_inicio, timestamp_fin, score_sentimiento, nivel_volumen_rms, tono_f0_hz)
     VALUES (?, 'CLIENTE', 'Tengo un problema con mi factura.', 4.2, 8.0, -0.35, -18.5, NULL),
            (?, 'AGENTE', 'Buenas tardes, gracias por llamar.', 0, 4.2, 0.6, -20.25, 213.64)`,
    [llamadas.completada, llamadas.completada]
  );
  await consultar(
    `INSERT INTO TB_Alerta (id_llamada, tipo_alerta, origen_evento, timestamp_evento, valor_registrado, mensaje_sugerencia)
     VALUES (?, 'ALTERACION_TONO', 'CLIENTE', 6.5, NULL, NULL),
            (?, 'EXCESO_VOLUMEN', 'CLIENTE', 5.1, '-8.5 dBFS', 'Mantenga un tono calmado.')`,
    [llamadas.completada, llamadas.completada]
  );

  // Pendiente: sus columnas de resultado tienen valores por defecto y su audio no esta en disco.
  llamadas.pendiente = await insertarLlamada(ids.agente, {
    nombre_archivo_original: 'pendiente.wav',
    ruta_audio_storage: `lotes/${idLote}/no-existe.wav`,
  });
  await consultar(
    `INSERT INTO TB_Transcripcion (id_llamada, hablante, texto_transcrito, timestamp_inicio, timestamp_fin, score_sentimiento)
     VALUES (?, 'AGENTE', 'No debe mostrarse.', 0, 1, 0)`,
    [llamadas.pendiente]
  );

  // De otro agente, con una ruta que intenta salir de uploads/.
  llamadas.ajena = await insertarLlamada(ids.agenteAjeno, {
    nombre_archivo_original: 'ajena.mp3',
    ruta_audio_storage: '../package.json',
  });

  tokens.supervisor = await iniciarSesion(CORREOS.supervisor, PASSWORD);
  tokens.agente = await iniciarSesion(CORREOS.agente, PASSWORD);
  tokens.supervisorAjeno = await iniciarSesion(CORREOS.supervisorAjeno, PASSWORD);
});

after(async () => {
  try {
    if (idLote) {
      // TB_Transcripcion y TB_Alerta se borran en cascada.
      await consultar('DELETE FROM TB_Llamada WHERE id_lote = ?', [idLote]);
      await consultar('DELETE FROM TB_LoteAudio WHERE id_lote = ?', [idLote]);
      await rm(path.join(config.lotes.carpetaUploads, 'lotes', String(idLote)), { recursive: true, force: true });
    }
    if (ids.supervisor) {
      await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ?', [ids.supervisor]);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

function verLlamada(idLlamada, token) {
  return llamar(`/api/v1/llamadas/${idLlamada}`, { token });
}

async function pedirAudio(idLlamada, token) {
  const respuesta = await fetch(`${base}/api/v1/llamadas/${idLlamada}/audio`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return respuesta;
}

// --- GET /llamadas/:id_llamada ---

test('GET llamada sin token responde 401', async () => {
  const { estado } = await verLlamada(1);
  assert.equal(estado, 401);
});

test('GET llamada: el Supervisor ve el detalle completo de una llamada de su agente', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.completada, tokens.supervisor);
  assert.equal(estado, 200);
  assert.equal(datos.id_llamada, llamadas.completada);
  assert.equal(datos.id_lote, idLote);
  assert.equal(datos.codigo_lote, `TEST-DET-${SUFIJO}`.slice(0, 30));
  assert.equal(datos.nombre_archivo_original, 'llamada señora Pérez.mp3');
  assert.deepEqual(datos.agente, { id_usuario: ids.agente, nombre_completo: 'Prueba AGENTE' });
  assert.equal(datos.id_cliente, null);
  assert.ok(!Number.isNaN(Date.parse(datos.fecha_inicio)));
  assert.equal(datos.duracion_segundos, 184);
  assert.equal(datos.estado_procesamiento, 'COMPLETADO');
  assert.equal(datos.mensaje_error, null);
  assert.equal(datos.baja_confianza_audio, true);
  assert.deepEqual(datos.resultado, {
    puntaje_final: 72.5,
    clasificacion_final: 'POSITIVO',
    diagnostico_conflicto: 'SIN_CONFLICTO',
    score_global_nlp: 0.41,
    score_acustico: -0.125,
  });
  assert.equal(datos.tiene_audio, true);
});

test('GET llamada: transcripcion y alertas llegan ordenadas por tiempo y con numeros', { skip: SIN_ADMIN }, async () => {
  const { datos } = await verLlamada(llamadas.completada, tokens.supervisor);
  assert.deepEqual(
    datos.transcripcion.map(({ id_transcripcion, ...resto }) => resto),
    [
      {
        hablante: 'AGENTE',
        texto_transcrito: 'Buenas tardes, gracias por llamar.',
        timestamp_inicio: 0,
        timestamp_fin: 4.2,
        score_sentimiento: 0.6,
        nivel_volumen_rms: -20.25,
        tono_f0_hz: 213.64,
      },
      {
        hablante: 'CLIENTE',
        texto_transcrito: 'Tengo un problema con mi factura.',
        timestamp_inicio: 4.2,
        timestamp_fin: 8,
        score_sentimiento: -0.35,
        nivel_volumen_rms: -18.5,
        tono_f0_hz: null,
      },
    ]
  );
  assert.ok(datos.transcripcion.every((fragmento) => Number.isInteger(fragmento.id_transcripcion)));
  assert.deepEqual(
    datos.alertas.map(({ id_alerta, ...resto }) => resto),
    [
      {
        tipo_alerta: 'EXCESO_VOLUMEN',
        origen_evento: 'CLIENTE',
        timestamp_evento: 5.1,
        valor_registrado: '-8.5 dBFS',
        mensaje_sugerencia: 'Mantenga un tono calmado.',
      },
      {
        tipo_alerta: 'ALTERACION_TONO',
        origen_evento: 'CLIENTE',
        timestamp_evento: 6.5,
        valor_registrado: null,
        mensaje_sugerencia: null,
      },
    ]
  );
});

test('GET llamada pendiente: resultado null, sin transcripcion ni alertas y sin audio', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.pendiente, tokens.supervisor);
  assert.equal(estado, 200);
  assert.equal(datos.estado_procesamiento, 'PENDIENTE');
  assert.equal(datos.baja_confianza_audio, false);
  assert.equal(datos.resultado, null);
  assert.deepEqual(datos.transcripcion, []);
  assert.deepEqual(datos.alertas, []);
  assert.equal(datos.tiene_audio, false);
});

test('GET llamada: el Agente ve sus propias llamadas', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.completada, tokens.agente);
  assert.equal(estado, 200);
  assert.equal(datos.id_llamada, llamadas.completada);
});

test('GET llamada: el Agente no ve las de otro agente (404)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.ajena, tokens.agente);
  assert.equal(estado, 404);
  assert.equal(datos.error.codigo, 'NO_ENCONTRADO');
});

test('GET llamada: un Supervisor sin ese agente asignado recibe 404', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.completada, tokens.supervisorAjeno);
  assert.equal(estado, 404);
  assert.equal(datos.error.codigo, 'NO_ENCONTRADO');
});

test('GET llamada: el SuperAdmin ve todas', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLlamada(llamadas.ajena, tokens.admin);
  assert.equal(estado, 200);
  assert.deepEqual(datos.agente, { id_usuario: ids.agenteAjeno, nombre_completo: 'Prueba AGENTE' });
});

test('GET llamada: una ruta de audio fuera de uploads/ cuenta como sin audio', { skip: SIN_ADMIN }, async () => {
  const { datos } = await verLlamada(llamadas.ajena, tokens.admin);
  assert.equal(datos.tiene_audio, false);
});

test('GET llamada que no existe responde 404 y un id no numerico 400', { skip: SIN_ADMIN }, async () => {
  const noExiste = await verLlamada(999999999, tokens.admin);
  assert.equal(noExiste.estado, 404);
  assert.equal(noExiste.datos.error.codigo, 'NO_ENCONTRADO');

  const texto = await verLlamada('abc', tokens.admin);
  assert.equal(texto.estado, 400);
  assert.equal(texto.datos.error.codigo, 'DATOS_INVALIDOS');
});

// --- GET /llamadas/:id_llamada/audio ---

test('GET audio: devuelve el archivo original con su Content-Type', { skip: SIN_ADMIN }, async () => {
  const respuesta = await pedirAudio(llamadas.completada, tokens.agente);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Buffer.from(await respuesta.arrayBuffer()), AUDIO);
});

test('GET audio sin token responde 401', async () => {
  const respuesta = await pedirAudio(1);
  assert.equal(respuesta.status, 401);
});

test('GET audio: quien no puede ver la llamada recibe 404', { skip: SIN_ADMIN }, async () => {
  const respuesta = await pedirAudio(llamadas.completada, tokens.supervisorAjeno);
  assert.equal(respuesta.status, 404);
  assert.equal((await respuesta.json()).error.codigo, 'NO_ENCONTRADO');
});

test('GET audio: si el archivo no esta en disco o la ruta sale de uploads/, responde 404', { skip: SIN_ADMIN }, async () => {
  const faltante = await pedirAudio(llamadas.pendiente, tokens.supervisor);
  assert.equal(faltante.status, 404);

  const fuera = await pedirAudio(llamadas.ajena, tokens.admin);
  assert.equal(fuera.status, 404);
  assert.equal((await fuera.json()).error.codigo, 'NO_ENCONTRADO');
});
