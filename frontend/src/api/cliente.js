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
  if (!respuesta.ok) throw errorDeRespuesta(respuesta.status, datos, token);
  return datos;
}

// Envia un formulario multipart (archivos). Usa XMLHttpRequest porque fetch no
// informa el avance de la subida. alProgreso recibe un numero de 0 a 100.
export function enviarFormulario(ruta, formulario, alProgreso) {
  const token = obtenerToken();

  return new Promise((resolver, rechazar) => {
    const solicitud = new XMLHttpRequest();
    solicitud.open('POST', `${URL_BASE}${ruta}`);
    if (token) solicitud.setRequestHeader('Authorization', `Bearer ${token}`);
    solicitud.responseType = 'json';

    solicitud.upload.onprogress = (evento) => {
      if (evento.lengthComputable) alProgreso?.(Math.round((evento.loaded / evento.total) * 100));
    };
    solicitud.onload = () => {
      if (solicitud.status >= 200 && solicitud.status < 300) {
        resolver(solicitud.response);
      } else {
        rechazar(errorDeRespuesta(solicitud.status, solicitud.response, token));
      }
    };
    solicitud.onerror = () => {
      rechazar(
        new ErrorApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Compruebe que el backend este encendido.')
      );
    };

    solicitud.send(formulario);
  });
}

// Convierte una respuesta de error del backend en ErrorApi. Un 401 con token
// significa que la sesion ya no vale: se borra y se vuelve al login.
function errorDeRespuesta(estado, datos, token) {
  const error = datos?.error ?? {};
  if (estado === 401 && token) {
    borrarToken();
    alPerderSesion?.();
  }
  return new ErrorApi(
    estado,
    error.codigo || 'ERROR_DESCONOCIDO',
    error.mensaje || `El servidor respondio con el estado ${estado}.`,
    error.detalles
  );
}
