// Detalle de una llamada (docs/api.md, GET /llamadas/:id_llamada) y su audio
// (GET /llamadas/:id_llamada/audio).
// No dependen de un modulo de permisos sino de la relacion con la llamada: si el
// usuario no puede verla, se responde 404 para no revelar que existe.
import { Router } from 'express';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { consultar } from '../db.js';
import { ErrorHttp, validar } from '../errores.js';
import { autenticar } from '../middleware/auth.js';
import { puedeVerLlamadaDe } from '../agentes.js';

export const rutasDetalleLlamada = Router();

const { carpetaUploads } = config.lotes;

const TIPO_POR_EXTENSION = Object.freeze({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav' });

const esquemaIdLlamada = z.object({
  id_llamada: z.coerce.number({ invalid_type_error: 'Debe ser un numero.' }).int().positive(),
});

function noEncontrada() {
  return new ErrorHttp(404, 'NO_ENCONTRADO', 'La llamada no existe.');
}

// La llamada si existe y el usuario puede verla; si no, lanza 404.
async function buscarLlamadaVisible(req) {
  const { id_llamada: idLlamada } = validar(esquemaIdLlamada, req.params);
  const [llamada] = await consultar(
    `SELECT c.id_llamada, c.id_lote, l.codigo_lote, c.nombre_archivo_original,
            c.id_agente, u.nombre_completo AS nombre_agente, c.id_cliente, c.fecha_inicio,
            c.duracion_segundos, c.estado_procesamiento, c.mensaje_error, c.baja_confianza_audio,
            c.puntaje_final, c.clasificacion_final, c.diagnostico_conflicto,
            c.score_global_nlp, c.score_acustico, c.ruta_audio_storage
       FROM TB_Llamada c
       JOIN TB_Usuario u ON u.id_usuario = c.id_agente
       LEFT JOIN TB_LoteAudio l ON l.id_lote = c.id_lote
      WHERE c.id_llamada = ?`,
    [idLlamada]
  );
  if (!llamada || !(await puedeVerLlamadaDe(req.usuario, llamada.id_agente))) {
    throw noEncontrada();
  }
  return llamada;
}

// Ruta absoluta del audio en disco, o null si no hay ruta, se sale de uploads/ o el archivo no esta.
async function rutaDelAudio(llamada) {
  if (!llamada.ruta_audio_storage) return null;
  const raiz = path.resolve(carpetaUploads);
  const ruta = path.resolve(raiz, llamada.ruta_audio_storage);
  if (!ruta.startsWith(raiz + path.sep)) return null;
  try {
    await access(ruta);
    return ruta;
  } catch {
    return null;
  }
}

rutasDetalleLlamada.get('/:id_llamada', autenticar, async (req, res) => {
  const llamada = await buscarLlamadaVisible(req);
  // Mientras no termine el analisis, sus columnas tienen valores por defecto: no se muestran.
  const completada = llamada.estado_procesamiento === 'COMPLETADO';

  const [transcripcion, alertas] = completada
    ? await Promise.all([
        consultar(
          `SELECT id_transcripcion, hablante, texto_transcrito, timestamp_inicio, timestamp_fin,
                  score_sentimiento, nivel_volumen_rms, tono_f0_hz
             FROM TB_Transcripcion WHERE id_llamada = ?
            ORDER BY timestamp_inicio, id_transcripcion`,
          [llamada.id_llamada]
        ),
        consultar(
          `SELECT id_alerta, tipo_alerta, origen_evento, timestamp_evento, valor_registrado, mensaje_sugerencia
             FROM TB_Alerta WHERE id_llamada = ?
            ORDER BY timestamp_evento, id_alerta`,
          [llamada.id_llamada]
        ),
      ])
    : [[], []];

  res.json({
    id_llamada: llamada.id_llamada,
    id_lote: llamada.id_lote,
    codigo_lote: llamada.codigo_lote,
    nombre_archivo_original: llamada.nombre_archivo_original,
    agente: { id_usuario: llamada.id_agente, nombre_completo: llamada.nombre_agente },
    id_cliente: llamada.id_cliente,
    fecha_inicio: llamada.fecha_inicio,
    duracion_segundos: llamada.duracion_segundos,
    estado_procesamiento: llamada.estado_procesamiento,
    mensaje_error: llamada.mensaje_error,
    baja_confianza_audio: Boolean(llamada.baja_confianza_audio),
    resultado: completada
      ? {
          puntaje_final: llamada.puntaje_final,
          clasificacion_final: llamada.clasificacion_final,
          diagnostico_conflicto: llamada.diagnostico_conflicto,
          score_global_nlp: llamada.score_global_nlp,
          score_acustico: llamada.score_acustico,
        }
      : null,
    transcripcion,
    alertas,
    tiene_audio: (await rutaDelAudio(llamada)) !== null,
  });
});

// El frontend lo pide con el token Bearer y lo reproduce desde memoria (sin Range).
rutasDetalleLlamada.get('/:id_llamada/audio', autenticar, async (req, res) => {
  const llamada = await buscarLlamadaVisible(req);
  const ruta = await rutaDelAudio(llamada);
  const tipo = ruta && TIPO_POR_EXTENSION[path.extname(ruta).toLowerCase()];
  if (!tipo) throw noEncontrada();

  await new Promise((resolver, rechazar) => {
    res.sendFile(ruta, { headers: { 'Content-Type': tipo } }, (error) => (error ? rechazar(error) : resolver()));
  });
});
