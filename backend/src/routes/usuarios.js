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

// PATCH: solo los campos que cambian (al menos uno). strict() rechaza campos
// desconocidos, por ejemplo "password", que no se cambia aqui.
const esquemaEditarUsuario = z
  .object({
    nombre_completo: z.string().trim().min(2).max(100).optional(),
    correo_electronico: z.string().trim().toLowerCase().email().max(150).optional(),
    // En mayusculas: TB_Rol no distingue mayusculas, pero las comparaciones del codigo si.
    rol: z.string().trim().toUpperCase().min(1).max(50).optional(),
  })
  .strict('Solo se pueden editar nombre_completo, correo_electronico y rol.')
  .refine((datos) => Object.keys(datos).length > 0, 'Envie al menos un campo para editar.');

const esquemaCambiarEstado = z.object({
  estado: z.enum(['ACTIVO', 'INACTIVO'], { errorMap: () => ({ message: 'Debe ser ACTIVO o INACTIVO.' }) }),
});

async function registrarAuditoria(conexion, req, accion, detalle) {
  await conexion.execute(
    `INSERT INTO TB_LogAuditoria
       (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
     VALUES (?, ?, 'GESTION_USUARIOS', ?, ?)`,
    [req.usuario.id, accion, JSON.stringify(detalle), obtenerIp(req)]
  );
}

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
      await registrarAuditoria(conexion, req, 'ASIGNACION_SUPERVISOR', {
        id_agente: idAgente,
        id_supervisor_anterior: idAnterior,
        id_supervisor_nuevo: idSupervisor,
      });
    });

    res.json(await buscarUsuario(idAgente));
  }
);

rutasUsuarios.patch('/:id_usuario', autenticar, requierePermiso('GESTION_USUARIOS', 'escribir'), async (req, res) => {
  const { id_usuario: idUsuario } = validar(esquemaIdUsuario, req.params);
  const datos = validar(esquemaEditarUsuario, req.body ?? {});
  const usuario = await buscarUsuario(idUsuario);

  // Solo se guardan (y se auditan) los campos que de verdad cambian.
  const cambios = {};
  for (const campo of ['nombre_completo', 'correo_electronico']) {
    if (datos[campo] !== undefined && datos[campo] !== usuario[campo]) {
      cambios[campo] = { anterior: usuario[campo], nuevo: datos[campo] };
    }
  }

  let idRolNuevo;
  const rolActual = usuario.roles.join(',');
  if (datos.rol !== undefined && datos.rol !== rolActual) {
    const roles = await consultar('SELECT id_rol FROM TB_Rol WHERE nombre_rol = ?', [datos.rol]);
    if (roles.length === 0) {
      throw new ErrorHttp(400, 'ROL_INEXISTENTE', `El rol "${datos.rol}" no existe.`);
    }
    // Asi el SuperAdmin no puede quedarse fuera del sistema por error.
    if (idUsuario === req.usuario.id) {
      throw new ErrorHttp(400, 'OPERACION_NO_PERMITIDA', 'No puede cambiar su propio rol.');
    }
    idRolNuevo = roles[0].id_rol;
    cambios.rol = { anterior: rolActual, nuevo: datos.rol };
  }

  if (Object.keys(cambios).length === 0) {
    return res.json(usuario); // Sin cambios: no se toca la base ni la auditoria.
  }

  try {
    await conTransaccion(async (conexion) => {
      if (cambios.nombre_completo || cambios.correo_electronico) {
        await conexion.execute(
          'UPDATE TB_Usuario SET nombre_completo = ?, correo_electronico = ? WHERE id_usuario = ?',
          [
            datos.nombre_completo ?? usuario.nombre_completo,
            datos.correo_electronico ?? usuario.correo_electronico,
            idUsuario,
          ]
        );
      }
      if (cambios.rol) {
        await conexion.execute('DELETE FROM TB_UsuarioRol WHERE id_usuario = ?', [idUsuario]);
        await conexion.execute('INSERT INTO TB_UsuarioRol (id_usuario, id_rol) VALUES (?, ?)', [idUsuario, idRolNuevo]);
        // Las asignaciones que dejan de tener sentido con el rol nuevo (docs/api.md).
        if (usuario.roles.includes('AGENTE') && datos.rol !== 'AGENTE') {
          await conexion.execute('DELETE FROM TB_AsignacionSupervisor WHERE id_agente = ?', [idUsuario]);
        }
        if (usuario.roles.includes('SUPERVISOR') && datos.rol !== 'SUPERVISOR') {
          await conexion.execute('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ?', [idUsuario]);
        }
      }
      await registrarAuditoria(conexion, req, 'EDICION_USUARIO', { id_usuario: idUsuario, cambios });
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new ErrorHttp(409, 'CORREO_DUPLICADO', 'Ya existe un usuario con ese correo.');
    }
    throw error;
  }

  res.json(await buscarUsuario(idUsuario));
});

// Desactivar no borra nada: el middleware autenticar rechaza a los usuarios
// INACTIVO en cada peticion, asi que sus tokens dejan de servir de inmediato.
rutasUsuarios.patch(
  '/:id_usuario/estado',
  autenticar,
  requierePermiso('GESTION_USUARIOS', 'escribir'),
  async (req, res) => {
    const { id_usuario: idUsuario } = validar(esquemaIdUsuario, req.params);
    const { estado } = validar(esquemaCambiarEstado, req.body ?? {});
    const usuario = await buscarUsuario(idUsuario);

    if (idUsuario === req.usuario.id && estado === 'INACTIVO') {
      throw new ErrorHttp(400, 'OPERACION_NO_PERMITIDA', 'No puede desactivarse a si mismo.');
    }
    if (usuario.estado === estado) {
      return res.json(usuario); // Sin cambios: no se toca la base ni la auditoria.
    }

    await conTransaccion(async (conexion) => {
      await conexion.execute('UPDATE TB_Usuario SET estado = ? WHERE id_usuario = ?', [estado, idUsuario]);
      await registrarAuditoria(conexion, req, 'CAMBIO_ESTADO_USUARIO', {
        id_usuario: idUsuario,
        estado_anterior: usuario.estado,
        estado_nuevo: estado,
      });
    });

    res.json(await buscarUsuario(idUsuario));
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
