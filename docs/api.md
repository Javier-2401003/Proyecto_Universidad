# API de VocalAnalytics

Contrato entre el backend (Willy) y el frontend (Javier). Si cambia un endpoint,
se actualiza este archivo en el mismo PR y se avisa al equipo.

## Reglas generales
- Base: `http://localhost:3000/api/v1`
- Autenticación: cabecera `Authorization: Bearer <token_acceso>` (el token dura 60 minutos).
- Errores, siempre con el mismo formato:
  ```json
  { "error": { "codigo": "DATOS_INVALIDOS", "mensaje": "Texto para mostrar.", "detalles": [ { "campo": "...", "mensaje": "..." } ] } }
  ```
  `detalles` es opcional. El frontend muestra `mensaje` y, si viene `detalles`, el error de cada campo.
- Errores comunes a todos los endpoints protegidos:
  - `401 NO_AUTENTICADO` / `401 TOKEN_INVALIDO`: falta el token, venció o el usuario fue desactivado.
  - `403 PROHIBIDO`: el usuario no tiene el permiso del módulo.
  - `500 ERROR_INTERNO`.

## Estado de cada endpoint
| Método y ruta | Permiso | Estado |
|---|---|---|
| `POST /auth/login` | - | Hecho |
| `GET /auth/me` | Sesión | Hecho |
| `GET /roles` | `GESTION_USUARIOS` leer | Hecho (PR #17) |
| `GET /usuarios` | `GESTION_USUARIOS` leer | Hecho |
| `POST /usuarios` | `GESTION_USUARIOS` escribir | Hecho |
| `PUT /usuarios/:id_usuario/supervisor` | `GESTION_USUARIOS` escribir | Hecho |
| `PATCH /usuarios/:id_usuario` | `GESTION_USUARIOS` escribir | Hecho |
| `PATCH /usuarios/:id_usuario/estado` | `GESTION_USUARIOS` escribir | Hecho |
| `GET /agentes` | `CARGA_LOTES` leer | Hecho |
| `POST /llamadas/lotes` | `CARGA_LOTES` escribir | Hecho |
| `GET /llamadas/lotes/:id_lote` | `CARGA_LOTES` leer | Hecho |
| `GET /llamadas/:id_llamada` | Sesión + visibilidad por rol | Hecho |
| `GET /llamadas/:id_llamada/audio` | Igual que el anterior | Hecho |
| `GET /estadisticas/resumen` | Sesión + visibilidad por rol | Hecho (PR #16) |
| `GET /llamadas` | Sesión + visibilidad por rol | Hecho (PR #37) |
| `GET /auditoria` | `AUDITORIA` leer | Hecho (PR #36) |

---

## Autenticación

### `POST /auth/login`
Cuerpo: `{ "correo_electronico": "...", "password": "..." }`

`200`:
```json
{
  "token_acceso": "eyJ...",
  "tipo_token": "Bearer",
  "expiracion_segundos": 3600,
  "usuario": { "id": 1, "nombre": "...", "roles": ["SUPERADMIN"], "permisos": [ ... ] }
}
```
Errores: `400 DATOS_INVALIDOS`, `401 CREDENCIALES_INVALIDAS`, `429 DEMASIADOS_INTENTOS`
(más de 10 intentos fallidos por IP en 15 minutos).

### `GET /auth/me`
`200`: `{ "id", "nombre", "correo", "roles": [...], "permisos": [...] }`

Cada permiso: `{ "modulo": "GESTION_USUARIOS", "nombre": "Gestion de Usuarios y Permisos", "leer": true, "escribir": true }`.
Solo incluye módulos activos. El frontend arma el menú con esta lista.

## Roles

### `GET /roles`
Roles que existen en `TB_Rol`, para el formulario de usuarios. El valor de `nombre_rol` es el
que se envía en el campo `rol` de `POST /usuarios`.

`200`: lista ordenada por `nombre_rol`:
```json
[ { "id_rol": 1, "nombre_rol": "AGENTE", "descripcion": "..." } ]
```
`descripcion` puede ser `null`. Solo tiene los errores comunes (`401`, `403 PROHIBIDO`, `500`).

## Usuarios

### `GET /usuarios`
`200`: lista de `{ "id_usuario", "nombre_completo", "correo_electronico", "estado": "ACTIVO" | "INACTIVO", "fecha_creacion", "roles": [...], "supervisor" }` (máximo 200).

`supervisor` (campo nuevo): `{ "id_usuario", "nombre_completo" }` del supervisor
asignado, o `null` si no tiene (siempre `null` para quien no es agente).

### `POST /usuarios`
Cuerpo: `{ "nombre_completo", "correo_electronico", "password" (8 a 72 bytes), "rol": "AGENTE" | "SUPERVISOR" | "SUPERADMIN" }`

`201`: `{ "id_usuario", "mensaje", "fecha_registro" }`

Errores: `400 DATOS_INVALIDOS`, `400 ROL_INEXISTENTE`, `409 CORREO_DUPLICADO`.

## Gestión de usuarios: supervisor, edición y estado

### Decisiones
1. **Un agente tiene como máximo un supervisor.** La tabla `TB_AsignacionSupervisor` permitiría
   varios, pero con uno solo es claro quién ve las llamadas de cada agente. Asignar uno nuevo
   reemplaza al anterior. Un supervisor puede tener muchos agentes.
2. **Cada usuario tiene un solo rol** (igual que en `POST /usuarios`). Editar el rol reemplaza el anterior.
3. **Nadie puede quitarse su propio rol ni desactivarse a sí mismo**, para que el SuperAdmin
   no se quede fuera del sistema por error.
4. **Desactivar no borra nada:** el usuario ya no puede iniciar sesión, sus tokens dejan de
   servir de inmediato y sus llamadas y asignaciones se conservan. Se puede reactivar.
5. Todo cambio queda en `TB_LogAuditoria` (módulo `GESTION_USUARIOS`), nunca con contraseñas.
6. Las tres rutas responden con el usuario actualizado, con la misma forma que cada elemento
   de `GET /usuarios`, para que el frontend reemplace la fila sin volver a pedir la lista.

Errores comunes a las tres: `400 DATOS_INVALIDOS` (`:id_usuario` no es un número o el cuerpo no
es válido) y `404 NO_ENCONTRADO` (el usuario no existe).

### `PUT /usuarios/:id_usuario/supervisor`
Asigna, cambia o quita el supervisor de un agente.

Cuerpo: `{ "id_supervisor": 5 }`, o `{ "id_supervisor": null }` para dejarlo sin supervisor.

`200`: el usuario actualizado (ver decisión 6), con `supervisor` lleno o `null`.

| Estado y código | Cuándo |
|---|---|
| `400 NO_ES_AGENTE` | El usuario de la ruta no tiene rol AGENTE. |
| `400 SUPERVISOR_INVALIDO` | `id_supervisor` no existe, no está activo o no tiene rol SUPERVISOR. |

Auditoría: `ASIGNACION_SUPERVISOR` con `{ id_agente, id_supervisor_anterior, id_supervisor_nuevo }`.
Si el supervisor ya era el mismo, responde `200` sin cambiar nada ni registrar auditoría.

### `PATCH /usuarios/:id_usuario`
Edita los datos de un usuario. Se envían solo los campos que cambian (al menos uno):

`{ "nombre_completo"?, "correo_electronico"?, "rol"?: "AGENTE" | "SUPERVISOR" | "SUPERADMIN" }`

La contraseña no se cambia aquí (quedará para un endpoint propio): si el cuerpo trae un
campo que no es uno de esos tres (por ejemplo `password`), responde `400 DATOS_INVALIDOS`.
El rol se acepta en mayúsculas o minúsculas y se guarda en mayúsculas; el correo, en minúsculas.

Al cambiar el rol se limpian las asignaciones que dejan de tener sentido: si deja de ser
AGENTE pierde su supervisor; si deja de ser SUPERVISOR, sus agentes quedan sin supervisor.

`200`: el usuario actualizado.

| Estado y código | Cuándo |
|---|---|
| `400 ROL_INEXISTENTE` | El rol no existe. |
| `400 OPERACION_NO_PERMITIDA` | El usuario intenta cambiar su propio rol. |
| `409 CORREO_DUPLICADO` | Otro usuario ya tiene ese correo. |

Auditoría: `EDICION_USUARIO` con `{ id_usuario, cambios: { <campo>: { anterior, nuevo } } }`
(solo los campos que de verdad cambiaron).

### `PATCH /usuarios/:id_usuario/estado`
Cuerpo: `{ "estado": "ACTIVO" | "INACTIVO" }`

`200`: el usuario actualizado.

| Estado y código | Cuándo |
|---|---|
| `400 OPERACION_NO_PERMITIDA` | El usuario intenta desactivarse a sí mismo. |

Auditoría: `CAMBIO_ESTADO_USUARIO` con `{ id_usuario, estado_anterior, estado_nuevo }`.

---

## Carga de audios por lotes

### Decisiones
1. **Un lote pertenece a un solo agente.** `TB_Llamada.id_agente` es obligatorio, así que
   quien carga el lote elige el agente que atendió esas llamadas. Si hay llamadas de
   varios agentes, se suben en lotes separados.
2. **Todo o nada.** Si un solo archivo no es válido (formato, tamaño o duplicado), se
   rechaza el lote completo y no se guarda nada. Así nunca queda un lote con una
   cantidad distinta de 5, 10 o 15.
3. **Formato del envío:** `multipart/form-data` (sugerido en el backend: `multer`, licencia MIT).
4. **Los límites se configuran en `backend/.env`** y el frontend repite los mismos valores
   para avisar antes de subir (el backend siempre vuelve a validar):
   - `LOTE_TAMANOS_PERMITIDOS=5,10,15`
   - `AUDIO_MAX_MB=25`
5. **El procesamiento es posterior.** El endpoint solo guarda los archivos y crea los
   registros en estado `PENDIENTE`; el análisis (Whisper, David) los toma después. El
   frontend consulta el avance con `GET /llamadas/lotes/:id_lote`.

### `GET /agentes`
Agentes a los que el usuario puede cargarles audios (para el selector de la pantalla).
- SuperAdmin: todos los agentes activos.
- Supervisor: solo los agentes asignados a él (`TB_AsignacionSupervisor`).

`200`: `[ { "id_usuario": 7, "nombre_completo": "Ana Torres", "correo_electronico": "ana@ejemplo.com" } ]`
ordenado por `nombre_completo`.

### `POST /llamadas/lotes`
`Content-Type: multipart/form-data` con estos campos:

| Campo | Tipo | Regla |
|---|---|---|
| `id_agente` | texto (número) | Obligatorio. Agente activo que el usuario puede ver en `GET /agentes`. |
| `audios` | archivo, **repetido una vez por audio** | Exactamente 5, 10 o 15 archivos. Extensión `.wav` o `.mp3` (sin importar mayúsculas) y contenido real WAV/MP3. Máximo 25 MB cada uno. |

Ejemplo con curl:
```
curl -X POST http://localhost:3000/api/v1/llamadas/lotes \
  -H "Authorization: Bearer <token>" \
  -F id_agente=7 -F audios=@llamada1.mp3 -F audios=@llamada2.wav ...
```

`201`:
```json
{
  "id_lote": 12,
  "codigo_lote": "LOTE-20261022-0012",
  "total_archivos": 5,
  "estado_lote": "PROCESANDO",
  "llamadas": [
    { "id_llamada": 101, "nombre_archivo_original": "llamada1.mp3", "estado_procesamiento": "PENDIENTE" }
  ]
}
```

Errores (en todos, no se guarda nada). Los errores de archivos traen un elemento en
`detalles` por archivo: `{ "campo": "audios", "archivo": "llamada3.ogg", "mensaje": "..." }`.

| Estado y código | Cuándo |
|---|---|
| `400 DATOS_INVALIDOS` | Falta `id_agente` o no es un número. |
| `400 AGENTE_INVALIDO` | El agente no existe, no está activo, no tiene rol AGENTE o el supervisor no lo tiene asignado. |
| `400 CANTIDAD_INVALIDA` | La cantidad de audios no es 5, 10 ni 15. El `mensaje` dice cuántos llegaron. |
| `400 FORMATO_NO_PERMITIDO` | Algún archivo no es WAV ni MP3. `detalles` por archivo. |
| `413 ARCHIVO_DEMASIADO_GRANDE` | Algún archivo supera 25 MB. `detalles` por archivo. |
| `409 AUDIO_DUPLICADO` | Algún archivo ya se había cargado antes (mismo SHA-256 en `TB_Llamada.hash_archivo`) o está repetido dentro del mismo lote. `detalles` por archivo, con `id_llamada_existente` cuando ya estaba en la base. |

Auditoría: `CARGA_LOTE` en `TB_LogAuditoria`, módulo `CARGA_LOTES`, con
`{ id_lote, id_agente, total_archivos }` en el detalle.

Los archivos se guardan en `backend/uploads/` (está en `.gitignore`); la ruta queda en
`TB_Llamada.ruta_audio_storage`.

Detalles de la implementación (no cambian el contrato, lo precisan):
- **Quién puede subir:** con los permisos iniciales (`02_datos_iniciales.sql`) solo el
  **Supervisor** tiene `CARGA_LOTES` escribir. El SuperAdmin puede ver `GET /agentes`, pero
  `POST /llamadas/lotes` le responde `403 PROHIBIDO`.
- **Orden de las validaciones:** `DATOS_INVALIDOS` → `AGENTE_INVALIDO` → `CANTIDAD_INVALIDA` →
  `FORMATO_NO_PERMITIDO` → `ARCHIVO_DEMASIADO_GRANDE` → `AUDIO_DUPLICADO`. Se responde solo
  el primer tipo de error que aparezca, con todos los archivos que lo tienen.
- **Formato:** el contenido debe coincidir con la extensión (un `.mp3` que en realidad es WAV
  se rechaza). Si los audios llegan en un campo distinto de `audios`, responde
  `400 DATOS_INVALIDOS` con ese campo en `detalles`.
- **Nombre original:** se conserva tal cual, con acentos y mayúsculas (máximo 255 caracteres).
- **Ruta en disco (para el procesamiento, David):** `ruta_audio_storage` es relativa a
  `backend/uploads/` y usa `/`, por ejemplo `lotes/12/101.mp3` (`lotes/<id_lote>/<id_llamada>.<ext>`).

### `GET /llamadas/lotes/:id_lote`
Estado del lote y de cada llamada, para mostrar el avance del procesamiento.

`200`:
```json
{
  "id_lote": 12,
  "codigo_lote": "LOTE-20261022-0012",
  "estado_lote": "PROCESANDO",
  "total_archivos": 5,
  "fecha_creacion": "2026-10-22T15:30:00.000Z",
  "agente": { "id_usuario": 7, "nombre_completo": "Ana Torres" },
  "llamadas": [
    { "id_llamada": 101, "nombre_archivo_original": "llamada1.mp3", "estado_procesamiento": "PENDIENTE", "mensaje_error": null }
  ]
}
```
`estado_procesamiento`: `PENDIENTE`, `PROCESANDO`, `COMPLETADO` o `ERROR` (con `mensaje_error`).

Errores: `404 NO_ENCONTRADO` si el lote no existe o el supervisor no tiene asignado a su agente.

Detalles de la implementación:
- El lote sigue visible aunque su agente se haya desactivado después de la carga.
- Mientras no exista el procesamiento automático (contrato de audio con David), las llamadas
  se quedan en `PENDIENTE` y el lote en `PROCESANDO`.

---

## Detalle de una llamada

Pantalla con el resultado del análisis: puntaje, clasificación, diagnóstico, alertas,
transcripción por hablante y mapa de sentimiento a lo largo de la llamada. Los nombres
de los campos son los mismos de las columnas de la base de datos.

### Quién puede ver una llamada
No depende de un módulo, sino de la relación con la llamada (si no puede verla, `404`,
para no revelar que existe):
- **Agente:** solo sus propias llamadas (`TB_Llamada.id_agente` = su id).
- **Supervisor:** las llamadas de los agentes que tiene asignados (`TB_AsignacionSupervisor`).
- **SuperAdmin:** todas.

### `GET /llamadas/:id_llamada`
`200`:
```json
{
  "id_llamada": 101,
  "id_lote": 12,
  "codigo_lote": "LOTE-20261022-0012",
  "nombre_archivo_original": "llamada1.mp3",
  "agente": { "id_usuario": 7, "nombre_completo": "Ana Torres" },
  "id_cliente": null,
  "fecha_inicio": "2026-10-22T15:30:00.000Z",
  "duracion_segundos": 184,
  "estado_procesamiento": "COMPLETADO",
  "mensaje_error": null,
  "baja_confianza_audio": false,
  "resultado": {
    "puntaje_final": 60.27,
    "clasificacion_final": "NEUTRO",
    "diagnostico_conflicto": "SIN_CONFLICTO",
    "score_global_nlp": 0.41,
    "score_acustico": -0.25
  },
  "transcripcion": [
    {
      "id_transcripcion": 1,
      "hablante": "AGENTE",
      "texto_transcrito": "Buenas tardes, gracias por llamar...",
      "timestamp_inicio": 0.0,
      "timestamp_fin": 4.2,
      "score_sentimiento": 0.6,
      "nivel_volumen_rms": -20.3,
      "tono_f0_hz": 180.5
    }
  ],
  "alertas": [
    {
      "id_alerta": 3,
      "tipo_alerta": "EXCESO_VOLUMEN",
      "origen_evento": "CLIENTE",
      "timestamp_evento": 95.4,
      "valor_registrado": "-8.5 dBFS",
      "mensaje_sugerencia": "Mantenga un tono calmado y valide la molestia del cliente."
    }
  ],
  "tiene_audio": true
}
```
- `resultado` es `null` mientras `estado_procesamiento` no sea `COMPLETADO`; `transcripcion`
  y `alertas` llegan vacías en ese caso.
- `transcripcion` ordenada por `timestamp_inicio`; `alertas` por `timestamp_evento`.
- Números como números (no texto): el backend ya usa `decimalNumbers: true`.
- El volumen está en **dBFS** (`docs/contrato_audio.md`): `nivel_volumen_rms` es negativo (0 es el
  máximo digital) y `valor_registrado` de un `EXCESO_VOLUMEN` va como `"-8.5 dBFS"`.
- Valores posibles: `clasificacion_final` = `POSITIVO`, `NEUTRO`, `NEGATIVO`, `CRITICO`;
  `diagnostico_conflicto` = `FALLA_AGENTE`, `CLIENTE_PROBLEMATICO`, `SIN_CONFLICTO`;
  `tipo_alerta` = `EXCESO_VOLUMEN`, `ALTERACION_TONO`, `VOCABULARIO_INADECUADO`, `OMISION_SCRIPT`.

Errores: `404 NO_ENCONTRADO` (no existe o el usuario no puede verla).

### `GET /llamadas/:id_llamada/audio`
Devuelve el archivo original (`Content-Type: audio/mpeg` o `audio/wav`) para el reproductor.
Mismas reglas de visibilidad. El frontend lo pide con el token Bearer y lo reproduce desde
memoria, por eso no hace falta soporte de `Range`.

Errores: `404 NO_ENCONTRADO` (la llamada no existe, no puede verla o el archivo ya no está en disco).

Detalles de la implementación (no cambian el contrato, lo precisan):
- Un `id_llamada` que no es un número entero positivo responde `400 DATOS_INVALIDOS`, igual que en
  `GET /llamadas/lotes/:id_lote`.
- La visibilidad del Supervisor depende de la asignación **actual** (`TB_AsignacionSupervisor`):
  si un agente cambia de supervisor, el anterior deja de ver sus llamadas.
- `fecha_inicio` es la fecha de carga del audio (valor por defecto de la columna). El análisis no
  conoce la fecha real de la llamada, así que el procesamiento no la cambia.
- `tiene_audio` es `false` si el archivo ya no está en disco; en ese caso `/audio` responde `404`.

### De dónde salen los datos (para `docs/contrato_audio.md`)
El análisis de audio (David) debe producir, por llamada, lo necesario para llenar estos
campos; el backend (Willy) los guarda en la base de datos:
- `TB_Transcripcion`: un fragmento por intervención, con `hablante` (AGENTE o CLIENTE),
  texto, tiempos de inicio y fin, `score_sentimiento` (-1 a 1), volumen RMS y tono F0.
- `TB_Alerta`: tipo, quién la originó, segundo, valor medido y sugerencia.
- `TB_Llamada`: `duracion_segundos`, `score_global_nlp`, `score_acustico`, `puntaje_final`
  (0 a 100), `clasificacion_final`, `diagnostico_conflicto` y `baja_confianza_audio`.

---

## Estadísticas del inicio

La página de inicio (la primera que se ve al entrar) muestra un resumen de las llamadas
del periodo: cuántas hay por estado, cómo salió el sentimiento, qué alertas aparecieron
y cómo le va a cada agente. Propuesto por Javier el 03/11/2026, a revisar por Willy.

### Quién ve qué
Igual que en "Detalle de una llamada" (sin módulo; lo decide la relación con las llamadas):
- **Agente:** solo sus propias llamadas.
- **Supervisor:** las de los agentes que tiene asignados **hoy** (`TB_AsignacionSupervisor`).
- **SuperAdmin:** todas.

### `GET /estadisticas/resumen?dias=30`
- `dias`: `7`, `30` o `90` (por defecto `30`). Cuenta las llamadas con `fecha_inicio` en los
  últimos `dias` días, incluido hoy. `fecha_inicio` es la **fecha de carga** del audio, no la de
  la llamada (ver "Detalle de una llamada").

`200`:
```json
{
  "periodo": { "dias": 30, "desde": "2026-10-05", "hasta": "2026-11-03" },
  "llamadas": {
    "total": 128,
    "por_estado": { "PENDIENTE": 4, "PROCESANDO": 1, "COMPLETADO": 117, "ERROR": 6 }
  },
  "sentimiento": {
    "puntaje_promedio": 61.8,
    "por_clasificacion": { "POSITIVO": 49, "NEUTRO": 33, "NEGATIVO": 25, "CRITICO": 10 },
    "baja_confianza_audio": 7
  },
  "alertas": {
    "total": 64,
    "por_tipo": { "EXCESO_VOLUMEN": 21, "ALTERACION_TONO": 14, "VOCABULARIO_INADECUADO": 17, "OMISION_SCRIPT": 12 }
  },
  "agentes": [
    {
      "id_usuario": 7,
      "nombre_completo": "Ana Torres",
      "llamadas_completadas": 40,
      "puntaje_promedio": 74.2,
      "llamadas_criticas": 1,
      "alertas": 9
    }
  ]
}
```
- `por_estado`, `por_clasificacion` y `por_tipo` traen **siempre todas las claves**, con `0`
  si no hay ninguna.
- `sentimiento` y `alertas` cuentan **solo llamadas `COMPLETADO`**. `puntaje_promedio` es el
  promedio de `puntaje_final` con 1 decimal, o `null` si no hay llamadas completadas. Los audios
  sin voz cuentan con su puntaje neutro (50); `baja_confianza_audio` dice cuántos son.
- Las alertas salen de la v0.3 de `docs/contrato_audio.md` (PRs #42 y #44). `OMISION_SCRIPT`
  todavía no se detecta, así que su conteo es `0`; el frontend lo aclara.
- `agentes`: los agentes visibles con al menos una llamada en el periodo, ordenados por
  `nombre_completo`. Para un Agente, solo él mismo. **Incluye agentes desactivados** si tienen
  llamadas en el periodo (sus resultados siguen contando). `puntaje_promedio` es `null` si el agente
  no tiene llamadas completadas.
- Se calcula desde `TB_Llamada` y `TB_Alerta`. `TB_MetricaDiariaAgente` todavía no la llena
  nadie; si más adelante se mantiene, se puede usar sin cambiar esta respuesta.

Errores: `400 DATOS_INVALIDOS` si `dias` no es `7`, `30` o `90`.

---

## Listado de llamadas

Lista paginada de llamadas con filtros. La usan el **Panel del Agente** (sus llamadas), la
**Búsqueda histórica** y, más adelante, el Dashboard. Propuesto por Javier el 07/11/2026,
aprobado por Willy e implementado en el PR #37.

### Quién ve qué
Sin módulo, igual que "Detalle de una llamada": **Agente** sus llamadas, **Supervisor** las de
sus agentes asignados hoy, **SuperAdmin** todas. Cada pantalla ya se protege con su propio
módulo en el frontend (`PANEL_AGENTE`, `BUSQUEDA_HISTORICA`).

### `GET /llamadas`
Todos los parámetros son opcionales y se combinan (todos deben cumplirse):

| Parámetro | Valores | Filtra por |
|---|---|---|
| `pagina` | entero desde `1` (por defecto `1`) | - |
| `tamano_pagina` | entero de `1` a `100` (por defecto `20`) | - |
| `desde`, `hasta` | `AAAA-MM-DD`, ambos incluidos | `fecha_inicio` (fecha de carga del audio) |
| `id_agente` | entero | `id_agente` |
| `id_lote` | entero | `id_lote` |
| `estado` | `PENDIENTE`, `PROCESANDO`, `COMPLETADO` o `ERROR` | `estado_procesamiento` |
| `clasificacion` | `POSITIVO`, `NEUTRO`, `NEGATIVO` o `CRITICO` | `clasificacion_final` (solo `COMPLETADO`) |
| `diagnostico` | `FALLA_AGENTE`, `CLIENTE_PROBLEMATICO` o `SIN_CONFLICTO` | `diagnostico_conflicto` (solo `COMPLETADO`) |
| `buscar` | texto de 2 a 100 caracteres | parte de `nombre_archivo_original` |

Orden: de la más reciente a la más antigua (`fecha_inicio` y luego `id_llamada`, descendentes).

`200`:
```json
{
  "pagina": 1,
  "tamano_pagina": 20,
  "total": 57,
  "total_paginas": 3,
  "llamadas": [
    {
      "id_llamada": 101,
      "id_lote": 12,
      "codigo_lote": "LOTE-20261022-0012",
      "nombre_archivo_original": "llamada1.mp3",
      "agente": { "id_usuario": 7, "nombre_completo": "Ana Torres" },
      "fecha_inicio": "2026-10-22T15:30:00.000Z",
      "duracion_segundos": 184,
      "estado_procesamiento": "COMPLETADO",
      "mensaje_error": null,
      "baja_confianza_audio": false,
      "resultado": {
        "puntaje_final": 72.5,
        "clasificacion_final": "POSITIVO",
        "diagnostico_conflicto": "SIN_CONFLICTO"
      },
      "total_alertas": 0
    }
  ]
}
```
- Paginación igual que en `GET /auditoria`: `total` es la cantidad de llamadas que cumplen los
  filtros y `total_paginas` cuántas páginas hay (`0` si no hay ninguna); `llamadas` trae solo las
  de la página pedida. Una página después de la última responde `200` con `llamadas: []`.
- `resultado` es `null` mientras `estado_procesamiento` no sea `COMPLETADO` (igual que en el
  detalle); `total_alertas` es `0` en ese caso.
- Si se filtra por `clasificacion` o `diagnostico`, solo entran llamadas `COMPLETADO`, porque
  las demás tienen los valores por defecto de la columna.
- Un `id_agente` o `id_lote` que el usuario no puede ver no es un error: simplemente no hay
  resultados (no se revela si existe).
- Índices que ya sirven: `ix_llamada_agente_fecha (id_agente, fecha_inicio)`, `ix_llamada_lote`,
  `ix_llamada_estado` e `ix_llamada_clasificacion`.

Errores: `400 DATOS_INVALIDOS` si un parámetro no tiene un valor permitido o `desde` es
posterior a `hasta`.

---

## Registro de auditoría

Pantalla **Auditoría** (`/auditoria`): lista de lo que quedó en `TB_LogAuditoria`, es decir, quién
hizo qué, cuándo, en qué módulo y desde qué IP. Propuesto por Willy el 06/11/2026, aprobado por
Javier e implementado en el PR #36.

### Decisiones
1. **Permiso:** `AUDITORIA` leer. Con los permisos iniciales solo lo tiene el SuperAdmin; el Supervisor
   y el Agente reciben `403 PROHIBIDO`.
2. **Solo lectura:** la auditoría no se edita ni se borra desde la API.
3. **Nunca hay contraseñas ni hashes:** el backend nunca los guarda en `detalle_cambio` (ver
   `CLAUDE.md`), así que la respuesta tampoco los trae. Del usuario solo se devuelven id, nombre y correo.
4. **Orden:** del más reciente al más antiguo (`fecha_evento`, y ante empate, `id_log`, ambos descendentes).
5. **Paginación por número de página**, con el total, para que la pantalla muestre "Página 2 de 7".

### `GET /auditoria`
Parámetros, todos opcionales y combinables:

| Parámetro | Regla | Ejemplo |
|---|---|---|
| `id_usuario` | Entero positivo. Solo los registros que hizo ese usuario. | `7` |
| `accion` | Texto exacto de `accion_ejecutada`, sin importar mayúsculas (máximo 100 caracteres). | `EDICION_USUARIO` |
| `modulo` | Texto exacto de `modulo_afectado`, sin importar mayúsculas (máximo 50 caracteres). | `GESTION_USUARIOS` |
| `desde` | Fecha `AAAA-MM-DD`, incluida. | `2026-11-01` |
| `hasta` | Fecha `AAAA-MM-DD`, incluida (hasta las 23:59:59 de ese día). | `2026-11-06` |
| `pagina` | Entero desde 1. Por defecto `1`. | `2` |
| `tamano_pagina` | Entero de 1 a 100. Por defecto `50`. | `25` |

Ejemplo: `GET /auditoria?modulo=GESTION_USUARIOS&desde=2026-11-01&pagina=2&tamano_pagina=25`

`200`:
```json
{
  "pagina": 2,
  "tamano_pagina": 25,
  "total": 134,
  "total_paginas": 6,
  "registros": [
    {
      "id_log": 812,
      "fecha_evento": "2026-11-05T21:14:03.000Z",
      "usuario": { "id_usuario": 1, "nombre_completo": "Willy Admin", "correo_electronico": "admin@vocalanalytics.local" },
      "accion_ejecutada": "EDICION_USUARIO",
      "modulo_afectado": "GESTION_USUARIOS",
      "detalle_cambio": { "id_usuario": 51, "cambios": { "nombre_completo": { "anterior": "Ana", "nuevo": "Ana Torres" } } },
      "direccion_ip": "127.0.0.1"
    }
  ]
}
```
- Si no hay registros, `registros` llega vacío, `total` en `0` y `total_paginas` en `0`. Una `pagina`
  mayor que `total_paginas` también responde `200` con `registros` vacío.
- `detalle_cambio` es el JSON tal como se guardó (o `null`): cada acción tiene su propia forma, la que
  documenta su endpoint. La pantalla puede mostrarlo como texto o con un formato por acción.
- `fecha_evento` es la hora de MySQL, enviada como fecha ISO; el frontend la muestra en hora local.
- El usuario siempre existe: `TB_LogAuditoria` no deja borrar a un usuario con registros.

Acciones que existen hoy, para el filtro de la pantalla:

| `accion_ejecutada` | `modulo_afectado` | Cuándo |
|---|---|---|
| `CREACION_USUARIO` | `GESTION_USUARIOS` | `POST /usuarios` |
| `EDICION_USUARIO` | `GESTION_USUARIOS` | `PATCH /usuarios/:id_usuario` |
| `CAMBIO_ESTADO_USUARIO` | `GESTION_USUARIOS` | `PATCH /usuarios/:id_usuario/estado` |
| `ASIGNACION_SUPERVISOR` | `GESTION_USUARIOS` | `PUT /usuarios/:id_usuario/supervisor` |
| `CARGA_LOTE` | `CARGA_LOTES` | `POST /llamadas/lotes` |
| `PROCESAMIENTO_LLAMADA` | `CARGA_LOTES` | El análisis de una llamada terminó; se atribuye a quien cargó el lote. |

Si más adelante aparecen acciones nuevas, se agregan a esta tabla en el mismo PR que las crea.

Errores: `400 DATOS_INVALIDOS` si algún parámetro no cumple su regla o si `desde` es posterior a
`hasta` (`detalles` dice qué campo falló).
