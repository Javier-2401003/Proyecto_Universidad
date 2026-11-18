// Reglas de una contrasena nueva, las mismas del backend (docs/api.md, "Contrasenas"):
// de 8 a 72 bytes. Se cuentan bytes y no letras porque bcrypt solo usa los primeros 72:
// una "n" con tilde o un acento ocupan 2. El backend siempre vuelve a validar.
const bytes = (texto) => new TextEncoder().encode(texto).length;

// Errores por campo de la contrasena nueva y su confirmacion: { password_nueva?, confirmacion? }.
// Vacio si estan bien.
export function erroresPasswordNueva(nueva, confirmacion) {
  if (bytes(nueva) < 8) return { password_nueva: 'Debe tener al menos 8 caracteres.' };
  if (bytes(nueva) > 72) {
    return { password_nueva: 'Es demasiado larga: maximo 72 bytes (las letras con tilde cuentan doble).' };
  }
  if (nueva !== confirmacion) return { confirmacion: 'No coincide con la contrasena nueva.' };
  return {};
}

// Campo del formulario al que corresponde cada error del backend.
export const CAMPO_POR_CODIGO = {
  PASSWORD_INCORRECTA: 'password_actual',
  PASSWORD_REPETIDA: 'password_nueva',
};

// Convierte un ErrorApi en errores por campo; lo que no es de un campo va en `general`.
export function erroresDeApi(excepcion) {
  if (excepcion.detalles?.length) {
    return Object.fromEntries(excepcion.detalles.map((d) => [d.campo, d.mensaje]));
  }
  const campo = CAMPO_POR_CODIGO[excepcion.codigo];
  return campo ? { [campo]: excepcion.message } : { general: excepcion.message };
}
