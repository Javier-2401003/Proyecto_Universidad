// Pruebas del procesamiento de audio contra la base de datos REAL, sin Python: un
// ejecutable falso (fixtures/analizar_falso.mjs) hace de analizar.py.
// Cada prueba trabaja solo con sus propias llamadas: nunca toca la cola completa, para no
// procesar las llamadas PENDIENTE de otras pruebas ni los datos de la demo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { consultar, pool } = await import('../src/db.js');
const { procesarLlamada, procesarPendientes, recuperarInterrumpidas, iniciarProcesamiento } = await import(
  '../src/procesamientoAudio.js'
);

const SUFIJO = Date.now();
const SCRIPT_FALSO = fileURLToPath(new URL('./fixtures/analizar_falso.mjs', import.meta.url));

let carpetaUploads;
let opciones;
let idUsuarioCarga;
let idAgente;
const lotes = [];

async function crearUsuario(nombre) {
  const resultado = await consultar(
    `INSERT INTO TB_Usuario (nombre_completo, correo_electronico, password_hash) VALUES (?, ?, 'x')`,
    [`Prueba ${nombre}`, `test.proc.${nombre}.${SUFIJO}@ejemplo.test`]
  );
  return resultado.insertId;
}

async function crearLote(total = 1) {
  const resultado = await consultar(
    'INSERT INTO TB_LoteAudio (codigo_lote, id_usuario_carga, total_archivos) VALUES (?, ?, ?)',
    [`TP-${SUFIJO}-${lotes.length}`.slice(0, 30), idUsuarioCarga, total]
  );
  lotes.push(resultado.insertId);
  return resultado.insertId;
}

// Una llamada PENDIENTE cuyo "audio" le dice al script falso como comportarse.
async function crearLlamada(modo, idLote) {
  const lote = idLote ?? (await crearLote());
  const resultado = await consultar('INSERT INTO TB_Llamada (id_agente, id_lote) VALUES (?, ?)', [idAgente, lote]);
  const ruta = `lotes/${lote}/${resultado.insertId}.mp3`;
  await mkdir(path.join(carpetaUploads, 'lotes', String(lote)), { recursive: true });
  await writeFile(path.join(carpetaUploads, ruta), modo);
  await consultar('UPDATE TB_Llamada SET ruta_audio_storage = ? WHERE id_llamada = ?', [ruta, resultado.insertId]);
  return resultado.insertId;
}

async function verLlamada(idLlamada) {
  const [fila] = await consultar('SELECT * FROM TB_Llamada WHERE id_llamada = ?', [idLlamada]);
  return fila;
}

async function procesarModo(modo, extra = {}) {
  const id = await crearLlamada(modo);
  assert.equal(await procesarLlamada(id, { ...opciones, ...extra }), true);
  return verLlamada(id);
}

async function auditoriaDe(idLlamada) {
  const filas = await consultar(
    `SELECT detalle_cambio, modulo_afectado, direccion_ip FROM TB_LogAuditoria
      WHERE id_usuario = ? AND accion_ejecutada = 'PROCESAMIENTO_LLAMADA'
        AND JSON_EXTRACT(detalle_cambio, '$.id_llamada') = ?`,
    [idUsuarioCarga, idLlamada]
  );
  return filas;
}

const estadoLote = async (idLote) =>
  (await consultar('SELECT estado_lote FROM TB_LoteAudio WHERE id_lote = ?', [idLote]))[0].estado_lote;

function sigueVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  // Con espacios y "&": sin shell, la ruta llega entera y no se interpreta nada.
  const temporal = await mkdtemp(path.join(os.tmpdir(), 'vocal-proc-'));
  carpetaUploads = path.join(temporal, 'uploads de prueba & más');
  await mkdir(carpetaUploads, { recursive: true });
  opciones = {
    python: process.execPath,
    script: SCRIPT_FALSO,
    modelo: 'small',
    timeoutMs: 20000,
    carpetaUploads,
  };
  idUsuarioCarga = await crearUsuario('carga');
  idAgente = await crearUsuario('agente');
});

