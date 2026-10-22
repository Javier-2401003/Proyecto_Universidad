# Frontend - VocalAnalytics

Interfaz web en React + Vite. Por ahora incluye el login, el menú lateral según los
permisos del usuario, la gestión de usuarios (listar y crear) y la carga de audios
por lotes (con datos simulados, ver más abajo).

## Puesta en marcha
Requisitos: Node.js 20 o superior y el backend funcionando (ver `README.md` de la raíz).

1. En una terminal, encienda el backend:
   ```
   cd backend
   npm run dev
   ```
2. En otra terminal:
   ```
   cd frontend
   npm install
   npm run dev
   ```
3. Abra http://localhost:5173 e inicie sesión con el SuperAdmin creado con
   `npm run crear-superadmin`.

El frontend busca el backend en `http://localhost:3000`. Si usa otra dirección,
copie `.env.example` como `.env` y cambie `VITE_API_URL`.

El puerto 5173 es fijo porque el backend solo acepta peticiones (CORS) desde ahí.
Si aparece "Port 5173 is in use", cierre la otra terminal que tenga `npm run dev`.

## Estructura
```
src/
├── api/          llamadas al backend (cliente.js agrega el token y maneja errores)
├── sesion/       usuario conectado, permisos y protección de rutas
├── componentes/  layout, menú lateral, indicador de carga
├── paginas/      una pantalla por archivo
├── modulos.js    ruta, icono y pantalla de cada módulo del menú
└── estilos/      estilos globales (colores en variables de :root, con modo oscuro)
```

## Cómo agregar la pantalla de un módulo
1. Cree el componente en `src/paginas/` (recibe `nombre` con el nombre del módulo).
2. En `src/modulos.js`, cambie `EnConstruccion` por su componente en ese módulo.

El menú y la protección de la ruta ya dependen de `usuario.permisos`: no hace falta
tocar nada más. El backend vuelve a comprobar los permisos en cada petición.

## Carga de audios por lotes (modo de prueba)
El contrato está en `docs/api.md`. Mientras el backend no tenga esos endpoints, la
pantalla usa **datos simulados** (`src/api/simulacion/lotes.js`) y muestra el aviso
"Modo de prueba". Los archivos no salen de la computadora.

- Solo el rol **Supervisor** puede cargar lotes (permiso de escritura en `CARGA_LOTES`);
  el SuperAdmin solo puede consultar el módulo.
- La simulación aplica las mismas reglas del contrato: 5, 10 o 15 archivos WAV/MP3 de
  hasta 25 MB, audios duplicados y agente válido.
- Un archivo cuyo nombre contenga `error` termina en estado ERROR, para probar ese caso.
- Para usar el backend real, cree `frontend/.env` con `VITE_SIMULAR_CARGA_LOTES=false`
  y reinicie `npm run dev`. Cuando los endpoints estén en `main`, cambie el valor por
  defecto de `SIMULAR` en `src/api/lotes.js` a `false`.

## Sesión
- El token se guarda en `sessionStorage`: sobrevive a una recarga y se borra al
  cerrar el navegador.
- Si el backend responde 401 (token vencido a los 60 minutos o usuario
  desactivado), la aplicación vuelve al login.
