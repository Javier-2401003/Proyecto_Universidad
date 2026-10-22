// Simulacion de GET /llamadas/:id_llamada (docs/api.md). Usa las llamadas de los
// lotes simulados y les asigna una de tres conversaciones de ejemplo, para poder
// ver la pantalla con resultados positivos, con un cliente problematico y con
// una falla del agente.
import { ErrorApi } from '../cliente.js';
import { buscarLlamada } from './lotes.js';

// Cada fragmento: [hablante, texto, duracion en segundos, sentimiento -1..1, volumen RMS, tono F0].
const CONVERSACIONES = [
  {
    resultado: {
      puntaje_final: 86.4,
      clasificacion_final: 'POSITIVO',
      diagnostico_conflicto: 'SIN_CONFLICTO',
      score_global_nlp: 0.58,
      score_acustico: 0.31,
    },
    baja_confianza_audio: false,
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
      puntaje_final: 41.2,
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
      ['EXCESO_VOLUMEN', 'CLIENTE', 6, '84 dB', 'Mantenga un tono calmado y valide la molestia del cliente.'],
      ['VOCABULARIO_INADECUADO', 'CLIENTE', 21, 'Palabra: estafa', 'No responda a la provocacion; enfoquese en la solucion.'],
      ['ALTERACION_TONO', 'CLIENTE', 22, '235 Hz', 'Hable mas despacio y resuma lo que hara a continuacion.'],
    ],
  },
  {
    resultado: {
      puntaje_final: 18.7,
      clasificacion_final: 'CRITICO',
      diagnostico_conflicto: 'FALLA_AGENTE',
      score_global_nlp: -0.62,
      score_acustico: -0.55,
    },
    baja_confianza_audio: true,
    fragmentos: [
      ['AGENTE', 'Diga.', 2, -0.2, 66, 175],
      ['CLIENTE', 'Hola, buenas, llamo porque me cobraron dos veces la mensualidad.', 6, -0.3, 62, 150],
      ['AGENTE', 'Eso no es asunto de este departamento.', 4, -0.6, 72, 190],
      ['CLIENTE', 'Pero me pasaron con ustedes. ¿Me puede ayudar o no?', 5, -0.5, 70, 165],
      ['AGENTE', 'Ya le dije que no. Tiene que llamar a otro numero, no me haga perder el tiempo.', 6, -0.9, 85, 215],
      ['CLIENTE', 'Que mala atencion. Quiero hablar con un supervisor.', 4, -0.8, 78, 180],
      ['AGENTE', 'No hay ningun supervisor disponible.', 3, -0.7, 80, 205],
      ['CLIENTE', 'Voy a presentar un reclamo formal.', 3, -0.7, 74, 170],
    ],
    alertas: [
      ['OMISION_SCRIPT', 'AGENTE', 0, 'Sin saludo ni identificacion', 'Salude, diga su nombre y ofrezca ayuda al iniciar la llamada.'],
      ['VOCABULARIO_INADECUADO', 'AGENTE', 22, 'Frase: no me haga perder el tiempo', 'Evite frases que culpen al cliente; ofrezca una alternativa.'],
      ['EXCESO_VOLUMEN', 'AGENTE', 20, '85 dB', 'Baje el volumen y respire antes de responder.'],
      ['OMISION_SCRIPT', 'AGENTE', 30, 'Escalamiento a supervisor negado', 'Si el cliente pide un supervisor, transfiera o agende la devolucion de la llamada.'],
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
      nivel_volumen_rms: rms,
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
