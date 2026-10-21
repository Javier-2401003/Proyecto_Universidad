# Proyecto_Universidad
Sistema de análisis de sentimientos en llamadas de Call Center con IA (VocalAnalytics).

## Estructura
- `frontend/` : interfaz en React
- `backend/` : API en Node.js + Express
- `database/` : scripts SQL (MySQL 8)
- `audio-processing/` : transcripción y análisis acústico (Python local)
- `docs/` : documentación

## Herramientas (todas gratuitas y de código abierto)
Ver `docs/herramientas.md`.

## Puesta en marcha (Windows + Wamp)

### 1. Requisitos
- Git, Node.js LTS y Wamp (MySQL 8 activo, ícono verde).

### 2. Base de datos
En http://localhost/phpmyadmin, pestaña SQL, ejecute en orden el contenido de
`database/01_esquema.sql` y `database/02_datos_iniciales.sql`.
Detalle del modelo en `docs/modelo_datos.md`.
(En Windows, MySQL guarda los nombres de tabla en minúsculas: `tb_usuario`.
Es normal y las consultas siguen funcionando igual.)

### 3. Backend
```
cd backend
copy .env.example .env
```
Abra `backend/.env` y complete `JWT_SECRET` (instrucción dentro del archivo) y
las tres variables `SEED_ADMIN_*`. Luego:
```
npm install
npm run crear-superadmin
npm test
npm run dev
```
Compruebe http://localhost:3000/health : debe mostrar `{"estado":"OK","base_de_datos":true}`.

### 4. Problemas frecuentes
- `Falta JWT_SECRET`: no existe `backend/.env` o la variable está vacía.
- `ECONNREFUSED` o `No se pudo conectar a MySQL`: Wamp no está en verde o `DB_*` es incorrecto.
- `ER_NO_SUCH_TABLE`: falta ejecutar los scripts SQL en phpMyAdmin.
- `ER_ACCESS_DENIED_ERROR`: `DB_PASSWORD` no coincide (en Wamp, root no tiene contraseña por defecto).
- `npm` no se reconoce: cierre y abra de nuevo la terminal, o reinicie Windows.
