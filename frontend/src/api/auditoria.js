// Registro de auditoria. Contrato: docs/api.md, seccion "Registro de auditoria".
import { pedir } from './cliente.js';

// filtros: { pagina, tamano_pagina, id_usuario, accion, modulo, desde, hasta }; los vacios no se envian.
// Responde { pagina, tamano_pagina, total, total_paginas, registros: [...] }.
export function listarAuditoria(filtros = {}) {
  const usados = Object.fromEntries(Object.entries(filtros).filter(([, valor]) => valor !== '' && valor != null));
  return pedir(`/api/v1/auditoria?${new URLSearchParams(usados)}`);
}
