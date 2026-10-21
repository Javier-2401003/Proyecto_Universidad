// Punto de entrada: comprueba la base de datos y levanta el servidor.
import { config } from './config.js';
import { consultar } from './db.js';
import { crearApp } from './app.js';

try {
  await consultar('SELECT 1');
} catch (error) {
  console.error('No se pudo conectar a MySQL. Revise Wamp (icono verde) y los datos DB_* de backend/.env');
  console.error('Detalle:', error.code || error.message);
  process.exit(1);
}

crearApp().listen(config.puerto, () => {
  console.log(`API lista en http://localhost:${config.puerto}  (prueba: /health)`);
});
