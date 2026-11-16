// Endpoints de autenticacion (Blueprint 3.1, Endpoint 1).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { consultar, conTransaccion } from '../db.js';
import { hashDePassword, passwordNueva } from '../contrasenas.js';
import { ErrorHttp, validar, obtenerIp } from '../errores.js';
import { autenticar } from '../middleware/auth.js';
import { obtenerPermisos, obtenerRoles } from '../permisos.js';

export const rutasAuth = Router();

// Medida antibot / fuerza bruta: solo cuentan los intentos fallidos.
const limitarLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginMaxIntentos,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        codigo: 'DEMASIADOS_INTENTOS',
        mensaje: 'Demasiados intentos fallidos. Intente de nuevo en unos minutos.',
      },
    });
  },
});

// Hash de relleno: si el correo no existe se compara igual contra este hash,
// para que la respuesta tarde lo mismo y no revele que correos existen.
const HASH_DE_RELLENO = bcrypt.hashSync('relleno-no-es-una-contrasena', config.bcryptCosto);

const esquemaLogin = z.object({
  correo_electronico: z.string().email().max(150),
  password: z.string().min(1).max(200),
});

rutasAuth.post('/login', limitarLogin, async (req, res) => {
  const { correo_electronico, password } = validar(esquemaLogin, req.body);

  const filas = await consultar(
    `SELECT id_usuario, nombre_completo, password_hash, estado
       FROM TB_Usuario WHERE correo_electronico = ?`,
    [correo_electronico]
  );
  const usuario = filas[0];
  const coincide = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_DE_RELLENO);

  if (!usuario || !coincide || usuario.estado !== 'ACTIVO') {
    console.warn(`[auth] intento de login fallido desde ${obtenerIp(req)}`);
    throw new ErrorHttp(401, 'CREDENCIALES_INVALIDAS', 'Correo o contrasena incorrectos.');
  }

  const token = jwt.sign({ sub: String(usuario.id_usuario) }, config.jwt.secreto, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiraSegundos,
  });

  res.json({
    token_acceso: token,
    tipo_token: 'Bearer',
    expiracion_segundos: config.jwt.expiraSegundos,
    usuario: {
      id: usuario.id_usuario,
      nombre: usuario.nombre_completo,
      roles: await obtenerRoles(usuario.id_usuario),
      permisos: await obtenerPermisos(usuario.id_usuario),
    },
  });
});

// Cambio de la propia contrasena (docs/api.md, "Contrasenas"). Como en el login, solo cuentan los
// intentos con la contrasena actual equivocada: un token robado no sirve para adivinarla.
const limitarCambioPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginMaxIntentos,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => !res.locals.passwordIncorrecta,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        codigo: 'DEMASIADOS_INTENTOS',
        mensaje: 'Demasiados intentos con la contrasena actual equivocada. Intente de nuevo en unos minutos.',
      },
    });
  },
});

const esquemaCambioPassword = z.object({
  password_actual: z.string({ required_error: 'Es obligatoria.' }).min(1, 'Es obligatoria.').max(200),
  password_nueva: passwordNueva,
});

rutasAuth.patch('/password', autenticar, limitarCambioPassword, async (req, res) => {
  const { password_actual: actual, password_nueva: nueva } = validar(esquemaCambioPassword, req.body ?? {});

  const [{ password_hash: hashActual }] = await consultar(
    'SELECT password_hash FROM TB_Usuario WHERE id_usuario = ?',
    [req.usuario.id]
  );
  if (!(await bcrypt.compare(actual, hashActual))) {
    res.locals.passwordIncorrecta = true; // cuenta para el limite de intentos
    // 400 y no 401: un 401 haria que el frontend cierre la sesion.
    throw new ErrorHttp(400, 'PASSWORD_INCORRECTA', 'La contrasena actual no es correcta.', [
      { campo: 'password_actual', mensaje: 'No es correcta.' },
    ]);
  }
  if (await bcrypt.compare(nueva, hashActual)) {
    throw new ErrorHttp(400, 'PASSWORD_REPETIDA', 'La contrasena nueva debe ser distinta de la actual.', [
      { campo: 'password_nueva', mensaje: 'Es igual a la actual.' },
    ]);
  }

  const passwordHash = await hashDePassword(nueva);
  await conTransaccion(async (conexion) => {
    await conexion.execute('UPDATE TB_Usuario SET password_hash = ? WHERE id_usuario = ?', [passwordHash, req.usuario.id]);
    // Nunca la contrasena ni su hash.
    await conexion.execute(
      `INSERT INTO TB_LogAuditoria (id_usuario, accion_ejecutada, modulo_afectado, detalle_cambio, direccion_ip)
       VALUES (?, 'CAMBIO_PASSWORD', 'AUTENTICACION', ?, ?)`,
      [req.usuario.id, JSON.stringify({ id_usuario: req.usuario.id }), obtenerIp(req)]
    );
  });

  res.json({ mensaje: 'La contraseña se cambió correctamente.' });
});

// Datos del usuario con sesion iniciada (el frontend lo usa para armar el menu).
rutasAuth.get('/me', autenticar, async (req, res) => {
  res.json({
    id: req.usuario.id,
    nombre: req.usuario.nombre,
    correo: req.usuario.correo,
    roles: req.usuario.roles,
    permisos: await obtenerPermisos(req.usuario.id),
  });
});
