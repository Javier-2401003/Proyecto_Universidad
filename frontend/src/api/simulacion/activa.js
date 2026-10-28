// Mientras el backend no tenga los endpoints de /llamadas (docs/api.md), el
// frontend usa datos simulados. Para usar el backend real ponga
// VITE_SIMULAR_LLAMADAS=false en frontend/.env y reinicie npm run dev. Cuando
// los endpoints esten en main, cambie aqui el valor por defecto a false.
export const SIMULAR = import.meta.env.VITE_SIMULAR_LLAMADAS !== 'false';
