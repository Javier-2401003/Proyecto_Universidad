// Procesamiento de audio (docs/contrato_audio.md): toma las llamadas PENDIENTE de una en
// una, ejecuta audio-processing/analizar.py y guarda el resultado.
// Nunca en paralelo: cada analisis usa todos los nucleos y hasta 0,8 GB de RAM.
// Debe correr UNA sola instancia del backend por base de datos: al arrancar, las llamadas
// en PROCESANDO se consideran interrumpidas y vuelven a PENDIENTE.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { consultar, conTransaccion } from './db.js';

const SEGUNDOS_ENTRE_REVISIONES = 5;
const MAX_MENSAJE_ERROR = 255; // tamano de TB_Llamada.mensaje_error
const MAX_SALIDA_BYTES = 64 * 1024 * 1024; // la transcripcion de una llamada larga cabe de sobra
const IP_DEL_SISTEMA = '127.0.0.1'; // TB_LogAuditoria.direccion_ip es obligatoria

const score = z.number().min(-1).max(1);
const tiempo = z.number().nonnegative().max(99999.999); // DECIMAL(8,3)
const medida = z.number().min(-9999.99).max(9999.99).nullish(); // DECIMAL(6,2)

// Cada alerta de la v0.3 (seccion 3 del contrato), con los limites de TB_Alerta.
const esquemaAlerta = z.object({
  tipo_alerta: z.enum(['EXCESO_VOLUMEN', 'ALTERACION_TONO', 'VOCABULARIO_INADECUADO', 'OMISION_SCRIPT']),
  origen_evento: z.enum(['AGENTE', 'CLIENTE']),
  timestamp_evento: tiempo,
  valor_registrado: z.string().max(100), // VARCHAR(100)
  mensaje_sugerencia: z.string().max(255), // VARCHAR(255)
});

// Campos de la v0.2 (seccion 5 del contrato) y, si vienen, las alertas de la v0.3. Los que el
// backend no conoce se ignoran. Los limites son los de las columnas: MySQL sin modo estricto
// (Wamp) recorta en silencio el valor que no cabe, y se guardaria un dato falso.
const esquemaResultado = z.object({
  duracion_segundos: z.number().nonnegative().max(2147483647),
  baja_confianza_audio: z.boolean(),
  score_global_nlp: score,
  score_acustico: score,
  puntaje_final: z.number().min(0).max(100),
  clasificacion_final: z.enum(['POSITIVO', 'NEUTRO', 'NEGATIVO', 'CRITICO']),
  diagnostico_conflicto: z.enum(['FALLA_AGENTE', 'CLIENTE_PROBLEMATICO', 'SIN_CONFLICTO']),
  segmentos: z.array(
    z
      .object({
        hablante: z.enum(['AGENTE', 'CLIENTE']),
        texto: z.string(),
        inicio: tiempo,
        fin: tiempo,
        score_sentimiento: score,
        f0_hz: medida,
        rms_dbfs: medida,
      })
      .refine((segmento) => segmento.fin >= segmento.inicio, { path: ['fin'] })
  ),
  // Sin el campo (v0.2) la llamada se guarda sin alertas; si viene, cada una debe ser valida.
  alertas: z.array(esquemaAlerta).default([]),
});

function recortar(mensaje) {
  return Array.from(mensaje).slice(0, MAX_MENSAJE_ERROR).join('');
}

function fallo(mensaje, reintentable = false) {
  return { exito: false, mensaje: recortar(mensaje), reintentable };
}

// El Python de un venv en Windows es un lanzador que abre otro proceso: matar solo al
// primero dejaria el analisis corriendo, y el siguiente se ejecutaria en paralelo.
function matarArbol(hijo) {
  const cerrarSalidas = () => {
    hijo.stdout?.destroy();
    hijo.stderr?.destroy();
  };
  if (process.platform === 'win32' && hijo.pid) {
    execFile('taskkill', ['/pid', String(hijo.pid), '/T', '/F'], { windowsHide: true }, () => {
      hijo.kill('SIGKILL');
      cerrarSalidas();
    });
    return;
  }
  hijo.kill('SIGKILL');
  cerrarSalidas();
}