after(async () => {
  try {
    for (const idLote of lotes) {
      await consultar('DELETE FROM TB_Llamada WHERE id_lote = ?', [idLote]);
      await consultar('DELETE FROM TB_LoteAudio WHERE id_lote = ?', [idLote]);
    }
    await consultar('DELETE FROM TB_LogAuditoria WHERE id_usuario = ?', [idUsuarioCarga]);
    await consultar('DELETE FROM TB_Usuario WHERE id_usuario IN (?, ?)', [idUsuarioCarga, idAgente]);
    await rm(path.dirname(carpetaUploads), { recursive: true, force: true });
  } finally {
    await pool.end();
  }
});

test('exito: guarda TB_Llamada y TB_Transcripcion, audita y cierra el lote', async () => {
  const idLote = await crearLote();
  const id = await crearLlamada('exito', idLote);
  assert.equal(await procesarLlamada(id, opciones), true);

  const llamada = await verLlamada(id);
  assert.equal(llamada.estado_procesamiento, 'COMPLETADO');
  assert.equal(llamada.mensaje_error, null);
  assert.equal(llamada.duracion_segundos, 185); // redondeada a entero
  assert.equal(llamada.baja_confianza_audio, 0);
  assert.equal(llamada.score_global_nlp, 0.41);
  assert.equal(llamada.score_acustico, -0.125);
  assert.equal(llamada.puntaje_final, 72.5);
  assert.equal(llamada.clasificacion_final, 'POSITIVO');
  assert.equal(llamada.diagnostico_conflicto, 'FALLA_AGENTE');

  const segmentos = await consultar(
    `SELECT hablante, texto_transcrito, timestamp_inicio, timestamp_fin, score_sentimiento, nivel_volumen_rms, tono_f0_hz
       FROM TB_Transcripcion WHERE id_llamada = ? ORDER BY timestamp_inicio`,
    [id]
  );
  assert.deepEqual(segmentos[0], {
    hablante: 'AGENTE',
    texto_transcrito: 'Buenas tardes, señora Núñez', // stdout leido como UTF-8
    timestamp_inicio: 0,
    timestamp_fin: 4.2,
    score_sentimiento: 0.6,
    nivel_volumen_rms: -20.25,
    tono_f0_hz: 180.5,
  });
  assert.equal(segmentos[1].hablante, 'CLIENTE');
  assert.equal(segmentos[1].tono_f0_hz, null);

  const [auditoria, ...otras] = await auditoriaDe(id);
  assert.equal(otras.length, 0);
  assert.equal(auditoria.modulo_afectado, 'CARGA_LOTES');
  assert.equal(auditoria.detalle_cambio.estado_procesamiento, 'COMPLETADO');
  assert.equal(auditoria.detalle_cambio.id_lote, idLote);
  assert.equal(auditoria.detalle_cambio.segmentos, 2);

  assert.equal(await estadoLote(idLote), 'COMPLETADO');
});

test('llama al script con argumentos en arreglo y la ruta absoluta del audio', async () => {
  const id = await crearLlamada('exito');
  await procesarLlamada(id, opciones);
  const { ruta_audio_storage: ruta } = await verLlamada(id);
  const absoluta = path.join(carpetaUploads, ruta);
  const argumentos = JSON.parse(await readFile(`${absoluta}.args.json`, 'utf8'));
  assert.deepEqual(argumentos, [absoluta, '--modelo', 'small', '--idioma', 'es']);
});

test('audio sin voz: COMPLETADO y sin filas en TB_Transcripcion', async () => {
  const llamada = await procesarModo('sin_voz');
  assert.equal(llamada.estado_procesamiento, 'COMPLETADO');
  assert.equal(llamada.baja_confianza_audio, 1);
  assert.equal(llamada.puntaje_final, 50);
  const filas = await consultar('SELECT 1 FROM TB_Transcripcion WHERE id_llamada = ?', [llamada.id_llamada]);
  assert.equal(filas.length, 0);
});

test('acepta cualquier 0.x e ignora los campos que no conoce', async () => {
  const llamada = await procesarModo('version_menor_nueva');
  assert.equal(llamada.estado_procesamiento, 'COMPLETADO');
});

const alertasDe = (idLlamada) =>
  consultar(
    `SELECT tipo_alerta, origen_evento, timestamp_evento, valor_registrado, mensaje_sugerencia
       FROM TB_Alerta WHERE id_llamada = ? ORDER BY timestamp_evento, id_alerta`,
    [idLlamada]
  );

