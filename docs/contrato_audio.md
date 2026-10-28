# Contrato: backend (Node) y análisis de audio (Python)

**Estado: BORRADOR v0.1. Lo acuerdan David y Willy.** Hasta que Willy lo apruebe en el
PR, nada de este archivo es definitivo. Si alguien necesita un cambio, se hace primero
aquí, en un PR propio, y se avisa al otro.

- Script: `audio-processing/analizar.py` (instalación en `audio-processing/README.md`).
- Quién llama: el backend, después de que `POST /llamadas/lotes` dejó la llamada en
  `PENDIENTE` (ver `docs/api.md`).
- Qué devuelve: **un solo JSON por stdout**. El backend lo guarda en `TB_Llamada`,
  `TB_Transcripcion` y, más adelante, `TB_Alerta`.

## 1. Cómo se ejecuta

```text
<AUDIO_PYTHON> <AUDIO_SCRIPT> <ruta_del_audio> --modelo <AUDIO_MODELO_WHISPER> --idioma es
```

Variables propuestas para `backend/.env` (las decide Willy):

| Variable | Ejemplo | Para qué |
|---|---|---|
| `AUDIO_PYTHON` | `../audio-processing/venv/Scripts/python.exe` | Python del venv (no el del sistema) |
| `AUDIO_SCRIPT` | `../audio-processing/analizar.py` | Script de análisis |
| `AUDIO_MODELO_WHISPER` | `base` | `base` o `small` |
| `AUDIO_TIMEOUT_SEGUNDOS` | `600` | Si se pasa, el backend mata el proceso y marca `ERROR` |

Reglas para el backend:
1. Usar `child_process.execFile` o `spawn` con los argumentos en un arreglo, **nunca**
   `exec` con una cadena: el nombre del archivo lo sube el usuario y podría inyectar comandos.
2. Pasar `ruta_audio_storage` (la ruta en disco que ya guardó el backend), no el nombre original.
3. Leer **stdout completo** como UTF-8 y hacer `JSON.parse` solo al terminar el proceso.
   stdout trae una sola línea JSON y nada más.
4. **stderr** trae mensajes de avance y advertencias (descarga del modelo, numba). Se
   pueden mostrar con `console.log`, pero **no** indican error: el error se sabe por el
   código de salida.
5. Procesar **una llamada a la vez**. Cada análisis usa todos los núcleos de la CPU y
   entre 0,6 y 0,8 GB de RAM; en paralelo serían más lentos y podrían agotar 8 GB.
6. Antes de llamar al script, `TB_Llamada.estado_procesamiento = 'PROCESANDO'`; al
   terminar, `COMPLETADO` o `ERROR` (ver sección 4).

Tiempos de referencia (laptop sin GPU, audio de 4,5 min): unos **60 s con `base`** y
unos **100 s con `small`**. La primera ejecución en una computadora nueva tarda más,
porque descarga el modelo y compila numba. Detalle en `audio-processing/README.md`.

## 2. Códigos de salida

| Código | Significado | stdout |
|---|---|---|
| `0` | Análisis completo | JSON de resultado (sección 3) |
| `1` | Error | JSON de error (sección 4) |
| otro / sin JSON | El proceso murió (falta el venv, se acabó la memoria, timeout) | puede venir vacío |

## 3. JSON de resultado (código 0)

