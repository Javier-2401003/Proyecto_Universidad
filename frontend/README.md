# Frontend - VocalAnalytics

Interfaz web en React + Vite. Por ahora incluye el login, el menú lateral según los
permisos del usuario, la gestión de usuarios (listar y crear), la carga de audios
por lotes y el detalle de una llamada (estas dos con datos simulados, ver más abajo).

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

## Modo de prueba (carga de lotes y detalle de llamada)
Los contratos están en `docs/api.md`. Mientras el backend no tenga los endpoints de
`/llamadas`, estas pantallas usan **datos simulados** (`src/api/simulacion/`) y muestran
el aviso "Modo de prueba". Los archivos no salen de la computadora.

- Para usar el backend real, cree `frontend/.env` con `VITE_SIMULAR_LLAMADAS=false` y
  reinicie `npm run dev`. Cuando los endpoints estén en `main`, cambie el valor por
  defecto en `src/api/simulacion/activa.js` a `false`.
- Los datos simulados viven en memoria: al recargar la página (F5) se pierden y hay que
  cargar un lote de nuevo.

### Carga de audios por lotes
- Solo el rol **Supervisor** puede cargar lotes (permiso de escritura en `CARGA_LOTES`);
  el SuperAdmin solo puede consultar el módulo.
- La simulación aplica las mismas reglas del contrato: 5, 10 o 15 archivos WAV/MP3 de
  hasta 25 MB, audios duplicados y agente válido.
- Un archivo cuyo nombre contenga `error` termina en estado ERROR, para probar ese caso.
- El lote en pantalla queda en la dirección (`/carga-lotes?lote=1`), así que al volver
  del detalle de una llamada se sigue viendo.

### Detalle de una llamada (`/llamadas/:id`)
- Se abre desde la carga de lotes, haciendo clic en una llamada **Completada**.
- Muestra el puntaje final (odómetro de 0 a 100), la clasificación, el diagnóstico, los
  puntajes de texto y voz, el mapa de sentimiento por hablante, las alertas y la
  transcripción. Al hacer clic en un tiempo se resalta la frase (y, con audio real, el
  reproductor salta a ese segundo).
- La simulación alterna tres conversaciones de ejemplo: positiva, cliente problemático
  y falla del agente (con audio de baja confianza).

## Sesión
- El token se guarda en `sessionStorage`: sobrevive a una recarga y se borra al
  cerrar el navegador.
- Si el backend responde 401 (token vencido a los 60 minutos o usuario
  desactivado), la aplicación vuelve al login.
