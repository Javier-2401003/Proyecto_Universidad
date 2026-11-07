// Llamadas. Contrato: docs/api.md, secciones "Detalle de una llamada" y "Listado de llamadas".
// Usa el backend real; con VITE_SIMULAR_LLAMADAS=true usa datos simulados
// (api/simulacion/llamadas.js). El listado tiene su propio interruptor, SIMULAR_LISTADO
// (api/simulacion/listado.js); ver api/simulacion/activa.js.
import { pedir, pedirArchivo } from './cliente.js';
import { SIMULAR_LISTADO, SIMULAR_LLAMADAS as SIMULAR } from './simulacion/activa.js';
import * as simulacion from './simulacion/llamadas.js';
import * as simulacionListado from './simulacion/listado.js';

// filtros: { pagina, tamano_pagina, desde, hasta, id_agente, id_lote, estado, clasificacion,
// diagnostico, buscar }; los vacios no se envian.
// Responde { pagina, tamano_pagina, total, total_paginas, llamadas: [...] }.
export function listarLlamadas(filtros = {}) {
  const usados = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== '' && valor != null));
  if (SIMULAR_LISTADO) return simulacionListado.listarLlamadas(usados);
  return pedir(`/api/v1/llamadas?${new URLSearchParams(usados)}`);
}

// { id_llamada, agente, estado_procesamiento, resultado, transcripcion, alertas, tiene_audio, ... }
export function obtenerLlamada(idLlamada) {
  return SIMULAR ? simulacion.obtenerLlamada(idLlamada) : pedir(`/api/v1/llamadas/${idLlamada}`);
}

// Blob con el audio original. En modo de prueba no hay audio.
export function obtenerAudio(idLlamada) {
  if (SIMULAR) return Promise.reject(new Error('No hay audio en modo de prueba.'));
  return pedirArchivo(`/api/v1/llamadas/${idLlamada}/audio`);
}
