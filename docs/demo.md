# Cómo probar la demo en su computadora

Se hace **una sola vez**. Después basta con encender el backend y el frontend
(paso 6).

## Requisitos
- Git
- Node.js LTS, versión 20.19 o superior (`node -v`)
- MySQL 8 (el de Wamp o uno instalado aparte)

## 1. Descargar el proyecto
Si todavía no lo tiene:
```
git clone https://github.com/Javier-2401003/Proyecto_Universidad.git
cd Proyecto_Universidad
```
Si ya lo tenía, traiga lo último:
```
git switch main
git pull
```
Para ver pantallas que aún están en revisión, cambie a la rama del PR
(por ejemplo `git switch javier-carga-lotes`).

## 2. Crear la base de datos
En phpMyAdmin (pestaña SQL) o MySQL Workbench, ejecute **en orden** el contenido de:
1. `database/01_esquema.sql`
2. `database/02_datos_iniciales.sql`

Si tiene dos MySQL en la misma computadora (por ejemplo, Wamp y otro instalado
aparte), use el que esté en el puerto 3306 o cambie `DB_PORT` en el paso 3.

## 3. Configurar el backend
```
cd backend
cp .env.example .env
```
Genere un valor para `JWT_SECRET` (copie el texto que aparece):
```
node --input-type=module -e "import {randomBytes} from 'crypto'; console.log(randomBytes(48).toString('hex'))"
```
Abra `backend/.env` y complete:
- `DB_PASSWORD`: contraseña de su MySQL (en Wamp normalmente se deja vacía).
- `JWT_SECRET`: el texto generado.
- `SEED_ADMIN_NOMBRE`, `SEED_ADMIN_CORREO`, `SEED_ADMIN_PASSWORD` (mínimo 8 caracteres): su administrador.

## 4. Instalar y crear el administrador
```
npm install
npm run crear-superadmin
```

## 5. Instalar el frontend
```
cd ../frontend
npm install
```

## 6. Encender todo (cada vez que quiera usarlo)
Terminal 1:
```
cd backend
npm run dev
```
Compruebe http://localhost:3000/health : debe mostrar `"base_de_datos":true`.

Terminal 2:
```
cd frontend
npm run dev
```
Abra **http://localhost:5173**. Para apagar, pulse `Ctrl + C` en cada terminal.

## 7. Recorrido de la demo
1. Entre con su SuperAdmin (el del `.env`).
2. En **Gestión de usuarios**, cree un usuario **Supervisor** y otro **Agente**.
3. Cierre sesión y entre como **Agente**: solo ve "Panel del Agente".
4. Entre como **Supervisor** y abra **Carga de audios por lotes**: elija un agente de
   prueba y arrastre 5 audios `.mp3` o `.wav` (modo de prueba: no salen de su computadora).
   Al terminar, haga clic en una llamada completada para ver su **detalle**.

## Si algo falla
| Mensaje | Solución |
|---|---|
| `Falta JWT_SECRET` | Falta `backend/.env` o está incompleto (paso 3). |
| `ER_ACCESS_DENIED_ERROR` | `DB_PASSWORD` incorrecta. |
| `ER_BAD_DB_ERROR` o `ER_NO_SUCH_TABLE` | Faltan los scripts SQL (paso 2). |
| `ECONNREFUSED` | MySQL o Wamp está apagado. |
| "No se pudo conectar con el servidor" en el login | El backend no está encendido. |
| `Port 5173 is in use` | Ya tiene otro `npm run dev` del frontend abierto. |
| `npm` no se reconoce | Cierre y abra la terminal, o reinicie Windows. |
