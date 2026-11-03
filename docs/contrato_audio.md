# Contrato: backend (Node) y análisis de audio (Python)

**Estado: v0.1, aprobada por Willy el 02/11/2026 (decisiones en la sección 7).** La v0.2 de la
sección 5 todavía no está implementada. Si alguien necesita un cambio, se hace primero aquí,
en un PR propio, y se avisa al otro.

- Script: `audio-processing/analizar.py` (instalación en `audio-processing/README.md`).
- Quién llama: el backend, después de que `POST /llamadas/lotes` dejó la llamada en
  `PENDIENTE` (ver `docs/api.md`).
- Qué devuelve: **un solo JSON por stdout**. El backend lo guarda en `TB_Llamada`,
  `TB_Transcripcion` y, más adelante, `TB_Alerta`.

## 1. Cómo se ejecuta

```text
<AUDIO_PYTHON> <AUDIO_SCRIPT> <ruta_del_audio> --modelo <AUDIO_MODELO_WHISPER> --idioma es
```

Variables acordadas para `backend/.env` (Willy las agrega a `backend/.env.example` cuando
haga el procesamiento):

| Variable | Ejemplo | Para qué |
|---|---|---|
| `AUDIO_PYTHON` | `../audio-processing/venv/Scripts/python.exe` | Python del venv (no el del sistema) |
| `AUDIO_SCRIPT` | `../audio-processing/analizar.py` | Script de análisis |
| `AUDIO_MODELO_WHISPER` | `base` | `base` o `small` |
| `AUDIO_TIMEOUT_SEGUNDOS` | `600` | Si se pasa, el backend mata el proceso y marca `ERROR` |

Reglas para el backend:
1. Usar `child_process.execFile` o `spawn` con los argumentos en un arreglo, **nunca**
   `exec` con una cadena: el nombre del archivo lo sube el usuario y podría inyectar comandos.
2. Pasar la ruta **absoluta** del audio: `backend/uploads/` + `ruta_audio_storage`, que es
   relativa a esa carpeta (ej. `lotes/12/101.mp3`). El script no corre en la carpeta del
   backend. Nunca pasar el nombre original del archivo.
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
y la voz normal ronda entre -30 y -15. **No** son dB de presión sonora.
`nivel_volumen_rms` guarda este valor negativo (`DECIMAL(6,2)` lo acepta). El ejemplo
"88 dB" del comentario de `TB_Alerta.valor_registrado` no se puede calcular desde
un archivo; se guarda, por ejemplo, `"-8.5 dBFS"`.

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

**Con la v0.1 el backend no guarda `TB_Transcripcion`**, porque `hablante` y
`score_sentimiento` son NOT NULL y no se creará un script `04_` para dejarlos en NULL.
Willy deja listo el procesamiento (estados, timeout, una llamada a la vez) y lo prueba
con la v0.1, **solo en desarrollo**.

**El backend no marca `COMPLETADO` si faltan campos de la v0.2:** la llamada queda en `ERROR`
con `mensaje_error = "CONTRATO_INCOMPLETO: ..."`. Así nunca se muestran los valores por defecto
de `TB_Llamada` (puntaje 0, `NEUTRO`) como si fueran un resultado real.

Campos acordados para la **v0.2**. Todos los calcula Python; el backend solo valida y guarda:

| Campo del JSON | Dónde | Tipo y valores | Columna |
|---|---|---|---|
| `hablante` | cada segmento | `"AGENTE"` o `"CLIENTE"` | `TB_Transcripcion.hablante` |
| `score_sentimiento` | cada segmento | number (3 dec.), de -1 a +1 | `TB_Transcripcion.score_sentimiento` |
| `score_global_nlp` | primer nivel | number (3 dec.), de -1 a +1 | `TB_Llamada.score_global_nlp` |
| `score_acustico` | primer nivel | number (3 dec.), de -1 a +1 | `TB_Llamada.score_acustico` |
| `puntaje_final` | primer nivel | number (2 dec.), de 0 a 100 | `TB_Llamada.puntaje_final` |
| `clasificacion_final` | primer nivel | `"POSITIVO"`, `"NEUTRO"`, `"NEGATIVO"` o `"CRITICO"` | `TB_Llamada.clasificacion_final` |
| `diagnostico_conflicto` | primer nivel | `"FALLA_AGENTE"`, `"CLIENTE_PROBLEMATICO"` o `"SIN_CONFLICTO"` | `TB_Llamada.diagnostico_conflicto` |

Reglas de la v0.2 para que estos campos nunca vayan nulos, porque las columnas son NOT NULL:

- **`hablante` viene siempre**, aunque la diarización no esté segura: es la mejor estimación
  entre `"AGENTE"` y `"CLIENTE"`, sin `null` ni un tercer valor.
- **Audio sin voz o puro ruido (`segmentos: []`):** es un análisis válido, no un error. El JSON
  trae `baja_confianza_audio: true`, `score_global_nlp: 0.0`, `score_acustico: 0.0`,
  `clasificacion_final: "NEUTRO"`, `diagnostico_conflicto: "SIN_CONFLICTO"` y `puntaje_final`
  en el punto neutro de la escala. Ese punto es `50.00` si se confirma que 100 es lo mejor del
  odómetro (Blueprint, páginas 7 y 9), **pendiente de confirmar con Javier**. El backend marca
  `COMPLETADO` y no guarda filas en `TB_Transcripcion`.

Para la **v0.3** queda `TB_Alerta` (EXCESO_VOLUMEN, ALTERACION_TONO, ...): arreglo `alertas` con `tipo_alerta`, `origen_evento`, `timestamp_evento`,
`valor_registrado` y `mensaje_sugerencia`.

Columnas que **no** son del análisis y siguen siendo del backend: `fecha_inicio`,
`fecha_fin`, `estado_procesamiento`, `mensaje_error`, `hash_archivo` y `ruta_audio_storage`.

## 6. Reglas de versión

- Agregar un campo nuevo es compatible: sube la versión menor (`0.1` a `0.2`). El backend
  acepta cualquier `0.x` e ignora los campos que no conoce, pero para guardar un resultado
  exige los campos de la v0.2 (sección 5).
- Renombrar, quitar o cambiar el tipo de un campo sube la versión mayor (`1.x` a `2.0`) y
  requiere el visto bueno de los dos.

## 7. Decisiones de Willy (28/10/2026 y 02/11/2026)

1. **Variables de `.env`:** se usan los nombres de la sección 1.
2. **`hablante` y `score_sentimiento`:** se espera a la v0.2 para guardar `TB_Transcripcion`,
   sin script `database/04_...sql`.
3. **Puntaje final, clasificación y diagnóstico:** los calcula Python y vienen en el primer
   nivel del JSON (sección 5).
4. **Volumen:** `rms_dbfs` se guarda en `nivel_volumen_rms`, y `valor_registrado` usa el
   formato `"-8.5 dBFS"`. Javier cambia el ejemplo `"88 dB"` de `docs/api.md` y de los datos simulados.
5. **Pruebas con la v0.1 (02/11):** quedan solo en desarrollo. El backend deja en `ERROR` con
   `CONTRATO_INCOMPLETO` toda llamada a la que le falten campos de la v0.2 (sección 5).
6. **Sin nulos en la v0.2 (02/11):** `hablante` viene siempre y los puntajes tienen valor aunque
   no haya segmentos. Willy pidió definirlo; la regla de la sección 5 es propuesta de David.
