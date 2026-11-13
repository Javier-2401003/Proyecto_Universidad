# Avance del proyecto

Cada integrante (o su Claude) actualiza **solo su propia sección** al terminar una
sesión de trabajo. Las secciones "Estado general" y "Acuerdos" se cambian en reunión.

## Estado general
Avance aproximado: **75-80 %** (11/11/2026).

| Parte | Responsable | Estado |
|---|---|---|
| Base de datos (12 tablas, roles, módulos, permisos) | - | Hecho |
| Autenticación JWT, RBAC y auditoría | - | Hecho |
| Gestión de usuarios (crear, editar, desactivar, asignar supervisor) | Willy y Javier | Hecho |
| Carga de audios por lotes | Willy y Javier | Hecho |
| Análisis de audio v0.3 (Whisper, sentimiento, puntaje, hablante, alertas) | David | Hecho; falta calibrar con llamadas reales |
| Procesamiento en el backend (análisis automático, alertas en `TB_Alerta`) | Willy | Hecho; probado de punta a punta el 06/11 (laptop de David, sin alertas) y el 10/11 (laptop de Willy, v0.3 con alertas: 10 llamadas `COMPLETADO`) |
| Inicio con estadísticas, detalle de llamada, panel del agente, búsqueda histórica, auditoría | Javier (endpoints de Willy) | Hecho |
| Dashboard en tiempo real | Javier y Willy | Por definir (Blueprint) |
| Reportes | Javier y Willy | Por definir (Blueprint) |

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
  - `docs/contrato_audio.md` (David y Willy): cómo llama Node a Python y el JSON que devuelve. En `main`
    la **v0.3** (con alertas).
