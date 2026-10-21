// Endpoints de autenticacion (Blueprint 3.1, Endpoint 1).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { consultar } from '../db.js';
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
