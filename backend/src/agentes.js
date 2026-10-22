// Que agentes puede ver un usuario (docs/api.md, GET /agentes):
// el SuperAdmin ve todos los agentes activos; cualquier otro rol (Supervisor)
// solo los que tiene asignados en TB_AsignacionSupervisor.
import { consultar } from './db.js';

const SQL_AGENTES_ACTIVOS = `
  SELECT u.id_usuario, u.nombre_completo, u.correo_electronico
    FROM TB_Usuario u
    JOIN TB_UsuarioRol ur ON ur.id_usuario = u.id_usuario
    JOIN TB_Rol r ON r.id_rol = ur.id_rol AND r.nombre_rol = 'AGENTE'
   WHERE u.estado = 'ACTIVO'`;

const SOLO_ASIGNADOS = `
     AND EXISTS (SELECT 1 FROM TB_AsignacionSupervisor a
                  WHERE a.id_agente = u.id_usuario AND a.id_supervisor = ?)`;

function veTodos(usuario) {
  return usuario.roles.includes('SUPERADMIN');
}

// "usuario" es req.usuario (lo arma el middleware autenticar).
export async function agentesVisibles(usuario) {
  if (veTodos(usuario)) {
    return consultar(`${SQL_AGENTES_ACTIVOS} ORDER BY u.nombre_completo`);
  }
  return consultar(`${SQL_AGENTES_ACTIVOS} ${SOLO_ASIGNADOS} ORDER BY u.nombre_completo`, [usuario.id]);
}

// Devuelve el agente si el usuario puede verlo, o null.
export async function buscarAgenteVisible(usuario, idAgente) {
  const filas = veTodos(usuario)
    ? await consultar(`${SQL_AGENTES_ACTIVOS} AND u.id_usuario = ?`, [idAgente])
    : await consultar(`${SQL_AGENTES_ACTIVOS} AND u.id_usuario = ? ${SOLO_ASIGNADOS}`, [idAgente, usuario.id]);
  return filas[0] || null;
}
