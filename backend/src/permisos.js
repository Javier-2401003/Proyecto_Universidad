// Consultas de roles y permisos (RBAC). Se leen de la base de datos en cada
// peticion, asi un cambio de permisos del SuperAdmin aplica de inmediato
// (Historia 2, flujo A1) sin reiniciar nada.
import { consultar } from './db.js';

export async function obtenerRoles(idUsuario) {
  const filas = await consultar(
    `SELECT r.nombre_rol
       FROM TB_UsuarioRol ur
       JOIN TB_Rol r ON r.id_rol = ur.id_rol
      WHERE ur.id_usuario = ?
      ORDER BY r.nombre_rol`,
    [idUsuario]
  );
  return filas.map((fila) => fila.nombre_rol);
}

// Modulos activos a los que el usuario tiene acceso, para armar el menu del frontend.
export async function obtenerPermisos(idUsuario) {
  const filas = await consultar(
    `SELECT m.codigo_modulo, m.nombre_modulo,
            MAX(rm.puede_leer) AS puede_leer,
            MAX(rm.puede_escribir) AS puede_escribir
       FROM TB_UsuarioRol ur
       JOIN TB_RolModulo rm ON rm.id_rol = ur.id_rol
       JOIN TB_Modulo m ON m.id_modulo = rm.id_modulo
      WHERE ur.id_usuario = ? AND m.activo = 1
      GROUP BY m.id_modulo, m.codigo_modulo, m.nombre_modulo
      ORDER BY m.codigo_modulo`,
    [idUsuario]
  );
  return filas.map((fila) => ({
    modulo: fila.codigo_modulo,
    nombre: fila.nombre_modulo,
    leer: Boolean(fila.puede_leer),
    escribir: Boolean(fila.puede_escribir),
  }));
}

// Columna de TB_RolModulo segun la accion pedida (lista cerrada, no viene del usuario).
const COLUMNA_POR_ACCION = Object.freeze({
  leer: 'puede_leer',
  escribir: 'puede_escribir',
});

export async function tienePermiso(idUsuario, codigoModulo, accion) {
  const columna = COLUMNA_POR_ACCION[accion];
  if (!columna) {
    throw new Error(`Accion de permiso desconocida: ${accion}`);
  }
  const filas = await consultar(
    `SELECT 1
       FROM TB_UsuarioRol ur
       JOIN TB_RolModulo rm ON rm.id_rol = ur.id_rol
       JOIN TB_Modulo m ON m.id_modulo = rm.id_modulo
      WHERE ur.id_usuario = ?
        AND m.codigo_modulo = ?
        AND m.activo = 1
        AND rm.${columna} = 1
      LIMIT 1`,
    [idUsuario, codigoModulo]
  );
  return filas.length > 0;
}
