// Roles existentes, para el formulario de usuarios (GET /roles). Los roles son
// configurables (TB_Rol): por eso el frontend no debe tener la lista fija.
import { Router } from 'express';
import { consultar } from '../db.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

export const rutasRoles = Router();

rutasRoles.get('/', autenticar, requierePermiso('GESTION_USUARIOS', 'leer'), async (_req, res) => {
  res.json(await consultar('SELECT id_rol, nombre_rol, descripcion FROM TB_Rol ORDER BY nombre_rol'));
});
