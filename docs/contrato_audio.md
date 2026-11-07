# Contrato: backend (Node) y análisis de audio (Python)

**Estado: v0.3 (alertas), propuesta por David y pendiente de la revisión de Willy.** La v0.2 la aprobó
Willy el 06/11/2026 (PR #21), con los puntos de la sección 7 como provisionales, y la implementan
`audio-processing/analizar.py` y el procesamiento del backend (`backend/src/procesamientoAudio.js`).
Si alguien necesita un cambio, se hace primero aquí, en un PR propio, y se avisa al otro.

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
| `AUDIO_TIMEOUT_SEGUNDOS` | `3600` | Si se pasa, el backend mata el proceso y marca `ERROR`. Una voz real de 52 s tardó hasta 87 s con `base` en la laptop de Willy |

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
  "version_contrato": "0.3",
  "archivo": "llamada_0001.mp3",
  "duracion_segundos": 268.553,
  "idioma": "es",
  "probabilidad_idioma": 1.0,
  "modelo": { "motor": "faster-whisper", "nombre": "base", "tipo_calculo": "int8" },
  "baja_confianza_audio": false,
  "score_global_nlp": 0.5,
  "score_acustico": 0.0,
  "puntaje_final": 63.75,
  "clasificacion_final": "NEUTRO",
  "diagnostico_conflicto": "SIN_CONFLICTO",
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
      "hablante": "AGENTE",
      "texto": "Buenas tardes, gracias por llamar a servicio al cliente, mi nombre es Carla, en que le puedo ayudar.",
      "score_sentimiento": 0.5,
      "f0_hz": 213.64,
      "rms_dbfs": -20.25,
      "confianza_logprob": -0.155,
      "probabilidad_sin_voz": 0.013
    }
  ],
  "alertas": [
    {
      "tipo_alerta": "EXCESO_VOLUMEN",
      "origen_evento": "CLIENTE",
      "timestamp_evento": 95.5,
      "valor_registrado": "-8.5 dBFS",
      "mensaje_sugerencia": "Mantenga un tono calmado y valide la molestia del cliente."
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
| `baja_confianza_audio` | boolean | no | Flujo E1. Es `true` si no hubo segmentos, si `confianza_logprob_promedio < -1,5`, o si hay ruido de fondo con variaciones de volumen extremas. Con `true`, `puntaje_final` usa 100 % el texto. Criterio **provisional**. | `TB_Llamada.baja_confianza_audio` (0/1) |
| `score_global_nlp` | number (3 dec.) | no | De -1 a +1. Promedio de las frases con palabras clave (RN-01); 0 si no hay ninguna. | `TB_Llamada.score_global_nlp` |
| `score_acustico` | number (3 dec.) | no | De -1 a 0 por ahora: 0 sin subidas de volumen o tono; nunca es positivo (RN-02). | `TB_Llamada.score_acustico` |
| `puntaje_final` | number (2 dec.) | no | De 0 a 100; 100 es lo mejor y 50 es neutro (RN-03). Con los pesos actuales, el máximo es 77,5. | `TB_Llamada.puntaje_final` |
| `clasificacion_final` | string | no | `"POSITIVO"`, `"NEUTRO"`, `"NEGATIVO"` o `"CRITICO"` (reglas en la sección 5). | `TB_Llamada.clasificacion_final` |
| `diagnostico_conflicto` | string | no | `"FALLA_AGENTE"`, `"CLIENTE_PROBLEMATICO"` o `"SIN_CONFLICTO"` (reglas en la sección 5). | `TB_Llamada.diagnostico_conflicto` |
| `resumen_acustico` | object | no | Ver abajo. | - |
| `tiempos_proceso_segundos` | object | no | `transcripcion`, `acustico` (incluye la diarización), `total`. | - (registro) |
| `segmentos` | array | no (puede ser `[]`) | Fragmentos en orden de tiempo. | una fila de `TB_Transcripcion` cada uno |
| `alertas` | array | no (puede ser `[]`) | **v0.3.** Alertas en orden de `timestamp_evento` (sección 5, "Alertas"). | una fila de `TB_Alerta` cada una |

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
| `hablante` | string | no | `"AGENTE"` o `"CLIENTE"`: siempre uno de los dos, aunque no sea seguro | `hablante` |
| `texto` | string | no | Texto transcrito, sin espacios al borde | `texto_transcrito` |
| `score_sentimiento` | number (3 dec.) | no | De -1 a +1, según el léxico (RN-01) | `score_sentimiento` DECIMAL(4,3) |
| `f0_hz` | number (2 dec.) | **sí** | Mediana del tono en los cuadros con voz | `tono_f0_hz` DECIMAL(6,2) |
| `rms_dbfs` | number (2 dec.) | sí (casi nunca) | Energía media del tramo | `nivel_volumen_rms` DECIMAL(6,2) |
| `confianza_logprob` | number (3 dec.) | no | Seguridad de Whisper (cerca de 0 = seguro) | - |
| `probabilidad_sin_voz` | number 0-1 | no | Probabilidad de que el tramo sea silencio o ruido | - |

### Cada elemento de `alertas` (v0.3)

| Campo | Tipo | Nulo | Descripción | Columna de `TB_Alerta` |
|---|---|---|---|---|
| `tipo_alerta` | string | no | `"EXCESO_VOLUMEN"`, `"ALTERACION_TONO"`, `"VOCABULARIO_INADECUADO"` u `"OMISION_SCRIPT"`, **exactamente** como el ENUM de la columna | `tipo_alerta` |
| `origen_evento` | string | no | `"AGENTE"` o `"CLIENTE"`: el `hablante` del segmento donde ocurre | `origen_evento` |
| `timestamp_evento` | number (3 dec.) | no | Segundo de la llamada en que empieza | `timestamp_evento` DECIMAL(8,3) |
| `valor_registrado` | string | no | Lo medido, como máximo 100 caracteres: `"-8.5 dBFS"`, `"235 Hz (variación 46 %)"` o `"Palabra: estafa"` | `valor_registrado` VARCHAR(100) |
| `mensaje_sugerencia` | string | no | Orientación para el agente, como máximo 255 caracteres | `mensaje_sugerencia` VARCHAR(255) |

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

Qué hace el backend (`backend/src/procesamientoAudio.js`): `estado_procesamiento = 'ERROR'` y
`mensaje_error = "<codigo>: <mensaje>"`, recortado a 255 caracteres. Con `ERROR_INTERNO` reintenta
**una vez** antes de marcar `ERROR`.

Mensajes que pone el propio backend, sin que vengan del script:

| `mensaje_error` | Cuándo |
|---|---|
| `PROCESO_FALLIDO: código <n>` | El proceso no se pudo iniciar (si falta el venv, `<n>` es `ENOENT`), terminó sin JSON válido, o terminó con un código distinto de 0 y 1 aunque mande JSON |
| `TIMEOUT` | Se pasó de `AUDIO_TIMEOUT_SEGUNDOS` (3600 s por defecto) |
| `CONTRATO_INCOMPLETO: ...` | Falta un campo de la v0.2, un valor no cabe en su columna (por ejemplo, un tiempo mayor a `DECIMAL(8,3)`) o está fuera de su rango aunque quepa (por ejemplo, `puntaje_final` de 140 o `score_sentimiento` mayor que 1) |
| `CONTRATO_INCOMPATIBLE: version <x>` | `version_contrato` no empieza con `0.` |
| `ARCHIVO_NO_ENCONTRADO: ...` | La llamada no tiene ruta de audio, o la ruta se sale de `backend/uploads/` |
| `ERROR_GUARDADO: ...` | El análisis salió bien, pero no se pudo guardar en la base |

Los valores que no caben en su columna se rechazan en lugar de recortarse, porque MySQL sin modo
estricto los recortaría en silencio y se guardaría un dato falso.

## 5. Reglas de la v0.2

**Con la v0.2 el backend ya puede guardar `TB_Transcripcion`.** Todos los campos los calcula
Python; el backend solo valida y guarda.

**El backend no marca `COMPLETADO` si faltan campos de la v0.2:** la llamada queda en `ERROR`
con `mensaje_error = "CONTRATO_INCOMPLETO: ..."`. Así nunca se muestran los valores por defecto
de `TB_Llamada` (puntaje 0, `NEUTRO`) como si fueran un resultado real.

**Clasificación (cortes provisionales):**

| `clasificacion_final` | Cuándo |
|---|---|
| `CRITICO` | Alerta roja: subida de volumen de 2 s o más **y** `score_global_nlp < -0,3`, sin baja confianza |
| `NEGATIVO` | `puntaje_final` menor a 35 |
| `POSITIVO` | `puntaje_final` mayor a 65 |
| `NEUTRO` | El resto |

`puntaje_final = (0,55 × score_global_nlp + 0,45 × score_acustico + 1) × 50`. Con
`baja_confianza_audio: true`, es `(score_global_nlp + 1) × 50` y no hay `CRITICO`.

**Diagnóstico (provisional).** Solo en llamadas `NEGATIVO` o `CRITICO`; en las demás es
`SIN_CONFLICTO`. Es `FALLA_AGENTE` si el agente tiene texto negativo (promedio menor a -0,3) o
subidas de volumen, y `CLIENTE_PROBLEMATICO` si solo los tiene el cliente. Si no se puede atribuir a
nadie, es `SIN_CONFLICTO`. Con baja confianza no cuentan las subidas de volumen. **Todavía no revisa si
el agente omitió el script o interrumpió**, y depende de que `hablante` sea correcto.

**Para que los campos nunca vayan nulos**, porque las columnas son NOT NULL:

- **`hablante` viene siempre**, aunque la diarización no esté segura: es la mejor estimación
  entre `"AGENTE"` y `"CLIENTE"`, sin `null` ni un tercer valor. Se espera un acierto de 65 a 85 % en
  audio mono, sin medir aún con llamadas reales (`audio-processing/README.md`).
- **Audio sin voz o puro ruido (`segmentos: []`):** es un análisis válido, no un error. El JSON
  trae `baja_confianza_audio: true`, `score_global_nlp: 0.0`, `score_acustico: 0.0`,
  `clasificacion_final: "NEUTRO"`, `diagnostico_conflicto: "SIN_CONFLICTO"` y
  `puntaje_final: 50.00`, el punto neutro de la escala (sección 7). El backend marca
  `COMPLETADO` y no guarda filas en `TB_Transcripcion`.

### Alertas (v0.3)

El arreglo `alertas` va siempre en el primer nivel, vacío si no hay ninguna, y ordenado por
`timestamp_evento`. Cada alerta es una fila de `TB_Alerta`. Lo que detecta la v0.3:

| `tipo_alerta` | Cuándo | `origen_evento` y `timestamp_evento` | `valor_registrado` |
|---|---|---|---|
| `EXCESO_VOLUMEN` | Cada subida de volumen de RN-02 (más del 180 % del promedio móvil durante 2 s seguidos), la misma que usa `score_acustico` | El hablante con más tiempo dentro de la subida; el segundo en que empieza | El cuadro más fuerte, en dBFS del audio original: `"-8.5 dBFS"` |
| `ALTERACION_TONO` | Dentro de los segmentos de **un mismo hablante**, una ventana de 2 s cuyo F0 varía más del 40 % de la media de **ese hablante** (RN-02, "media del canal") | Ese hablante; el segundo en que empieza | La mediana del F0 en la ventana y la mayor variación medida (desviación estándar entre la media del hablante): `"235 Hz (variación 46 %)"` |
| `VOCABULARIO_INADECUADO` | Un segmento que contiene una palabra de la lista `vocabulario_inadecuado` de `audio-processing/lexico_es.json` | El `hablante` del segmento; su `inicio` | `"Palabra: estafa"` |

- **Una alerta por evento:** una subida o una ventana de tono que dura varios segundos da una sola
  alerta. Una palabra da una alerta por segmento, aunque se repita.
- **Con `baja_confianza_audio: true`** solo se emite `VOCABULARIO_INADECUADO`, porque las alertas de
  voz no son confiables con ruido (flujo E1).
- **Audio sin voz:** `alertas: []`.
- **`mensaje_sugerencia`** sale de una tabla fija por tipo y origen, en
  `audio-processing/reglas_alertas.json`. Usa los mismos textos que los datos simulados del frontend.
- **`ALTERACION_TONO` se mide por hablante** para no confundir el cambio entre dos voces con una
  alteración. `score_acustico` no cambia: sigue igual que en la v0.2.
- **`VOCABULARIO_INADECUADO`** no mira la negación: "no es una estafa" también la marca. La lista es
  **provisional**; el Blueprint solo da el ejemplo "estafa".

**Quedan para después:**

- **`OMISION_SCRIPT`:** necesita que el equipo defina el guion obligatorio (por ejemplo, saludo,
  identificación y despedida) y cómo se verifica en el texto.
- **Frases inadecuadas** ("no me haga perder el tiempo") y **sarcasmo** (RN-07): un léxico de palabras
  sueltas no las detecta.
- **Interrupciones** del agente: necesitan saber cuándo hablan los dos a la vez.

Columnas que **no** son del análisis y siguen siendo del backend: `fecha_inicio`,
`fecha_fin`, `estado_procesamiento`, `mensaje_error`, `hash_archivo` y `ruta_audio_storage`.

## 6. Reglas de versión

- Agregar un campo nuevo es compatible: sube la versión menor (`0.1` a `0.2`). El backend
  acepta cualquier `0.x` e ignora los campos que no conoce, pero para guardar un resultado
  exige los campos de la v0.2 (sección 5).
- **Propuesta para la v0.3:** si viene `alertas`, el backend las valida como el resto (tipos y orígenes
  del ENUM, tiempo dentro de `DECIMAL(8,3)`, textos dentro de su largo) y las guarda en la misma
  transacción que la llamada; si una no es válida, la llamada queda en `ERROR` con
  `CONTRATO_INCOMPLETO`. Si no viene (v0.2), la llamada se guarda sin alertas.
- Renombrar, quitar o cambiar el tipo de un campo sube la versión mayor (`1.x` a `2.0`) y
  requiere el visto bueno de los dos.

## 7. Decisiones del equipo

Las decisiones 1 a 6 y 8 son de Willy (28/10/2026, 02/11/2026 y 06/11/2026); la 7 es de Javier.

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
7. **Odómetro (Javier):** 100 es lo mejor del odómetro y el puntaje neutro es `50.00`.
8. **v0.2 aprobada como provisional (06/11):** se aceptan, para revisarlos con llamadas reales:
   - el umbral de `baja_confianza_audio` en -1,5, en lugar de -1,0, y el criterio de ruido con
     variaciones extremas;
   - los cortes de 35 y 65, y la alerta roja como `CRITICO`;
   - las reglas de `diagnostico_conflicto`;
   - RN-02 y RN-03 recalibrados: 180 % durante 2 s en lugar de 150 % durante 1,5 s, y la alerta roja
     exige también texto negativo.

### Por aprobar en la v0.3

- El arreglo `alertas` y las tres alertas que detecta (sección 5, "Alertas").
- La lista provisional de `vocabulario_inadecuado` y los mensajes de `reglas_alertas.json`.
- Que `OMISION_SCRIPT` espere a que el equipo defina el guion.
- La validación de las alertas en el backend (sección 6).

### Para revisar con llamadas reales

Dos efectos de las reglas actuales que señaló Willy:

1. Como `score_acustico` nunca es positivo, el máximo de `puntaje_final` es 77,5, y llegar a
   `POSITIVO` exige un `score_global_nlp` mayor a 0,545.
2. Con `baja_confianza_audio`, el puntaje usa solo el texto y puede llegar a 100. Con el mismo texto
   (0,8), una llamada limpia da 72 y una con ruido da 90: el ruido sube el puntaje.
