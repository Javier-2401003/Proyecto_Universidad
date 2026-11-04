// Agentes a los que el usuario puede cargarles audios (docs/api.md, GET /agentes).
import { Router } from 'express';
import { agentesVisibles } from '../agentes.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';

export const rutasAgentes = Router();

rutasAgentes.get('/', autenticar, requierePermiso('CARGA_LOTES', 'leer'), async (req, res) => {
  res.json(await agentesVisibles(req.usuario));
});
