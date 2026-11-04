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
- Contratos entre áreas:
  - `docs/api.md` (Willy y Javier): **creado el 22/10/2026**. Documenta los endpoints que ya
    existen y deja **acordada la carga de audios por lotes**: `GET /agentes`,
    `POST /llamadas/lotes` y `GET /llamadas/lotes/:id_lote`.
    - **Willy:** implementa esos tres endpoints **tal como están en `docs/api.md`** (campos,
      respuestas y códigos de error). Si necesitas cambiar algo, cámbialo primero en
      `docs/api.md` en un PR propio y avisa a Javier. Ya no hace falta crear `docs/api.md`:
      agrega ahí los endpoints nuevos (editar/desactivar usuario, asignar supervisor).
    - **Javier:** construye la pantalla de carga con ese contrato y datos de prueba hasta
      que el endpoint exista.
    - Decisiones clave: un lote = un solo agente; todo o nada (si un archivo falla, no se
      guarda ninguno); `multipart/form-data` con el campo `audios` repetido; límites en
      `backend/.env` (`LOTE_TAMANOS_PERMITIDOS=5,10,15`, `AUDIO_MAX_MB=25`).
  - `docs/api.md`, sección **Detalle de una llamada** (propuesto el 22/10/2026 por Javier,
    a revisar por Willy y David): `GET /llamadas/:id_llamada` y `GET /llamadas/:id_llamada/audio`.
    Define qué datos del análisis muestra la pantalla (transcripción por hablante con
    sentimiento, alertas, puntaje, clasificación y diagnóstico). Su apartado **"De dónde
    salen los datos"** es la base para `docs/contrato_audio.md`.
  - `docs/contrato_audio.md` (David y Willy): pendiente. Cómo llama Node a Python y el JSON que devuelve.
- Guía para instalar y probar la demo en cualquier computadora: `docs/demo.md`.

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
llamada). Solo el Supervisor puede cargar lotes; el SuperAdmin solo consulta.

Rama `javier-detalle-llamada`: pantalla **Detalle de una
llamada** (`/llamadas/:id`), que se abre desde la carga de lotes: odómetro del puntaje final,
clasificación, diagnóstico, puntajes de texto y voz, mapa de sentimiento por hablante con
alertas, transcripción y reproductor de audio (salta al segundo elegido). Contrato propuesto
en `docs/api.md` y guía de demo en `docs/demo.md`.

Las dos pantallas funcionan con **datos simulados** (`src/api/simulacion/`) hasta que existan
los endpoints; con `VITE_SIMULAR_LLAMADAS=false` usan el backend real.

**En curso:** -

**Necesito de otros:**
- Willy: los 3 endpoints de carga de lotes **tal como están en `docs/api.md`**
  (`GET /agentes`, `POST /llamadas/lotes`, `GET /llamadas/lotes/:id_lote`). Cuando estén,
  aviso para conectarlos y probar juntos.
- Willy y David: revisar la sección "Detalle de una llamada" de `docs/api.md` y avisar si
  algún dato no se puede producir o guardar así.
- Willy: endpoints para editar, desactivar y asignar supervisor (para completar Gestión de usuarios).
  Asignar supervisor también hace falta para que `GET /agentes` devuelva agentes al Supervisor.
- Willy: un endpoint de roles (`GET /api/v1/roles`); hoy la lista de roles del formulario está fija
  en el frontend con los 3 roles base.

---

## David - Procesamiento de audio
_Última actualización: 03/11/2026_

**Objetivo para la próxima reunión**
- [x] `audio-processing/README.md` con la instalación (Python, ffmpeg, dependencias).
- [x] `python analizar.py ruta_del_audio` que imprima un JSON: transcripción con tiempos, tono (F0), volumen (RMS), duración.
- [x] Tiempo de un audio de 3 a 5 min con los modelos `base` y `small`.
- [x] Borrador de `docs/contrato_audio.md`.