test('v0.3: guarda cada alerta en TB_Alerta y la cuenta en la auditoria', async () => {
  const llamada = await procesarModo('v03');
  assert.equal(llamada.estado_procesamiento, 'COMPLETADO');
  assert.deepEqual(await alertasDe(llamada.id_llamada), [
    {
      tipo_alerta: 'VOCABULARIO_INADECUADO',
      origen_evento: 'AGENTE',
      timestamp_evento: 0,
      valor_registrado: 'Palabra: estafa',
      mensaje_sugerencia: 'Evite términos que puedan ofender o alarmar al cliente.',
    },
    {
      tipo_alerta: 'EXCESO_VOLUMEN',
      origen_evento: 'CLIENTE',
      timestamp_evento: 5.5,
      valor_registrado: '-8.5 dBFS',
      mensaje_sugerencia: 'Mantenga un tono calmado y valide la molestia del cliente.',
    },
  ]);
  const [auditoria] = await auditoriaDe(llamada.id_llamada);
  assert.equal(auditoria.detalle_cambio.alertas, 2);
  assert.equal(auditoria.detalle_cambio.version_contrato, '0.3');
});

test('v0.3 con alertas vacias, o v0.2 sin el campo: COMPLETADO sin alertas', async () => {
  for (const modo of ['v03_sin_alertas', 'exito']) {
    const llamada = await procesarModo(modo);
    assert.equal(llamada.estado_procesamiento, 'COMPLETADO', modo);
    assert.deepEqual(await alertasDe(llamada.id_llamada), [], modo);
    const [auditoria] = await auditoriaDe(llamada.id_llamada);
    assert.equal(auditoria.detalle_cambio.alertas, 0, modo);
  }
});

test('una alerta invalida deja la llamada en ERROR sin guardar nada', async () => {
  const casos = {
    alerta_tipo_invalido: 'alertas[].tipo_alerta',
    alerta_origen_invalido: 'alertas[].origen_evento',
    alerta_tiempo_negativo: 'alertas[].timestamp_evento',
    alerta_valor_largo: 'alertas[].valor_registrado',
    alerta_mensaje_largo: 'alertas[].mensaje_sugerencia',
    alerta_sin_mensaje: 'alertas[].mensaje_sugerencia',
  };
  for (const [modo, campo] of Object.entries(casos)) {
    const llamada = await procesarModo(modo);
    assert.equal(llamada.estado_procesamiento, 'ERROR', modo);
    assert.match(llamada.mensaje_error, /^CONTRATO_INCOMPLETO: /, modo);
    assert.ok(llamada.mensaje_error.includes(campo), `${modo}: ${llamada.mensaje_error}`);
    assert.equal(llamada.puntaje_final, 0, modo);
    assert.deepEqual(await alertasDe(llamada.id_llamada), [], modo);
    const transcripcion = await consultar('SELECT 1 FROM TB_Transcripcion WHERE id_llamada = ?', [llamada.id_llamada]);
    assert.equal(transcripcion.length, 0, modo);
  }
});

test('v0.1 (la actual): ERROR con CONTRATO_INCOMPLETO y sin guardar valores por defecto', async () => {
  const llamada = await procesarModo('v01');
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.match(llamada.mensaje_error, /^CONTRATO_INCOMPLETO: /);
  for (const campo of ['puntaje_final', 'clasificacion_final', 'diagnostico_conflicto', 'segmentos[].hablante', 'segmentos[].score_sentimiento']) {
    assert.ok(llamada.mensaje_error.includes(campo), `falta ${campo} en: ${llamada.mensaje_error}`);
  }
  const filas = await consultar('SELECT 1 FROM TB_Transcripcion WHERE id_llamada = ?', [llamada.id_llamada]);
  assert.equal(filas.length, 0);
});

test('un valor fuera de rango tampoco se guarda', async () => {
  const llamada = await procesarModo('puntaje_fuera_de_rango');
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.match(llamada.mensaje_error, /^CONTRATO_INCOMPLETO: .*puntaje_final/);
});

test('rechaza una version mayor distinta de 0', async () => {
  const llamada = await procesarModo('version_mayor');
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.equal(llamada.mensaje_error, 'CONTRATO_INCOMPATIBLE: version 2.0');
});

test('codigo 1 con JSON: ERROR con "<codigo>: <mensaje>", auditado y lote CON_ERRORES', async () => {
  const idLote = await crearLote();
  const id = await crearLlamada('error_audio', idLote);
  await procesarLlamada(id, opciones);
  const llamada = await verLlamada(id);
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.equal(llamada.mensaje_error, 'AUDIO_ILEGIBLE: No se pudo leer el audio.');
  const [auditoria] = await auditoriaDe(id);
  assert.equal(auditoria.detalle_cambio.estado_procesamiento, 'ERROR');
  assert.equal(await estadoLote(idLote), 'CON_ERRORES');
});

