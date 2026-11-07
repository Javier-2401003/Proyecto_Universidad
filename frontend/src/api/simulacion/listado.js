// Simulacion de GET /llamadas (docs/api.md, "Listado de llamadas"). Genera 60 dias de
// llamadas de ejemplo de tres agentes, siempre las mismas (semilla fija), y aplica la
// misma visibilidad, filtros, orden y paginacion que el contrato.
import { ErrorApi } from '../cliente.js';
import { aleatorio, elegir } from './estadisticas.js';

const ESTADOS = ['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ERROR'];
const CLASIFICACIONES = ['POSITIVO', 'NEUTRO', 'NEGATIVO', 'CRITICO'];
const DIAGNOSTICOS = ['FALLA_AGENTE', 'CLIENTE_PROBLEMATICO', 'SIN_CONFLICTO'];
// Rango de puntaje_final de cada clasificacion (los cortes de docs/contrato_audio.md).
const RANGOS_PUNTAJE = { POSITIVO: [65, 77.5], NEUTRO: [35, 65], NEGATIVO: [20, 35], CRITICO: [5, 30] };
const ALERTAS_MAXIMAS = { POSITIVO: 0, NEUTRO: 1, NEGATIVO: 3, CRITICO: 5 };

// Los mismos agentes de prueba que la simulacion de carga de lotes.
const AGENTES = [
  { id_usuario: 901, nombre_completo: 'Ana Torres (prueba)', correo_electronico: 'ana.torres@ejemplo.test' },
  { id_usuario: 902, nombre_completo: 'Luis Paredes (prueba)', correo_electronico: 'luis.paredes@ejemplo.test' },
  { id_usuario: 903, nombre_completo: 'Maria Quispe (prueba)', correo_electronico: 'maria.quispe@ejemplo.test' },
];

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function generarLlamadas() {
  const azar = aleatorio(4242);
  const llamadas = [];
  let idLlamada = 5000;
  // Un lote cada pocos dias; "hace" es cuantos dias atras se cargo. El ultimo es de hoy (0),
  // para que haya llamadas en cola.
  const dias = [];
  for (let hace = 60; hace > 0; hace -= 3 + Math.floor(azar() * 3)) dias.push(hace);
  dias.push(0);
  for (const [indice, hace] of dias.entries()) {
    const idLote = 700 + indice;
    const { id_usuario: idAgente, nombre_completo: nombreAgente } = AGENTES[indice % AGENTES.length];
    const agente = { id_usuario: idAgente, nombre_completo: nombreAgente };
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - hace);
    fecha.setHours(9 + Math.floor(azar() * 8), Math.floor(azar() * 60), 0, 0);
    const codigoLote = `LOTE-${fecha.toISOString().slice(0, 10).replaceAll('-', '')}-${String(idLote).padStart(4, '0')}`;
    const cantidad = [5, 10][Math.floor(azar() * 2)];
    for (let n = 0; n < cantidad; n += 1) {
      idLlamada += 1;
      // Las del ultimo lote siguen en cola; unas pocas terminan en error.
      let estado = 'COMPLETADO';
      if (hace === 0) estado = n < 2 ? 'PROCESANDO' : 'PENDIENTE';
      else if (azar() < 0.05) estado = 'ERROR';
      const clasificacion = CLASIFICACIONES[elegir(azar, [0.45, 0.3, 0.18, 0.07])];
      const [minimo, maximo] = RANGOS_PUNTAJE[clasificacion];
      const conflicto = clasificacion === 'NEGATIVO' || clasificacion === 'CRITICO';
      llamadas.push({
        id_llamada: idLlamada,
        id_lote: idLote,
        codigo_lote: codigoLote,
        nombre_archivo_original: `llamada_${String(idLlamada).slice(-3)}.mp3`,
        agente,
        fecha_inicio: new Date(fecha.getTime() + n * 60000).toISOString(),
        duracion_segundos: estado === 'COMPLETADO' ? 60 + Math.floor(azar() * 240) : 0,
        estado_procesamiento: estado,
        mensaje_error: estado === 'ERROR' ? 'AUDIO_ILEGIBLE: No se pudo leer el audio.' : null,
        baja_confianza_audio: estado === 'COMPLETADO' && azar() < 0.06,
        resultado:
          estado === 'COMPLETADO'
            ? {
                puntaje_final: Math.round((minimo + azar() * (maximo - minimo)) * 100) / 100,
                clasificacion_final: clasificacion,
                diagnostico_conflicto: conflicto
                  ? DIAGNOSTICOS[elegir(azar, [0.4, 0.5, 0.1])]
                  : 'SIN_CONFLICTO',
              }
            : null,
        total_alertas: estado === 'COMPLETADO' ? Math.round(azar() * ALERTAS_MAXIMAS[clasificacion]) : 0,
      });
    }
  }
  // Orden del contrato: de la mas reciente a la mas antigua.
  return llamadas.sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio) || b.id_llamada - a.id_llamada);
}