```json
{
  "version_contrato": "0.1",
  "archivo": "llamada_0001.mp3",
  "duracion_segundos": 268.553,
  "idioma": "es",
  "probabilidad_idioma": 1.0,
  "modelo": { "motor": "faster-whisper", "nombre": "base", "tipo_calculo": "int8" },
  "baja_confianza_audio": false,
  "resumen_acustico": {
    "f0_mediana_hz": 213.64,
    "f0_desviacion_hz": 36.43,
    "rms_promedio_dbfs": -20.05,
    "rms_maximo_dbfs": -12.07,
    "confianza_logprob_promedio": -0.104
  },
  "tiempos_proceso_segundos": { "transcripcion": 46.18, "acustico": 10.38, "total": 57.94 },
  "segmentos": [
    {
      "indice": 0,
      "inicio": 0.0,
      "fin": 7.0,
      "texto": "Buenas tardes, gracias por llamar a servicio al cliente, mi nombre es Carla, en que le puedo ayudar.",
      "f0_hz": 213.64,
      "rms_dbfs": -20.25,
      "confianza_logprob": -0.155,
      "probabilidad_sin_voz": 0.013
    }
  ]
}
```

### Campos de primer nivel

| Campo | Tipo | Nulo | Descripción | Va a |
|---|---|---|---|---|
| `version_contrato` | string | no | Versión de este contrato. El backend debe rechazar un número mayor (antes del punto) distinto del que conoce (sección 6). | - |
| `archivo` | string | no | Nombre del archivo analizado (sin carpeta). Solo informativo. | - |
| `duracion_segundos` | number (3 decimales) | no | Duración total del audio. | `TB_Llamada.duracion_segundos` (redondear a entero) |
| `idioma` | string | no | Idioma usado (hoy siempre el de `--idioma`). | - |
| `probabilidad_idioma` | number 0-1 | no | Seguridad de Whisper sobre el idioma. | - |
| `modelo` | object | no | `motor`, `nombre` y `tipo_calculo` usados. | - (útil para auditoría) |
| `baja_confianza_audio` | boolean | no | Flujo E1 (ruido extremo). Hoy es `true` si no hubo segmentos o si `confianza_logprob_promedio < -1,0`. Criterio **provisional**. | `TB_Llamada.baja_confianza_audio` (0/1) |
| `resumen_acustico` | object | no | Ver abajo. | - (lo usará el score acústico) |
| `tiempos_proceso_segundos` | object | no | `transcripcion`, `acustico`, `total`. | - (registro) |
| `segmentos` | array | no (puede ser `[]`) | Fragmentos en orden de tiempo. | una fila de `TB_Transcripcion` cada uno |

### `resumen_acustico`

| Campo | Tipo | Nulo | Unidad |
|---|---|---|---|
| `f0_mediana_hz` | number (2 dec.) | sí, si no hubo voz | Hz |
| `f0_desviacion_hz` | number (2 dec.) | sí, si no hubo voz | Hz |
| `rms_promedio_dbfs` | number (2 dec.) | no | dBFS |
| `rms_maximo_dbfs` | number (2 dec.) | no | dBFS (cuadro de 64 ms más fuerte) |
| `confianza_logprob_promedio` | number (3 dec.) | sí, si no hubo segmentos | log-probabilidad, de -inf a 0 |

### Cada elemento de `segmentos`

| Campo | Tipo | Nulo | Descripción | Columna de `TB_Transcripcion` |
|---|---|---|---|---|
| `indice` | integer | no | 0, 1, 2... | - |
| `inicio` | number (3 dec.) | no | Segundo de inicio | `timestamp_inicio` DECIMAL(8,3) |
| `fin` | number (3 dec.) | no | Segundo de fin (`>= inicio`) | `timestamp_fin` DECIMAL(8,3) |
| `texto` | string | no | Texto transcrito, sin espacios al borde | `texto_transcrito` |
| `f0_hz` | number (2 dec.) | **sí** | Mediana del tono en los cuadros con voz | `tono_f0_hz` DECIMAL(6,2) |
| `rms_dbfs` | number (2 dec.) | sí (casi nunca) | Energía media del tramo | `nivel_volumen_rms` DECIMAL(6,2) |
| `confianza_logprob` | number (3 dec.) | no | Seguridad de Whisper (cerca de 0 = seguro) | - |
| `probabilidad_sin_voz` | number 0-1 | no | Probabilidad de que el tramo sea silencio o ruido | - |