// Argumentos siempre en un arreglo, sin shell. Nunca se rechaza: el resultado dice que paso.
function ejecutarScript(rutaAudio, opciones) {
  return new Promise((resolver) => {
    let seAcaboElTiempo = false;
    const hijo = execFile(
      opciones.python,
      [opciones.script, rutaAudio, '--modelo', opciones.modelo, '--idioma', 'es'],
      {
        encoding: 'utf8',
        maxBuffer: MAX_SALIDA_BYTES,
        windowsHide: true,
        cwd: path.dirname(opciones.script),
      },
      (error, stdout) => {
        clearTimeout(temporizador);
        resolver({ codigo: error ? (error.code ?? error.signal) : 0, seAcaboElTiempo, stdout });
      }
    );
    const temporizador = setTimeout(() => {
      seAcaboElTiempo = true;
      matarArbol(hijo);
    }, opciones.timeoutMs);
  });
}

function leerJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function validarResultado(json) {
  const version = String(json.version_contrato ?? '');
  if (!version) return fallo('CONTRATO_INCOMPLETO: falta version_contrato');
  if (!/^0\.\d+$/.test(version)) return fallo(`CONTRATO_INCOMPATIBLE: version ${version}`);

  const validacion = esquemaResultado.safeParse(json);
  if (!validacion.success) {
    // "segmentos.3.hablante" -> "segmentos[].hablante", sin repetir por cada segmento.
    const campos = validacion.error.issues.map((problema) =>
      problema.path.map((parte) => (typeof parte === 'number' ? '[]' : parte)).join('.').replace('.[].', '[].')
    );
    return fallo(`CONTRATO_INCOMPLETO: faltan o no son validos: ${[...new Set(campos)].join(', ')}`);
  }
  return { exito: true, datos: validacion.data, versionContrato: version };
}

// Secciones 2 y 4 del contrato: lo que manda es el codigo de salida; stderr no indica error.
function interpretarSalida({ codigo, seAcaboElTiempo, stdout }) {
  if (seAcaboElTiempo) return fallo('TIMEOUT');
  const json = codigo === 0 || codigo === 1 ? leerJson(stdout) : null;
  if (codigo === 0 && json) return validarResultado(json);
  if (codigo === 1 && json?.error?.codigo) {
    return fallo(`${json.error.codigo}: ${json.error.mensaje}`, json.error.codigo === 'ERROR_INTERNO');
  }
  return fallo(`PROCESO_FALLIDO: código ${codigo}`);
}

// Ruta absoluta del audio, o null si no hay ruta o se sale de uploads/.
function rutaAbsolutaAudio(rutaRelativa, carpetaUploads) {
  if (!rutaRelativa) return null;
  const raiz = path.resolve(carpetaUploads);
  const ruta = path.resolve(raiz, rutaRelativa);
  return ruta.startsWith(raiz + path.sep) ? ruta : null;
}

async function analizar(llamada, opciones) {
  const ruta = rutaAbsolutaAudio(llamada.ruta_audio_storage, opciones.carpetaUploads);
  if (!ruta) return fallo('ARCHIVO_NO_ENCONTRADO: La llamada no tiene un audio valido.');

  let resultado = interpretarSalida(await ejecutarScript(ruta, opciones));
  if (!resultado.exito && resultado.reintentable) {
    resultado = interpretarSalida(await ejecutarScript(ruta, opciones)); // ERROR_INTERNO: una vez
  }
  return resultado;
}