const LLAMADAS = generarLlamadas();

// Imita la visibilidad del backend: en modo de prueba un Agente "es" Ana Torres.
function idsVisibles(usuario) {
  const roles = usuario?.roles ?? [];
  const todos = roles.includes('SUPERADMIN') || roles.includes('SUPERVISOR');
  return new Set((todos ? AGENTES : AGENTES.slice(0, 1)).map((agente) => agente.id_usuario));
}

// Para el filtro por agente en modo de prueba (con el backend real se usa GET /agentes).
export async function listarAgentes() {
  await esperar(150);
  return AGENTES.map(({ id_usuario, nombre_completo, correo_electronico }) => ({
    id_usuario,
    nombre_completo,
    correo_electronico,
  }));
}

function invalido(campo, mensaje) {
  return new ErrorApi(400, 'DATOS_INVALIDOS', 'Los datos enviados no son validos.', [{ campo, mensaje }]);
}

export async function listarLlamadas(filtros = {}, usuario = null) {
  await esperar(300);
  const pagina = Number(filtros.pagina ?? 1);
  const tamanoPagina = Number(filtros.tamano_pagina ?? 20);
  if (!Number.isInteger(pagina) || pagina < 1) throw invalido('pagina', 'Debe ser un entero desde 1.');
  if (!Number.isInteger(tamanoPagina) || tamanoPagina < 1 || tamanoPagina > 100) {
    throw invalido('tamano_pagina', 'Debe ser un entero de 1 a 100.');
  }
  if (filtros.estado && !ESTADOS.includes(filtros.estado)) throw invalido('estado', 'Estado no valido.');
  if (filtros.clasificacion && !CLASIFICACIONES.includes(filtros.clasificacion)) {
    throw invalido('clasificacion', 'Clasificacion no valida.');
  }
  if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
    throw invalido('desde', 'La fecha inicial no puede ser posterior a la final.');
  }

  const visibles = idsVisibles(usuario);
  const buscar = filtros.buscar?.toLowerCase();
  const filtradas = LLAMADAS.filter(
    (l) =>
      visibles.has(l.agente.id_usuario) &&
      (!filtros.id_agente || l.agente.id_usuario === Number(filtros.id_agente)) &&
      (!filtros.estado || l.estado_procesamiento === filtros.estado) &&
      (!filtros.clasificacion || l.resultado?.clasificacion_final === filtros.clasificacion) &&
      (!filtros.diagnostico || l.resultado?.diagnostico_conflicto === filtros.diagnostico) &&
      (!filtros.id_lote || l.id_lote === Number(filtros.id_lote)) &&
      (!filtros.desde || l.fecha_inicio.slice(0, 10) >= filtros.desde) &&
      (!filtros.hasta || l.fecha_inicio.slice(0, 10) <= filtros.hasta) &&
      (!buscar || l.nombre_archivo_original.toLowerCase().includes(buscar))
  );

  return {
    pagina,
    tamano_pagina: tamanoPagina,
    total: filtradas.length,
    total_paginas: Math.ceil(filtradas.length / tamanoPagina),
    llamadas: filtradas.slice((pagina - 1) * tamanoPagina, pagina * tamanoPagina),
  };
}
