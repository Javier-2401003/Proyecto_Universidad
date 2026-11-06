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
_Última actualización: 03/11/2026_

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

Rama `claude/elegant-newton-m1b3dj`: **estadísticas en la página de inicio** (pedido del
03/11/2026): indicadores (llamadas, analizadas, puntaje promedio, alertas), llamadas por
estado, sentimiento, alertas por tipo y tabla por agente, con periodo de 7, 30 o 90 días.
Contrato propuesto en `docs/api.md` ("Estadísticas del inicio", `GET /estadisticas/resumen`).

Arreglos que pidió Willy (03/11/2026): la carga de lotes consulta el estado cada 2 s el primer
minuto y luego cada 10 s, y se detiene a los 30 minutos con un botón "Actualizar" (antes
consultaba cada 2 s sin fin); el aviso "Se reintentará automáticamente" ya no sale cuando la
consulta se detuvo. El volumen pasó a **dBFS** en `docs/api.md` y en los datos simulados.

**Carga de lotes y detalle de llamada ya usan el backend real** (03/11/2026): probado de punta
a punta con MySQL 8 (subida de 5 audios, estados, detalle y audio original). Las llamadas quedan
en Pendiente hasta que el backend ejecute el análisis; para una demo con resultados está
`VITE_SIMULAR_LLAMADAS=true`.

