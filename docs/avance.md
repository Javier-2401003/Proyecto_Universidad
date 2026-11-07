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

**Panel del Agente** (07/11/2026, rama `javier-panel-agente`): resumen de los últimos 30 días
(estadísticas reales) y "Mis llamadas" con filtros por estado y clasificación y paginación.
La lista usa datos simulados (`VITE_SIMULAR_LISTADO`) hasta que exista `GET /llamadas`, cuyo
contrato propuse en el PR #30. `Indicador` pasó a `src/componentes/` para usarlo en el inicio y
en el panel.

**Búsqueda histórica** (07/11/2026, rama `javier-busqueda-historica`): filtros por fechas, agente,
estado, clasificación, diagnóstico y nombre de archivo, con paginación y los filtros en la dirección.
Comparte la tabla con el Panel del Agente (`src/componentes/ListaLlamadas.jsx`). También quité del inicio las tarjetas de módulos, que
repetían el menú lateral (lo pidió Willy).

**Listado con datos reales** (07/11/2026): `GET /llamadas` ya está en `main` (PR #37), así que
`VITE_SIMULAR_LISTADO` pasó a `false`. El Panel del Agente y la Búsqueda histórica usan el backend
real; probado con MySQL 8, incluido el enlace al detalle.

**Registro de auditoría** (07/11/2026, rama `javier-auditoria`): filtros por usuario, acción,
módulo y fechas, con paginación; cada registro se muestra como una frase legible (nombres en lugar
de ids) y el análisis de una llamada enlaza a su detalle. Probado con `GET /auditoria` real (PR #36).

**En curso:** -

**Pendiente:** Dashboard en Tiempo Real y Reportes. Falta definir qué muestran (Blueprint) y sus
contratos.

**Necesito de otros:**
- Willy y David: probar de punta a punta con audios reales ahora que el #15 está en `main`, para
  ver resultados reales en la carga de lotes, el detalle y el inicio.

---

## David - Procesamiento de audio
_Última actualización: 07/11/2026_

**Objetivo para la próxima reunión**
- [x] `audio-processing/README.md` con la instalación (Python, ffmpeg, dependencias).
- [x] `python analizar.py ruta_del_audio` que imprima un JSON: transcripción con tiempos, tono (F0), volumen (RMS), duración.
- [x] Tiempo de un audio de 3 a 5 min con los modelos `base` y `small`.
- [x] Borrador de `docs/contrato_audio.md`.

**Hecho (en `main`):** `analizar.py` emite la **v0.2** del contrato (PRs #8, #19, #20, #22 y #23):
transcripción con faster-whisper en CPU, `score_sentimiento` y `score_global_nlp` por léxico (RN-01),
`score_acustico` (RN-02), `puntaje_final`, `clasificacion_final`, `diagnostico_conflicto` y `hablante`
con una diarización local sin PyTorch. Python 3.12 o 3.13; no hace falta instalar ffmpeg. Con un audio
de 4,5 min en mi laptop, `base` tarda ~1 min. Contrato v0.1 y v0.2 en `main` (PRs #9 y #21); Willy
aprobó la v0.2 el 06/11 con la sección 7 como provisional. La salida real pasa el esquema del backend
del #15. Detalle de reglas, calibración y precisión en `audio-processing/README.md`. Los eventos usan
`EXCESO_VOLUMEN` (el valor de `TB_Alerta`) y la salida rechaza `NaN` (PR #35). Las notas de Willy sobre
el contrato v0.2 (estado, mensajes del backend, timeout 3600) están en `main` (PR #32).

**Prueba de punta a punta (06/11, en mi laptop, `main` en `188fff8`):** MySQL 8.4 de Wamp (puerto 3309,
sin modo estricto), base creada con `01` y `02`, backend con `npm start`. Como Supervisor subí un lote
de 5 audios por `POST /llamadas/lotes`. El backend los procesó solo con `analizar.py` (`base`) en
**206 s**, y las 5 llamadas quedaron `COMPLETADO` con sus filas en `TB_Transcripcion`, el lote
`COMPLETADO` y la auditoría `PROCESAMIENTO_LLAMADA`. También funcionan `GET /llamadas/:id`, el `/audio`
y la visibilidad del Agente. Las tildes se guardan bien (`utf8mb4`).

| Audio | Puntaje | Clasificación | `hablante` |
|---|---|---|---|
| Llamada real de radio (4 min 44 s) | 60,87 | NEUTRO | sin etiquetas |
| Sin voz (8 s) | 50 | NEUTRO, baja confianza, sin filas | - |
| Recorte de la llamada real (90 s) | 50 | NEUTRO | sin etiquetas |
| Conversación armada tranquila | 49,72 | NEUTRO | 99,7 % de acierto |
| Conversación armada, cliente grita (×3) y amenaza con cancelar | 39,8 | NEUTRO | 97,0 % de acierto |

Los audios "armados" usan voces de Windows, con hablante conocido; solo la llamada de radio es real.

**En curso: v0.3 (alertas).**
- PR #41, contrato v0.3 (espera revisión de Willy): arreglo `alertas` con los valores exactos de
  `TB_Alerta`. Detecta `EXCESO_VOLUMEN`, `ALTERACION_TONO` por hablante y `VOCABULARIO_INADECUADO`;
  `OMISION_SCRIPT` queda para cuando el equipo defina el guion. Incluye las dos precisiones de Willy
  del #32.
- Rama `david-alertas-v03`: la implementación, con 81 pruebas pasando. No se fusiona hasta que se
  apruebe el #41. Con audio: el grito armado da 1 `EXCESO_VOLUMEN` del cliente, la conversación tranquila
  ninguna, y la llamada real ninguna (daba 7 `ALTERACION_TONO` falsas por errores de octava de `pyin`,
  que ahora se descartan). La salida sigue pasando el esquema del #15.

**Pendiente:**
- **Calibración:** el cliente que grita y amenaza con cancelar sale `NEUTRO` (39,8): el texto queda en
  -0,1 porque se promedia con los "gracias", y `CRITICO` exige texto menor a -0,3. Hay que revisar los
  cortes y el promedio del léxico con llamadas reales.
- Repetir la prueba de punta a punta con llamadas reales de call center, junto con Willy y Javier.
- Medir `hablante` con llamadas reales etiquetadas (espero 65-85 % en mono, sin medir) y usarlo en el
  promedio móvil de RN-02.
- Medir con gritos reales: el Blueprint pide 88 % sobre 50 muestras y la recalibración bajó la
  sensibilidad.
- Recalibrar `baja_confianza_audio` con grabaciones reales, y revisar que con ruido el puntaje sube
  (usa solo el texto) y que `POSITIVO` exige `score_global_nlp` mayor a 0,545.
- Investigar por qué Whisper casi no transcribió a quien llama en una llamada real.
- `diagnostico_conflicto` todavía no revisa si el agente omitió el script o interrumpió.
- Mediciones con llamadas reales (tarea 3): tiempos con `base` en la laptop más lenta, acierto de
  `hablante`, detección de gritos y umbral de `baja_confianza_audio`. **Bloqueado:** no tengo llamadas
  reales de call center ni acceso a las otras laptops.
- `ALTERACION_TONO`: sin los errores de octava, el 40 % de RN-02 no se cumplió en ningún audio; hay que
  ver con llamadas reales si alguna vez se dispara.

**Necesito de otros:**
- Willy: revisar el PR #41 (contrato v0.3) y anotar aquí los fallos del análisis que encuentres en tu
  prueba con audios de call center. ¿Me compartes 3 o 4 de esos audios, y tu grabación de 52 s, para
  medir `hablante` y el umbral de confianza?
- Willy o Javier: correr `analizar.py` con `base` en su laptop y anotar cuánto tarda, para medir en la
  más lenta del equipo.
- Equipo: definir el guion obligatorio para `OMISION_SCRIPT` (por ejemplo, saludo, identificación y
  despedida).
- Equipo: confirmar que RN-02 y RN-03 se apartan del Blueprint (180 % durante 2 s en lugar de 150 %
  durante 1,5 s; alerta roja solo con texto negativo) y los cortes provisionales 35 y 65.

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
