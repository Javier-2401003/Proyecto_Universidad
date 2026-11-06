// Estadisticas de la pagina de inicio (docs/api.md, GET /estadisticas/resumen).
// Sin modulo de permisos: como en el detalle de una llamada, lo decide la relacion del
// usuario con las llamadas. Ningun modulo lo tienen los tres roles.
import { Router } from 'express';
import { z } from 'zod';
import { consultar } from '../db.js';
import { validar } from '../errores.js';
import { autenticar } from '../middleware/auth.js';
import { filtroLlamadasVisibles } from '../agentes.js';

export const rutasEstadisticas = Router();

const ESTADOS = ['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ERROR'];
const CLASIFICACIONES = ['POSITIVO', 'NEUTRO', 'NEGATIVO', 'CRITICO'];
const TIPOS_ALERTA = ['EXCESO_VOLUMEN', 'ALTERACION_TONO', 'VOCABULARIO_INADECUADO', 'OMISION_SCRIPT'];

const esquemaResumen = z.object({
  dias: z.enum(['7', '30', '90'], { message: 'El periodo debe ser de 7, 30 o 90 dias.' }).default('30'),
});

// { clave: cantidad } con todas las claves, en 0 si la consulta no trajo fila.
function conTodasLasClaves(claves, filas) {
  const conteos = Object.fromEntries(claves.map((clave) => [clave, 0]));
  for (const fila of filas) conteos[fila.clave] = fila.cantidad;
  return conteos;
}

rutasEstadisticas.get('/resumen', autenticar, async (req, res) => {
  const dias = Number(validar(esquemaResumen, req.query).dias);

  // Como texto: un DATE llegaria como Date y el frontend espera AAAA-MM-DD.
  const [periodo] = await consultar(
    `SELECT DATE_FORMAT(CURDATE() - INTERVAL ? DAY, '%Y-%m-%d') AS desde,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hasta,
            DATE_FORMAT(CURDATE() + INTERVAL 1 DAY, '%Y-%m-%d') AS limite`,
    [dias - 1]
  );

  const { condicion, parametros: parametrosVisibles } = filtroLlamadasVisibles(req.usuario);
  const filtro = `${condicion} AND c.fecha_inicio >= ? AND c.fecha_inicio < ?`;
  const parametros = [...parametrosVisibles, periodo.desde, periodo.limite];
  const completadas = `${filtro} AND c.estado_procesamiento = 'COMPLETADO'`;

  // Las alertas van aparte: un JOIN en las demas consultas repetiria cada llamada por alerta.
  const [porEstado, [sentimiento], porClasificacion, porTipo, agentes, alertasPorAgente] = await Promise.all([
    consultar(
      `SELECT c.estado_procesamiento AS clave, COUNT(*) AS cantidad
         FROM TB_Llamada c WHERE ${filtro} GROUP BY c.estado_procesamiento`,
      parametros
    ),
    consultar(
      `SELECT ROUND(AVG(c.puntaje_final), 1) AS puntaje_promedio,
              COALESCE(SUM(c.baja_confianza_audio), 0) AS baja_confianza_audio
         FROM TB_Llamada c WHERE ${completadas}`,
      parametros
    ),
    consultar(
      `SELECT c.clasificacion_final AS clave, COUNT(*) AS cantidad
         FROM TB_Llamada c WHERE ${completadas} GROUP BY c.clasificacion_final`,
      parametros
    ),
    consultar(
      `SELECT t.tipo_alerta AS clave, COUNT(*) AS cantidad
         FROM TB_Alerta t JOIN TB_Llamada c ON c.id_llamada = t.id_llamada
        WHERE ${completadas} GROUP BY t.tipo_alerta`,
      parametros
    ),
    consultar(
      `SELECT c.id_agente AS id_usuario, u.nombre_completo,
              SUM(c.estado_procesamiento = 'COMPLETADO') AS llamadas_completadas,
              ROUND(AVG(CASE WHEN c.estado_procesamiento = 'COMPLETADO' THEN c.puntaje_final END), 1) AS puntaje_promedio,
              SUM(c.estado_procesamiento = 'COMPLETADO' AND c.clasificacion_final = 'CRITICO') AS llamadas_criticas
         FROM TB_Llamada c JOIN TB_Usuario u ON u.id_usuario = c.id_agente
        WHERE ${filtro}
        GROUP BY c.id_agente, u.nombre_completo
        ORDER BY u.nombre_completo, c.id_agente`,
      parametros
    ),
    consultar(
      `SELECT c.id_agente, COUNT(*) AS cantidad
         FROM TB_Alerta t JOIN TB_Llamada c ON c.id_llamada = t.id_llamada
        WHERE ${completadas} GROUP BY c.id_agente`,
      parametros
    ),
  ]);

  const alertasDe = new Map(alertasPorAgente.map((fila) => [fila.id_agente, fila.cantidad]));

  res.json({
    periodo: { dias, desde: periodo.desde, hasta: periodo.hasta },
    llamadas: {
      total: porEstado.reduce((suma, fila) => suma + fila.cantidad, 0),
      por_estado: conTodasLasClaves(ESTADOS, porEstado),
    },
    sentimiento: {
      puntaje_promedio: sentimiento.puntaje_promedio,
      por_clasificacion: conTodasLasClaves(CLASIFICACIONES, porClasificacion),
      baja_confianza_audio: sentimiento.baja_confianza_audio,
    },
    alertas: {
      total: porTipo.reduce((suma, fila) => suma + fila.cantidad, 0),
      por_tipo: conTodasLasClaves(TIPOS_ALERTA, porTipo),
    },
    agentes: agentes.map((agente) => ({ ...agente, alertas: alertasDe.get(agente.id_usuario) ?? 0 })),
  });
});
