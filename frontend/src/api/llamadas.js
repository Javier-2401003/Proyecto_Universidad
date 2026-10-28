// Detalle de una llamada. Contrato: docs/api.md, seccion "Detalle de una llamada".
// Mientras el backend no tenga estos endpoints, se usan datos simulados
// (api/simulacion/llamadas.js); ver api/simulacion/activa.js.
import { pedir, pedirArchivo } from './cliente.js';
import { SIMULAR } from './simulacion/activa.js';
import * as simulacion from './simulacion/llamadas.js';

// { id_llamada, agente, estado_procesamiento, resultado, transcripcion, alertas, tiene_audio, ... }
export function obtenerLlamada(idLlamada) {
  return SIMULAR ? simulacion.obtenerLlamada(idLlamada) : pedir(`/api/v1/llamadas/${idLlamada}`);
}

// Blob con el audio original. En modo de prueba no hay audio.
export function obtenerAudio(idLlamada) {
  if (SIMULAR) return Promise.reject(new Error('No hay audio en modo de prueba.'));
  return pedirArchivo(`/api/v1/llamadas/${idLlamada}/audio`);
}
