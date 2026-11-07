// Registro de auditoria (docs/api.md, GET /auditoria): solo lectura, del mas reciente
// al mas antiguo, con filtros y paginacion. Del usuario solo salen id, nombre y correo:
// nunca la contrasena ni su hash.
import { Router } from 'express';
import { z } from 'zod';
import { consultar } from '../db.js';
import { validar } from '../errores.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import {
  camposPaginacion,
  condicionesDeFecha,
  datosDePagina,
  fechaDia,
  limitePagina,
  revisarRango,
} from '../listados.js';

export const rutasAuditoria = Router();

const textoExacto = (maximo) => z.string().trim().min(1, 'No puede estar vacio.').max(maximo).toUpperCase();

const esquemaFiltros = z
  .object({
    id_usuario: z.coerce
      .number({ invalid_type_error: 'Debe ser un numero.' })
      .int('Debe ser un numero entero.')
      .positive('Debe ser un numero mayor que cero.')
      .optional(),
    accion: textoExacto(100).optional(),
    modulo: textoExacto(50).optional(),
    desde: fechaDia.optional(),
    hasta: fechaDia.optional(),
    ...camposPaginacion(50),
  })
  .superRefine(revisarRango);

rutasAuditoria.get('/', autenticar, requierePermiso('AUDITORIA', 'leer'), async (req, res) => {
  const filtros = validar(esquemaFiltros, req.query);

  const { condiciones, parametros } = condicionesDeFecha('l.fecha_evento', filtros);
  if (filtros.id_usuario) {
    condiciones.push('l.id_usuario = ?');
    parametros.push(filtros.id_usuario);
  }
  if (filtros.accion) {
    condiciones.push('l.accion_ejecutada = ?');
    parametros.push(filtros.accion);
  }
  if (filtros.modulo) {
    condiciones.push('l.modulo_afectado = ?');
    parametros.push(filtros.modulo);
  }
  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

  const [[{ total }], filas] = await Promise.all([
    consultar(`SELECT COUNT(*) AS total FROM TB_LogAuditoria l ${donde}`, parametros),
    consultar(
      `SELECT l.id_log, l.fecha_evento, l.id_usuario, u.nombre_completo, u.correo_electronico,
              l.accion_ejecutada, l.modulo_afectado, l.detalle_cambio, l.direccion_ip
         FROM TB_LogAuditoria l
         JOIN TB_Usuario u ON u.id_usuario = l.id_usuario
         ${donde}
        ORDER BY l.fecha_evento DESC, l.id_log DESC
        ${limitePagina(filtros)}`,
      parametros
    ),
  ]);

  res.json({
    ...datosDePagina(total, filtros),
    registros: filas.map((fila) => ({
      id_log: fila.id_log,
      fecha_evento: fila.fecha_evento,
      usuario: {
        id_usuario: fila.id_usuario,
        nombre_completo: fila.nombre_completo,
        correo_electronico: fila.correo_electronico,
      },
      accion_ejecutada: fila.accion_ejecutada,
      modulo_afectado: fila.modulo_afectado,
      detalle_cambio: fila.detalle_cambio,
      direccion_ip: fila.direccion_ip,
    })),
  });
});