// Auditoria y estado del lote, dentro de la transaccion que cierra la llamada. El analisis
// no tiene usuario en sesion: se atribuye a quien cargo el lote.
async function registrarCierre(conexion, llamada, detalle) {
  await conexion.execute(
    `INSERT INTO TB_LogAuditoria
       (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
     VALUES (?, 'PROCESAMIENTO_LLAMADA', 'CARGA_LOTES', ?, ?)`,
    [
      llamada.id_usuario_carga ?? llamada.id_agente,
      JSON.stringify({ id_llamada: llamada.id_llamada, id_lote: llamada.id_lote, origen: 'AUTOMATICO', ...detalle }),
      IP_DEL_SISTEMA,
    ]
  );
  if (llamada.id_lote === null) return;
  await conexion.execute(
    `UPDATE TB_LoteAudio l
       JOIN (SELECT SUM(estado_procesamiento IN ('PENDIENTE', 'PROCESANDO')) AS abiertas,
                    SUM(estado_procesamiento = 'ERROR') AS errores
               FROM TB_Llamada WHERE id_lote = ?) r
        SET l.estado_lote = IF(r.errores > 0, 'CON_ERRORES', 'COMPLETADO')
      WHERE l.id_lote = ? AND r.abiertas = 0`,
    [llamada.id_lote, llamada.id_lote]
  );
}

async function guardarExito(llamada, { datos, versionContrato }) {
  await conTransaccion(async (conexion) => {
    const [cambio] = await conexion.execute(
      `UPDATE TB_Llamada
          SET estado_procesamiento = 'COMPLETADO', mensaje_error = NULL, duracion_segundos = ?,
              baja_confianza_audio = ?, score_global_nlp = ?, score_acustico = ?, puntaje_final = ?,
              clasificacion_final = ?, diagnostico_conflicto = ?
        WHERE id_llamada = ? AND estado_procesamiento = 'PROCESANDO'`,
      [
        Math.round(datos.duracion_segundos),
        datos.baja_confianza_audio ? 1 : 0,
        datos.score_global_nlp,
        datos.score_acustico,
        datos.puntaje_final,
        datos.clasificacion_final,
        datos.diagnostico_conflicto,
        llamada.id_llamada,
      ]
    );
    if (cambio.affectedRows === 0) return; // la borraron mientras se analizaba

    // Por si un intento interrumpido alcanzo a dejar filas.
    await conexion.execute('DELETE FROM TB_Transcripcion WHERE id_llamada = ?', [llamada.id_llamada]);
    for (const segmento of datos.segmentos) {
      await conexion.execute(
        `INSERT INTO TB_Transcripcion
           (id_llamada, hablante, texto_transcrito, timestamp_inicio, timestamp_fin,
            score_sentimiento, nivel_volumen_rms, tono_f0_hz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          llamada.id_llamada,
          segmento.hablante,
          segmento.texto,
          segmento.inicio,
          segmento.fin,
          segmento.score_sentimiento,
          segmento.rms_dbfs ?? null,
          segmento.f0_hz ?? null,
        ]
      );
    }
    // Igual que la transcripcion: un reproceso no debe duplicar las alertas.
    await conexion.execute('DELETE FROM TB_Alerta WHERE id_llamada = ?', [llamada.id_llamada]);
    for (const alerta of datos.alertas) {
      await conexion.execute(
        `INSERT INTO TB_Alerta
           (id_llamada, tipo_alerta, origen_evento, timestamp_evento, valor_registrado, mensaje_sugerencia)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          llamada.id_llamada,
          alerta.tipo_alerta,
          alerta.origen_evento,
          alerta.timestamp_evento,
          alerta.valor_registrado,
          alerta.mensaje_sugerencia,
        ]
      );
    }
    await registrarCierre(conexion, llamada, {
      estado_procesamiento: 'COMPLETADO',
      version_contrato: versionContrato,
      segmentos: datos.segmentos.length,
      alertas: datos.alertas.length,
    });
  });
}

async function guardarError(llamada, mensaje) {
  await conTransaccion(async (conexion) => {
    const [cambio] = await conexion.execute(
      `UPDATE TB_Llamada SET estado_procesamiento = 'ERROR', mensaje_error = ?
        WHERE id_llamada = ? AND estado_procesamiento = 'PROCESANDO'`,
      [mensaje, llamada.id_llamada]
    );
    if (cambio.affectedRows === 0) return;
    await registrarCierre(conexion, llamada, { estado_procesamiento: 'ERROR', mensaje_error: mensaje });
  });
}

