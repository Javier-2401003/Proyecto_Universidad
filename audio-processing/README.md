# Procesamiento de audio (David)

Script que recibe un audio de una llamada y devuelve, en un JSON por la salida
estándar, la transcripción con tiempos por segmento, el tono (F0), el volumen (RMS)
y la duración. El formato exacto del JSON está en `docs/contrato_audio.md`.

Todo corre en local y es gratuito: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(MIT) para transcribir y [librosa](https://librosa.org/) (ISC) para el análisis
acústico. No usa la API de OpenAI ni ningún servicio en la nube.

## Instalación en Windows, paso a paso

Se necesita Windows 10/11 y unos 2 GB libres en disco (entorno y modelos). No hace
falta GPU.

### 1. Python 3.12 o 3.13

Se recomienda **Python 3.12**. **Python 3.13 también funciona** (probado con 3.13.5: instala solo con
paquetes ya compilados). Con versiones más nuevas pueden faltar paquetes compilados (numba,
ctranslate2) y pip intentaría compilarlos, lo que falla sin Visual C++.

Opción A, instalador oficial:
1. Descargue "Windows installer (64-bit)" de Python 3.12 en https://www.python.org/downloads/windows/.
2. En la primera pantalla marque **"Add python.exe to PATH"** y pulse **Install Now**.
3. Abra una terminal nueva (PowerShell) y compruebe:
   ```powershell
   py -3.12 --version
   ```

Opción B, si ya tiene [uv](https://docs.astral.sh/uv/):
```powershell
uv python install 3.12
```

### 2. ffmpeg: no hace falta instalarlo

faster-whisper lee el audio con PyAV, que ya trae ffmpeg incluido. Lee mp3, wav, ogg,
m4a y los demás formatos habituales sin instalar nada aparte. Solo `openai-whisper`
necesita `ffmpeg.exe` en el PATH, y este proyecto no lo usa (ver "Comparación" abajo).

### 3. Entorno virtual y dependencias

Desde la raíz del repositorio:
```powershell
cd audio-processing
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```
Con uv, la línea del venv es `uv venv --seed --python 3.12 venv`.

La carpeta `venv/` está en `.gitignore`: no se sube al repositorio.

### 4. Primera ejecución

```powershell
.\venv\Scripts\python.exe analizar.py C:\ruta\a\llamada.mp3
```
La primera vez tarda más por dos razones, y las dos pasan una sola vez:
- **Descarga el modelo** de Hugging Face (gratis, sin cuenta): `base` pesa unos 145 MB
  y `small` unos 480 MB. Se guardan en `%USERPROFILE%\.cache\huggingface`.
- **numba compila** las funciones de librosa (unos 50 s) y deja el resultado en caché.

Los avisos que salen en esa primera vez son normales y se pueden ignorar:
`HF_TOKEN` (no hace falta cuenta) y `symlinks` (Windows sin modo desarrollador).
Una vez descargados los modelos, puede trabajar sin internet con
`$env:HF_HUB_OFFLINE = "1"`.

## Uso

```powershell
.\venv\Scripts\python.exe analizar.py ruta_del_audio [--modelo base|small] [--idioma es]
```

- `--modelo`: `base` (por defecto, más rápido) o `small` (algo más preciso, el doble de lento).
- `--idioma`: `es` por defecto.
- **stdout**: solo el JSON, en UTF-8. Se puede guardar con `> resultado.json`.
- **stderr**: mensajes de avance y advertencias.
- **Código de salida**: `0` si todo salió bien; `1` si hubo un error. En ese caso el JSON
  es `{ "error": { "codigo", "mensaje", "detalles" } }`.

Ejemplo de salida (recortado):
```json
{
  "version_contrato": "0.2",
  "archivo": "llamada.wav",
  "duracion_segundos": 268.553,
  "idioma": "es",
  "modelo": { "motor": "faster-whisper", "nombre": "base", "tipo_calculo": "int8" },
  "baja_confianza_audio": false,
  "score_global_nlp": 0.5,
  "score_acustico": 0.0,
  "puntaje_final": 63.75,
  "clasificacion_final": "NEUTRO",
  "diagnostico_conflicto": "SIN_CONFLICTO",
  "resumen_acustico": { "f0_mediana_hz": 213.64, "rms_promedio_dbfs": -20.05, "...": "..." },
  "segmentos": [
    { "indice": 0, "inicio": 0.0, "fin": 7.0,
      "hablante": "AGENTE",
      "texto": "Buenas tardes, gracias por llamar a servicio al cliente...",
      "score_sentimiento": 0.5, "f0_hz": 213.64, "rms_dbfs": -20.25, "confianza_logprob": -0.155, "probabilidad_sin_voz": 0.013 }
  ]
}
```

## Cómo funciona

1. Decodifica el audio a mono, 16 kHz (`faster_whisper.decode_audio`).
2. Transcribe con faster-whisper en CPU (`int8`), con filtro de voz (VAD) para saltar silencios.
3. Calcula el F0 con `librosa.pyin` (65-500 Hz) y el RMS con `librosa.feature.rms`, en
   cuadros de 20 ms.
4. Para cada segmento de Whisper toma la **mediana del F0** (solo cuadros con voz) y la
   **energía RMS media en dBFS** (0 dBFS es el máximo digital; los valores son negativos).
5. Puntúa cada segmento con el léxico (`lexico.py`, ver abajo).
6. Busca subidas de volumen y tono en todo el audio y calcula `score_acustico`, `puntaje_final` y
   `clasificacion_final` (`acustico.py`, ver abajo).

## Sentimiento por léxico (RN-01)

Las palabras están en `lexico_es.json`, sin tocar código. RN-01 fija la escala de -1 a +1, los
umbrales de ±0,3 y 11 palabras clave (`oficial_rn01`). **No define la fórmula**, así que estas
reglas son una decisión del proyecto, no del Blueprint:

- Cada palabra clave vale ±0,5 y la suma de la frase se limita a ±1. Una sola palabra ya cruza
  el umbral de ±0,3; una frase sin palabras clave queda en 0.
- "no", "sin" o "tampoco" hasta 3 palabras antes, sin una coma de por medio, invierten el
  signo: "no es una estafa" suma, y "no, gracias" sigue siendo positiva.
- `score_global_nlp` es el promedio de las frases con alguna palabra clave, o 0 si no hay ninguna.
- `ampliacion_no_oficial` agrega plurales, femeninos y palabras como "molesto" o "terrible".
  **No está en el Blueprint.** Hay que vaciar esa lista para usar solo RN-01.

Para ejecutar las pruebas, desde `audio-processing/` (no necesitan audio ni instalar nada más):
```powershell
.\venv\Scripts\python.exe -m unittest -v
```

**Límites conocidos:**
- No detecta sarcasmo ni contexto, aunque RN-07 lo pide para calificar una llamada como crítica.
- Hay falsos positivos: "nunca tuve problemas" cuenta como negativa, porque RN-01 incluye "nunca",
  y "no quiero cancelar" cuenta como positiva por la negación.
- Depende del texto de Whisper: lo que no se transcribe no se puntúa.
- El global puede engañar con pocas frases. En una llamada de asesoría sobre una deuda (4 min 44 s,
  modelo `small`), solo dos despedidas tuvieron palabras clave ("Ok, gracias") y `score_global_nlp`
  dio **+0,75**, porque Whisper casi no transcribió a quien llamaba. Falta validarlo con llamadas
  de call center etiquetadas; **este resultado no mide precisión**.

## Análisis acústico (RN-02)

Los valores están en `reglas_acusticas.json`, separados por su origen:

| Sección | Qué contiene |
|---|---|
| `rn02`, `rn03` | Valores del Blueprint: tramos de 500 ms, desviación de F0 del 40 %, pesos 55/45 y subida de 2 s |
| `recalibracion_falsos_positivos` | **Se apartan del Blueprint a propósito**, para bajar las falsas alarmas |
| `decisiones_del_proyecto` | Lo que el Blueprint no define: filtro, ventanas, cortes y criterio de ruido |

**Qué se recalibró frente al Blueprint:**

| Regla | Blueprint | Ahora |
|---|---|---|
| Elevación de volumen (RN-02) | 150 % del promedio móvil, 1,5 s acumulados | **180 %, 2,0 s seguidos**, tolerando pausas de hasta 0,5 s |
| Alerta roja (RN-03) | Subida de 2 s, sea cual sea el texto | Subida de volumen de 2 s **y** `score_global_nlp < -0,3` |

**Cómo funciona:**

1. **Preparación del audio:** para medir RN-02, el audio pasa por un filtro de 80 a 4000 Hz y se
   normaliza. Solo se usa para esta regla: `rms_dbfs` sigue midiendo el audio original.
2. **Voz y ruido:** se estima el ruido en cada audio, y lo que no llega a voz no entra al promedio móvil.
3. **`score_acustico`:** es 0 sin eventos y baja hasta -1 cuando los eventos ocupan el 25 % del tiempo
   con voz. **Nunca es positivo**, porque una voz tranquila no prueba satisfacción. Sin segmentos es 0.
4. **`puntaje_final`:** `(0,55 × NLP + 0,45 × acústico + 1) × 50`, donde 100 es lo mejor. Con texto
   neutro o positivo, la voz solo baja este puntaje. Como `score_acustico` nunca es positivo, el máximo
   es 77,5.
5. **`clasificacion_final`:** `CRITICO` si hay alerta roja; `NEGATIVO` bajo 35; `POSITIVO` sobre 65;
   `NEUTRO` en el resto. **Los cortes son provisionales**: el Blueprint no los define.
6. **Flujo E1:** `baja_confianza_audio` es `true` si no hay segmentos, si Whisper está poco seguro, o si
   hay ruido de fondo (menos de 15 dB entre voz y ruido) con variaciones extremas (12 dB o más sobre la
   mediana). Con esa bandera, el puntaje usa **100 % el texto** y no hay alerta roja.

**Resultados de la calibración:** se probó con una sola llamada real (asesoría que parece tranquila,
4 min 44 s), subiendo la ganancia en 12 posiciones para simular gritos:

| Volumen / duración / pausa | Eventos de volumen falsos | 3 s × 2 | 3 s × 3 | 5 s × 2 | 5 s × 3 |
|---|---|---|---|---|---|
| 150 % / 2,0 s / sin pausa | 1 | 8 de 12 | 11 de 12 | 9 de 12 | 12 de 12 |
| **180 % / 2,0 s / 0,5 s (actual)** | **0** | 6 de 12 | 11 de 12 | 7 de 12 | 12 de 12 |
| 200 % / 2,5 s / 0,5 s | 0 | 3 de 12 | 8 de 12 | 3 de 12 | 9 de 12 |

Antes esa llamada daba `score_acustico` -0,304, con 15 eventos de volumen. Ahora da **-0,128**, sin
eventos de volumen, y queda `NEUTRO` con 60,87 puntos. Lo que queda viene de los eventos de tono.
El filtro y la normalización casi no cambiaron el resultado en esta llamada; lo que más influyó fue
pasar de acumular a exigir continuidad y subir el umbral.

**Límites conocidos:**

- **La sensibilidad bajó.** Un grito simulado de 3 s al doble de volumen se pierde en la mitad de las
  posiciones. Eso puede dificultar el 88 % de acierto que exige el Blueprint sobre 50 muestras con
  gritos, y **ese 88 % sigue sin medirse**: aquí solo hubo ganancias simuladas, no gritos reales.
- **Calibrado con un solo audio real.** Hay que repetirlo con llamadas de call center antes de darlo
  por bueno.
- **Todavía no distingue hablantes.** RN-02 pide comparar con el promedio de cada hablante, pero sin
  diarización se compara con toda la mezcla. Los eventos de tono pueden ser cambios de voz o errores
  de `pyin`, y por eso solo el volumen cuenta como subida sostenida para la alerta roja.
- **E1 con la baja confianza de Whisper:** si Whisper está poco seguro, también se usa 100 % el texto,
  aunque justo ese texto sea el dudoso. Hay que revisarlo con audios ruidosos reales.

## Tiempos medidos

Equipo: laptop AMD Ryzen 7 5825U (8 núcleos), 14 GB de RAM, sin GPU, Windows 11.
Audio: 4 min 29 s (268,6 s) de voz en español generada con la voz "Sabina" de Windows.
Cada medida es la segunda ejecución, con el modelo ya descargado.

| Motor | Modelo | Transcripción | Acústico (F0 + RMS) | Total | Memoria pico |
|---|---|---|---|---|---|
| faster-whisper (int8) | base | 46 s | 10 s | **58 s** | 570 MB |
| faster-whisper (int8) | small | 89 s | 10 s | **101 s** | 740 MB |
| openai-whisper (fp32) | base | 53 s | - | - | 830 MB |
| openai-whisper (fp32) | small | 91 s | - | - | 1770 MB |

Lectura rápida: con `base`, un audio de 4,5 min tarda **cerca de 1 minuto** (unas 4,6 veces
más rápido que el tiempo real); con `small`, **cerca de 1 min 40 s**. Un lote de 15 llamadas
de 4-5 min tomaría unos 15 min con `base` y unos 25 min con `small`.

**Cuidado:** la voz sintética es limpia y monótona. Con una llamada real de radio de 4 min 44 s,
`base` tardó de **36 a 47 s** y `small` unos **85 s** (70 s de transcripción y 12 s de análisis acústico). Falta medir con
llamadas de call center.

**Problema detectado en esa llamada:** entre los segundos 47 y 126 hay sonido, pero Whisper casi
no transcribe a quien llama, con o sin filtro de voz. Aún no se sabe la causa ni si pasa en
otras llamadas.

### Comparación con openai-whisper

En esta laptop las dos librerías tardan casi lo mismo, pero openai-whisper:
- usa el **doble o más de memoria** (1,77 GB con `small`), lo cual pesa en una laptop de 8 GB;
- instala **PyTorch** (unos 700 MB más en disco);
- necesita `ffmpeg.exe` instalado aparte.

La calidad del texto fue la misma en las dos (por ejemplo, ambas transcriben mal "solución"
como "sal o quién" o "saluquien" en la voz sintética). Por eso el proyecto usa
**faster-whisper**. La comparación se hizo en un entorno temporal fuera del repositorio.

## Baja confianza

`baja_confianza_audio` es `true` si no hay segmentos, si hay ruido con variaciones extremas (ver
"Análisis acústico") o si `confianza_logprob` promedio es menor a **-1,5**. El valor anterior, -1,0,
marcó como ruidosa una voz real (-1,142, en la revisión de Willy). Para elegirlo se agregó ruido blanco a 2 minutos de una llamada real (modelo
`base`) y se comparó el texto con el del audio original:

| Relación señal/ruido | Confianza promedio | Palabras que coinciden con el texto original |
|---|---|---|
| Sin ruido | -0,33 | 100 % |
| 20 dB | -0,37 | 90 % |
| 10 dB | -0,53 | 72 % |
| 5 dB | -0,71 | 59 % |
| 0 dB | -1,60 | 32 % |
| -5 dB | -4,03 | 5 % |

**Es provisional:** sale de un solo audio con ruido agregado y del dato de Willy, no de varias
grabaciones reales. Hay que repetirlo con grabaciones reales de la laptop de cada integrante,
incluida la de Willy.

## Separación de agente y cliente

`diarizacion.py` no usa pyannote ni PyTorch, y no necesita token. Cada segmento lleva `hablante`, y
siempre es `AGENTE` o `CLIENTE`, aunque la separación no sea segura:

1. **Por canales:** si el archivo trae dos canales distintos, izquierdo = agente y derecho = cliente
   (Blueprint, 3.2.1). Un estéreo con la misma mezcla en ambos canales no cuenta.
2. **Por voz:** si no, reparte ventanas de 1 s en dos grupos, según timbre (MFCC) y tono (F0).
3. **Quién es el agente:** el grupo con más frases típicas de agente (`reglas_diarizacion.json`); si
   empatan, quien habla primero.

**Precisión medida** con conversaciones armadas con voces de Windows (unos 100 s cada una), donde se
sabe quién habla. Es el porcentaje del tiempo con el hablante correcto:

| Caso | Acierto |
|---|---|
| Hombre y mujer | 99,6 % y 99,9 % |
| Dos mujeres | 99,9 % |
| Misma voz con 4 semitonos de diferencia | 96,8 % |
| Misma voz con 2 semitonos de diferencia | **56,5 %** (casi al azar) |
| Habla primero el cliente, hombre y mujer | 97,3 % |
| Filtro de teléfono y ruido, hombre y mujer | 89,6 % |
| Filtro de teléfono y ruido, dos mujeres | 93,0 % |

**Precisión esperada en llamadas reales: de 65 a 85 % en audio mono, y por encima de 95 % con canales
separados.** Es una estimación, no una medida: las voces sintéticas son más fáciles que una llamada
real. Falta medirla con llamadas etiquetadas.

**Límites conocidos:**

- **Voces parecidas:** dos personas del mismo género y tono casi no se separan.
- **Roles invertidos:** si no hay frases típicas y el cliente habla primero, se invierten **todos** los
  hablantes de la llamada, aunque la separación sea buena.
- **Un hablante por segmento:** si dos personas hablan dentro de un mismo segmento de Whisper, gana
  quien ocupa más tiempo. En una llamada real hubo segmentos de más de 60 s con muy poco texto.
- **Una sola voz:** igual se reparte en dos grupos.
- **Conflicto:** `diagnostico_conflicto` depende de esta separación, y aún no revisa si el agente
  omitió el script o interrumpió. Con hablantes errados, puede culpar a quien no fue. Cada subida de
  volumen cuenta solo para quien más tiempo habla dentro de ella: los eventos se miden en tramos de
  0,5 s y Whisper pega un turno con el siguiente, así que un grito del cliente suele rozar unas décimas
  el final del turno del agente (antes eso bastaba para dar `FALLA_AGENTE`). Al agente no le cuentan
  las palabras negativas que el cliente ya dijo antes, comparadas por familia (las 5 primeras letras:
  "cancelar" y "cancelación"), para no culparlo por "registro su queja". Por eso, si el cliente dijo
  "nunca" y el agente contesta con otro "nunca" grosero, ese tampoco cuenta. Esto solo cambia el
  diagnóstico: el puntaje y el `score_sentimiento` de cada frase siguen igual.
- **RN-02:** el promedio móvil todavía mezcla las dos voces.

## Pendiente

- Medir la diarización con llamadas reales etiquetadas.
- Usar `hablante` para el promedio móvil por hablante de RN-02.
- Revisar en `diagnostico_conflicto` el script omitido y las interrupciones.
- Confirmar con el equipo la recalibración de RN-02 y RN-03, y los cortes de `clasificacion_final`.
- Umbrales de las alertas `EXCESO_VOLUMEN` y `ALTERACION_TONO` a partir de `rms_dbfs` y `f0_hz`.
- Recalibrar `baja_confianza_audio` con grabaciones reales.
