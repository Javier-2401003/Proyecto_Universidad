// Cliente HTTP del backend. Agrega el token Bearer y convierte las respuestas de
// error del backend ({ error: { codigo, mensaje, detalles } }) en ErrorApi.

const URL_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

// sessionStorage: el token sobrevive a una recarga pero se borra al cerrar el navegador.
const CLAVE_TOKEN = 'vocalanalytics.token';

export class ErrorApi extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// El navegador puede bloquear sessionStorage (modo privado estricto); en ese caso
// la sesion simplemente no se recuerda al recargar.
export function obtenerToken() {
  try {
    return sessionStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
}

export function guardarToken(token) {
  try {
    sessionStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    // Sin almacenamiento disponible: la sesion dura hasta recargar la pagina.
  }
}

export function borrarToken() {
  try {
    sessionStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // Nada que borrar.
  }
}

// Lo registra SesionContexto: se llama cuando el backend rechaza el token
// (expiro o el usuario fue desactivado), para volver a la pantalla de login.
let alPerderSesion = null;
export function registrarPerdidaDeSesion(funcion) {
  alPerderSesion = funcion;
}

export async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const token = obtenerToken();

  let respuesta;
  try {
    respuesta = await fetch(`${URL_BASE}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(
      0,
      'SIN_CONEXION',
      'No se pudo conectar con el servidor. Compruebe que el backend este encendido.'
    );
  }

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    const error = datos?.error ?? {};
    if (respuesta.status === 401 && token) {
      borrarToken();
      alPerderSesion?.();
    }
    throw new ErrorApi(
      respuesta.status,
      error.codigo || 'ERROR_DESCONOCIDO',
      error.mensaje || `El servidor respondio con el estado ${respuesta.status}.`,
      error.detalles
    );
  }

  return datos;
}
