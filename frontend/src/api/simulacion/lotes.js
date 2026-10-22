// Simulacion de los endpoints de carga de lotes (docs/api.md), para construir y
// probar la pantalla antes de que existan en el backend. Repite las mismas
// validaciones y respuestas del contrato. Los datos viven solo en memoria: se
// pierden al recargar la pagina.
import { ErrorApi } from '../cliente.js';

const AGENTES = [
  { id_usuario: 901, nombre_completo: 'Ana Torres (prueba)', correo_electronico: 'ana.torres@ejemplo.test' },
  { id_usuario: 902, nombre_completo: 'Luis Paredes (prueba)', correo_electronico: 'luis.paredes@ejemplo.test' },
  { id_usuario: 903, nombre_completo: 'Maria Quispe (prueba)', correo_electronico: 'maria.quispe@ejemplo.test' },
];

const TAMANOS_PERMITIDOS = [5, 10, 15];
const MAX_BYTES = 25 * 1024 * 1024;

// Tiempos de la simulacion del procesamiento (milisegundos).
const ESPERA_INICIAL = 2000;
const DURACION_POR_LLAMADA = 1500;

const lotes = new Map();
// Archivos ya "cargados": nombre + tamano hace de huella (el backend real usa SHA-256).
const huellasCargadas = new Map();
let siguienteIdLote = 1;
let siguienteIdLlamada = 1;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const huella = (archivo) => `${archivo.name}|${archivo.size}`;
const extensionValida = (nombre) => /\.(wav|mp3)$/i.test(nombre);

export async function listarAgentes() {
  await esperar(300);
  return AGENTES;
}

export async function subirLote({ idAgente, archivos }, alProgreso) {
  validar(Number(idAgente), archivos);

  // Avance de subida simulado en 10 pasos.
  for (let paso = 1; paso <= 10; paso += 1) {
    await esperar(120);
    alProgreso?.(paso * 10);
  }

  const idLote = siguienteIdLote++;
  const ahora = new Date();
  const codigo = `LOTE-${ahora.toISOString().slice(0, 10).replaceAll('-', '')}-${String(idLote).padStart(4, '0')}`;
  const llamadas = archivos.map((archivo) => {
    const idLlamada = siguienteIdLlamada++;
    huellasCargadas.set(huella(archivo), idLlamada);
    return { id_llamada: idLlamada, nombre_archivo_original: archivo.name };
  });

  lotes.set(idLote, {
    id_lote: idLote,
    codigo_lote: codigo,
    total_archivos: archivos.length,
    fecha_creacion: ahora.toISOString(),
    agente: AGENTES.find((agente) => agente.id_usuario === Number(idAgente)),
    llamadas,
    inicio: ahora.getTime(),
  });

  const lote = estadoActual(lotes.get(idLote));
  return {
    id_lote: lote.id_lote,
    codigo_lote: lote.codigo_lote,
    total_archivos: lote.total_archivos,
    estado_lote: lote.estado_lote,
    llamadas: lote.llamadas.map(({ id_llamada, nombre_archivo_original, estado_procesamiento }) => ({
      id_llamada,
      nombre_archivo_original,
      estado_procesamiento,
    })),
  };
}

export async function obtenerLote(idLote) {
  await esperar(200);
  const lote = lotes.get(Number(idLote));
  if (!lote) throw new ErrorApi(404, 'NO_ENCONTRADO', 'El lote no existe.');
  return estadoActual(lote);
}

// Las mismas reglas y codigos de error que POST /llamadas/lotes en docs/api.md.
function validar(idAgente, archivos) {
  if (!Number.isInteger(idAgente)) {
    throw new ErrorApi(400, 'DATOS_INVALIDOS', 'Los datos enviados no son validos.', [
      { campo: 'id_agente', mensaje: 'Seleccione un agente.' },
    ]);
  }
  if (!AGENTES.some((agente) => agente.id_usuario === idAgente)) {
    throw new ErrorApi(400, 'AGENTE_INVALIDO', 'El agente seleccionado no es valido.');
  }
  if (!TAMANOS_PERMITIDOS.includes(archivos.length)) {
    throw new ErrorApi(
      400,
      'CANTIDAD_INVALIDA',
      `Se recibieron ${archivos.length} audios; el lote debe tener 5, 10 o 15.`
    );
  }

  const detallesPor = (filtro, mensaje) =>
    archivos.filter(filtro).map((archivo) => ({ campo: 'audios', archivo: archivo.name, mensaje }));

  const formato = detallesPor((a) => !extensionValida(a.name), 'Solo se permiten archivos WAV o MP3.');
  if (formato.length) {
    throw new ErrorApi(400, 'FORMATO_NO_PERMITIDO', 'Hay archivos con un formato no permitido.', formato);
  }

  const grandes = detallesPor((a) => a.size > MAX_BYTES, 'El archivo supera 25 MB.');
  if (grandes.length) {
    throw new ErrorApi(413, 'ARCHIVO_DEMASIADO_GRANDE', 'Hay archivos que superan el tamano maximo.', grandes);
  }

  const vistos = new Set();
  const duplicados = [];
  for (const archivo of archivos) {
    const clave = huella(archivo);
    if (huellasCargadas.has(clave)) {
      duplicados.push({
        campo: 'audios',
        archivo: archivo.name,
        mensaje: 'Este audio ya se habia cargado antes.',
        id_llamada_existente: huellasCargadas.get(clave),
      });
    } else if (vistos.has(clave)) {
      duplicados.push({ campo: 'audios', archivo: archivo.name, mensaje: 'El audio esta repetido en el lote.' });
    }
    vistos.add(clave);
  }
  if (duplicados.length) {
    throw new ErrorApi(409, 'AUDIO_DUPLICADO', 'Hay audios duplicados.', duplicados);
  }
}

// Avance simulado: las llamadas se procesan una tras otra. Un archivo cuyo
// nombre contiene "error" termina en ERROR, para poder probar ese caso.
function estadoActual(lote) {
  const transcurrido = Date.now() - lote.inicio;

  const llamadas = lote.llamadas.map((llamada, indice) => {
    const inicio = ESPERA_INICIAL + indice * DURACION_POR_LLAMADA;
    let estado = 'PENDIENTE';
    if (transcurrido >= inicio + DURACION_POR_LLAMADA) {
      estado = /error/i.test(llamada.nombre_archivo_original) ? 'ERROR' : 'COMPLETADO';
    } else if (transcurrido >= inicio) {
      estado = 'PROCESANDO';
    }
    return {
      ...llamada,
      estado_procesamiento: estado,
      mensaje_error: estado === 'ERROR' ? 'No se pudo transcribir el audio (simulado).' : null,
    };
  });

  const terminadas = llamadas.every((l) => l.estado_procesamiento === 'COMPLETADO' || l.estado_procesamiento === 'ERROR');
  const conErrores = llamadas.some((l) => l.estado_procesamiento === 'ERROR');

  return {
    id_lote: lote.id_lote,
    codigo_lote: lote.codigo_lote,
    estado_lote: !terminadas ? 'PROCESANDO' : conErrores ? 'CON_ERRORES' : 'COMPLETADO',
    total_archivos: lote.total_archivos,
    fecha_creacion: lote.fecha_creacion,
    agente: { id_usuario: lote.agente.id_usuario, nombre_completo: lote.agente.nombre_completo },
    llamadas,
  };
}