**Hecho:** rama `david-audio-base`: `analizar.py` (faster-whisper en CPU + librosa) imprime
solo un JSON por stdout; errores en JSON con código de salida 1. Python **3.12** (con 3.14
fallan dependencias); no hace falta instalar ffmpeg (PyAV lo trae). Con un audio de 4,5 min
en una laptop sin GPU: **`base` ~1 min, `small` ~1 min 40 s**, 0,6-0,8 GB de RAM.
openai-whisper tardó lo mismo pero usa el doble de memoria y PyTorch, así que se usa
faster-whisper. Detalle en `audio-processing/README.md`. PR #8 ya fusionado en `main`.
Rama `david-contrato-audio` (PR #9): `docs/contrato_audio.md` v0.1 con las decisiones del equipo:
ruta absoluta del audio, variables de `.env`, dBFS y los campos de la v0.2. Python calcula también
el puntaje final, la clasificación y el diagnóstico. Si faltan campos de la v0.2, el backend deja
la llamada en `ERROR` con `CONTRATO_INCOMPLETO`. Javier confirmó que 100 es lo mejor del odómetro y
que el puntaje neutro es 50.00. Willy lo aprobó el 02/11; aún no ha revisado la regla para audios sin
voz que agregué el 03/11.
Rama `david-lexico-sentimiento`: `score_sentimiento` por segmento y `score_global_nlp` con un
léxico según RN-01 (`lexico.py`, `lexico_es.json`), 13 pruebas pasando. RN-01 no define la
fórmula; la decisión del proyecto está en `audio-processing/README.md`.

**En curso:** -

**Pendiente:**
- `hablante`: diarización sin PyTorch. Sin esto, `analizar.py` sigue emitiendo la v0.1.
- `score_acustico` (RN-02), `puntaje_final` (RN-03), `clasificacion_final` y `diagnostico_conflicto`.
- Investigar por qué Whisper casi no transcribió a quien llama en una llamada real de 4 min 44 s
  y repetir la prueba con una muestra de call center (el léxico aún no tiene precisión medida).
- Rendimiento: Willy midió 66-87 s con `base` para una grabación real de 52 s, mucho más que en mi
  laptop. Repetir las medidas con llamadas reales en la laptop más lenta del equipo.
- Revisar el umbral de `baja_confianza_audio`: esa grabación dio `true` (-1,142).
- Notas de Willy en el PR #8: un archivo de 0 bytes devuelve `AUDIO_ILEGIBLE`, no `AUDIO_VACIO`, y
  el README puede aclarar que Python 3.13.5 también funcionó.
- Fusionar el PR del léxico y luego el de `david-score-acustico`, que sale de esa rama.
- v0.3: alertas de volumen y tono.

**Necesito de otros:**
- Willy: revisar en el PR #9 la regla para audios sin voz (sección 5 del contrato) y compartir su
  grabación de 52 s, para investigar la baja confianza.
- Willy o Javier: revisar el PR del léxico.
- Equipo: acordar los cortes numéricos de `clasificacion_final`, que el Blueprint no define.
- Reunión: agregar faster-whisper (MIT, gratis) a `docs/herramientas.md`, y aclarar ahí que
  ffmpeg ya no hay que instalarlo aparte.

---

## Willy - Backend
_Última actualización: 28/10/2026_

**Objetivo para la próxima reunión**
- [x] Carga de audios por lotes: `GET /agentes`, `POST /llamadas/lotes` y `GET /llamadas/lotes/:id_lote` (PR #7, fusionado).
- [x] Gestión de usuarios: editar, desactivar y asignar supervisor (PR #11, aprobado; falta fusionar).
- [x] Detalle de una llamada: `GET /llamadas/:id_llamada` y `/audio` (rama `willy-detalle-llamada`).
- [x] Responder el borrador de `docs/contrato_audio.md` (PR #9 de David).
- [ ] Procesamiento de audio en el backend (cuando se aprueben los PRs #8 y #9).

**Hecho:**
- Carga de lotes en `main` (PR #7). Usa `multer` (MIT): después de `git pull` hay que correr
  `npm install` en `backend/`. Los audios quedan en `backend/uploads/lotes/<id_lote>/`.
- `GET /api/v1/llamadas/:id_llamada` y `/audio` según `docs/api.md` (`src/routes/llamadas.js`).
  Sin módulo de permisos: el agente ve sus llamadas, el supervisor las de sus agentes asignados
  y el SuperAdmin todas; si no puede verla, `404`. `resultado` es `null` hasta `COMPLETADO`.
  `tests/llamadas.test.js` (14 pruebas). Probado también con la pantalla de detalle de Javier y el
  audio descargado desde el navegador.
- PR #11: resuelto el conflicto de `docs/api.md` con el `main` nuevo (62 pruebas pasando).
- PR #9 (contrato de audio): respondí las 4 preguntas de David. Esperar a la v0.2 para guardar
  `TB_Transcripcion` (sin script que deje `hablante` y `score_sentimiento` en NULL); el puntaje
  final, la clasificación y el diagnóstico los calcula Python; el volumen se guarda en dBFS.

**En curso:** -

**Pendiente:**
- Procesamiento de audio: tomar las llamadas `PENDIENTE` una por una, ejecutar `analizar.py` con
  `execFile` y guardar el resultado según `docs/contrato_audio.md` (después de los PRs #8 y #9).
- `GET /api/v1/roles` (lo pidió Javier para el formulario de usuarios).

**Necesito de otros:**
- **David:** la v0.2 del contrato de audio con `hablante` y `score_sentimiento` por segmento, y los
  puntajes (`score_global_nlp`, `score_acustico`, `puntaje_final`, `clasificacion_final`,
  `diagnostico_conflicto`) en el primer nivel del JSON.
- **Javier:** fusionar el PR #11. El ejemplo `"88 dB"` de `docs/api.md` y de los datos simulados
  pasaría a dBFS (por ejemplo, `"-8.5 dBFS"`), según el contrato de audio.
- **Javier (detalles menores del PR #12, no bloquean):** `CargaLotes.jsx:297` deja de consultar con
  un 404 pero dice "Se reintentará automáticamente"; la pantalla consulta el lote cada 2 s sin fin
  mientras las llamadas sigan en `PENDIENTE` (límite: 1000 peticiones / 15 min por IP).
- **Equipo:** decidir si el SuperAdmin también puede subir lotes. Con los permisos iniciales solo
  lee `CARGA_LOTES`, así que solo el Supervisor puede subir. Si se decide que sí, lo cambio con
  un script `database/04_...sql`.
- **Javier:** para probar la pantalla de carga con la API real hay que iniciar sesión como
  Supervisor con al menos un agente asignado. Cuando se fusione el PR #11, la asignación se hace
  con `PUT /usuarios/:id_usuario/supervisor`; mientras tanto, en phpMyAdmin (`TB_AsignacionSupervisor`).
- **David:** `ruta_audio_storage` es relativa a `backend/uploads/` (ej. `lotes/12/101.mp3`). Lo
  agregamos a `docs/contrato_audio.md`.
