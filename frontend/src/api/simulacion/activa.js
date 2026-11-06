// Que partes del frontend usan datos simulados en lugar del backend (docs/api.md).
//
// Carga de lotes y detalle de llamada: sus endpoints ya existen, asi que usan el
// backend real. Para mostrarlas sin backend (por ejemplo, en una demo) ponga
// VITE_SIMULAR_LLAMADAS=true en frontend/.env y reinicie npm run dev.
export const SIMULAR_LLAMADAS = import.meta.env.VITE_SIMULAR_LLAMADAS === 'true';

// Estadisticas del inicio: simuladas hasta que exista GET /estadisticas/resumen.
// Para probar el endpoint real ponga VITE_SIMULAR_ESTADISTICAS=false. Cuando el
// endpoint este en main, cambie aqui el valor por defecto.
export const SIMULAR_ESTADISTICAS = import.meta.env.VITE_SIMULAR_ESTADISTICAS !== 'false';
