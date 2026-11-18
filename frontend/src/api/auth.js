import { pedir, guardarToken } from './cliente.js';

// Guarda el token y devuelve el usuario con el mismo formato que /auth/me,
// para que el resto de la aplicacion trabaje con una sola forma de usuario.
export async function iniciarSesion(correo, password) {
  const datos = await pedir('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: correo, password },
  });
  guardarToken(datos.token_acceso);
  return obtenerSesion();
}

// { id, nombre, correo, roles: [...], permisos: [{ modulo, nombre, leer, escribir }] }
export function obtenerSesion() {
  return pedir('/api/v1/auth/me');
}

// Cambia la contrasena del usuario con sesion (docs/api.md, "Contrasenas"). Responde { mensaje }.
// Una contrasena actual equivocada es 400 PASSWORD_INCORRECTA, no 401: no cierra la sesion.
export function cambiarPassword(passwordActual, passwordNueva) {
  return pedir('/api/v1/auth/password', {
    metodo: 'PATCH',
    cuerpo: { password_actual: passwordActual, password_nueva: passwordNueva },
  });
}
