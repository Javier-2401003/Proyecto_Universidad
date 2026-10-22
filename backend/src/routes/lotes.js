// Carga de audios por lotes (docs/api.md, POST /llamadas/lotes).
// Todo o nada: si un solo archivo no es valido, no se guarda ninguno.
// El analisis (Whisper) toma despues las llamadas en estado PENDIENTE.
import { Router } from 'express';
import multer from 'multer';
import { mkdir, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { conTransaccion } from '../db.js';
import { ErrorHttp, validar, obtenerIp } from '../errores.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import { buscarAgenteVisible } from '../agentes.js';
import { crearAlmacenamientoAudio } from '../almacenamientoAudio.js';

export const rutasLlamadas = Router();

const { tamanosPermitidos, audioMaxBytes, carpetaUploads } = config.lotes;

// Tope de seguridad de archivos por peticion; la cantidad valida la decide tamanosPermitidos.
const MAXIMO_ARCHIVOS = 50;

const FORMATO_POR_EXTENSION = Object.freeze({ '.wav': 'WAV', '.mp3': 'MP3' });

const recibirAudios = multer({
  storage: crearAlmacenamientoAudio({
    carpeta: path.join(carpetaUploads, 'temporal'),
    maxBytes: audioMaxBytes,
  }),
  defParamCharset: 'utf8', // nombres de archivo con acentos o enie
  limits: { files: MAXIMO_ARCHIVOS, fields: 10, fieldSize: 1024, parts: MAXIMO_ARCHIVOS + 10 },
}).array('audios');

// Traduce los errores de multer al formato de errores de la API.
function recibirAudiosConErrores(req, res, next) {
  recibirAudios(req, res, (error) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    if (error.code === 'LIMIT_FILE_COUNT') {
      return next(
        new ErrorHttp(400, 'CANTIDAD_INVALIDA', `Se enviaron mas de ${MAXIMO_ARCHIVOS} audios. ${textoTamanos()}`)
      );
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(
        new ErrorHttp(400, 'DATOS_INVALIDOS', 'Los datos enviados no son validos.', [
          { campo: error.field, mensaje: 'Los audios deben enviarse en el campo "audios".' },
        ])
      );
    }
    return next(new ErrorHttp(400, 'DATOS_INVALIDOS', 'El formulario enviado no es valido.'));
  });
}

function textoTamanos() {
  const lista = tamanosPermitidos.length > 1
    ? `${tamanosPermitidos.slice(0, -1).join(', ')} o ${tamanosPermitidos.at(-1)}`
    : String(tamanosPermitidos[0]);
  return `Un lote debe tener ${lista} audios.`;
}

function detalleArchivo(archivo, mensaje, extra = {}) {
  return { campo: 'audios', archivo: archivo.originalname, mensaje, ...extra };
}

// Cantidad, formato y tamano. Los duplicados se revisan al guardar (necesitan la base).
function validarArchivos(archivos) {
  if (!tamanosPermitidos.includes(archivos.length)) {
    throw new ErrorHttp(400, 'CANTIDAD_INVALIDA', `Se recibieron ${archivos.length} audios. ${textoTamanos()}`);
  }

  const malFormato = archivos.flatMap((archivo) => {
    const esperado = FORMATO_POR_EXTENSION[path.extname(archivo.originalname).toLowerCase()];
    if (!esperado) return [detalleArchivo(archivo, 'Solo se permiten archivos .wav o .mp3.')];
    if (archivo.formato !== esperado) {
      return [detalleArchivo(archivo, `El contenido no es un audio ${esperado} valido.`)];
    }
    return [];
  });
  if (malFormato.length > 0) {
    throw new ErrorHttp(400, 'FORMATO_NO_PERMITIDO', 'Hay archivos que no son audios WAV ni MP3.', malFormato);
  }

  const maxMb = audioMaxBytes / (1024 * 1024);
  const grandes = archivos
    .filter((archivo) => archivo.demasiadoGrande)
    .map((archivo) => detalleArchivo(archivo, `Supera el maximo de ${maxMb} MB.`));
  if (grandes.length > 0) {
    throw new ErrorHttp(413, 'ARCHIVO_DEMASIADO_GRANDE', `Hay archivos de mas de ${maxMb} MB.`, grandes);
  }
}

