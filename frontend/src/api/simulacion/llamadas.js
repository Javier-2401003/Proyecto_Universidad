// Simulacion de GET /llamadas/:id_llamada (docs/api.md). Usa las llamadas de los
// lotes simulados y les asigna una de tres conversaciones de ejemplo, para poder
// ver la pantalla con resultados positivos, con un cliente problematico y con
// una falla del agente. Los resultados siguen las reglas de docs/contrato_audio.md (v0.4):
// score_acustico nunca es positivo, cortes 35 y 65, sin CRITICO ni alertas de voz con baja
// confianza, y los mensajes de las alertas son los de audio-processing/reglas_alertas.json.
import { ErrorApi } from '../cliente.js';
import { buscarLlamada } from './lotes.js';

// Cada fragmento: [hablante, texto, duracion en segundos, sentimiento -1..1, volumen (60 a 90,
// mas alto = mas fuerte; se convierte a dBFS), tono F0].
const CONVERSACIONES = [
  {
    resultado: {
      // Con baja confianza el puntaje usa solo el texto: (0,58 + 1) x 50.
      puntaje_final: 79.0,
      clasificacion_final: 'POSITIVO',
      diagnostico_conflicto: 'SIN_CONFLICTO',
      score_global_nlp: 0.58,
      score_acustico: 0.0,
    },
    baja_confianza_audio: true,
    fragmentos: [
      ['AGENTE', 'Buenas tardes, gracias por comunicarse con soporte. Le saluda Ana, ¿en que puedo ayudarle?', 6, 0.6, 61, 192],
      ['CLIENTE', 'Hola, buenas tardes. Queria saber por que mi factura de este mes vino un poco mas alta.', 7, -0.1, 63, 138],
      ['AGENTE', 'Con gusto lo reviso. ¿Me confirma el numero de su linea, por favor?', 5, 0.4, 60, 188],
      ['CLIENTE', 'Si, claro, es el que termina en cuatro cinco seis.', 4, 0.1, 62, 140],
      ['AGENTE', 'Gracias. Veo que se cobro un paquete de datos adicional el dia doce.', 6, 0.2, 61, 186],
      ['CLIENTE', 'Ah, es verdad, lo active cuando estaba de viaje. No me acordaba.', 6, 0.3, 64, 145],
      ['AGENTE', 'No se preocupe. Si desea, puedo activarle un aviso para que le llegue un mensaje antes de cada cobro.', 8, 0.7, 60, 190],
      ['CLIENTE', 'Excelente, eso me ayudaria mucho. Muchas gracias por la explicacion.', 5, 0.8, 65, 150],
      ['AGENTE', 'Listo, ya quedo activado. ¿Hay algo mas en lo que pueda ayudarle?', 5, 0.6, 61, 191],
      ['CLIENTE', 'No, eso es todo. Muy amable.', 3, 0.7, 63, 148],
      ['AGENTE', 'Gracias a usted por llamar. Que tenga una excelente tarde.', 4, 0.8, 60, 193],
    ],
    alertas: [],
  },
  {
    resultado: {
      // 50 + 50 x (0,55 x -0,35 + 0,45 x -0,42)
      puntaje_final: 30.9,
      clasificacion_final: 'NEGATIVO',
      diagnostico_conflicto: 'CLIENTE_PROBLEMATICO',
      score_global_nlp: -0.35,
      score_acustico: -0.42,
    },
    baja_confianza_audio: false,
    fragmentos: [
      ['AGENTE', 'Buenos dias, soporte tecnico, habla Luis. ¿En que puedo ayudarle?', 5, 0.5, 60, 132],
      ['CLIENTE', '¡Llevo tres dias sin internet y nadie me da una solucion! Ya llame dos veces.', 7, -0.8, 84, 220],
      ['AGENTE', 'Entiendo su molestia y lamento los inconvenientes. Voy a revisar su caso ahora mismo.', 7, 0.4, 61, 130],
      ['CLIENTE', 'Siempre dicen lo mismo. Esto es una estafa, pago por un servicio que no funciona.', 7, -0.9, 89, 235],
      ['AGENTE', 'Comprendo. Veo una averia en su zona; el equipo tecnico ya esta trabajando en ella.', 7, 0.2, 60, 131],
      ['CLIENTE', '¿Y cuando lo van a arreglar? Necesito trabajar desde mi casa.', 5, -0.6, 80, 210],
      ['AGENTE', 'El tiempo estimado es hoy antes de las seis. Ademas le aplicare un descuento por los dias sin servicio.', 8, 0.5, 61, 133],
      ['CLIENTE', 'Bueno... al menos eso. Espero que esta vez si cumplan.', 5, -0.2, 70, 180],
      ['AGENTE', 'Le dejo registrado el caso y le enviaremos un mensaje cuando se restablezca. Gracias por su paciencia.', 7, 0.5, 60, 132],
    ],
    alertas: [
      ['EXCESO_VOLUMEN', 'CLIENTE', 6, '-9.6 dBFS', 'Mantenga un tono calmado y valide la molestia del cliente.'],
      ['VOCABULARIO_INADECUADO', 'CLIENTE', 20.5, 'Palabra: estafa', 'No responda a la provocación; enfóquese en la solución.'],
      ['ALTERACION_TONO', 'CLIENTE', 22, '235 Hz (variación 46 %)', 'Hable más despacio y resuma lo que hará a continuación.'],
    ],
  },
  {
    resultado: {
      // 50 + 50 x (0,55 x -0,62 + 0,45 x -0,55); CRITICO: grito de 2 s y texto menor a -0,3.
      puntaje_final: 20.6,
      clasificacion_final: 'CRITICO',
      diagnostico_conflicto: 'FALLA_AGENTE',
      score_global_nlp: -0.62,
      score_acustico: -0.55,
    },
    baja_confianza_audio: false,
    fragmentos: [
      ['AGENTE', 'Diga.', 2, -0.2, 66, 175],
      ['CLIENTE', 'Hola, buenas, llamo porque me cobraron dos veces la mensualidad.', 6, -0.3, 62, 150],
      ['AGENTE', 'Eso no es asunto de este departamento.', 4, -0.6, 72, 190],
      ['CLIENTE', 'Pero me pasaron con ustedes. ¿Me puede ayudar o no?', 5, -0.5, 70, 165],
      ['AGENTE', 'Ya le dije que no, no sea inútil. Tiene que llamar a otro numero.', 6, -0.9, 85, 215],
      ['CLIENTE', 'Que mala atencion. Quiero hablar con un supervisor.', 4, -0.8, 78, 180],
      ['AGENTE', 'No hay ningun supervisor disponible.', 3, -0.7, 80, 205],
      ['CLIENTE', 'Voy a presentar un reclamo formal.', 3, -0.7, 74, 170],
    ],
    alertas: [
      // OMISION_SCRIPT no va: el analisis todavia no la detecta (falta definir el guion).
      ['VOCABULARIO_INADECUADO', 'AGENTE', 19, 'Palabra: inútil', 'Evite ese lenguaje: mantenga un trato respetuoso con el cliente.'],
      ['EXCESO_VOLUMEN', 'AGENTE', 20, '-8.5 dBFS', 'Baje el volumen y respire antes de responder.'],
      ['ALTERACION_TONO', 'AGENTE', 20.5, '215 Hz (variación 44 %)', 'Respire, baje el ritmo y vuelva a un tono neutro.'],
    ],
  },
];

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function obtenerLlamada(idLlamada) {
  await esperar(300);
  const encontrada = buscarLlamada(Number(idLlamada));
  if (!encontrada) {
    // Las llamadas simuladas viven en memoria: al recargar la pagina se pierden.
    throw new ErrorApi(404, 'NO_ENCONTRADO', 'La llamada no existe. En modo de prueba, cargue un lote de nuevo.');
  }

  const { lote, llamada } = encontrada;
  const base = {
    id_llamada: llamada.id_llamada,
    id_lote: lote.id_lote,
    codigo_lote: lote.codigo_lote,
    nombre_archivo_original: llamada.nombre_archivo_original,
    agente: lote.agente,
    id_cliente: null,
    fecha_inicio: lote.fecha_creacion,
    estado_procesamiento: llamada.estado_procesamiento,
    mensaje_error: llamada.mensaje_error,
    tiene_audio: false,
  };

  if (llamada.estado_procesamiento !== 'COMPLETADO') {
    return { ...base, duracion_segundos: 0, baja_confianza_audio: false, resultado: null, transcripcion: [], alertas: [] };
  }

  const conversacion = CONVERSACIONES[(llamada.id_llamada - 1) % CONVERSACIONES.length];
  let segundo = 0;
  const transcripcion = conversacion.fragmentos.map(([hablante, texto, duracion, score, rms, f0], indice) => {
    const fragmento = {
      id_transcripcion: indice + 1,
      hablante,
      texto_transcrito: texto,
      timestamp_inicio: segundo,
      timestamp_fin: segundo + duracion,
      score_sentimiento: score,
      // dBFS, como en docs/contrato_audio.md: 0 es el maximo y la voz normal ronda -30 a -15.
      nivel_volumen_rms: Math.round((rms - 95) * 6) / 10,
      tono_f0_hz: f0,
    };
    segundo += duracion + 0.5;
    return fragmento;
  });

  return {
    ...base,
    duracion_segundos: Math.ceil(segundo),
    baja_confianza_audio: conversacion.baja_confianza_audio,
    resultado: conversacion.resultado,
    transcripcion,
    alertas: [...conversacion.alertas].sort((a, b) => a[2] - b[2]).map(([tipo, origen, momento, valor, sugerencia], indice) => ({
      id_alerta: indice + 1,
      tipo_alerta: tipo,
      origen_evento: origen,
      timestamp_evento: momento,
      valor_registrado: valor,
      mensaje_sugerencia: sugerencia,
    })),
  };
}
