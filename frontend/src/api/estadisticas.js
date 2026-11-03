// Estadisticas de la pagina de inicio. Contrato: docs/api.md, seccion "Estadisticas del inicio".
// Mientras el backend no tenga este endpoint, se usan datos simulados
// (api/simulacion/estadisticas.js); ver api/simulacion/activa.js.
import { pedir } from './cliente.js';
import { SIMULAR } from './simulacion/activa.js';
import * as simulacion from './simulacion/estadisticas.js';

// Los mismos valores que acepta el backend.
export const PERIODOS = [7, 30, 90];

// { periodo, llamadas, sentimiento, alertas, agentes }. En modo de prueba se necesita
// el usuario para imitar quien ve que (el backend real lo sabe por el token).
export function obtenerResumen(dias, usuario) {
  return SIMULAR ? simulacion.obtenerResumen(dias, usuario) : pedir(`/api/v1/estadisticas/resumen?dias=${dias}`);
}