// Repetidos dentro del lote o ya cargados antes (mismo SHA-256).
async function rechazarDuplicados(conexion, archivos) {
  const detalles = [];
  const primeroPorHash = new Map();
  for (const archivo of archivos) {
    const primero = primeroPorHash.get(archivo.hash);
    if (primero) {
      detalles.push(detalleArchivo(archivo, `Esta repetido dentro del lote (igual a "${primero.originalname}").`));
    } else {
      primeroPorHash.set(archivo.hash, archivo);
    }
  }

  const hashes = [...primeroPorHash.keys()];
  const [existentes] = await conexion.execute(
    `SELECT hash_archivo, MIN(id_llamada) AS id_llamada
       FROM TB_Llamada
      WHERE hash_archivo IN (${hashes.map(() => '?').join(', ')})
      GROUP BY hash_archivo`,
    hashes
  );
  for (const fila of existentes) {
    detalles.push(
      detalleArchivo(primeroPorHash.get(fila.hash_archivo), 'Este audio ya se habia cargado antes.', {
        id_llamada_existente: fila.id_llamada,
      })
    );
  }

  if (detalles.length > 0) {
    throw new ErrorHttp(409, 'AUDIO_DUPLICADO', 'Hay audios repetidos o que ya se habian cargado.', detalles);
  }
}

// Ej. LOTE-20261022-0012 (fecha local del servidor + id del lote).
function codigoLote(idLote) {
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
  return `LOTE-${fecha}-${String(idLote).padStart(4, '0')}`;
}

// Crea el lote y sus llamadas, y mueve los audios a uploads/lotes/<id_lote>/.
// Los archivos se mueven dentro de la transaccion: si algo falla, se deshace todo.
async function guardarLote({ archivos, idAgente, usuario, ip }) {
  let carpetaLote;
  try {
    return await conTransaccion(async (conexion) => {
      await rechazarDuplicados(conexion, archivos);

      // codigo_lote es unico y depende del id: se inserta uno provisional y se corrige.
      const [lote] = await conexion.execute(
        `INSERT INTO TB_LoteAudio (codigo_lote, id_usuario_carga, total_archivos) VALUES (?, ?, ?)`,
        [`TMP-${randomBytes(12).toString('hex')}`, usuario.id, archivos.length]
      );
      const idLote = lote.insertId;
      const codigo = codigoLote(idLote);
      await conexion.execute('UPDATE TB_LoteAudio SET codigo_lote = ? WHERE id_lote = ?', [codigo, idLote]);

      carpetaLote = path.join(carpetaUploads, 'lotes', String(idLote));
      await mkdir(carpetaLote, { recursive: true });

      const llamadas = [];
      for (const archivo of archivos) {
        const nombre = archivo.originalname.slice(0, 255);
        const [llamada] = await conexion.execute(
          `INSERT INTO TB_Llamada (id_agente, id_lote, nombre_archivo_original, hash_archivo)
           VALUES (?, ?, ?, ?)`,
          [idAgente, idLote, nombre, archivo.hash]
        );
        // Ruta relativa a backend/uploads/, con "/" para que sirva en cualquier sistema.
        const ruta = `lotes/${idLote}/${llamada.insertId}${path.extname(nombre).toLowerCase()}`;
        await rename(archivo.path, path.join(carpetaUploads, ruta));
        await conexion.execute('UPDATE TB_Llamada SET ruta_audio_storage = ? WHERE id_llamada = ?', [
          ruta,
          llamada.insertId,
        ]);
        llamadas.push({
          id_llamada: llamada.insertId,
          nombre_archivo_original: nombre,
          estado_procesamiento: 'PENDIENTE',
        });
      }

      await conexion.execute(
        `INSERT INTO TB_LogAuditoria
           (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
         VALUES (?, 'CARGA_LOTE', 'CARGA_LOTES', ?, ?)`,
        [usuario.id, JSON.stringify({ id_lote: idLote, id_agente: idAgente, total_archivos: archivos.length }), ip]
      );

      return {
        id_lote: idLote,
        codigo_lote: codigo,
        total_archivos: archivos.length,
        estado_lote: 'PROCESANDO',
        llamadas,
      };
    });
  } catch (error) {
    if (carpetaLote) await rm(carpetaLote, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

const esquemaLote = z.object({
  id_agente: z.coerce
    .number({ invalid_type_error: 'Debe ser un numero.' })
    .int('Debe ser un numero entero.')
    .positive('Debe ser un numero mayor que cero.'),
});

rutasLlamadas.post(
  '/lotes',
  autenticar,
  requierePermiso('CARGA_LOTES', 'escribir'),
  recibirAudiosConErrores,
  async (req, res) => {
    const archivos = req.files ?? [];
    try {
      const { id_agente: idAgente } = validar(esquemaLote, req.body ?? {});
      if (!(await buscarAgenteVisible(req.usuario, idAgente))) {
        throw new ErrorHttp(
          400,
          'AGENTE_INVALIDO',
          'El agente no existe, no esta activo o no puede cargarle audios.'
        );
      }
      validarArchivos(archivos);
      const lote = await guardarLote({ archivos, idAgente, usuario: req.usuario, ip: obtenerIp(req) });
      res.status(201).json(lote);
    } finally {
      // Temporales que no se movieron (por error) o que sobraron.
      await Promise.all(archivos.map((archivo) => rm(archivo.path, { force: true }).catch(() => {})));
    }
  }
);
