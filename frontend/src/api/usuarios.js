// Gestion de usuarios. Contrato: docs/api.md, secciones "Usuarios", "Gestion de usuarios:
// supervisor, edicion y estado" y "Roles".
import { pedir } from './cliente.js';

// [{ id_usuario, nombre_completo, correo_electronico, estado, fecha_creacion, roles, supervisor }]
export function listarUsuarios() {
  return pedir('/api/v1/usuarios');
}

// datos: { nombre_completo, correo_electronico, password, rol }. Responde { id_usuario, ... }.
export function crearUsuario(datos) {
  return pedir('/api/v1/usuarios', { metodo: 'POST', cuerpo: datos });
}

// [{ id_rol, nombre_rol, descripcion }]
export function listarRoles() {
  return pedir('/api/v1/roles');
}

// Las tres responden con el usuario actualizado (misma forma que en listarUsuarios).

// cambios: solo los campos que cambian, entre nombre_completo, correo_electronico y rol.
export function editarUsuario(idUsuario, cambios) {
  return pedir(`/api/v1/usuarios/${idUsuario}`, { metodo: 'PATCH', cuerpo: cambios });
}

// estado: 'ACTIVO' o 'INACTIVO'.
export function cambiarEstado(idUsuario, estado) {
  return pedir(`/api/v1/usuarios/${idUsuario}/estado`, { metodo: 'PATCH', cuerpo: { estado } });
}

// idSupervisor: numero, o null para dejar al agente sin supervisor.
export function asignarSupervisor(idUsuario, idSupervisor) {
  return pedir(`/api/v1/usuarios/${idUsuario}/supervisor`, {
    metodo: 'PUT',
    cuerpo: { id_supervisor: idSupervisor },
  });
}
