# Avance del proyecto

Cada integrante (o su Claude) actualiza **solo su propia sección** al terminar una
sesión de trabajo. Las secciones "Estado general" y "Acuerdos" se cambian en reunión.

## Estado general
Avance aproximado: **15-20 %** (20/10/2026).

| Parte | Responsable | Estado |
|---|---|---|
| Base de datos (12 tablas, roles, módulos, permisos) | - | Hecho |
| Autenticación JWT, RBAC y auditoría | - | Hecho |
| Gestión de usuarios | Willy | Parcial: listar y crear |
| Carga de audios por lotes | Willy | Por empezar |
| Procesamiento de audio (Whisper, librosa, sentimiento, puntaje) | David | Por empezar |
| Frontend | Javier | Por empezar |
| Dashboard en vivo, panel del agente, alertas | Por asignar | Por empezar |
| Búsqueda histórica y reportes | Por asignar | Por empezar |

## Acuerdos
- Solo herramientas gratuitas; Whisper siempre en local (ver `CLAUDE.md`).
- Contratos entre áreas, pendientes de crear y acordar al inicio de esta fase:
  - `docs/contrato_audio.md` (David y Willy): cómo llama Node a Python y el JSON que devuelve.
  - `docs/api.md` (Willy y Javier): endpoints para el frontend.

---

## Javier - Frontend
_Última actualización: 22/10/2026_

**Objetivo para la próxima reunión**
- [x] Proyecto React + Vite en `frontend/`.
- [x] Login contra `POST /api/v1/auth/login`, guardando el token.
- [x] Menú lateral según `usuario.permisos`.
- [x] Gestión de usuarios: listar y crear.
- [x] Demo: SuperAdmin crea un agente; el agente solo ve su panel.

**Hecho:** rama `javier-frontend-base`. Login con errores del backend, sesión en
`sessionStorage` (vuelve al login si el token vence), menú y rutas protegidas por
permiso, gestión de usuarios (tabla + formulario con errores por campo), diseño
adaptable a móvil y modo oscuro. Cómo ejecutarlo y cómo agregar pantallas: `frontend/README.md`.
Los módulos sin pantalla muestran "En construcción" (`src/modulos.js`).

Rama `javier-carga-lotes`: pantalla **Carga de audios por lotes** según el contrato de
`docs/api.md` (selector de agente, arrastrar o elegir archivos, validación de cantidad,
formato, tamaño y duplicados, barra de progreso y seguimiento del procesamiento de cada
llamada). Funciona con **datos simulados** (`src/api/simulacion/lotes.js`) hasta que
existan los endpoints; con `VITE_SIMULAR_CARGA_LOTES=false` usa el backend real.
Solo el Supervisor puede cargar lotes; el SuperAdmin solo consulta.

**En curso:** -

**Necesito de otros:**
- Willy: los 3 endpoints de carga de lotes **tal como están en `docs/api.md`**
  (`GET /agentes`, `POST /llamadas/lotes`, `GET /llamadas/lotes/:id_lote`). Cuando estén,
  aviso para conectarlos y probar juntos.
- Willy: endpoints para editar, desactivar y asignar supervisor (para completar Gestión de usuarios).
  Asignar supervisor también hace falta para que `GET /agentes` devuelva agentes al Supervisor.
- Willy: un endpoint de roles (`GET /api/v1/roles`); hoy la lista de roles del formulario está fija
  en el frontend con los 3 roles base.

---

## David - Procesamiento de audio
_Última actualización: 20/10/2026_

**Objetivo para la próxima reunión**
- [ ] `audio-processing/README.md` con la instalación (Python, ffmpeg, dependencias).
- [ ] `python analizar.py ruta_del_audio` que imprima un JSON: transcripción con tiempos, tono (F0), volumen (RMS), duración.
- [ ] Tiempo de un audio de 3 a 5 min con los modelos `base` y `small`.
- [ ] Borrador de `docs/contrato_audio.md`.

**Hecho:** -
**En curso:** -
**Necesito de otros:** -

---

## Willy - Backend
_Última actualización: 20/10/2026_

**Objetivo para la próxima reunión**
- [ ] `POST /api/v1/llamadas/lotes` (5, 10 o 15 audios, máx. 25 MB, duplicados por SHA-256).
- [ ] Gestión de usuarios: editar, desactivar y asignar supervisor.
- [ ] Pruebas de lo nuevo; `npm test` pasando.
- [ ] `docs/api.md` con todos los endpoints.

**Hecho:** -
**En curso:** -
**Necesito de otros:** -