**Estadísticas del inicio con datos reales** (06/11/2026): `GET /estadisticas/resumen` (PR #16)
ya está en `main`, así que `VITE_SIMULAR_ESTADISTICAS` pasó a `false` por defecto. Probado con el
backend real como SuperAdmin, Supervisor y Agente.

**Gestión de usuarios completa** (06/11/2026, rama `javier-gestion-usuarios`): editar nombre,
correo y rol; activar o desactivar (con confirmación); asignar o quitar supervisor (al editar o al
crear un agente); roles desde `GET /roles`. Respeta las reglas del contrato: nadie cambia su propio
rol ni se desactiva a sí mismo, solo se envían los campos que cambian, y un agente cuyo supervisor
está desactivado se marca para reasignarlo. Probado con el backend real (incluida la auditoría).

**En curso:** -

**Necesito de otros:**
- Willy y David: probar de punta a punta con audios reales ahora que el #15 está en `main`, para
  ver resultados reales en la carga de lotes, el detalle y el inicio.
- `docs/demo.md` dice que las estadísticas del inicio son de ejemplo y que el supervisor se asigna
  en phpMyAdmin: ya no es así. Es un archivo compartido; lo corrijo en un PR aparte con revisión.

---

## David - Procesamiento de audio
_Última actualización: 03/11/2026_

**Objetivo para la próxima reunión**
- [x] `audio-processing/README.md` con la instalación (Python, ffmpeg, dependencias).
- [x] `python analizar.py ruta_del_audio` que imprima un JSON: transcripción con tiempos, tono (F0), volumen (RMS), duración.
- [x] Tiempo de un audio de 3 a 5 min con los modelos `base` y `small`.
- [x] Borrador de `docs/contrato_audio.md`.

**Hecho:** rama `david-audio-base`: `analizar.py` (faster-whisper en CPU + librosa) imprime
solo un JSON por stdout; errores en JSON con código de salida 1. Python **3.12** o 3.13 (Willy probó
3.13.5); no hace falta instalar ffmpeg (PyAV lo trae). Con un audio de 4,5 min
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
Rama `david-score-acustico` (sale de la anterior): `score_acustico` según RN-02 (`acustico.py`,
`reglas_acusticas.json`), más `puntaje_final` y `clasificacion_final`, 43 pruebas pasando.
Recalibrado por falsas alarmas: filtro y normalización antes del RMS, 180 % durante 2 s seguidos, y
la alerta roja exige también texto negativo. Una asesoría que parece tranquila pasó de -0,304 a -0,128
y queda `NEUTRO`. Los valores están en `reglas_acusticas.json`, y la comparación, en el README.
Rama `david-notas-revision`: notas de Willy del PR #8. Un archivo de 0 bytes da `AUDIO_VACIO`, README
con Python 3.13, faster-whisper en `docs/herramientas.md`, y umbral de `baja_confianza_audio` en -1,5,
provisional.
Rama `david-analizar-v02` (sale de `david-score-acustico` y trae las notas): `analizar.py` emite la
**v0.2** con `hablante` y `diagnostico_conflicto`, 66 pruebas pasando. La diarización es local y sin
PyTorch: por canales o por timbre y tono. Con voces sintéticas acierta de 90 a 99 %, y 56,5 % con voces
casi iguales. En llamadas reales espero de 65 a 85 %, sin medir. Rama `david-contrato-v02`: contrato v0.2.
PR #14 de Javier revisado en lo del volumen: el dBFS de `docs/api.md` coincide con el contrato.

**En curso:** -

**Pendiente:**
- Medir la diarización con llamadas reales etiquetadas y usar `hablante` en el promedio móvil de RN-02.
- `diagnostico_conflicto` todavía no revisa si el agente omitió el script o interrumpió.
- Medir con gritos reales: el Blueprint pide 88 % sobre 50 muestras y la recalibración bajó la
  sensibilidad. Un grito simulado de 3 s al doble de volumen se detecta en 6 de 12 posiciones.
- Investigar por qué Whisper casi no transcribió a quien llama en una llamada real de 4 min 44 s
  y repetir la prueba con una muestra de call center (el léxico aún no tiene precisión medida).
- Rendimiento: Willy midió 66-87 s con `base` para una grabación real de 52 s, mucho más que en mi
  laptop. Repetir las medidas con llamadas reales en la laptop más lenta del equipo.
- Recalibrar `baja_confianza_audio` con grabaciones reales (hoy sale de un audio con ruido agregado).
- Orden de fusión: PR #9, léxico, `david-score-acustico`, notas, contrato v0.2 y `david-analizar-v02`.
- v0.3: alertas de volumen y tono.

**Necesito de otros:**
- Willy: revisar en el PR #9 la regla para audios sin voz (sección 5 del contrato) y compartir su
  grabación de 52 s, para investigar la baja confianza.
- Willy o Javier: revisar los PRs del léxico, `david-score-acustico`, notas y `david-analizar-v02`.
- Willy: revisar y aprobar el contrato v0.2. Cambia el criterio de `baja_confianza_audio`.
- Equipo: confirmar que RN-02 y RN-03 se apartan del Blueprint: 180 % durante 2 s en lugar de 150 %
  durante 1,5 s, y alerta roja solo con texto negativo. También acordar los cortes provisionales de
  `clasificacion_final` (35 y 65; alerta roja = `CRITICO`) y si `score_acustico` puede ser positivo:
  hoy nunca lo es, así que `puntaje_final` llega a 77,5 como máximo.

---

## Willy - Backend
_Última actualización: 05/11/2026_

**Objetivo para la próxima reunión**
- [x] Carga de audios por lotes: `GET /agentes`, `POST /llamadas/lotes` y `GET /llamadas/lotes/:id_lote` (PR #7, fusionado).
- [x] Gestión de usuarios: editar, desactivar y asignar supervisor (PR #11, fusionado).
- [x] Detalle de una llamada: `GET /llamadas/:id_llamada` y `/audio` (PR #13, fusionado).
- [x] Estadísticas del inicio: `GET /estadisticas/resumen` (PR #16, fusionado).
- [x] Roles: `GET /roles` (PR #17) y su contrato en `docs/api.md` (PR #18), fusionados.
- [x] Revisar el contrato de audio v0.1 (PR #9) y v0.2 (PR #21).
- [x] Procesamiento de audio en el backend (PR #15, fusionado).

**Hecho:**
- Carga de lotes (PR #7). Usa `multer` (MIT): después de `git pull` hay que correr `npm install` en
  `backend/`. Los audios quedan en `backend/uploads/lotes/<id_lote>/`.
- `GET /api/v1/llamadas/:id_llamada` y `/audio` (PR #13). Sin módulo de permisos: el agente ve sus
  llamadas, el supervisor las de sus agentes asignados y el SuperAdmin todas; si no puede verla, `404`.
- `GET /api/v1/estadisticas/resumen` (PR #16), con la misma visibilidad que el detalle. Javier ya puede
  poner `VITE_SIMULAR_ESTADISTICAS=false`.
- `GET /api/v1/roles` (PR #17), con `GESTION_USUARIOS` leer; documentado en `docs/api.md` (PR #18).
- PR #11: los correos de `tests/usuarios.test.js` usan el prefijo `test.usr.` para no chocar con otros
  archivos de prueba (10 de 10 corridas pasando).
- Contrato v0.2 (PR #21): aprobado en un comentario del PR. Es compatible con el PR #15: su ejemplo y
  el caso sin voz quedan `COMPLETADO` en el código real. Las reglas de puntaje quedan como provisionales.
- Procesamiento de audio en `main` (PR #15: `src/procesamientoAudio.js`, `tests/procesamiento.test.js`,
  sin Python). Una llamada a la vez con `execFile`, según `docs/contrato_audio.md`. Si `AUDIO_PYTHON` o
  `AUDIO_SCRIPT` de `backend/.env` faltan o no existen, no arranca y las llamadas siguen en `PENDIENTE`
  (ver `backend/.env.example`). Solo está probado con un ejecutable falso.
- Regla nueva en `CLAUDE.md` (PR #24): el autor puede fusionar su propio PR si solo toca su área.

**En curso:** -

**Pendiente:**
- Probar el procesamiento con el `analizar.py` real (hay que instalar el venv de `audio-processing/`).
- Guardar `TB_Alerta` cuando David entregue la v0.3.

**Necesito de otros:**
- **Quien tenga el venv de audio:** iniciar el backend con `AUDIO_PYTHON` y `AUDIO_SCRIPT` en su `.env` y
  avisarme si alguna llamada queda en `ERROR` (con su `mensaje_error`).
- **David** (detalle en el comentario del PR #21; no bloquean):
  - En la v0.3, usar los valores de `TB_Alerta.tipo_alerta` (`EXCESO_VOLUMEN`, no `ELEVACION_VOLUMEN`).
  - Anotar en el contrato los mensajes propios del backend y el timeout de 3600 s.
  - `json.dumps(..., allow_nan=False)` en `analizar.py`.
  - Cambiar el estado del contrato a "aprobada".
- **Equipo:** decidir si el SuperAdmin también puede subir lotes. Con los permisos iniciales solo
  lee `CARGA_LOTES`, así que solo el Supervisor puede subir. Si se decide que sí, lo cambio con
  un script `database/04_...sql`.
