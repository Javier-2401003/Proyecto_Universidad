import { pedir } from './cliente.js';

// [{ id_usuario, nombre_completo, correo_electronico, estado, fecha_creacion, roles }]
export function listarUsuarios() {
  return pedir('/api/v1/usuarios');
}

// datos: { nombre_completo, correo_electronico, password, rol }
export function crearUsuario(datos) {
  return pedir('/api/v1/usuarios', { metodo: 'POST', cuerpo: datos });
}