test('mensaje_error se recorta a 255 caracteres', async () => {
  const llamada = await procesarModo('error_largo');
  assert.equal(llamada.mensaje_error.length, 255);
  assert.match(llamada.mensaje_error, /^ERROR_LARGO: x+$/);
});

test('ERROR_INTERNO se reintenta una vez: si la segunda sale bien, COMPLETADO', async () => {
  const llamada = await procesarModo('error_interno_una_vez');
  assert.equal(llamada.estado_procesamiento, 'COMPLETADO');
});

test('ERROR_INTERNO que se repite: ERROR tras dos intentos', async () => {
  const id = await crearLlamada('error_interno_siempre');
  await procesarLlamada(id, opciones);
  const llamada = await verLlamada(id);
  assert.equal(llamada.mensaje_error, 'ERROR_INTERNO: Fallo inesperado.');
  const registro = await readFile(path.join(carpetaUploads, 'lotes', String(llamada.id_lote), 'registro.txt'), 'utf8');
  assert.equal(registro.match(/^inicio /gm).length, 2);
});

test('proceso sin JSON: PROCESO_FALLIDO con el codigo de salida', async () => {
  for (const [modo, codigo] of [['sin_json_codigo_3', 3], ['sin_json_codigo_1', 1], ['basura_codigo_0', 0]]) {
    const llamada = await procesarModo(modo);
    assert.equal(llamada.estado_procesamiento, 'ERROR', modo);
    assert.equal(llamada.mensaje_error, `PROCESO_FALLIDO: código ${codigo}`, modo);
  }
});

test('falta el ejecutable (venv sin instalar): PROCESO_FALLIDO', async () => {
  const llamada = await procesarModo('exito', { python: path.join(carpetaUploads, 'no-existe.exe') });
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.equal(llamada.mensaje_error, 'PROCESO_FALLIDO: código ENOENT');
});

test('timeout: ERROR con TIMEOUT y no deja procesos vivos, aunque hereden stdout', async () => {
  const inicio = Date.now();
  const llamada = await procesarModo('colgado', { timeoutMs: 2500 });
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.equal(llamada.mensaje_error, 'TIMEOUT');
  assert.ok(Date.now() - inicio < 15000, 'no debe esperar a que termine el proceso colgado');

  const pid = Number(await readFile(path.join(carpetaUploads, `${llamada.ruta_audio_storage}.nieto`), 'utf8'));
  for (let intento = 0; intento < 20 && sigueVivo(pid); intento += 1) {
    await new Promise((resolver) => setTimeout(resolver, 100));
  }
  const vivo = sigueVivo(pid);
  if (vivo) process.kill(pid);
  assert.equal(vivo, false, 'el proceso hijo del script siguio corriendo');
});

test('ruta que se sale de uploads/: ERROR sin ejecutar el script', async () => {
  const id = await crearLlamada('exito');
  await consultar('UPDATE TB_Llamada SET ruta_audio_storage = ? WHERE id_llamada = ?', ['../../afuera.mp3', id]);
  await procesarLlamada(id, opciones);
  const llamada = await verLlamada(id);
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.match(llamada.mensaje_error, /^ARCHIVO_NO_ENCONTRADO: /);
});

test('un valor que no cabe en su columna se rechaza (MySQL sin modo estricto lo recortaria)', async () => {
  const llamada = await procesarModo('no_cabe_en_la_columna');
  assert.equal(llamada.estado_procesamiento, 'ERROR');
  assert.match(llamada.mensaje_error, /^CONTRATO_INCOMPLETO: .*segmentos\[\]\.inicio/);
  assert.equal(llamada.puntaje_final, 0);
  const filas = await consultar('SELECT 1 FROM TB_Transcripcion WHERE id_llamada = ?', [llamada.id_llamada]);
  assert.equal(filas.length, 0);
});

test('una llamada que ya no esta PENDIENTE no se toma', async () => {
  const id = await crearLlamada('exito');
  await consultar(`UPDATE TB_Llamada SET estado_procesamiento = 'ERROR', mensaje_error = 'previo' WHERE id_llamada = ?`, [id]);
  assert.equal(await procesarLlamada(id, opciones), false);
  assert.equal((await verLlamada(id)).mensaje_error, 'previo');
});

