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

rutasUsuarios.get('/', autenticar, requierePermiso('GESTION_USUARIOS', 'leer'), async (_req, res) => {
  const filas = await consultar(
    `SELECT u.id_usuario, u.nombre_completo, u.correo_electronico, u.estado, u.fecha_creacion,
            GROUP_CONCAT(r.nombre_rol ORDER BY r.nombre_rol SEPARATOR ',') AS roles
       FROM TB_Usuario u
       LEFT JOIN TB_UsuarioRol ur ON ur.id_usuario = u.id_usuario
       LEFT JOIN TB_Rol r ON r.id_rol = ur.id_rol
      GROUP BY u.id_usuario
      ORDER BY u.id_usuario
      LIMIT 200`
  );
  res.json(
    filas.map((fila) => ({
      id_usuario: fila.id_usuario,
      nombre_completo: fila.nombre_completo,
      correo_electronico: fila.correo_electronico,
      estado: fila.estado,
      fecha_creacion: fila.fecha_creacion,
      roles: fila.roles ? fila.roles.split(',') : [],
    }))
  );
});

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
