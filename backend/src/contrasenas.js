// Reglas comunes de las contrasenas (docs/api.md, "Contrasenas" y POST /usuarios).
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from './config.js';

// bcrypt solo usa los primeros 72 bytes de la contrasena.
export const passwordNueva = z
  .string({ required_error: 'Es obligatoria.' })
  .min(8, 'La contrasena debe tener al menos 8 caracteres.')
  .refine((valor) => Buffer.byteLength(valor, 'utf8') <= 72, 'La contrasena es demasiado larga.');

export function hashDePassword(password) {
  return bcrypt.hash(password, config.bcryptCosto);
}
