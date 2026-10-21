// Conexion a MySQL. Todas las consultas usan "?" (consultas parametrizadas),
// nunca se concatenan datos del usuario dentro del SQL.
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL llega como numero, no como texto
});

// Ejecuta una consulta y devuelve las filas.
export async function consultar(sql, parametros = []) {
  const [filas] = await pool.execute(sql, parametros);
  return filas;
}

// Ejecuta varias operaciones como una sola: si una falla, se deshacen todas.
export async function conTransaccion(trabajo) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}
