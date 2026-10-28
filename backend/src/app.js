// Construye la aplicacion Express (separada de server.js para poder probarla).
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { consultar } from './db.js';
import { ErrorHttp } from './errores.js';
import { rutasAuth } from './routes/auth.js';
import { rutasUsuarios } from './routes/usuarios.js';
import { rutasAgentes } from './routes/agentes.js';
import { rutasLlamadas } from './routes/lotes.js';

export function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  // Limite general de solicitudes por IP.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    })
  );

  // Comprobacion de salud: tambien verifica la conexion a MySQL.
  app.get('/health', async (_req, res) => {
    try {
      await consultar('SELECT 1');
      res.json({ estado: 'OK', base_de_datos: true });
    } catch {
      res.status(503).json({ estado: 'ERROR', base_de_datos: false });
    }
  });

  app.use('/api/v1/auth', rutasAuth);
  app.use('/api/v1/usuarios', rutasUsuarios);
  app.use('/api/v1/agentes', rutasAgentes);
  app.use('/api/v1/llamadas', rutasLlamadas);

  app.use((_req, _res, next) => {
    next(new ErrorHttp(404, 'NO_ENCONTRADO', 'La ruta solicitada no existe.'));
  });

  // Manejo central de errores: el cliente nunca recibe trazas ni detalles internos.
  // (Express exige los 4 parametros para reconocer este manejador.)
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof ErrorHttp) {
      const cuerpo = { codigo: error.codigo, mensaje: error.message };
      if (error.detalles) cuerpo.detalles = error.detalles;
      return res.status(error.estado).json({ error: cuerpo });
    }
    if (error.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la solicitud no es JSON valido.' } });
    }
    console.error('[error]', error.code || '', error.message);
    return res
      .status(500)
      .json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrio un error interno.' } });
  });

  return app;
}
