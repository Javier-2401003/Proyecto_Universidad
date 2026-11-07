# Frontend - VocalAnalytics

Interfaz web en React + Vite. Por ahora incluye el login, el menú lateral según los
permisos del usuario, la gestión de usuarios (crear, editar, activar o desactivar y asignar
supervisor), la carga de audios por lotes, el detalle de una llamada y las estadísticas de
la página de inicio, el Panel del Agente, la Búsqueda histórica y el Registro de auditoría.

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

## Backend real y modo de prueba
Los contratos están en `docs/api.md`. Qué parte usa datos simulados (`src/api/simulacion/`)
lo decide `src/api/simulacion/activa.js`; las pantallas simuladas muestran el aviso
"Modo de prueba".

| Pantalla | Por defecto | Para cambiarlo (en `frontend/.env`, luego reinicie `npm run dev`) |
|---|---|---|
| Carga de lotes y detalle de llamada | **Backend real** | `VITE_SIMULAR_LLAMADAS=true` |
| Estadísticas del inicio | **Backend real** | `VITE_SIMULAR_ESTADISTICAS=true` |
| Listado de llamadas (Panel del Agente y Búsqueda histórica) | **Backend real** | `VITE_SIMULAR_LISTADO=true` |

- Con el backend real, cada llamada se analiza con `audio-processing/analizar.py` (hace falta
  instalarlo, ver `audio-processing/README.md`); mientras tanto queda en **Pendiente**. Para
  mostrar resultados en una demo sin el análisis instalado, ponga las tres variables en `true`.
- En modo de prueba los archivos no salen de la computadora y los datos viven en memoria:
  al recargar la página (F5) se pierden y hay que cargar un lote de nuevo.

### Carga de audios por lotes
- Solo el rol **Supervisor** puede cargar lotes (permiso de escritura en `CARGA_LOTES`);
  el SuperAdmin solo puede consultar el módulo.
- Para cargar, el Supervisor necesita al menos un agente asignado (`GET /agentes` solo
  devuelve los suyos). Se asigna en **Gestión de usuarios**: Editar el agente → Supervisor
  (o al crearlo).
- La simulación aplica las mismas reglas del contrato: 5, 10 o 15 archivos WAV/MP3 de
  hasta 25 MB, audios duplicados y agente válido.
- Un archivo cuyo nombre contenga `error` termina en estado ERROR, para probar ese caso.
- El lote en pantalla queda en la dirección (`/carga-lotes?lote=1`), así que al volver
  del detalle de una llamada se sigue viendo.

### Detalle de una llamada (`/llamadas/:id`)
- Se abre desde la carga de lotes, haciendo clic en una llamada **Completada**. Con el
  backend real se escucha el audio original.
- Muestra el puntaje final (odómetro de 0 a 100), la clasificación, el diagnóstico, los
  puntajes de texto y voz, el mapa de sentimiento por hablante, las alertas y la
  transcripción. Al hacer clic en un tiempo se resalta la frase (y, con audio real, el
  reproductor salta a ese segundo).
- La simulación alterna tres conversaciones de ejemplo: positiva, cliente problemático
  y falla del agente (con audio de baja confianza).

### Estadísticas de la página de inicio
- Indicadores, llamadas por estado, sentimiento de las llamadas
  analizadas, alertas por tipo y una tabla por agente (primero los de menor puntaje).
  Se elige el periodo: 7, 30 o 90 días.
- El Agente ve solo sus llamadas y no ve la tabla por agente. En modo de prueba, un Agente
  ve los datos de "Ana Torres (prueba)"; el Supervisor y el SuperAdmin ven los tres agentes.
- Los datos simulados son siempre los mismos (90 días generados con una semilla fija) y no
  dependen de los lotes cargados en la pantalla de carga.

### Panel del Agente (`/panel-agente`)
- Solo para el rol **Agente** (módulo `PANEL_AGENTE`).
- Arriba, su resumen de los últimos 30 días (`GET /estadisticas/resumen`, backend real).
- Abajo, **Mis llamadas** (`GET /llamadas`): filtros por estado y clasificación, 10 por página.
  Una llamada completada abre su detalle. En modo de prueba la lista es de ejemplo (siempre la
  misma) y no enlaza al detalle, porque esas llamadas no existen en el backend.

### Búsqueda histórica (`/busqueda`)
- Para SuperAdmin y Supervisor (módulo `BUSQUEDA_HISTORICA`), con `GET /llamadas`.
- Filtros: fechas, agente (de `GET /agentes`), estado, clasificación, diagnóstico y nombre del
  archivo. Se aplican con **Buscar**; 20 resultados por página.
- Los filtros y la página quedan en la dirección (`/busqueda?clasificacion=CRITICO&pagina=2`):
  al volver del detalle de una llamada se conservan.
- La tabla y la paginación son las mismas del Panel del Agente (`src/componentes/ListaLlamadas.jsx`).
- En modo de prueba hay tres agentes de ejemplo; un Agente solo ve los de "Ana Torres (prueba)".

### Registro de auditoría (`/auditoria`)
- Solo SuperAdmin (módulo `AUDITORIA`), con `GET /auditoria`. Solo lectura.
- Filtros por usuario, acción, módulo y fechas, 25 por página; quedan en la dirección como en la
  Búsqueda histórica.
- El detalle de cada registro se muestra como una frase ("Ana Torres: rol Agente → Supervisor"),
  con nombres en lugar de ids (salen de `GET /usuarios`, que trae hasta 200). Al pasar el mouse se
  ve el JSON guardado. Una acción nueva que la pantalla no conozca se muestra como JSON.
- "Análisis de llamada" enlaza al detalle de la llamada.

## Sesión
- El token se guarda en `sessionStorage`: sobrevive a una recarga y se borra al
  cerrar el navegador.
- Si el backend responde 401 (token vencido a los 60 minutos o usuario
  desactivado), la aplicación vuelve al login.
