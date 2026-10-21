// Errores controlados de la API y validacion de datos de entrada.

export class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// Valida "datos" con un esquema de zod. Si no cumple, responde 400 con el detalle.
export function validar(esquema, datos) {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const detalles = resultado.error.issues.map((problema) => ({
      campo: problema.path.join('.'),
      mensaje: problema.message,
    }));
    throw new ErrorHttp(400, 'DATOS_INVALIDOS', 'Los datos enviados no son validos.', detalles);
  }
  return resultado.data;
}

// Direccion IP del cliente, sin el prefijo IPv4-en-IPv6, maximo 45 caracteres
// (tamano de TB_LogAuditoria.direccion_ip).
export function obtenerIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  return ip.replace(/^::ffff:/, '').slice(0, 45);
}
