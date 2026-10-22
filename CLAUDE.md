# VocalAnalytics - Guía para Claude Code

Sistema de análisis de sentimiento en llamadas de call center. Proyecto universitario
de 3 integrantes. Este archivo lo leen los tres Claude Code del equipo: lo que no esté
escrito en el repositorio, los demás no lo saben.

## Al empezar cada sesión
1. Confirma que el usuario trajo lo último de `main` (`git pull origin main`); si no, sugiéreselo.
2. Lee `docs/avance.md` y resume en pocas líneas qué cambió desde la última vez,
   sobre todo en las áreas de los otros integrantes.
3. Si la tarea toca un contrato entre áreas (`docs/api.md`, `docs/contrato_audio.md`),
   léelo antes de escribir código.

## Al terminar cada sesión
Actualiza **solo la sección del integrante con quien trabajas** en `docs/avance.md`
(hecho, en curso, pendiente, lo que necesita de otros) y la fecha. No edites las
secciones de los demás: así se evitan conflictos de merge.

## Equipo y áreas
| Integrante | GitHub | Área | Carpeta propia |
|---|---|---|---|
| Javier | Javier-2401003 | Frontend (React + Vite) | `frontend/` |
| David | DavidLemu | Procesamiento de audio (Whisper, librosa, sentimiento) | `audio-processing/` |
| Willy | WillyDev07 | Backend (API) y base de datos | `backend/`, `database/` |

- Trabaja solo en la carpeta del integrante. Si hace falta cambiar algo de otra área,
  no lo cambies: anótalo en `docs/avance.md` como "Necesito de <persona>".
- `docs/` es compartido. Un cambio a un contrato va en su propio PR y se avisa al equipo.

## Herramientas: solo gratuitas
La única herramienta de pago es la suscripción de Claude. Detalle en `docs/herramientas.md`.
- Whisper se usa **instalado en local** (`faster-whisper` u `openai-whisper` con pip).
  **Nunca** la API de OpenAI ni ninguna API key o servicio en la nube.
- Sentimiento con léxico en español, sin modelos pesados (PyTorch / HuggingFace).
- Debe funcionar en Windows, laptops de 8 GB sin GPU, con MySQL 8 local.
- Si una tarea parece necesitar algo de pago, detente y pregunta.

## Convenciones
- Todo en español: nombres de variables, funciones, rutas, mensajes y documentación.
- Base de datos: tablas `TB_` + singular (`TB_Llamada`). Cambios de esquema en un
  script nuevo (`database/04_...sql`); nunca modificar los scripts ya aplicados.
- API bajo `/api/v1/`. Errores con formato `{ "error": { "codigo", "mensaje", "detalles" } }`
  usando `ErrorHttp` de `backend/src/errores.js`.
- Backend: validar con zod (`validar()`), proteger con `autenticar` + `requierePermiso(modulo, 'leer'|'escribir')`,
  consultas siempre parametrizadas con `?`, y registrar en `TB_LogAuditoria` todo cambio de datos
  (nunca contraseñas ni hashes).
- Módulos de permisos: `GESTION_USUARIOS`, `DASHBOARD_VIVO`, `CARGA_LOTES`,
  `BUSQUEDA_HISTORICA`, `REPORTES`, `PANEL_AGENTE`, `AUDITORIA`.
- Iconos con Lucide o Font Awesome Free; sin emojis en la interfaz.
- Nunca subir al repo: `.env`, audios (`*.wav`, `*.mp3`), `backend/uploads/`, `venv/`, `node_modules/`.

## Flujo de Git
- Nada directo a `main`. Una rama por tarea con formato `persona-tarea`
  (`javier-frontend-base`, `david-audio-base`, `willy-carga-lotes`). Usa guion, no `/`:
  ya existe una rama `javier` y git no permite `javier/...`.
- PRs pequeños; los revisa otro integrante antes de fusionar.
- Antes de abrir el PR: `npm test` en `backend/` debe pasar si se tocó el backend.

## Comandos
- Backend: `cd backend`, `npm install`, `npm test`, `npm run dev` (http://localhost:3000/health).
- Puesta en marcha completa: ver `README.md`.