**Sobre las unidades del volumen:** `rms_dbfs` está en **dBFS**: 0 es el máximo digital
y la voz normal ronda entre -30 y -15. **No** son dB de presión sonora. El ejemplo
"88 dB" del comentario de `TB_Alerta.valor_registrado` no se puede calcular desde
un archivo; se propone guardar, por ejemplo, `"-8.5 dBFS"`.

## 4. JSON de error (código 1)

Mismo formato que los errores de la API:

```json
{ "error": { "codigo": "AUDIO_ILEGIBLE", "mensaje": "No se pudo leer el audio.", "detalles": { "ruta": "...", "causa": "..." } } }
```

| `codigo` | Cuándo | ¿Reintentar? |
|---|---|---|
| `ARGUMENTOS_INVALIDOS` | Falta la ruta o un argumento no es válido (error del backend) | No |
| `ARCHIVO_NO_ENCONTRADO` | La ruta no existe | No |
| `AUDIO_ILEGIBLE` | El archivo no es un audio válido o está dañado | No |
| `AUDIO_VACIO` | El audio no tiene muestras | No |
| `ERROR_INTERNO` | Falla inesperada (ver `detalles.causa`) | Sí, una vez |

Qué hace el backend: `estado_procesamiento = 'ERROR'` y
`mensaje_error = "<codigo>: <mensaje>"`, recortado a 255 caracteres. Si el proceso
murió sin JSON, usar `mensaje_error = "PROCESO_FALLIDO: código <n>"` (o `TIMEOUT`).

## 5. Columnas que este contrato todavía NO llena

| Columna | Por qué falta | Propuesta |
|---|---|---|
| `TB_Transcripcion.hablante` (**NOT NULL**) | Necesita diarización (separar agente y cliente) | v0.2: campo `hablante` en cada segmento. **Hay que decidir** qué guarda el backend mientras tanto. |
| `TB_Transcripcion.score_sentimiento` (**NOT NULL**) | Necesita el léxico de sentimiento (RN-01) | v0.2: campo `score_sentimiento` (-1 a +1) en cada segmento |
| `TB_Llamada.score_global_nlp`, `score_acustico` | Dependen de lo anterior | v0.2 o v0.3, en el primer nivel del JSON |
| `TB_Llamada.puntaje_final`, `clasificacion_final`, `diagnostico_conflicto` | Consolidado final (55 % léxico) | Por decidir: ¿lo calcula Python o el backend? |
| `TB_Alerta` (EXCESO_VOLUMEN, ALTERACION_TONO, ...) | Faltan umbrales | v0.3: arreglo `alertas` con `tipo_alerta`, `origen_evento`, `timestamp_evento`, `valor_registrado`, `mensaje_sugerencia` |

Columnas que **no** son del análisis y siguen siendo del backend: `fecha_inicio`,
`fecha_fin`, `estado_procesamiento`, `mensaje_error`, `hash_archivo` y `ruta_audio_storage`.

## 6. Reglas de versión

- Agregar un campo nuevo es compatible: sube la versión menor (`0.1` a `0.2`). El backend
  debe ignorar los campos que no conoce.
- Renombrar, quitar o cambiar el tipo de un campo sube la versión mayor (`1.x` a `2.0`) y
  requiere el visto bueno de los dos.

## 7. Preguntas para Willy

1. ¿Los nombres de las variables de `.env` (sección 1) te sirven?
2. Mientras no haya diarización ni sentimiento (`hablante` y `score_sentimiento` son NOT NULL),
   ¿prefieres (a) esperar a la v0.2 antes de guardar `TB_Transcripcion`, o (b) un script
   `database/04_...sql` que los deje aceptar NULL?
3. ¿El puntaje final y la clasificación los calcula Python (y van en el JSON) o el backend?
4. ¿Te parece bien guardar `rms_dbfs` (negativo) en `nivel_volumen_rms`?
