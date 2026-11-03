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
  - `docs/contrato_audio.md` (David y Willy): pendiente. Cómo llama Node a Python y el JSON que devuelve.

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

**En curso:** -

**Necesito de otros:**
- Willy: endpoints para editar, desactivar y asignar supervisor (para completar Gestión de usuarios),
  y `docs/api.md` con los endpoints de carga de lotes.
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
faster-whisper. Detalle en `audio-processing/README.md`. Willy aprobó el PR #8 el 02/11; falta fusionar.
Rama `david-contrato-audio` (PR #9): `docs/contrato_audio.md` v0.1 con las decisiones de Willy:
ruta absoluta del audio, variables de `.env`, dBFS y los campos de la v0.2. Python calcula también
el puntaje final, la clasificación y el diagnóstico. Si faltan campos de la v0.2, el backend deja
la llamada en `ERROR` con `CONTRATO_INCOMPLETO`. Willy lo aprobó el 02/11; el 03/11 agregué la regla
para audios sin voz, que él aún no ha revisado.
Rama `david-lexico-sentimiento`: `score_sentimiento` por segmento y `score_global_nlp` con un
léxico según RN-01 (`lexico.py`, `lexico_es.json`), 13 pruebas pasando. RN-01 no define la
fórmula; la decisión del proyecto está en `audio-processing/README.md`.
Rama `david-score-acustico` (sale de la anterior): `score_acustico` según RN-02 (`acustico.py`,
`reglas_acusticas.json`), más `puntaje_final` y `clasificacion_final`, 43 pruebas pasando.
Recalibrado por falsas alarmas: filtro y normalización antes del RMS, 180 % durante 2 s seguidos, y
la alerta roja exige también texto negativo. Una asesoría que parece tranquila pasó de -0,304 a -0,128
y queda `NEUTRO`. Los valores están en `reglas_acusticas.json`, y la comparación, en el README.

**En curso:** -

**Pendiente:**
- `hablante`: diarización sin PyTorch. Es lo que más urge: sin esto `analizar.py` sigue en la v0.1
  y el baseline de RN-02 mezcla las dos voces.
- `diagnostico_conflicto`.
- Medir con gritos reales: el Blueprint pide 88 % sobre 50 muestras y la recalibración bajó la
  sensibilidad. Un grito simulado de 3 s al doble de volumen se detecta en 6 de 12 posiciones.
- Actualizar `docs/contrato_audio.md` en un PR propio: nuevo criterio de `baja_confianza_audio`,
  puntaje con 100 % texto en E1, y `puntaje_final` y `clasificacion_final` ya emitidos.
- Investigar por qué Whisper casi no transcribió a quien llama en una llamada real de 4 min 44 s
  y repetir la prueba con una muestra de call center (el léxico aún no tiene precisión medida).
- Rendimiento: Willy midió 66-87 s con `base` para una grabación real de 52 s, mucho más que en mi
  laptop. Repetir las medidas con llamadas reales en la laptop más lenta del equipo.
- Revisar el umbral de `baja_confianza_audio`: esa grabación dio `true` (-1,142).
- Notas de Willy en el PR #8: un archivo de 0 bytes devuelve `AUDIO_ILEGIBLE`, no `AUDIO_VACIO`, y
  el README puede aclarar que Python 3.13.5 también funcionó.
- Abrir el PR de `david-lexico-sentimiento` cuando el PR #8 esté en `main`.
- v0.3: alertas de volumen y tono.

**Necesito de otros:**
- Willy: revisar en el PR #9 la regla para audios sin voz (sección 5 del contrato) y compartir su
  grabación de 52 s, para investigar la baja confianza.
- Javier: dar su revisión de los PRs #8 y #9, o acordar que se fusionen con la aprobación de Willy.
  El procesamiento en el backend depende de ellos.
- Javier: confirmar el sentido del odómetro. El Blueprint se contradice: en las páginas 7 y 9,
  100 es bueno y de 0 a 30 es rojo; en la 32, conflicto "ALTO" tiene 78,5 puntos. Propongo seguir
  las páginas 7 y 9, con `puntaje_final = (combinado + 1) × 50`.
- Equipo: confirmar que RN-02 y RN-03 se apartan del Blueprint: 180 % durante 2 s en lugar de 150 %
  durante 1,5 s, y alerta roja solo con texto negativo. También acordar los cortes provisionales de
  `clasificacion_final` (35 y 65; alerta roja = `CRITICO`) y si `score_acustico` puede ser positivo:
  hoy nunca lo es, así que `puntaje_final` llega a 77,5 como máximo.
- Reunión: agregar faster-whisper (MIT, gratis) a `docs/herramientas.md`, y aclarar ahí que
  ffmpeg ya no hay que instalarlo aparte.

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