test('cola: de una en una, sin solaparse, y el lote cierra al terminar la ultima', async () => {
  const idLote = await crearLote(3);
  const otroLote = await crearLote();
  const ids = [await crearLlamada('lento', idLote), await crearLlamada('lento', idLote), await crearLlamada('error_audio', idLote)];
  const ajena = await crearLlamada('exito', otroLote);

  const procesadas = await procesarPendientes({ idLote, ...opciones });
  assert.equal(procesadas, 3);

  const eventos = (await readFile(path.join(carpetaUploads, 'lotes', String(idLote), 'registro.txt'), 'utf8'))
    .trim()
    .split(/\r?\n/);
  assert.deepEqual(
    eventos,
    ids.flatMap((id) => [`inicio ${id}.mp3`, `fin ${id}.mp3`]),
    'cada analisis debe terminar antes de que empiece el siguiente, en orden'
  );

  assert.equal(await estadoLote(idLote), 'CON_ERRORES');
  assert.equal((await verLlamada(ajena)).estado_procesamiento, 'PENDIENTE');
  assert.equal(await estadoLote(otroLote), 'PROCESANDO');
});

test('el lote sigue PROCESANDO mientras le queden llamadas', async () => {
  const idLote = await crearLote(2);
  const primera = await crearLlamada('exito', idLote);
  await crearLlamada('exito', idLote);
  await procesarLlamada(primera, opciones);
  assert.equal(await estadoLote(idLote), 'PROCESANDO');
  await procesarPendientes({ idLote, ...opciones });
  assert.equal(await estadoLote(idLote), 'COMPLETADO');
});

test('una llamada interrumpida vuelve a PENDIENTE y al repetirla no duplica la transcripcion', async () => {
  const idLote = await crearLote();
  const id = await crearLlamada('exito', idLote);
  await consultar(`UPDATE TB_Llamada SET estado_procesamiento = 'PROCESANDO' WHERE id_llamada = ?`, [id]);
  await consultar(
    `INSERT INTO TB_Transcripcion (id_llamada, hablante, texto_transcrito, timestamp_inicio, timestamp_fin, score_sentimiento)
     VALUES (?, 'AGENTE', 'resto de un intento anterior', 0, 1, 0)`,
    [id]
  );

  assert.equal(await recuperarInterrumpidas({ idLote }), 1);
  assert.equal((await verLlamada(id)).estado_procesamiento, 'PENDIENTE');

  await procesarPendientes({ idLote, ...opciones });
  const filas = await consultar('SELECT texto_transcrito FROM TB_Transcripcion WHERE id_llamada = ?', [id]);
  assert.equal(filas.length, 2);
  assert.ok(!filas.some((fila) => fila.texto_transcrito.includes('resto')));
});

test('al repetir una llamada interrumpida no duplica las alertas', async () => {
  const idLote = await crearLote();
  const id = await crearLlamada('v03', idLote);
  await consultar(`UPDATE TB_Llamada SET estado_procesamiento = 'PROCESANDO' WHERE id_llamada = ?`, [id]);
  await consultar(
    `INSERT INTO TB_Alerta (id_llamada, tipo_alerta, origen_evento, timestamp_evento, valor_registrado)
     VALUES (?, 'ALTERACION_TONO', 'AGENTE', 1, 'resto de un intento anterior')`,
    [id]
  );

  await recuperarInterrumpidas({ idLote });
  await procesarPendientes({ idLote, ...opciones });
  const alertas = await alertasDe(id);
  assert.deepEqual(alertas.map((alerta) => alerta.tipo_alerta), ['VOCABULARIO_INADECUADO', 'EXCESO_VOLUMEN']);
});

test('sin AUDIO_PYTHON o con la ruta inexistente, el procesamiento no arranca', () => {
  assert.equal(iniciarProcesamiento({ python: '', script: SCRIPT_FALSO }), null);
  assert.equal(iniciarProcesamiento({ python: process.execPath, script: '' }), null);
  assert.equal(iniciarProcesamiento({ python: path.join(path.sep, 'no', 'existe.exe'), script: SCRIPT_FALSO }), null);
  assert.ok(existsSync(SCRIPT_FALSO));
});
