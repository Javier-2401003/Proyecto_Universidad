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
_Última actualización: 20/10/2026_

**Objetivo para la próxima reunión**
- [ ] Proyecto React + Vite en `frontend/`.
- [ ] Login contra `POST /api/v1/auth/login`, guardando el token.
- [ ] Menú lateral según `usuario.permisos`.
- [ ] Gestión de usuarios: listar y crear.
- [ ] Demo: SuperAdmin crea un agente; el agente solo ve su panel.

**Hecho:** -
**En curso:** -
**Necesito de otros:** -

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
