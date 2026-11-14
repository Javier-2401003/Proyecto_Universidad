// Reproceso de llamadas ya analizadas (decision 3 del 11/11, v0.4 del contrato de audio): las que
// se analizaron con una version anterior conservan su escala de puntaje, y el inicio, el Dashboard y
// los Reportes las promedian junto con las nuevas. Volverlas a PENDIENTE hace que el procesamiento las
// analice otra vez con el analizar.py actual, que reemplaza su transcripcion y sus alertas.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { consultar, conTransaccion } from './db.js';

const IP_DEL_SISTEMA = '127.0.0.1';

// "0.3" -> 3. Las versiones mayores distintas de 0 nunca se guardan (CONTRATO_INCOMPATIBLE).
export function versionMenor(texto) {
  const coincidencia = /^0\.(\d+)$/.exec(String(texto ?? '').trim());
  return coincidencia ? Number(coincidencia[1]) : null;
}

// Version del ultimo analisis de cada llamada, segun la auditoria (PROCESAMIENTO_LLAMADA).
async function versionesAnalizadas() {
  const filas = await consultar(
    `SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(detalle_cambio, '$.id_llamada')) AS UNSIGNED) AS id_llamada,
            JSON_UNQUOTE(JSON_EXTRACT(detalle_cambio, '$.version_contrato')) AS version
       FROM TB_LogAuditoria
      WHERE accion_ejecutada = 'PROCESAMIENTO_LLAMADA'
      ORDER BY id_log`
  );
  const versiones = new Map();
  for (const fila of filas) versiones.set(Number(fila.id_llamada), fila.version ?? null); // gana la ultima
  return versiones;
}

async function existeAudio(rutaRelativa, carpetaUploads) {
  if (!rutaRelativa) return false;
  const raiz = path.resolve(carpetaUploads);
  const ruta = path.resolve(raiz, rutaRelativa);
  if (!ruta.startsWith(raiz + path.sep)) return false;
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

// Que llamadas habria que reprocesar. No cambia nada.
// - antesDe: version menor del contrato, ej. "0.4": las COMPLETADO analizadas con una version anterior
//   (o sin version conocida). Sin antesDe ("todas"), todas las COMPLETADO.
// - incluirErrores: tambien las que quedaron en ERROR, para reintentarlas.
// - idLote: solo ese lote.
export async function buscarParaReprocesar({
  antesDe,
  idLote,
  incluirErrores = false,
  carpetaUploads = config.lotes.carpetaUploads,
} = {}) {
  const limite = antesDe === undefined ? null : versionMenor(antesDe);
  if (antesDe !== undefined && limite === null) {
    throw new Error(`Version invalida: "${antesDe}". Use el formato 0.x, por ejemplo 0.4.`);
  }

  const estados = incluirErrores ? ['COMPLETADO', 'ERROR'] : ['COMPLETADO'];
  const llamadas = await consultar(
    `SELECT id_llamada, id_lote, nombre_archivo_original, estado_procesamiento, ruta_audio_storage
       FROM TB_Llamada
      WHERE estado_procesamiento IN (${estados.map(() => '?').join(', ')}) ${idLote ? 'AND id_lote = ?' : ''}
      ORDER BY id_llamada`,
    idLote ? [...estados, idLote] : estados
  );
  const versiones = await versionesAnalizadas();

  const resultado = { aReprocesar: [], sinAudio: [], alDia: 0 };
  for (const llamada of llamadas) {
    const version = versiones.get(llamada.id_llamada) ?? null;
    const anterior =
      llamada.estado_procesamiento === 'ERROR' ||
      limite === null ||
      versionMenor(version) === null ||
      versionMenor(version) < limite;
    if (!anterior) {
      resultado.alDia += 1;
      continue;
    }
    const fila = { ...llamada, version };
    if (await existeAudio(llamada.ruta_audio_storage, carpetaUploads)) resultado.aReprocesar.push(fila);
    else resultado.sinAudio.push(fila);
  }
  return resultado;
}

// Vuelve a PENDIENTE las llamadas indicadas (solo si siguen COMPLETADO o ERROR) y sus lotes a
// PROCESANDO, y lo registra en la auditoria. Devuelve cuantas cambiaron.
export async function marcarParaReprocesar(idsLlamadas, { idUsuario, motivo = {} }) {
  if (idsLlamadas.length === 0) return 0;
  const marcas = idsLlamadas.map(() => '?').join(', ');
  return conTransaccion(async (conexion) => {
    const [cambio] = await conexion.execute(
      `UPDATE TB_Llamada SET estado_procesamiento = 'PENDIENTE', mensaje_error = NULL
        WHERE id_llamada IN (${marcas}) AND estado_procesamiento IN ('COMPLETADO', 'ERROR')`,
      idsLlamadas
    );
    await conexion.execute(
      `UPDATE TB_LoteAudio SET estado_lote = 'PROCESANDO'
        WHERE id_lote IN (SELECT DISTINCT id_lote FROM TB_Llamada WHERE id_llamada IN (${marcas}))`,
      idsLlamadas
    );
    await conexion.execute(
      `INSERT INTO TB_LogAuditoria (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
       VALUES (?, 'REPROCESO_LLAMADAS', 'CARGA_LOTES', ?, ?)`,
      [
        idUsuario,
        JSON.stringify({ total: cambio.affectedRows, ids_llamadas: idsLlamadas, origen: 'SCRIPT', ...motivo }),
        IP_DEL_SISTEMA,
      ]
    );
    return cambio.affectedRows;
  });
}
