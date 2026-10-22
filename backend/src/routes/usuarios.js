// Gestion minima de usuarios (Blueprint 3.1, Endpoint 2). Solo con permiso
// sobre el modulo GESTION_USUARIOS (por defecto, el SuperAdmin).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { consultar, conTransaccion } from '../db.js';
import { ErrorHttp, validar, obtenerIp } from '../errores.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

export const rutasUsuarios = Router();

// bcrypt solo usa los primeros 72 bytes de la contrasena.
const esquemaCrearUsuario = z.object({
  nombre_completo: z.string().trim().min(2).max(100),
  correo_electronico: z.string().trim().toLowerCase().email().max(150),
  password: z
    .string()
    .min(8, 'La contrasena debe tener al menos 8 caracteres.')
    .refine((valor) => Buffer.byteLength(valor, 'utf8') <= 72, 'La contrasena es demasiado larga.'),
  rol: z.string().trim().min(1).max(50),
});

const esquemaIdUsuario = z.object({
  id_usuario: z.coerce.number({ invalid_type_error: 'Debe ser un numero.' }).int().positive(),
});

// null quita el supervisor. Un agente tiene como maximo uno (docs/api.md).
const esquemaAsignarSupervisor = z.object({
  id_supervisor: z.number({ required_error: 'Es obligatorio (use null para quitarlo).' }).int().positive().nullable(),
});

// Usuarios con la forma que devuelve la API (docs/api.md, GET /usuarios).
// El supervisor sale de una subconsulta para no duplicar filas en GROUP_CONCAT.
async function buscarUsuarios(condicion = '', parametros = []) {
  const filas = await consultar(
    `SELECT u.id_usuario, u.nombre_completo, u.correo_electronico, u.estado, u.fecha_creacion,
            GROUP_CONCAT(r.nombre_rol ORDER BY r.nombre_rol SEPARATOR ',') AS roles,
            MAX(s.id_usuario) AS id_supervisor,
            MAX(s.nombre_completo) AS nombre_supervisor
       FROM TB_Usuario u
       LEFT JOIN TB_UsuarioRol ur ON ur.id_usuario = u.id_usuario
       LEFT JOIN TB_Rol r ON r.id_rol = ur.id_rol
       LEFT JOIN TB_Usuario s ON s.id_usuario = (
              SELECT a.id_supervisor FROM TB_AsignacionSupervisor a
               WHERE a.id_agente = u.id_usuario
               ORDER BY a.id_asignacion DESC LIMIT 1)
      ${condicion}
      GROUP BY u.id_usuario
      ORDER BY u.id_usuario
      LIMIT 200`,
    parametros
  );
  return filas.map((fila) => ({
    id_usuario: fila.id_usuario,
    nombre_completo: fila.nombre_completo,
    correo_electronico: fila.correo_electronico,
    estado: fila.estado,
    fecha_creacion: fila.fecha_creacion,
    roles: fila.roles ? fila.roles.split(',') : [],
    supervisor: fila.id_supervisor
      ? { id_usuario: fila.id_supervisor, nombre_completo: fila.nombre_supervisor }
      : null,
  }));
}

async function buscarUsuario(idUsuario) {
  const [usuario] = await buscarUsuarios('WHERE u.id_usuario = ?', [idUsuario]);
  if (!usuario) {
    throw new ErrorHttp(404, 'NO_ENCONTRADO', 'El usuario no existe.');
  }
  return usuario;
}

rutasUsuarios.get('/', autenticar, requierePermiso('GESTION_USUARIOS', 'leer'), async (_req, res) => {
  res.json(await buscarUsuarios());
});

