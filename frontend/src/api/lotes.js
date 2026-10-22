// Carga de audios por lotes. Contrato: docs/api.md, seccion "Carga de audios por lotes".
//
// Mientras el backend no tenga estos endpoints, se usan datos simulados
// (api/simulacion/lotes.js). Para usar el backend real ponga
// VITE_SIMULAR_CARGA_LOTES=false en frontend/.env. Cuando los endpoints esten
// listos en main, cambie el valor por defecto de SIMULAR a false.
import { enviarFormulario, pedir } from './cliente.js';
import * as simulacion from './simulacion/lotes.js';

export const SIMULAR = import.meta.env.VITE_SIMULAR_CARGA_LOTES !== 'false';

// Los mismos valores que backend/.env (LOTE_TAMANOS_PERMITIDOS y AUDIO_MAX_MB).
// El frontend solo avisa antes de subir; el backend siempre vuelve a validar.
export const LIMITES = Object.freeze({
  tamanosPermitidos: [5, 10, 15],
  maxMegabytes: 25,
  extensiones: ['.wav', '.mp3'],
});

// [{ id_usuario, nombre_completo, correo_electronico }]
export function listarAgentes() {
  return SIMULAR ? simulacion.listarAgentes() : pedir('/api/v1/agentes');
}

// Responde { id_lote, codigo_lote, total_archivos, estado_lote, llamadas: [...] }.
export function subirLote({ idAgente, archivos }, alProgreso) {
  if (SIMULAR) return simulacion.subirLote({ idAgente, archivos }, alProgreso);

  const formulario = new FormData();
  formulario.append('id_agente', String(idAgente));
  for (const archivo of archivos) formulario.append('audios', archivo);
  return enviarFormulario('/api/v1/llamadas/lotes', formulario, alProgreso);
}

// Estado del lote y de cada llamada (PENDIENTE, PROCESANDO, COMPLETADO o ERROR).
export function obtenerLote(idLote) {
  return SIMULAR ? simulacion.obtenerLote(idLote) : pedir(`/api/v1/llamadas/lotes/${idLote}`);
}
