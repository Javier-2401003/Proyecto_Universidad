# Contrato: backend (Node) y análisis de audio (Python)

**Estado: v0.6 (guion obligatorio: `estado_guion` y `OMISION_SCRIPT`), propuesta por David y pendiente
de la revisión de Willy.** La v0.5 (gritos sostenidos) la aprobó Willy en el PR #68, con los puntos de la
sección 7 como provisionales; la implementan `audio-processing/analizar.py` (PR #69) y el procesamiento
del backend (`backend/src/procesamientoAudio.js`). Si alguien necesita un cambio, se hace primero aquí,
en un PR propio, y se avisa al otro.

- Script: `audio-processing/analizar.py` (instalación en `audio-processing/README.md`).
- Quién llama: el backend, después de que `POST /llamadas/lotes` dejó la llamada en
  `PENDIENTE` (ver `docs/api.md`).
- Qué devuelve: **un solo JSON por stdout**. El backend lo guarda en `TB_Llamada`,
  `TB_Transcripcion` y `TB_Alerta`.

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
  "version_contrato": "0.6",
  "archivo": "llamada_0001.mp3",
  "duracion_segundos": 268.553,
  "idioma": "es",
  "probabilidad_idioma": 1.0,
  "modelo": { "motor": "faster-whisper", "nombre": "base", "tipo_calculo": "int8" },
  "baja_confianza_audio": false,
  "score_global_nlp": 0.5,
  "score_acustico": -0.25,
  "puntaje_final": 64.77,
  "clasificacion_final": "NEUTRO",
  "diagnostico_conflicto": "SIN_CONFLICTO",
  "estado_guion": "CUMPLE",
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
| `baja_confianza_audio` | boolean | no | Flujo E1. Es `true` si no hubo segmentos, si `confianza_logprob_promedio < -1,5`, o si la relación señal/ruido medida es menor a 18 dB (**v0.4**; la v0.3 exigía además variaciones de volumen extremas). Con `true`, `puntaje_final` usa 100 % el texto. Criterio **provisional**. | `TB_Llamada.baja_confianza_audio` (0/1) |
| `score_global_nlp` | number (3 dec.) | no | De -1 a +1. Promedio de las frases con palabras clave (RN-01); 0 si no hay ninguna. | `TB_Llamada.score_global_nlp` |
| `score_acustico` | number (3 dec.) | no | De -1 a 0 por ahora: 0 sin subidas de volumen (incluidos los gritos sostenidos de la v0.5) o tono; nunca es positivo (RN-02). | `TB_Llamada.score_acustico` |
| `puntaje_final` | number (2 dec.) | no | De 0 a 100; 100 es lo mejor y 50 es neutro (RN-03). **v0.4:** usa toda la escala (fórmula en la sección 5); con la v0.3 el máximo era 77,5. | `TB_Llamada.puntaje_final` |
| `clasificacion_final` | string | no | `"POSITIVO"`, `"NEUTRO"`, `"NEGATIVO"` o `"CRITICO"` (reglas en la sección 5). | `TB_Llamada.clasificacion_final` |
| `diagnostico_conflicto` | string | no | `"FALLA_AGENTE"`, `"CLIENTE_PROBLEMATICO"` o `"SIN_CONFLICTO"` (reglas en la sección 5). | `TB_Llamada.diagnostico_conflicto` |
| `estado_guion` | string | no | **v0.6.** `"CUMPLE"`, `"NO_CUMPLE"` o `"PENDIENTE"` (sección 5, "Guion obligatorio"). Solo informativo: no cambia `puntaje_final`, `clasificacion_final` ni `diagnostico_conflicto`. | `TB_Llamada.estado_guion` (columna nueva, en un script `database/04_...sql` de Willy) |
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
| `CRITICO` | Alerta roja: subida de volumen de 2 s o más, incluidos los gritos sostenidos (v0.5), **y** `score_global_nlp < -0,3`, sin baja confianza |
| `NEGATIVO` | `puntaje_final` menor a 35 |
| `POSITIVO` | `puntaje_final` mayor a 65 |
| `NEUTRO` | El resto |

`combinado = 0,55 × score_global_nlp + 0,45 × score_acustico`, que va de -1 a 0,55 porque
`score_acustico` nunca es positivo. **v0.4:** el lado positivo se estira hasta 100.

- Si `combinado` es mayor que 0: `puntaje_final = 50 + 50 × combinado / 0,55`.
- Si no: `puntaje_final = 50 + 50 × combinado`, igual que en la v0.3.

Así 50 sigue siendo neutro, el lado negativo no cambia y una llamada con texto +1 sin subidas llega a
100. `POSITIVO` (más de 65) pide `combinado` mayor a 0,165: sin subidas, un texto mayor a +0,3, el
umbral de RN-01. Con `baja_confianza_audio: true`, es `(score_global_nlp + 1) × 50` y no hay `CRITICO`;
con texto positivo y sin subidas, da lo mismo que una llamada limpia. En la v0.3 era
`(combinado + 1) × 50`, con un máximo de 77,5.

**Diagnóstico (provisional).** Solo en llamadas `NEGATIVO` o `CRITICO`; en las demás es
`SIN_CONFLICTO`. Es `FALLA_AGENTE` si el agente tiene texto negativo (promedio menor a -0,3) o
subidas de volumen, y `CLIENTE_PROBLEMATICO` si solo los tiene el cliente. Si no se puede atribuir a
nadie, es `SIN_CONFLICTO`. Con baja confianza no cuentan las subidas de volumen. **No revisa si el
agente omitió el guion** (eso va aparte, en `estado_guion`, y no cambia el diagnóstico) **ni si
interrumpió**, y depende de que `hablante` sea correcto.

**Guion obligatorio (v0.6, decisión 6 del 14/11).** Cuatro pasos, buscados solo en los segmentos del
`AGENTE`:

| Paso | Dónde se busca | Frases (lista completa y editable en `audio-processing/guion.json`) |
|---|---|---|
| Saludo | Segmentos del agente que empiezan en los primeros 20 s | "buenos días", "buenas tardes", "buenas noches", "hola", "gracias por llamar", "gracias por comunicarse" |
| Identificación | Primeros 60 s | "mi nombre es", "le saluda", "le atiende", "le habla", "habla con" |
| Ofrecer ayuda | Primeros 60 s | "en qué le puedo ayudar", "en qué puedo ayudarle", "en qué le puedo servir", "en qué le puedo colaborar"… |
| Cierre | Segmentos del agente que terminan en los últimos 30 s | "algo más en que pueda ayudarle", "gracias por llamar", "que tenga buen día / buena tarde / una excelente…", "hasta luego"… |

- **Tolerancia a errores de Whisper:** una frase cuenta si un grupo de palabras del agente se le parece en
  un 80 % o más, sin mirar tildes, mayúsculas ni signos ("buenas tarde", "en que le puedo ayudar"). No
  alcanza para errores grandes ("Puede estarles" por "Buenas tardes").
- **`estado_guion`:** `"CUMPLE"` si están los cuatro pasos, y `"NO_CUMPLE"` si falta alguno. Es
  `"PENDIENTE"` si no es confiable evaluarlo: con `baja_confianza_audio: true`, sin segmentos del agente
  o si el agente habló menos de 8 s en total.
- **Alertas:** una `OMISION_SCRIPT` por cada paso que falte (sección 5, "Alertas"). Con `"PENDIENTE"` no
  se emite ninguna.
- **Solo informativo:** no cambia `puntaje_final`, `clasificacion_final` ni `diagnostico_conflicto`. Pasará
  a afectar la calificación solo si el equipo lo decide después de medir con llamadas reales que cada paso
  acierta en al menos el 90 % de los casos.
- **Depende de `hablante`:** si los roles salen invertidos, las frases del agente quedan como del cliente
  y la llamada sale `"NO_CUMPLE"` aunque el agente haya seguido el guion.

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
`timestamp_evento`. Cada alerta es una fila de `TB_Alerta`. Lo que detecta (v0.3, y `OMISION_SCRIPT`
desde la v0.6):

| `tipo_alerta` | Cuándo | `origen_evento` y `timestamp_evento` | `valor_registrado` |
|---|---|---|---|
| `EXCESO_VOLUMEN` | Cada subida de volumen de RN-02 (más del 180 % del promedio móvil durante 2 s seguidos) **o grito sostenido (v0.5)**: un hablante 6 dB o más por encima del volumen típico del otro durante 2 s seguidos, si su texto en la llamada es negativo. Son las mismas que usa `score_acustico` | El hablante con más tiempo dentro de la subida; el segundo en que empieza | El cuadro más fuerte, en dBFS del audio original: `"-8.5 dBFS"` |
| `ALTERACION_TONO` | Dentro de los segmentos de **un mismo hablante**, una ventana de 2 s cuyo F0 varía más del 40 % de la media de **ese hablante** (RN-02, "media del canal") | Ese hablante; el segundo en que empieza | La mediana del F0 en la ventana y la mayor variación medida (desviación estándar entre la media del hablante): `"235 Hz (variación 46 %)"` |
| `VOCABULARIO_INADECUADO` | Un segmento que contiene una palabra de la lista `vocabulario_inadecuado` de `audio-processing/lexico_es.json` | El `hablante` del segmento; su `inicio` | `"Palabra: estafa"` |
| `OMISION_SCRIPT` | **v0.6.** Un paso del guion obligatorio que el agente no dijo ("Guion obligatorio", arriba): una alerta por paso. No se emite con `estado_guion: "PENDIENTE"` | `AGENTE`; el segundo 0 para saludo, identificación y ofrecer ayuda, y el inicio del último segmento del agente para el cierre | `"Falta: saludo"`, `"Falta: identificación"`, `"Falta: ofrecer ayuda"` o `"Falta: cierre"` |

- **Una alerta por evento:** una subida o una ventana de tono que dura varios segundos da una sola
  alerta. Una palabra da una alerta por segmento, aunque se repita.
- **Con `baja_confianza_audio: true`** solo se emite `VOCABULARIO_INADECUADO`, porque las alertas de
  voz no son confiables con ruido (flujo E1).
- **Audio sin voz:** `alertas: []`.
- **`mensaje_sugerencia`** sale de una tabla fija por tipo y origen, en
  `audio-processing/reglas_alertas.json`. Usa los mismos textos que los datos simulados del frontend.
- **`ALTERACION_TONO` se mide por hablante** para no confundir el cambio entre dos voces con una
  alteración, y descarta los errores de octava de `pyin`: cuadros con más del doble o menos de la mitad
  de la mediana de ese hablante. Sin ese filtro, una llamada real tranquila daba 7 alertas falsas.
  `score_acustico` no cambia: sigue igual que en la v0.2.
- **`VOCABULARIO_INADECUADO`** no mira la negación: "no es una estafa" también la marca. La lista es
  **provisional**; el Blueprint solo da el ejemplo "estafa".

**Quedan para después:**

- **Frases inadecuadas** ("no me haga perder el tiempo") y **sarcasmo** (RN-07): un léxico de palabras
  sueltas no las detecta.
- **Interrupciones** del agente: necesitan saber cuándo hablan los dos a la vez.

Columnas que **no** son del análisis y siguen siendo del backend: `fecha_inicio`,
`fecha_fin`, `estado_procesamiento`, `mensaje_error`, `hash_archivo` y `ruta_audio_storage`.

## 6. Reglas de versión

- Agregar un campo nuevo es compatible: sube la versión menor (`0.1` a `0.2`). El backend
  acepta cualquier `0.x` e ignora los campos que no conoce, pero para guardar un resultado
  exige los campos de la v0.2 (sección 5).
- **Desde la v0.3 (aprobado el 10/11):** si viene `alertas`, el backend las valida como el resto (tipos y orígenes
  del ENUM, tiempo dentro de `DECIMAL(8,3)`, textos dentro de su largo) y las guarda en la misma
  transacción que la llamada; si una no es válida, la llamada queda en `ERROR` con
  `CONTRATO_INCOMPLETO`. Si no viene (v0.2), la llamada se guarda sin alertas.
- Cambiar cómo se calcula un campo, sin cambiar su tipo ni su rango, también sube la versión menor
  (`0.3` a `0.4`). El backend no cambia, pero los puntajes de versiones distintas no se comparan: una
  llamada analizada con la v0.3 conserva su escala hasta que se reprocese. La versión de cada análisis
  queda en la auditoría (`detalle_cambio.version_contrato`).
- Renombrar, quitar o cambiar el tipo de un campo sube la versión mayor (`1.x` a `2.0`) y
  requiere el visto bueno de los dos.

## 7. Decisiones del equipo

Las decisiones 1 a 6, 8, 9, 11 y 12 son de Willy (28/10/2026, 02/11/2026, 06/11/2026, 10/11/2026,
14/11/2026 y PR #68); la 7 es de Javier, y la 10 y la 13, del equipo.

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
     variaciones extremas (la v0.4 propone cambiarlo, abajo);
   - los cortes de 35 y 65, y la alerta roja como `CRITICO`;
   - las reglas de `diagnostico_conflicto`;
   - RN-02 y RN-03 recalibrados: 180 % durante 2 s en lugar de 150 % durante 1,5 s, y la alerta roja
     exige también texto negativo.
9. **v0.3 aprobada (10/11, PR #41):** se aceptan como provisionales las tres alertas, la lista de
   `vocabulario_inadecuado` y los mensajes de `reglas_alertas.json`. `OMISION_SCRIPT` espera el guion del
   equipo, y una alerta no válida deja la llamada en `ERROR` con `CONTRATO_INCOMPLETO` (sección 6).
10. **Decisiones del equipo del 11/11 (PR #46)** sobre el análisis:
    - Se acepta que RN-02 y RN-03 se aparten del Blueprint, como en la decisión 8.
    - Los cortes 35 y 65 se quedan, provisionales, hasta medir con llamadas reales.
    - `puntaje_final` se reescala para usar de 0 a 100: es la v0.4 (abajo).
    - Las palabras de cancelación o amenaza y los gritos pesan más que la cortesía. Se hizo en el
      léxico y en `score_acustico` (PR #52), sin cambiar este contrato.
11. **v0.4 aprobada (14/11, PR #53):** con la fórmula lineal y el criterio de ruido de 18 dB, los dos
    provisionales. Willy anota que el backend todavía no puede reprocesar una llamada `COMPLETADO`, así
    que los promedios mezclan puntajes de la v0.3 y la v0.4 hasta que se reprocesen.

### v0.4 (aprobada el 14/11)

- **La fórmula de `puntaje_final` de la sección 5.** Resuelve los dos efectos que señaló Willy en la
  v0.3:
  - el máximo era 77,5, y `POSITIVO` exigía un `score_global_nlp` mayor a 0,545;
  - con el mismo texto (0,8) y sin subidas, una llamada limpia daba 72 y una con ruido 90.
- **Efecto medido** con 27 llamadas (17 armadas, 5 de la demo, 2 de la prueba del 06/11 y 3
  descargadas), con los pesos del PR #52:

  | | v0.3 | v0.4 |
  |---|---|---|
  | Máximo posible | 77,5 | 100 |
  | Positiva de la prueba de Willy (10/11) | `NEUTRO`, 62,36 | `POSITIVO`, 72,5 |
  | Texto 0,8 sin subidas: limpia / con ruido | 72 / 90 | 90 / 90 |
  | Llamadas que cambian de clase | - | 7, todas de `NEUTRO` a `POSITIVO` |
  | Negativas y críticas | - | Sin cambios |

- **Efecto a decidir:** de esas 7, 3 son positivas que antes no llegaban. Las otras 4 son consultas
  neutras que terminan con "gracias" o "perfecto": su texto da +0,5, igual que una llamada satisfecha,
  y salen `POSITIVO` (de 66 a 72).
  - Si el equipo prefiere que sigan `NEUTRO`, la alternativa es estirar el lado positivo en curva:
    `50 + 50 × (combinado / 0,55)²`.
  - También llega a 100 y no cambia ninguna clase de las 27 llamadas, pero la positiva de Willy sigue
    `NEUTRO` (60,1).
- **Puntajes anteriores:** las llamadas analizadas con la v0.3 conservan su escala hasta que se
  reprocesen (sección 6).
- **Javier:** los datos simulados del frontend generan las positivas entre 65 y 77,5
  (`frontend/src/api/simulacion/listado.js`); con la v0.4 pueden llegar a 100.
- **El criterio de ruido de `baja_confianza_audio` (tabla de la sección 3):** señal/ruido medida menor a
  18 dB, sin exigir variaciones extremas de volumen. Resuelve otro efecto que vio Willy el 10/11: con
  ruido de calle, el texto se degradaba y la bandera quedaba en `false`.
  - Con la v0.3 no se activa nunca con ruido de calle: un ruido constante no llega a los 12 dB de
    variación que exigía.
  - Medido con 6 llamadas armadas y ruido de calle mezclado dentro de la banda de la voz:

    | Ruido mezclado | Señal/ruido medida | Texto igual al de la llamada limpia | v0.3 | v0.4 |
    |---|---|---|---|---|
    | Sin ruido | 26-27 dB | 100 % | `false` | `false` |
    | 10 dB | 19-21 dB | 76-92 % | `false` | `false` |
    | 5 dB | 15-17 dB | 67-80 % | `false` | `true` |
    | 0 dB | 13-15 dB | 30-69 % | `false` | `true` |

  - Las 17 llamadas armadas miden de 26 a 36 dB, y las de la demo más, por sus silencios digitales. Llamadas reales: la de soporte con
    conflicto mide 40,5 dB y la de radio 25,6 dB, pero dos recortes de la de radio miden 19,4 y 19,6 dB.
    Ninguna se marca, aunque esos recortes quedan cerca del corte.
  - Con `true`, el puntaje usa solo el texto, no hay `CRITICO` y solo salen alertas de vocabulario: un
    auto que pasa ya no puede contar como grito.

12. **v0.5 aprobada (PR #68):** gritos sostenidos por tramos y con texto negativo, y el margen de 6 dB
    provisional. Willy anota que una llamada con gritos de principio a fin da muchas alertas (33 en la
    real); si molesta en pantalla, se pueden unir los tramos cercanos más adelante.
13. **Guion obligatorio (decisión 6 del 14/11, PRs #59 y #63):** cuatro pasos buscados en los segmentos
    del agente, solo informativo, y "pendiente" cuando no es confiable evaluarlo. David define las
    frases y la tolerancia a errores de Whisper: es la v0.6 (abajo).

### v0.5 (aprobada)

- **Gritos sostenidos (`EXCESO_VOLUMEN`, sección 5).** RN-02 compara con el promedio de los 30 s
  anteriores: si un cliente grita casi toda la llamada, ese promedio ya es su grito y nunca lo supera. En
  la llamada real con conflicto (8 min 56 s), la clienta grita e insulta todo el tiempo y no salía ningún
  `EXCESO_VOLUMEN`, así que no llegaba a `CRITICO`. Se aparta de RN-02 a propósito: el análisis prioriza
  funcionar con llamadas reales de distintos tipos por encima de seguir el Blueprint al pie de la letra.
- **Propuesta:** implementa la decisión 7 del 14/11 (`docs/avance.md`). También es `EXCESO_VOLUMEN`
  cuando un hablante está **6 dB o más por encima del volumen típico (la mediana) del otro**, en sus
  propios segmentos, **durante 2 s seguidos** (con pausas de hasta 0,5 s), **y su texto en la llamada es
  negativo**. Cuenta igual que las demás subidas: en `score_acustico`, en la alerta roja y en el
  diagnóstico.
- **Diferencias con la decisión 7**, para que el equipo las confirme:
  - **Calibración:** el umbral de 6 dB se queda. Las llamadas sin gritos difieren como mucho 4,4 dB, y
    las que tienen gritos, 6,8 dB o más.
  - **Por tramos y no por "la mayor parte de lo que habla":** cada racha de 2 s o más es un
    `EXCESO_VOLUMEN` en su momento. Así la alerta dice cuándo gritó, y también se detecta a quien grita
    solo durante una parte de la llamada. Una llamada con gritos de principio a fin da muchas alertas: la
    real con conflicto da 33.
  - **El texto negativo** es una condición nueva (motivo abajo).
- **Por qué el texto negativo:** en una grabación real, el canal del cliente puede sonar más fuerte que el
  del agente por el micrófono, la línea o la distancia, sin que nadie grite. Probé señales de esfuerzo
  vocal que no dependen del volumen del canal (los agudos frente a los graves, y el tono), pero cambian
  más con el canal y la voz que con el grito: en la llamada real, la clienta que grita tenía menos agudos
  que el agente. En un call center, un grito casi siempre va con palabras negativas, y un cliente
  tranquilo con la línea más fuerte no se marca.
- **Medido** con 27 llamadas (17 armadas, 5 de la demo, 2 de la prueba del 06/11 y 3 descargadas):

  | Llamadas | Diferencia de volumen entre hablantes | Gritos sostenidos | Clase |
  |---|---|---|---|
  | 20 sin gritos (incluidas 2 reales) | de -4,4 a +4,4 dB | Ninguno | Sin cambios |
  | 5 armadas con un cliente que grita | de +8,3 a +12,8 dB | Del cliente | Sin cambios: 3 ya eran `CRITICO`, y 2 siguen `NEGATIVO` porque su texto no llega a -0,3 |
  | Demo con un agente grosero que habla más fuerte | el agente, +6,8 dB | 2, del agente | `NEGATIVO` → `CRITICO`, `FALLA_AGENTE` |
  | Real con conflicto | +7,7 dB | 33, de la clienta | `NEGATIVO` → **`CRITICO`** |

- **Riesgo:** solo hay 3 llamadas reales. Un cliente con la línea 6 dB más fuerte, que no grita pero sí
  dice palabras negativas, se marcaría. Queda provisional.
- **Backend:** no cambia. Son los mismos campos y valores; solo puede haber más `EXCESO_VOLUMEN` y más
  `CRITICO` en llamadas con gritos sostenidos.

### Por aprobar en la v0.6

- **El guion obligatorio de la sección 5:** el campo nuevo `estado_guion` (`"CUMPLE"`, `"NO_CUMPLE"` o
  `"PENDIENTE"`) y las alertas `OMISION_SCRIPT`. Implementa la decisión 13 (decisión 6 del 14/11).
- **Ventanas que no fijó la decisión:** identificación y ofrecer ayuda se buscan en los primeros 60 s,
  igual que el saludo pero con más margen, porque algunos agentes se presentan después de saludar a la
  empresa. "Casi no habló" es menos de 8 s de voz del agente.
- **Tolerancia:** 80 % de parecido por grupo de palabras. Probé además una comparación "fonética"
  (juntar palabras e igualar b/v, s/z/c, k/qu, h muda, ll/y). Recuperaba solo 2 de los 15 pasos perdidos
  con ruido y "encontraba" un saludo y una presentación en un agente grosero que no los dice, así que la
  descarté.
- **Medido** con las 16 llamadas armadas, cuyos guiones conozco (qué pasos dice cada agente), y con 6 de
  ellas mezcladas con ruido de calle:

  | Audio | Pasos bien detectados | `estado_guion` |
  |---|---|---|
  | Sin ruido | 68 de 68 | Correcto en todas |
  | Ruido de 20 y 10 dB | 44 de 48 | Los errores son de una llamada con los roles invertidos por el ruido y de un cierre mal transcrito |
  | Ruido de 5 y 0 dB | — | `"PENDIENTE"`: esas llamadas tienen `baja_confianza_audio` |

- **Llamadas reales:** no hay ninguna con el guion conocido, así que el 90 % por paso que pide la decisión
  todavía no se puede medir.
- **Backend:** el campo nuevo sube la versión menor (sección 6). Willy agrega `TB_Llamada.estado_guion`
  en un script `database/04_...sql` y lo devuelve en `GET /llamadas` y `GET /llamadas/:id_llamada`.
  `OMISION_SCRIPT` ya es un valor válido de `TB_Alerta`.

### Para revisar con llamadas reales

1. Los cortes 35 y 65 (decisión 10).
2. Si una consulta neutra y cortés debe salir `POSITIVO` (efecto de la v0.4).
3. Con `baja_confianza_audio` el puntaje usa solo el texto: con texto negativo sigue bajando más que en
   una llamada limpia (texto -0,5 sin subidas: 36,25 limpia, 25 con ruido).
4. El corte de 18 dB: hay pocas llamadas reales para confirmarlo, y los recortes de la de radio quedan a
   1,4 dB. Con ruido de 10 dB la bandera no se activa, pero `hablante` ya puede invertirse (en una
   llamada, 9 % de acierto), porque Whisper deforma las frases típicas del agente.
5. El margen de 6 dB de los gritos sostenidos (v0.5): cuánto difieren el canal del agente y el del
   cliente en grabaciones reales, sin gritos.
6. El guion (v0.6): cuánto acierta cada paso con llamadas reales, antes de que pueda afectar la
   calificación (decisión 13), y si las ventanas de 20, 60 y 30 s alcanzan.