rutasUsuarios.put(
  '/:id_usuario/supervisor',
  autenticar,
  requierePermiso('GESTION_USUARIOS', 'escribir'),
  async (req, res) => {
    const { id_usuario: idAgente } = validar(esquemaIdUsuario, req.params);
    const { id_supervisor: idSupervisor } = validar(esquemaAsignarSupervisor, req.body ?? {});

    const agente = await buscarUsuario(idAgente);
    if (!agente.roles.includes('AGENTE')) {
      throw new ErrorHttp(400, 'NO_ES_AGENTE', 'Solo se puede asignar supervisor a un agente.');
    }
    if (idSupervisor !== null) {
      const supervisores = await consultar(
        `SELECT 1
           FROM TB_Usuario u
           JOIN TB_UsuarioRol ur ON ur.id_usuario = u.id_usuario
           JOIN TB_Rol r ON r.id_rol = ur.id_rol AND r.nombre_rol = 'SUPERVISOR'
          WHERE u.id_usuario = ? AND u.estado = 'ACTIVO'`,
        [idSupervisor]
      );
      if (supervisores.length === 0) {
        throw new ErrorHttp(400, 'SUPERVISOR_INVALIDO', 'El supervisor no existe, no esta activo o no tiene rol SUPERVISOR.');
      }
    }

    const idAnterior = agente.supervisor ? agente.supervisor.id_usuario : null;
    if (idAnterior === idSupervisor) {
      return res.json(agente); // Sin cambios: no se toca la base ni la auditoria.
    }

    await conTransaccion(async (conexion) => {
      await conexion.execute('DELETE FROM TB_AsignacionSupervisor WHERE id_agente = ?', [idAgente]);
      if (idSupervisor !== null) {
        await conexion.execute('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [
          idSupervisor,
          idAgente,
        ]);
      }
      await conexion.execute(
        `INSERT INTO TB_LogAuditoria
           (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
         VALUES (?, 'ASIGNACION_SUPERVISOR', 'GESTION_USUARIOS', ?, ?)`,
        [
          req.usuario.id,
          JSON.stringify({ id_agente: idAgente, id_supervisor_anterior: idAnterior, id_supervisor_nuevo: idSupervisor }),
          obtenerIp(req),
        ]
      );
    });

    res.json(await buscarUsuario(idAgente));
  }
);

rutasUsuarios.post('/', autenticar, requierePermiso('GESTION_USUARIOS', 'escribir'), async (req, res) => {
  const datos = validar(esquemaCrearUsuario, req.body);

  const roles = await consultar('SELECT id_rol FROM TB_Rol WHERE nombre_rol = ?', [datos.rol]);
  if (roles.length === 0) {
    throw new ErrorHttp(400, 'ROL_INEXISTENTE', `El rol "${datos.rol}" no existe.`);
  }
  const idRol = roles[0].id_rol;
  const passwordHash = await bcrypt.hash(datos.password, config.bcryptCosto);

  let idNuevo;
  try {
    idNuevo = await conTransaccion(async (conexion) => {
      const [insercion] = await conexion.execute(
        `INSERT INTO TB_Usuario (nombre_completo, correo_electronico, password_hash)
         VALUES (?, ?, ?)`,
        [datos.nombre_completo, datos.correo_electronico, passwordHash]
      );
      await conexion.execute('INSERT INTO TB_UsuarioRol (id_usuario, id_rol) VALUES (?, ?)', [
        insercion.insertId,
        idRol,
      ]);
      // Auditoria (RN-04). Nunca se guarda la contrasena ni su hash.
      await conexion.execute(
        `INSERT INTO TB_LogAuditoria
           (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
         VALUES (?, 'CREACION_USUARIO', 'GESTION_USUARIOS', ?, ?)`,
        [
          req.usuario.id,
          JSON.stringify({ id_usuario_creado: insercion.insertId, rol: datos.rol }),
          obtenerIp(req),
        ]
      );
      return insercion.insertId;
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new ErrorHttp(409, 'CORREO_DUPLICADO', 'Ya existe un usuario con ese correo.');
    }
    throw error;
  }

  res.status(201).json({
    id_usuario: idNuevo,
    mensaje: 'Usuario creado exitosamente.',
    fecha_registro: new Date().toISOString(),
  });
});
