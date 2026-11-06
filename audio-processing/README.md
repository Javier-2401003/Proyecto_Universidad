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

### 1. Python 3.12

Use **Python 3.12**. Con 3.13 o 3.14 pueden faltar paquetes ya compilados (numba,
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
  "version_contrato": "0.1",
  "archivo": "llamada.wav",
  "duracion_segundos": 268.553,
  "idioma": "es",
  "modelo": { "motor": "faster-whisper", "nombre": "base", "tipo_calculo": "int8" },
  "baja_confianza_audio": false,
  "score_global_nlp": 0.5,
  "resumen_acustico": { "f0_mediana_hz": 213.64, "rms_promedio_dbfs": -20.05, "...": "..." },
  "segmentos": [
    { "indice": 0, "inicio": 0.0, "fin": 7.0,
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
`small` tardó unos **85 s** (70 s de transcripción y 12 s de análisis acústico). Falta medir con
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

## Pendiente

- `hablante` (AGENTE/CLIENTE): necesita diarización; todavía no lo calcula el script. Por eso
  `version_contrato` sigue en `0.1` (ver `docs/contrato_audio.md`).
- `score_acustico`, `puntaje_final`, `clasificacion_final` y `diagnostico_conflicto`.
- Umbrales de las alertas `EXCESO_VOLUMEN` y `ALTERACION_TONO` a partir de `rms_dbfs` y `f0_hz`.
- Probar el criterio de `baja_confianza_audio` (`confianza_logprob` promedio < -1,0) con
  audios ruidosos reales.
