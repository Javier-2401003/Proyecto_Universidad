// Crea el primer SuperAdmin leyendo SEED_ADMIN_* de backend/.env.
// Es seguro repetirlo: si el correo ya existe no hace nada.
// Uso (desde la carpeta backend):  npm run crear-superadmin
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { consultar, conTransaccion, pool } from '../src/db.js';

const nombre = (process.env.SEED_ADMIN_NOMBRE || '').trim();
const correo = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || '';

async function main() {
  if (!nombre || !correo || password.length < 8) {
    console.error(
      'Complete SEED_ADMIN_NOMBRE, SEED_ADMIN_CORREO y SEED_ADMIN_PASSWORD (minimo 8 caracteres) en backend/.env'
    );
    return 1;
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    console.error('SEED_ADMIN_PASSWORD no puede superar 72 bytes.');
    return 1;
  }

  const roles = await consultar("SELECT id_rol FROM TB_Rol WHERE nombre_rol = 'SUPERADMIN'");
  if (roles.length === 0) {
    console.error('No existe el rol SUPERADMIN. Ejecute primero database/02_datos_iniciales.sql en phpMyAdmin.');
    return 1;
  }

  const existentes = await consultar('SELECT id_usuario FROM TB_Usuario WHERE correo_electronico = ?', [correo]);
  if (existentes.length > 0) {
    console.log(`El usuario ${correo} ya existe. No se hizo ningun cambio.`);
    return 0;
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptCosto);
  await conTransaccion(async (conexion) => {
    const [insercion] = await conexion.execute(
      'INSERT INTO TB_Usuario (nombre_completo, correo_electronico, password_hash) VALUES (?, ?, ?)',
      [nombre, correo, passwordHash]
    );
    await conexion.execute('INSERT INTO TB_UsuarioRol (id_usuario, id_rol) VALUES (?, ?)', [
      insercion.insertId,
      roles[0].id_rol,
    ]);
  });

  console.log(`SuperAdmin ${correo} creado. Ya puede iniciar sesion en POST /api/v1/auth/login`);
  return 0;
}

let codigo = 1;
try {
  codigo = await main();
} catch (error) {
  console.error('Error:', error.code || error.message);
} finally {
  await pool.end();
}
process.exit(codigo);