// Procesa una llamada si sigue PENDIENTE. Devuelve false si no la pudo tomar.
export async function procesarLlamada(idLlamada, opcionesExtra = {}) {
  const opciones = { ...config.audio, carpetaUploads: config.lotes.carpetaUploads, ...opcionesExtra };

  const tomada = await consultar(
    `UPDATE TB_Llamada SET estado_procesamiento = 'PROCESANDO', mensaje_error = NULL
      WHERE id_llamada = ? AND estado_procesamiento = 'PENDIENTE'`,
    [idLlamada]
  );
  if (tomada.affectedRows === 0) return false;

  const [llamada] = await consultar(
    `SELECT c.id_llamada, c.id_agente, c.id_lote, c.ruta_audio_storage, l.id_usuario_carga
       FROM TB_Llamada c
       LEFT JOIN TB_LoteAudio l ON l.id_lote = c.id_lote
      WHERE c.id_llamada = ?`,
    [idLlamada]
  );
  if (!llamada) return false;

  const resultado = await analizar(llamada, opciones);
  try {
    if (resultado.exito) await guardarExito(llamada, resultado);
    else await guardarError(llamada, resultado.mensaje);
  } catch (error) {
    console.error('[audio] no se pudo guardar la llamada', idLlamada, error.code || error.message);
    // Si esto tambien falla, sube a quien llamo; al reiniciar, la llamada vuelve a PENDIENTE.
    await guardarError(llamada, 'ERROR_GUARDADO: No se pudo guardar el resultado del analisis.');
  }
  return true;
}

// Procesa las pendientes de una en una, hasta que no quede ninguna. Devuelve cuantas tomo.
// "idLote" limita la cola a un lote.
export async function procesarPendientes({ idLote, ...opciones } = {}) {
  let procesadas = 0;
  for (;;) {
    const [siguiente] = await consultar(
      `SELECT id_llamada FROM TB_Llamada
        WHERE estado_procesamiento = 'PENDIENTE' ${idLote ? 'AND id_lote = ?' : ''}
        ORDER BY id_llamada LIMIT 1`,
      idLote ? [idLote] : []
    );
    if (!siguiente) return procesadas;
    if (await procesarLlamada(siguiente.id_llamada, opciones)) procesadas += 1;
  }
}

// Llamadas que quedaron en PROCESANDO porque el servidor se detuvo a medio analisis.
export async function recuperarInterrumpidas({ idLote } = {}) {
  const resultado = await consultar(
    `UPDATE TB_Llamada SET estado_procesamiento = 'PENDIENTE'
      WHERE estado_procesamiento = 'PROCESANDO' ${idLote ? 'AND id_lote = ?' : ''}`,
    idLote ? [idLote] : []
  );
  return resultado.affectedRows;
}

// Un comando suelto ("python") se busca en el PATH; una ruta debe existir.
function faltaArchivo(ruta) {
  return ruta.includes(path.sep) && !existsSync(ruta);
}

// Revisa la cola mientras el servidor este activo. En una computadora sin el analisis
// instalado no arranca, para no dejar en ERROR todas las llamadas: siguen en PENDIENTE.
export function iniciarProcesamiento({ python, script } = config.audio) {
  if (!python || !script || faltaArchivo(python) || faltaArchivo(script)) {
    console.log('[audio] Procesamiento apagado: revise AUDIO_PYTHON y AUDIO_SCRIPT en backend/.env.');
    return null;
  }

  let detenido = false;
  let temporizador;
  const revisar = async () => {
    try {
      await procesarPendientes();
    } catch (error) {
      console.error('[audio] fallo la revision de la cola:', error.code || error.message);
    }
    if (!detenido) temporizador = setTimeout(revisar, SEGUNDOS_ENTRE_REVISIONES * 1000);
  };

  recuperarInterrumpidas()
    .catch((error) => console.error('[audio] no se pudo recuperar la cola:', error.code || error.message))
    .then(revisar);
  console.log('[audio] Procesamiento activo.');

  return () => {
    detenido = true;
    clearTimeout(temporizador);
  };
}
