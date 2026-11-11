// Llamadas. Contrato: docs/api.md, secciones "Detalle de una llamada" y "Listado de llamadas".
// Usa el backend real; con VITE_SIMULAR_LLAMADAS=true usa datos simulados
// (api/simulacion/llamadas.js). El listado tiene su propio interruptor, SIMULAR_LISTADO
// (api/simulacion/listado.js); ver api/simulacion/activa.js.
import { pedir, pedirArchivo } from './cliente.js';
import { SIMULAR_LISTADO, SIMULAR_LLAMADAS as SIMULAR } from './simulacion/activa.js';
import * as simulacion from './simulacion/llamadas.js';
import * as simulacionListado from './simulacion/listado.js';
import { listarAgentes } from './lotes.js';

// filtros: { pagina, tamano_pagina, desde, hasta, id_agente, id_lote, estado, clasificacion,
// diagnostico, buscar }; los vacios no se envian.
// Responde { pagina, tamano_pagina, total, total_paginas, llamadas: [...] }. En modo de
// prueba se necesita el usuario para imitar quien ve que (el backend lo sabe por el token).
export function listarLlamadas(filtros = {}, usuario = null) {
  const usados = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== '' && valor != null));
  if (SIMULAR_LISTADO) return simulacionListado.listarLlamadas(usados, usuario);
  return pedir(`/api/v1/llamadas?${new URLSearchParams(usados)}`);
}

// Todas las llamadas que cumplen los filtros, pidiendo GET /llamadas pagina por pagina (100 por
// pagina, el maximo del contrato), hasta `limite`. Responde { total, llamadas, recortado }: si hay
// mas de `limite`, recortado es true y llamadas trae solo las `limite` mas recientes.
export async function listarTodasLasLlamadas(filtros = {}, usuario = null, limite = 2000) {
  const llamadas = [];
  let total = 0;
  for (let pagina = 1; llamadas.length < limite; pagina += 1) {
    const respuesta = await listarLlamadas({ ...filtros, pagina, tamano_pagina: 100 }, usuario);
    total = respuesta.total;
    llamadas.push(...respuesta.llamadas);
    if (pagina >= respuesta.total_paginas) break;
  }
  return { total, llamadas: llamadas.slice(0, limite), recortado: total > limite };
}

// Agentes para el filtro de la Busqueda historica: GET /agentes (SuperAdmin: los activos;
// Supervisor: los suyos). En modo de prueba, los agentes del listado simulado.
export function listarAgentesDelListado() {
  return SIMULAR_LISTADO ? simulacionListado.listarAgentes() : listarAgentes();
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
