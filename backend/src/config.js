// Configuracion central. Todo valor que cambie entre computadoras sale de .env.
import 'dotenv/config';

function texto(nombre, defecto) {
  const valor = process.env[nombre];
  return valor === undefined || valor === '' ? defecto : valor;
}

function entero(nombre, defecto) {
  const valor = Number.parseInt(texto(nombre, String(defecto)), 10);
  if (Number.isNaN(valor)) {
    throw new Error(`La variable ${nombre} del archivo .env debe ser un numero.`);
  }
  return valor;
}

const jwtSecreto = texto('JWT_SECRET', '');
if (jwtSecreto.length < 32 || jwtSecreto.startsWith('cambie-esto')) {
  throw new Error(
    'Falta JWT_SECRET en backend/.env (minimo 32 caracteres, distinto del ejemplo). ' +
      'Vea .env.example para saber como generarlo.'
  );
}

export const config = Object.freeze({
  puerto: entero('PORT', 3000),
  corsOrigin: texto('CORS_ORIGIN', 'http://localhost:5173'),
  db: Object.freeze({
    host: texto('DB_HOST', '127.0.0.1'),
    port: entero('DB_PORT', 3306),
    user: texto('DB_USER', 'root'),
    password: texto('DB_PASSWORD', ''),
    database: texto('DB_NAME', 'db_vocalanalytics'),
  }),
  jwt: Object.freeze({
    secreto: jwtSecreto,
    expiraSegundos: entero('JWT_EXPIRES_IN_SECONDS', 3600),
  }),
  bcryptCosto: entero('BCRYPT_COST', 12),
  loginMaxIntentos: entero('LOGIN_MAX_INTENTOS', 10),
});
