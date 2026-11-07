// Que partes del frontend usan datos simulados en lugar del backend (docs/api.md).
// Todas usan el backend real por defecto. Para mostrarlas sin backend (por ejemplo,
// en una demo) ponga la variable en "true" en frontend/.env y reinicie npm run dev.

// Carga de lotes y detalle de llamada.
export const SIMULAR_LLAMADAS = import.meta.env.VITE_SIMULAR_LLAMADAS === 'true';

// Estadisticas del inicio.
export const SIMULAR_ESTADISTICAS = import.meta.env.VITE_SIMULAR_ESTADISTICAS === 'true';

// Listado de llamadas (Panel del Agente): simulado hasta que exista GET /llamadas.
// Para probar el endpoint real ponga VITE_SIMULAR_LISTADO=false. Cuando el endpoint
// este en main, cambie aqui el valor por defecto como en las otras dos.
export const SIMULAR_LISTADO = import.meta.env.VITE_SIMULAR_LISTADO !== 'false';
