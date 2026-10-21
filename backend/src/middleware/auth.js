// Autenticacion (quien eres) y autorizacion (que puedes hacer).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { consultar } from '../db.js';
import { ErrorHttp } from '../errores.js';
import { obtenerRoles, tienePermiso } from '../permisos.js';

// Exige "Authorization: Bearer <token>". Carga el usuario desde la base de datos
// en cada peticion para detectar usuarios desactivados o roles cambiados.
export async function autenticar(req, _res, next) {
  const cabecera = req.headers.authorization || '';
  const [tipo, token] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw new ErrorHttp(401, 'NO_AUTENTICADO', 'Falta el token de acceso.');
  }

  let carga;
  try {
    carga = jwt.verify(token, config.jwt.secreto, { algorithms: ['HS256'] });
  } catch {
    throw new ErrorHttp(401, 'TOKEN_INVALIDO', 'El token es invalido o expiro.');
  }

  const idUsuario = Number.parseInt(carga.sub, 10);
  const filas = await consultar(
    `SELECT id_usuario, nombre_completo, correo_electronico, estado
       FROM TB_Usuario WHERE id_usuario = ?`,
    [idUsuario]
  );
  if (filas.length === 0 || filas[0].estado !== 'ACTIVO') {
    throw new ErrorHttp(401, 'TOKEN_INVALIDO', 'El token es invalido o expiro.');
  }

  req.usuario = {
    id: filas[0].id_usuario,
    nombre: filas[0].nombre_completo,
    correo: filas[0].correo_electronico,
    roles: await obtenerRoles(filas[0].id_usuario),
  };
  next();
}

// Uso: router.get('/', autenticar, requierePermiso('REPORTES', 'leer'), manejador)
export function requierePermiso(codigoModulo, accion = 'leer') {
  return async (req, _res, next) => {
    const permitido = await tienePermiso(req.usuario.id, codigoModulo, accion);
    if (!permitido) {
      throw new ErrorHttp(403, 'PROHIBIDO', 'No tiene permiso para realizar esta accion.');
    }
    next();
  };
}
