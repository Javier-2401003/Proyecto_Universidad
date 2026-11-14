// Pruebas del reproceso (src/reproceso.js) contra la base de datos REAL, sin Python: el analisis
// lo hace el ejecutable falso de fixtures/. Cada prueba trabaja solo con su propio lote, para no
// tocar las llamadas de otras pruebas ni los datos de la demo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { consultar, pool } = await import('../src/db.js');
const { buscarParaReprocesar, marcarParaReprocesar, versionMenor } = await import('../src/reproceso.js');
const { procesarPendientes } = await import('../src/procesamientoAudio.js');

const SUFIJO = Date.now();
const SCRIPT_FALSO = fileURLToPath(new URL('./fixtures/analizar_falso.mjs', import.meta.url));

let carpetaUploads;
let idUsuario;
let idLote;
const llamadas = {};

async function crearLlamada(nombre, { estado, versiones = [], conAudio = true }) {
  const resultado = await consultar(
    `INSERT INTO TB_Llamada (id_agente, id_lote, nombre_archivo_original, estado_procesamiento, puntaje_final)
     VALUES (?, ?, ?, ?, ?)`,
    [idUsuario, idLote, `${nombre}.mp3`, estado, estado === 'COMPLETADO' ? 62.36 : 0]
  );
  const id = resultado.insertId;
  const ruta = `lotes/${idLote}/${id}.mp3`;
  if (conAudio) await writeFile(path.join(carpetaUploads, ruta), 'v03'); // el "audio" dice que responda el falso
  await consultar('UPDATE TB_Llamada SET ruta_audio_storage = ? WHERE id_llamada = ?', [ruta, id]);
  // Un registro de auditoria por cada analisis anterior, como los deja el procesamiento.
  for (const version of versiones) {
    await consultar(
      `INSERT INTO TB_LogAuditoria (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
       VALUES (?, 'PROCESAMIENTO_LLAMADA', 'CARGA_LOTES', ?, '127.0.0.1')`,
      [idUsuario, JSON.stringify({ id_llamada: id, id_lote: idLote, estado_procesamiento: estado, version_contrato: version })]
    );
  }
  return id;
}

const ids = (lista) => lista.map((llamada) => llamada.id_llamada).sort((a, b) => a - b);
const estadoDe = async (id) =>
  (await consultar('SELECT estado_procesamiento FROM TB_Llamada WHERE id_llamada = ?', [id]))[0].estado_procesamiento;
const estadoLote = async () =>
  (await consultar('SELECT estado_lote FROM TB_LoteAudio WHERE id_lote = ?', [idLote]))[0].estado_lote;

before(async () => {
  const temporal = await mkdtemp(path.join(os.tmpdir(), 'vocal-reproceso-'));
  carpetaUploads = path.join(temporal, 'uploads');
  const usuario = await consultar(
    `INSERT INTO TB_Usuario (nombre_completo, correo_electronico, password_hash) VALUES ('Prueba Reproceso', ?, 'x')`,
    [`test.rep.${SUFIJO}@ejemplo.test`]
  );
  idUsuario = usuario.insertId;
  const lote = await consultar(
    `INSERT INTO TB_LoteAudio (codigo_lote, id_usuario_carga, total_archivos, estado_lote) VALUES (?, ?, 6, 'CON_ERRORES')`,
    [`TEST-REP-${SUFIJO}`.slice(0, 30), idUsuario]
  );
  idLote = lote.insertId;
  await mkdir(path.join(carpetaUploads, 'lotes', String(idLote)), { recursive: true });

  llamadas.v03 = await crearLlamada('v03', { estado: 'COMPLETADO', versiones: ['0.3'] });
  llamadas.v04 = await crearLlamada('v04', { estado: 'COMPLETADO', versiones: ['0.4'] });
  // Se analizo con la 0.3 y despues se reproceso con la 0.4: cuenta la ultima.
  llamadas.yaReprocesada = await crearLlamada('ya_reprocesada', { estado: 'COMPLETADO', versiones: ['0.3', '0.4'] });
  llamadas.sinVersion = await crearLlamada('sin_version', { estado: 'COMPLETADO' });
  llamadas.sinAudio = await crearLlamada('sin_audio', { estado: 'COMPLETADO', versiones: ['0.2'], conAudio: false });
  llamadas.conError = await crearLlamada('con_error', { estado: 'ERROR' });
  llamadas.pendiente = await crearLlamada('pendiente', { estado: 'PENDIENTE' });
});

after(async () => {
  try {
    await consultar('DELETE FROM TB_Llamada WHERE id_lote = ?', [idLote]);
    await consultar('DELETE FROM TB_LoteAudio WHERE id_lote = ?', [idLote]);
    await consultar('DELETE FROM TB_LogAuditoria WHERE id_usuario = ?', [idUsuario]);
    await consultar('DELETE FROM TB_Usuario WHERE id_usuario = ?', [idUsuario]);
    await rm(path.dirname(carpetaUploads), { recursive: true, force: true });
  } finally {
    await pool.end();
  }
});

