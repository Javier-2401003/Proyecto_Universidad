// Simulacion de GET /estadisticas/resumen (docs/api.md). Genera 90 dias de llamadas
// de ejemplo para los agentes de prueba, siempre las mismas (semilla fija), y las
// resume igual que lo hara el backend.
import { ErrorApi } from '../cliente.js';

const AGENTES = [
  // tendencia: probabilidad de [POSITIVO, NEUTRO, NEGATIVO, CRITICO] de cada agente.
  { id_usuario: 901, nombre_completo: 'Ana Torres (prueba)', tendencia: [0.6, 0.25, 0.12, 0.03] },
  { id_usuario: 902, nombre_completo: 'Luis Paredes (prueba)', tendencia: [0.4, 0.3, 0.22, 0.08] },
  { id_usuario: 903, nombre_completo: 'Maria Quispe (prueba)', tendencia: [0.25, 0.3, 0.27, 0.18] },
];

const CLASIFICACIONES = ['POSITIVO', 'NEUTRO', 'NEGATIVO', 'CRITICO'];
// Rango de puntaje_final (0 a 100) de cada clasificacion.
const RANGOS_PUNTAJE = { POSITIVO: [70, 98], NEUTRO: [45, 70], NEGATIVO: [25, 45], CRITICO: [5, 25] };
// Cuantas alertas suele tener una llamada de cada clasificacion (maximo).
const ALERTAS_MAXIMAS = { POSITIVO: 0, NEUTRO: 1, NEGATIVO: 3, CRITICO: 5 };
const TIPOS_ALERTA = ['EXCESO_VOLUMEN', 'ALTERACION_TONO', 'VOCABULARIO_INADECUADO', 'OMISION_SCRIPT'];
const ESTADOS = ['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ERROR'];
const PERIODOS = [7, 30, 90];
const DIAS_GENERADOS = 90;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Generador pseudoaleatorio con semilla (mulberry32): los mismos datos en cada carga.
export function aleatorio(semilla) {
  let estado = semilla;
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function elegir(azar, probabilidades) {
  let acumulado = 0;
  const valor = azar();
  for (let indice = 0; indice < probabilidades.length; indice += 1) {
    acumulado += probabilidades[indice];
    if (valor < acumulado) return indice;
  }
  return probabilidades.length - 1;
}

// Fecha local en formato AAAA-MM-DD.
function fechaIso(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// Llamadas de los ultimos 90 dias. "hace" es cuantos dias atras ocurrio (0 = hoy).
function generarLlamadas() {
  const azar = aleatorio(2026);
  const llamadas = [];
  for (let hace = 0; hace < DIAS_GENERADOS; hace += 1) {
    for (const agente of AGENTES) {
      const cantidad = 1 + Math.floor(azar() * 4);
      for (let n = 0; n < cantidad; n += 1) {
        // Las de hoy pueden seguir en cola; unas pocas terminan en error.
        let estado = 'COMPLETADO';
        if (hace === 0 && azar() < 0.5) estado = azar() < 0.7 ? 'PENDIENTE' : 'PROCESANDO';
        else if (azar() < 0.04) estado = 'ERROR';

        const llamada = { hace, id_agente: agente.id_usuario, estado, alertas: [] };
        if (estado === 'COMPLETADO') {
          const clasificacion = CLASIFICACIONES[elegir(azar, agente.tendencia)];
          const [minimo, maximo] = RANGOS_PUNTAJE[clasificacion];
          llamada.clasificacion = clasificacion;
          llamada.puntaje = minimo + azar() * (maximo - minimo);
          llamada.baja_confianza = azar() < 0.05;
          const totalAlertas = Math.round(azar() * ALERTAS_MAXIMAS[clasificacion]);
          for (let a = 0; a < totalAlertas; a += 1) {
            llamada.alertas.push(TIPOS_ALERTA[elegir(azar, [0.32, 0.22, 0.27, 0.19])]);
          }
        }
        llamadas.push(llamada);
      }
    }
  }
  return llamadas;
}

const LLAMADAS = generarLlamadas();

const ceros = (claves) => Object.fromEntries(claves.map((clave) => [clave, 0]));
const promedio = (valores) =>
  valores.length === 0 ? null : Math.round((valores.reduce((suma, v) => suma + v, 0) / valores.length) * 10) / 10;

// Imita la visibilidad del backend: en modo de prueba un Agente "es" Ana Torres.
function agentesVisibles(usuario) {
  const roles = usuario?.roles ?? [];
  if (roles.includes('SUPERADMIN') || roles.includes('SUPERVISOR')) return AGENTES;
  return AGENTES.slice(0, 1);
}

export async function obtenerResumen(dias, usuario) {
  await esperar(300);
  if (!PERIODOS.includes(Number(dias))) {
    throw new ErrorApi(400, 'DATOS_INVALIDOS', 'El periodo debe ser de 7, 30 o 90 dias.');
  }

  const visibles = agentesVisibles(usuario);
  const ids = new Set(visibles.map((agente) => agente.id_usuario));
  const delPeriodo = LLAMADAS.filter((llamada) => llamada.hace < dias && ids.has(llamada.id_agente));
  const completadas = delPeriodo.filter((llamada) => llamada.estado === 'COMPLETADO');

  const porEstado = ceros(ESTADOS);
  for (const llamada of delPeriodo) porEstado[llamada.estado] += 1;
  const porClasificacion = ceros(CLASIFICACIONES);
  const porTipo = ceros(TIPOS_ALERTA);
  for (const llamada of completadas) {
    porClasificacion[llamada.clasificacion] += 1;
    for (const tipo of llamada.alertas) porTipo[tipo] += 1;
  }

  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setDate(desde.getDate() - (dias - 1));

  return {
    periodo: { dias: Number(dias), desde: fechaIso(desde), hasta: fechaIso(hasta) },
    llamadas: { total: delPeriodo.length, por_estado: porEstado },
    sentimiento: {
      puntaje_promedio: promedio(completadas.map((llamada) => llamada.puntaje)),
      por_clasificacion: porClasificacion,
      baja_confianza_audio: completadas.filter((llamada) => llamada.baja_confianza).length,
    },
    alertas: {
      total: Object.values(porTipo).reduce((suma, n) => suma + n, 0),
      por_tipo: porTipo,
    },
    agentes: visibles
      .map((agente) => {
        const propias = delPeriodo.filter((llamada) => llamada.id_agente === agente.id_usuario);
        const analizadas = propias.filter((llamada) => llamada.estado === 'COMPLETADO');
        return {
          id_usuario: agente.id_usuario,
          nombre_completo: agente.nombre_completo,
          total: propias.length,
          llamadas_completadas: analizadas.length,
          puntaje_promedio: promedio(analizadas.map((llamada) => llamada.puntaje)),
          llamadas_criticas: analizadas.filter((llamada) => llamada.clasificacion === 'CRITICO').length,
          alertas: analizadas.reduce((suma, llamada) => suma + llamada.alertas.length, 0),
        };
      })
      .filter((agente) => agente.total > 0)
      .map(({ total, ...agente }) => agente)
      .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo)),
  };
}
