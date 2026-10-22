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
| `GET /usuarios` | `GESTION_USUARIOS` leer | Hecho |
| `POST /usuarios` | `GESTION_USUARIOS` escribir | Hecho |
| `PUT /usuarios/:id_usuario/supervisor` | `GESTION_USUARIOS` escribir | **Propuesto, pendiente (Willy)** |
| `PATCH /usuarios/:id_usuario` | `GESTION_USUARIOS` escribir | **Propuesto, pendiente (Willy)** |
| `PATCH /usuarios/:id_usuario/estado` | `GESTION_USUARIOS` escribir | **Propuesto, pendiente (Willy)** |
| `GET /agentes` | `CARGA_LOTES` leer | **Acordado, pendiente (Willy)** |
| `POST /llamadas/lotes` | `CARGA_LOTES` escribir | **Acordado, pendiente (Willy)** |
| `GET /llamadas/lotes/:id_lote` | `CARGA_LOTES` leer | **Acordado, pendiente (Willy)** |

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

## Usuarios

### `GET /usuarios`
`200`: lista de `{ "id_usuario", "nombre_completo", "correo_electronico", "estado": "ACTIVO" | "INACTIVO", "fecha_creacion", "roles": [...], "supervisor" }` (máximo 200).

`supervisor` (**propuesto**, campo nuevo): `{ "id_usuario", "nombre_completo" }` del supervisor
asignado, o `null` si no tiene (siempre `null` para quien no es agente).

### `POST /usuarios`
Cuerpo: `{ "nombre_completo", "correo_electronico", "password" (8 a 72 bytes), "rol": "AGENTE" | "SUPERVISOR" | "SUPERADMIN" }`

`201`: `{ "id_usuario", "mensaje", "fecha_registro" }`

Errores: `400 DATOS_INVALIDOS`, `400 ROL_INEXISTENTE`, `409 CORREO_DUPLICADO`.

## Gestión de usuarios: supervisor, edición y estado (propuesto, pendiente de implementar)

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

La contraseña no se cambia aquí (quedará para un endpoint propio).

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

## Carga de audios por lotes (acordado, pendiente de implementar)

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