test('versionMenor: solo acepta 0.x', () => {
  assert.equal(versionMenor('0.3'), 3);
  assert.equal(versionMenor('0.10'), 10);
  assert.equal(versionMenor('1.0'), null);
  assert.equal(versionMenor(null), null);
  assert.equal(versionMenor('abc'), null);
});

test('--antes-de 0.4: las de versiones anteriores o desconocidas; la ultima version manda', async () => {
  const resultado = await buscarParaReprocesar({ antesDe: '0.4', idLote, carpetaUploads });
  assert.deepEqual(ids(resultado.aReprocesar), [llamadas.v03, llamadas.sinVersion].sort((a, b) => a - b));
  assert.deepEqual(ids(resultado.sinAudio), [llamadas.sinAudio]);
  assert.equal(resultado.alDia, 2); // v04 y yaReprocesada
  assert.equal(resultado.aReprocesar.find((llamada) => llamada.id_llamada === llamadas.v03).version, '0.3');
});

test('--todas e --incluir-errores', async () => {
  const todas = await buscarParaReprocesar({ idLote, carpetaUploads });
  assert.equal(todas.aReprocesar.length, 4); // las 4 COMPLETADO con audio
  assert.equal(todas.alDia, 0);

  const conErrores = await buscarParaReprocesar({ antesDe: '0.4', idLote, incluirErrores: true, carpetaUploads });
  assert.ok(ids(conErrores.aReprocesar).includes(llamadas.conError));
  assert.ok(!ids(conErrores.aReprocesar).includes(llamadas.pendiente));
});

test('una version invalida es un error', async () => {
  await assert.rejects(buscarParaReprocesar({ antesDe: '1.0', idLote, carpetaUploads }), /Version invalida/);
  await assert.rejects(buscarParaReprocesar({ antesDe: 'x', idLote, carpetaUploads }), /Version invalida/);
});

test('marcar: vuelven a PENDIENTE, el lote a PROCESANDO y queda en la auditoria; despues se analizan otra vez', async () => {
  const { aReprocesar } = await buscarParaReprocesar({ antesDe: '0.4', idLote, incluirErrores: true, carpetaUploads });
  const elegidas = ids(aReprocesar);
  const cambiadas = await marcarParaReprocesar(elegidas, { idUsuario, motivo: { antes_de: '0.4' } });
  assert.equal(cambiadas, 3); // v03, sinVersion y conError

  for (const id of elegidas) assert.equal(await estadoDe(id), 'PENDIENTE');
  assert.equal(await estadoDe(llamadas.v04), 'COMPLETADO'); // las al dia no se tocan
  assert.equal(await estadoLote(), 'PROCESANDO');

  const [auditoria] = await consultar(
    `SELECT detalle_cambio, modulo_afectado FROM TB_LogAuditoria
      WHERE id_usuario = ? AND accion_ejecutada = 'REPROCESO_LLAMADAS'`,
    [idUsuario]
  );
  assert.equal(auditoria.modulo_afectado, 'CARGA_LOTES');
  assert.deepEqual(auditoria.detalle_cambio, { total: 3, ids_llamadas: elegidas, origen: 'SCRIPT', antes_de: '0.4' });

  // La pendiente que ya estaba se procesa junto con las reprocesadas: el lote queda listo para la cola.
  const procesadas = await procesarPendientes({
    idLote,
    python: process.execPath,
    script: SCRIPT_FALSO,
    modelo: 'base',
    timeoutMs: 20000,
    carpetaUploads,
  });
  assert.equal(procesadas, 4);
  for (const id of elegidas) assert.equal(await estadoDe(id), 'COMPLETADO');
  // La llamada sin audio sigue COMPLETADO con su resultado anterior: no se toca.
  assert.equal(await estadoDe(llamadas.sinAudio), 'COMPLETADO');
  assert.equal(await estadoLote(), 'COMPLETADO');
});

test('marcar no toca una llamada que ya no esta COMPLETADO ni ERROR', async () => {
  await consultar(`UPDATE TB_Llamada SET estado_procesamiento = 'PROCESANDO' WHERE id_llamada = ?`, [llamadas.v04]);
  const cambiadas = await marcarParaReprocesar([llamadas.v04], { idUsuario });
  assert.equal(cambiadas, 0);
  assert.equal(await estadoDe(llamadas.v04), 'PROCESANDO');
  await consultar(`UPDATE TB_Llamada SET estado_procesamiento = 'COMPLETADO' WHERE id_llamada = ?`, [llamadas.v04]);
});

test('sin llamadas que marcar no hace nada', async () => {
  assert.equal(await marcarParaReprocesar([], { idUsuario }), 0);
});
