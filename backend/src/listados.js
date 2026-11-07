// Piezas comunes de los listados paginados (docs/api.md: GET /llamadas y GET /auditoria):
// pagina y tamano_pagina, rango de fechas desde/hasta y la respuesta con el total.
import { z } from 'zod';

const MAXIMA_PAGINA = 1000000;

function esFechaReal(texto) {
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(texto);
}

// Fecha AAAA-MM-DD que existe (2026-02-30 no pasa).
export const fechaDia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe tener el formato AAAA-MM-DD.')
  .refine(esFechaReal, 'No es una fecha valida.');

const entero = (mensaje) => z.coerce.number({ invalid_type_error: mensaje }).int('Debe ser un numero entero.');

// Campos pagina y tamano_pagina, con el tamano por defecto de cada listado.
export function camposPaginacion(tamanoPorDefecto) {
  return {
    pagina: entero('Debe ser un numero.').min(1, 'Debe ser 1 o mayor.').max(MAXIMA_PAGINA).default(1),
    tamano_pagina: entero('Debe ser un numero.')
      .min(1, 'Debe ser 1 o mayor.')
      .max(100, 'Debe ser como maximo 100.')
      .default(tamanoPorDefecto),
  };
}

// Para .superRefine del esquema: "desde" no puede ser posterior a "hasta".
export function revisarRango(datos, contexto) {
  if (datos.desde && datos.hasta && datos.desde > datos.hasta) {
    contexto.addIssue({ code: z.ZodIssueCode.custom, path: ['desde'], message: 'No puede ser posterior a "hasta".' });
  }
}

// Condiciones SQL del rango sobre una columna DATETIME. "hasta" incluye todo ese dia.
export function condicionesDeFecha(columna, { desde, hasta }) {
  const condiciones = [];
  const parametros = [];
  if (desde) {
    condiciones.push(`${columna} >= ?`);
    parametros.push(desde);
  }
  if (hasta) {
    condiciones.push(`${columna} < DATE_ADD(?, INTERVAL 1 DAY)`);
    parametros.push(hasta);
  }
  return { condiciones, parametros };
}

// LIMIT y OFFSET ya validados como enteros: van en el texto porque MySQL 8 rechaza
// "LIMIT ?" en algunas sentencias preparadas.
export function limitePagina({ pagina, tamano_pagina: tamano }) {
  return `LIMIT ${Number(tamano)} OFFSET ${(Number(pagina) - 1) * Number(tamano)}`;
}

export function datosDePagina(total, { pagina, tamano_pagina: tamano }) {
  return { pagina, tamano_pagina: tamano, total, total_paginas: Math.ceil(total / tamano) };
}
