// Listado de llamadas (docs/api.md, GET /llamadas): paginado, con filtros y la misma
// visibilidad por rol que el detalle. Un agente o lote que el usuario no puede ver no
// es un error: simplemente no aparece (no se revela si existe).
import { z } from 'zod';
import { consultar } from '../db.js';
import { validar } from '../errores.js';
import { filtroLlamadasVisibles } from '../agentes.js';
import {
  camposPaginacion,
  condicionesDeFecha,
  datosDePagina,
  fechaDia,
  limitePagina,
  revisarRango,
} from '../listados.js';

const ESTADOS = ['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ERROR'];
const CLASIFICACIONES = ['POSITIVO', 'NEUTRO', 'NEGATIVO', 'CRITICO'];
const DIAGNOSTICOS = ['FALLA_AGENTE', 'CLIENTE_PROBLEMATICO', 'SIN_CONFLICTO'];

const uno = (valores) =>
  z.string().trim().toUpperCase().pipe(z.enum(valores, { message: `Debe ser ${valores.join(', ')}.` }));

const idPositivo = z.coerce
  .number({ invalid_type_error: 'Debe ser un numero.' })
  .int('Debe ser un numero entero.')
  .positive('Debe ser un numero mayor que cero.');

const esquemaFiltros = z
  .object({
    desde: fechaDia.optional(),
    hasta: fechaDia.optional(),
    id_agente: idPositivo.optional(),
    id_lote: idPositivo.optional(),
    estado: uno(ESTADOS).optional(),
    clasificacion: uno(CLASIFICACIONES).optional(),
    diagnostico: uno(DIAGNOSTICOS).optional(),
    buscar: z.string().trim().min(2, 'Debe tener al menos 2 caracteres.').max(100).optional(),
    ...camposPaginacion(20),
  })
  .superRefine(revisarRango);

// "%" y "_" se buscan como texto, no como comodines de LIKE.
function patronLike(texto) {
  return `%${texto.replace(/[!%_]/g, (caracter) => `!${caracter}`)}%`;
}

function condiciones(usuario, filtros) {
  const visibles = filtroLlamadasVisibles(usuario);
  const fechas = condicionesDeFecha('c.fecha_inicio', filtros);
  const lista = [visibles.condicion, ...fechas.condiciones];
  const parametros = [...visibles.parametros, ...fechas.parametros];
  const agregar = (condicion, valor) => {
    lista.push(condicion);
    parametros.push(valor);
  };

  if (filtros.id_agente) agregar('c.id_agente = ?', filtros.id_agente);
  if (filtros.id_lote) agregar('c.id_lote = ?', filtros.id_lote);
  if (filtros.estado) agregar('c.estado_procesamiento = ?', filtros.estado);
  // Antes de COMPLETADO, estas columnas tienen valores por defecto: no cuentan.
  if (filtros.clasificacion) agregar(`c.estado_procesamiento = 'COMPLETADO' AND c.clasificacion_final = ?`, filtros.clasificacion);
  if (filtros.diagnostico) agregar(`c.estado_procesamiento = 'COMPLETADO' AND c.diagnostico_conflicto = ?`, filtros.diagnostico);
  if (filtros.buscar) agregar(`c.nombre_archivo_original LIKE ? ESCAPE '!'`, patronLike(filtros.buscar));

  return { donde: `WHERE ${lista.map((condicion) => `(${condicion})`).join(' AND ')}`, parametros };
}

export async function listarLlamadas(req, res) {
  const filtros = validar(esquemaFiltros, req.query);
  const { donde, parametros } = condiciones(req.usuario, filtros);

  const [[{ total }], filas] = await Promise.all([
    consultar(`SELECT COUNT(*) AS total FROM TB_Llamada c ${donde}`, parametros),
    consultar(
      `SELECT c.id_llamada, c.id_lote, l.codigo_lote, c.nombre_archivo_original,
              c.id_agente, u.nombre_completo AS nombre_agente, c.fecha_inicio, c.duracion_segundos,
              c.estado_procesamiento, c.mensaje_error, c.baja_confianza_audio,
              c.puntaje_final, c.clasificacion_final, c.diagnostico_conflicto,
              CASE WHEN c.estado_procesamiento = 'COMPLETADO'
                   THEN (SELECT COUNT(*) FROM TB_Alerta t WHERE t.id_llamada = c.id_llamada)
                   ELSE 0 END AS total_alertas
         FROM TB_Llamada c
         JOIN TB_Usuario u ON u.id_usuario = c.id_agente
         LEFT JOIN TB_LoteAudio l ON l.id_lote = c.id_lote
         ${donde}
        ORDER BY c.fecha_inicio DESC, c.id_llamada DESC
        ${limitePagina(filtros)}`,
      parametros
    ),
  ]);

  res.json({
    ...datosDePagina(total, filtros),
    llamadas: filas.map((fila) => {
      const completada = fila.estado_procesamiento === 'COMPLETADO';
      return {
        id_llamada: fila.id_llamada,
        id_lote: fila.id_lote,
        codigo_lote: fila.codigo_lote,
        nombre_archivo_original: fila.nombre_archivo_original,
        agente: { id_usuario: fila.id_agente, nombre_completo: fila.nombre_agente },
        fecha_inicio: fila.fecha_inicio,
        duracion_segundos: fila.duracion_segundos,
        estado_procesamiento: fila.estado_procesamiento,
        mensaje_error: fila.mensaje_error,
        baja_confianza_audio: Boolean(fila.baja_confianza_audio),
        resultado: completada
          ? {
              puntaje_final: fila.puntaje_final,
              clasificacion_final: fila.clasificacion_final,
              diagnostico_conflicto: fila.diagnostico_conflicto,
            }
          : null,
        total_alertas: fila.total_alertas,
      };
    }),
  });
}