- Guía para instalar y probar la demo en cualquier computadora: `docs/demo.md`.
- **Decisiones del 11/11/2026** (sobre el análisis de audio; ver `docs/contrato_audio.md`, "Por
  aprobar" y "Para revisar con llamadas reales"):
  1. **RN-02 y RN-03 se apartan del Blueprint, y se acepta así:** una subida de volumen cuenta si
     llega al 180 % durante 2 s (el Blueprint dice 150 % durante 1,5 s), y la alerta roja exige además
     texto negativo. El motivo es bajar las falsas alarmas; se explica en el informe.
  2. **Cortes de clasificación 35 y 65:** se quedan, de forma provisional, hasta medir con llamadas reales.
  3. **`puntaje_final` se reescala para usar de 0 a 100.** Hoy el máximo es 77,5 porque `score_acustico`
     nunca es positivo. **David** propone cómo en un PR al contrato, que revisa Willy. El campo sigue
     siendo de 0 a 100, así que el backend y el frontend no cambian.
  4. **Las palabras de cancelación o amenaza y los gritos pesan más que las de cortesía.** Un cliente
     que grita y amenaza con cancelar debe salir `NEGATIVO` o `CRITICO`, aunque diga "gracias" (hoy
     sale `NEUTRO`, 39,8). Lo ajusta **David**.
  5. **Solo el Supervisor sube lotes;** el SuperAdmin sigue solo consultando `CARGA_LOTES`. No hace
     falta el script `database/04_...sql`.

---

## Javier - Frontend
_Última actualización: 11/11/2026_

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

**Dashboard en Tiempo Real** (11/11/2026, rama `javier-dashboard`): se actualiza solo cada 10 s con
`GET /llamadas` (sin WebSocket ni endpoints nuevos). Muestra lo que se está analizando y lo de hoy:
indicadores, "Requieren atención", cola de análisis, sentimiento y tabla; aviso con sonido ante una
crítica nueva y estado de conexión. Decidido priorizar lo que ya tenemos sobre la guía de Dashboard
y Reportes del Blueprint (no hay llamadas en vivo).

**Reportes** (11/11/2026, rama `javier-reportes`): resumen ejecutivo, desempeño por agente (índice
de calidad sin las llamadas de cliente problemático), tendencia semanal y llamadas críticas, con
filtros de fechas y agente. Descarga CSV y PDF (impresión del navegador). También sin endpoints
nuevos: junta las llamadas con `GET /llamadas`. Con esto **ningún módulo queda "En construcción"**.

**En curso:** -

**Pendiente:** registrar en la auditoría la descarga de reportes (necesitaría un endpoint de
exportación en el backend; opcional).

**Necesito de otros:**
- Willy y David: probar de punta a punta con audios reales ahora que el #15 está en `main`, para
  ver resultados reales en la carga de lotes, el detalle y el inicio.

---

## David - Procesamiento de audio
_Última actualización: 12/11/2026_

**Objetivo para la próxima reunión**
- [x] `audio-processing/README.md` con la instalación (Python, ffmpeg, dependencias).
- [x] `python analizar.py ruta_del_audio` que imprima un JSON: transcripción con tiempos, tono (F0), volumen (RMS), duración.
- [x] Tiempo de un audio de 3 a 5 min con los modelos `base` y `small`.
- [x] Borrador de `docs/contrato_audio.md`.

**Diagnóstico corregido:** dos casos culpaban al agente sin razón.
- Gritos (07/11, PR #43, en `main`): un grito se le atribuía a cualquiera cuyo turno rozara, aunque
  fuera 0,2 s. Ahora cuenta para quien más tiempo habla dentro del grito, igual que `origen_evento` en
  la v0.3.
- Palabras repetidas (10/11, PR #45, en `main`): "Dejo registrada su queja y su
  solicitud de cancelación" daba `FALLA_AGENTE`. Ahora al agente no le cuentan las palabras negativas
  que el cliente ya dijo antes, de la misma familia ("cancelar" y "cancelación"). Solo cambia el
  diagnóstico, no el puntaje.
- Con 15 llamadas armadas de call center y 2 más que repiten palabras, las que fallaban pasan a
  `CLIENTE_PROBLEMATICO` y el resto no cambia; 79 pruebas pasando.

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

**v0.3 (alertas):**
- Contrato v0.3 (PR #41): Willy lo aprobó y lo fusionó el 10/11. Arreglo `alertas` con los valores
  exactos de `TB_Alerta`: `EXCESO_VOLUMEN`, `ALTERACION_TONO` por hablante y `VOCABULARIO_INADECUADO`,
  provisionales igual que la lista de palabras y los mensajes. `OMISION_SCRIPT` queda para cuando el
  equipo defina el guion. El backend ya guarda las alertas (PR #44 de Willy).
- Implementación (PR #42): `analizar.py` emite la v0.3. Con audio: el grito armado da 1
  `EXCESO_VOLUMEN` del cliente, la conversación tranquila ninguna, y la llamada real ninguna (daba 7
  `ALTERACION_TONO` falsas por errores de octava de `pyin`, que ahora se descartan). Probado junto con
  los PRs #43 y #45: 92 pruebas pasando, y en las llamadas armadas el origen de cada alerta coincide
  con el diagnóstico.

**Primera llamada real con conflicto (10/11, PR #51, en `main`):** una llamada de soporte
técnico descargada de internet (8 min 56 s) en la que la clienta grita e insulta casi todo el tiempo.
- Antes salía `NEUTRO` 42,7 sin alertas de la clienta: 17 frases con groserías daban 0 y no hubo ningún
  `EXCESO_VOLUMEN`. Además salieron 3 `ALTERACION_TONO` falsas del agente.
- Amplié el léxico (conjugaciones como "cancelaron", "falta de respeto") y la lista provisional de
  groserías, que ahora también restan en el sentimiento, sin que la negación las invierta ("no sea
  tonto"). Ahora: texto -0,43, puntaje 35,35 y 10 `VOCABULARIO_INADECUADO` de la clienta. Sigue `NEUTRO`
  por 0,35 puntos, porque el volumen no ayuda (ver Pendiente).
- Las 17 llamadas armadas dan lo mismo que antes y otra llamada descargada (un sketch irónico, sin
  gritos) sigue `NEUTRO` sin alertas; 97 pruebas pasando.

**Decisión 4 del 11/11 (PR #52, en `main`): cancelación, amenazas y gritos pesan más que la
cortesía.**
- Texto: la cancelación y las amenazas (lista `graves` de `lexico_es.json`) y todo el vocabulario
  inadecuado valen -1,0, el doble que "gracias" o "con gusto". Negadas valen lo normal: "no quiero
  cancelar" sigue en +0,5. No cambia el contrato: el global sigue siendo el promedio de las frases.
- Voz: cada tramo de grito sostenido cuenta doble en `score_acustico`; los cambios de tono, que también
  salen en llamadas tranquilas, cuentan una vez.
- Con 27 llamadas (las 17 armadas, la de la decisión y la tranquila de la prueba del 06/11, 5 de la demo
  y 3 descargadas): 27 en la clase esperada, antes 24. El cliente que grita y amenaza con cancelar pasa
  de `NEUTRO` 39,8 a `NEGATIVO` 33,3 (`CLIENTE_PROBLEMATICO`), y la llamada real con insultos, de
  `NEUTRO` 35,4 a `NEGATIVO` 24,4. Las positivas y neutras no cambian. 103 pruebas pasando.
- No llega a `CRITICO`: su texto queda en -0,20 y el contrato pide menos de -0,3. La decisión acepta
  `NEGATIVO`.

**En curso: decisión 3 del 11/11, contrato v0.4 (rama `david-contrato-v04`, espera revisión de Willy).**
`puntaje_final` usa de 0 a 100: el lado positivo se estira (`50 + 50 × combinado / 0,55`) y el negativo
queda igual. Con 27 llamadas: la positiva de la prueba de Willy pasa a `POSITIVO` (72,5), 7 llamadas
cambian de `NEUTRO` a `POSITIVO` y ninguna negativa cambia. Efecto a decidir: 4 de esas 7 son consultas
neutras que terminan con "gracias"; el contrato deja una alternativa en curva que no las cambia. La
implementación va en otro PR cuando se apruebe.

**Pendiente:**
- **Ruido (prueba de Willy del 10/11):** con ruido de calle, Whisper degrada el texto, los `hablante`
  salen cruzados (13 `AGENTE` contra 6 `CLIENTE` en una llamada pareja) y `baja_confianza_audio` queda en
  `false`.
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
  ver con llamadas reales si alguna vez se dispara. En la llamada real con conflicto dio 3 alertas
  falsas al agente: quedan errores de octava y ventanas con la voz de la clienta.
- **Gritos sostenidos:** si el cliente grita casi toda la llamada, RN-02 no lo detecta, porque compara con
  el promedio de los 30 s anteriores, que ya es su grito. En la llamada real la clienta hablaba unos 8 dB
  más fuerte que el agente y no hubo ningún `EXCESO_VOLUMEN`. Arreglarlo cambia RN-02 (ver "Necesito").

**Necesito de otros:**
- Willy: revisar el contrato v0.4 (escala de `puntaje_final`) y elegir entre la fórmula propuesta y la
  alternativa en curva. Y tu grabación de 52 s (por fuera de GitHub, como dijiste), para el umbral de
  baja confianza.
- Javier: si se aprueba la v0.4, los datos simulados del frontend (`simulacion/listado.js`) pueden
  llevar las positivas hasta 100.
- Willy o Javier: correr `analizar.py` con `base` en su laptop y anotar cuánto tarda, para medir en la
  más lenta del equipo.
- Equipo: definir el guion obligatorio para `OMISION_SCRIPT` (por ejemplo, saludo, identificación y
  despedida).
- Equipo: decidir cómo detectar a un cliente que grita casi toda la llamada (cambia RN-02); propongo
  comparar su volumen con el del agente. Lo de RN-02, RN-03 y los cortes 35 y 65 ya quedó decidido el 11/11.

---

## Willy - Backend
_Última actualización: 10/11/2026_

**Objetivo para la próxima reunión**
- [x] Carga de lotes, gestión de usuarios, detalle de llamada, estadísticas, roles y procesamiento de audio (PRs #7, #11, #13, #15 a #18, fusionados).
- [x] Auditoría: contrato (PR #29) y `GET /auditoria` (PR #36).
- [x] Listado de llamadas: revisión del contrato de Javier (PR #30) y `GET /llamadas` (PR #37).
- [x] Alertas: revisar la v0.3 del contrato (PR #41) y guardarlas en `TB_Alerta` (PR #44).
- [x] Prueba de punta a punta con el `analizar.py` real (10/11, abajo).

**Hecho:**
- Carga de lotes (PR #7). Usa `multer` (MIT): después de `git pull` hay que correr `npm install` en
  `backend/`. Los audios quedan en `backend/uploads/lotes/<id_lote>/`.
- `GET /llamadas/:id_llamada` y `/audio` (PR #13), `GET /estadisticas/resumen` (PR #16) y `GET /llamadas`
  (PR #37). Los tres tienen la misma visibilidad, sin módulo de permisos: el Agente ve sus llamadas, el
  Supervisor las de sus agentes asignados y el SuperAdmin todas.
- `GET /auditoria` (PR #36), con `AUDITORIA` leer. Del usuario solo devuelve id, nombre y correo.
  `src/listados.js` reúne la paginación y las fechas de los dos listados.
- `GET /roles` (PR #17), con `GESTION_USUARIOS` leer.
- Procesamiento de audio (PR #15). Una llamada a la vez con `execFile`, según `docs/contrato_audio.md`.
  Si `AUDIO_PYTHON` o `AUDIO_SCRIPT` de `backend/.env` faltan o no existen, no arranca y las llamadas
  siguen en `PENDIENTE`.
- Alertas de la v0.3 en `TB_Alerta` (PR #44). Si una alerta no es válida, la llamada queda en `ERROR`
  con `CONTRATO_INCOMPLETO` (decisión de la sección 6 del contrato). Un reproceso no las duplica.
- Revisiones: contrato v0.2 (PRs #21 y #32), v0.3 (PR #41) y decisiones del 11/11 (PR #46).
- Regla de `CLAUDE.md` (PR #24): el autor puede fusionar su propio PR si solo toca su área.
- `npm test` en `backend/`: 135 pruebas pasando con MySQL real.

**Prueba de punta a punta (10/11, en mi laptop, `main` con la v0.3):** venv de `audio-processing/` con
Python 3.13 (606 MB) y modelo `base`. Usé 5 llamadas armadas con voces de Windows, de 72 a 89 s: el
agente con la voz de Raúl y la cliente con la de Sabina. **No son llamadas humanas.** Creé un Supervisor
y un Agente por la API, los asigné y subí el lote como Supervisor. El backend las procesó solo, junto
con las 5 que seguían `PENDIENTE` del lote 6. **Las 10 quedaron `COMPLETADO` y los dos lotes se
cerraron, sin ningún `ERROR`.** El análisis tardó de 22 a 36 s por llamada.

| Llamada | Resultado | ¿Tiene sentido? |
|---|---|---|
| Positiva ("excelente", "muchas gracias, fue muy amable") | `NEUTRO`, 62,36 | No llega a `POSITIVO` (máximo 77,5): decisión 3 del 11/11 |
| Neutra (cambio de dirección) | `NEUTRO`, 62,04 | Sí |
| Cliente grita, dice "estafa" y "ladrones", quiere cancelar | `CRITICO`, 19,02; 2 `EXCESO_VOLUMEN` y 2 `VOCABULARIO_INADECUADO` del cliente | Sí, salvo el diagnóstico `FALLA_AGENTE` (ver David) |
| Agente grosero ("no sea tonta") | `NEGATIVO`, 34,14, `FALLA_AGENTE`; alerta de vocabulario del agente | Sí |
| Con ruido de calle | `NEUTRO`, 63,75, sin baja confianza | No (ver David) |

En las 4 llamadas sin ruido, la transcripción y el `hablante` salieron casi perfectos (13 a 27 segmentos).
Solo hubo detalles menores, como "Telecomandina" o "señor a Torres".

**En curso:** -

**Pendiente:**
- Dashboard en tiempo real y Reportes: definir el contrato con Javier (están "Por definir").
- Endpoint para cambiar la contraseña (`docs/api.md` lo deja "para un endpoint propio").
- Repetir la prueba con llamadas humanas reales cuando el equipo las tenga.

**Necesito de otros:**
- **David** (de la prueba del 10/11):
  - **Diagnóstico:** en la llamada del cliente que grita sale `FALLA_AGENTE` porque el agente dice
    "voy a registrar su **queja**" (-0,5). Debería ser `CLIENTE_PROBLEMATICO`; parece lo que corrige tu
    PR #45.
  - **Ruido:** con ruido de calle, Whisper degrada el texto ("Buenas noches de recorrandito a la Lama")
    y la mayoría de los `hablante` salen cruzados: 13 `AGENTE` contra 6 `CLIENTE` en una llamada
    pareja. Además, `baja_confianza_audio` queda en `false`.
  - **Puntaje:** la llamada positiva confirma que hace falta reescalar `puntaje_final` (decisión 3).
  - Te paso mi grabación de 52 s por fuera de GitHub, para el umbral de baja confianza.
- **Javier:** qué necesita el Dashboard en tiempo real y los Reportes, para proponer los contratos.
- **Usuarios de la prueba:** `sup.real.9d2bec@prueba.test` (Supervisor) y `age.real.9d2bec@prueba.test`
  (Agente), solo en mi MySQL local. Las contraseñas están en mi `backend/.env`.
