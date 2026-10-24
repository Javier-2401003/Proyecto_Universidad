"""Analiza un audio de llamada y escribe un JSON por la salida estandar.

Uso:
    python analizar.py ruta_del_audio [--modelo base|small] [--idioma es]

La salida estandar (stdout) lleva SOLO el JSON descrito en docs/contrato_audio.md.
Los mensajes de avance y las advertencias van a la salida de errores (stderr).
Codigo de salida: 0 si todo salio bien, 1 si hubo un error (el JSON trae "error").
"""

import argparse
import json
import os
import sys
import time

VERSION_CONTRATO = "0.1"
FRECUENCIA_MUESTREO = 16000  # Whisper trabaja a 16 kHz
SALTO_MUESTRAS = 320         # 20 ms entre cuadros de analisis acustico
CUADRO_MUESTRAS = 1024       # 64 ms por cuadro (alcanza para F0 desde 65 Hz)
F0_MINIMO_HZ = 65.0
F0_MAXIMO_HZ = 500.0
# Criterio provisional del flujo E1 (ruido extremo): Whisper poco seguro del texto.
UMBRAL_LOGPROB_BAJA_CONFIANZA = -1.0


class ErrorAnalisis(Exception):
    def __init__(self, codigo, mensaje, detalles=None):
        super().__init__(mensaje)
        self.codigo = codigo
        self.mensaje = mensaje
        self.detalles = detalles or {}


class ParserConErrorJson(argparse.ArgumentParser):
    """argparse imprime texto libre al fallar; aqui el error tambien sale en JSON."""

    def error(self, message):
        raise ErrorAnalisis("ARGUMENTOS_INVALIDOS", message)


def registrar(mensaje):
    print(mensaje, file=sys.stderr, flush=True)


def escribir_json(datos):
    sys.stdout.write(json.dumps(datos, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def redondear(valor, decimales):
    """Redondea y convierte NaN o None en None (null en el JSON)."""
    if valor is None:
        return None
    valor = float(valor)
    if valor != valor:  # NaN
        return None
    return round(valor, decimales)


def leer_argumentos(argv):
    parser = ParserConErrorJson(description="Analisis de audio de una llamada.")
    parser.add_argument("ruta_audio", help="Ruta del archivo de audio (mp3, wav, ogg...)")
    parser.add_argument("--modelo", default="base", choices=["tiny", "base", "small", "medium"],
                        help="Modelo de Whisper (por defecto: base)")
    parser.add_argument("--idioma", default="es", help="Idioma del audio (por defecto: es)")
    return parser.parse_args(argv)


def cargar_audio(ruta_audio):
    """Decodifica el audio a mono, 16 kHz, float32. Usa PyAV (viene con faster-whisper)."""
    from faster_whisper import decode_audio

    if not os.path.isfile(ruta_audio):
        raise ErrorAnalisis("ARCHIVO_NO_ENCONTRADO", "No existe el archivo de audio.",
                            {"ruta": ruta_audio})
    try:
        audio = decode_audio(ruta_audio, sampling_rate=FRECUENCIA_MUESTREO)
    except Exception as error:
        raise ErrorAnalisis("AUDIO_ILEGIBLE", "No se pudo leer el audio.",
                            {"ruta": ruta_audio, "causa": str(error)})
    if len(audio) == 0:
        raise ErrorAnalisis("AUDIO_VACIO", "El audio no tiene muestras.", {"ruta": ruta_audio})
    return audio


def transcribir(audio, nombre_modelo, idioma):
    from faster_whisper import WhisperModel

    registrar(f"Cargando modelo {nombre_modelo} (la primera vez se descarga)...")
    modelo = WhisperModel(nombre_modelo, device="cpu", compute_type="int8")
    registrar("Transcribiendo...")
    segmentos, info = modelo.transcribe(audio, language=idioma, vad_filter=True)
    # transcribe() es perezoso: el trabajo ocurre al recorrer los segmentos.
    lista = [
        {
            "inicio": s.start,
            "fin": s.end,
            "texto": s.text.strip(),
            "confianza_logprob": s.avg_logprob,
            "probabilidad_sin_voz": s.no_speech_prob,
        }
        for s in segmentos
    ]
    return lista, info


def analizar_acustica(audio):
    """Calcula F0 (pyin) y RMS por cuadro de 20 ms."""
    import librosa
    import numpy as np

    registrar("Calculando tono (F0) y volumen (RMS)...")
    f0, _, _ = librosa.pyin(audio, fmin=F0_MINIMO_HZ, fmax=F0_MAXIMO_HZ, sr=FRECUENCIA_MUESTREO,
                            frame_length=CUADRO_MUESTRAS, hop_length=SALTO_MUESTRAS)
    rms = librosa.feature.rms(y=audio, frame_length=CUADRO_MUESTRAS, hop_length=SALTO_MUESTRAS)[0]
    tiempos = librosa.frames_to_time(np.arange(len(rms)), sr=FRECUENCIA_MUESTREO,
                                     hop_length=SALTO_MUESTRAS)
    return f0[: len(rms)], rms, tiempos


def rms_a_dbfs(rms):
    """Energia media de los cuadros en dBFS (0 = maximo digital, valores negativos)."""
    import numpy as np

    if len(rms) == 0:
        return None
    energia = float(np.sqrt(np.mean(np.square(rms))))
    return 20.0 * np.log10(max(energia, 1e-10))


def resumir_tramo(f0, rms):
    import numpy as np

    f0_con_voz = f0[~np.isnan(f0)]
    return {
        "f0_hz": redondear(np.median(f0_con_voz), 2) if len(f0_con_voz) else None,
        "rms_dbfs": redondear(rms_a_dbfs(rms), 2),
    }


def construir_resultado(args, audio, segmentos, info, f0, rms, tiempos, duraciones):
    import numpy as np

    salida_segmentos = []
    for indice, segmento in enumerate(segmentos):
        tramo = (tiempos >= segmento["inicio"]) & (tiempos < segmento["fin"])
        acustica = resumir_tramo(f0[tramo], rms[tramo])
        salida_segmentos.append({
            "indice": indice,
            "inicio": redondear(segmento["inicio"], 3),
            "fin": redondear(segmento["fin"], 3),
            "texto": segmento["texto"],
            "f0_hz": acustica["f0_hz"],
            "rms_dbfs": acustica["rms_dbfs"],
            "confianza_logprob": redondear(segmento["confianza_logprob"], 3),
            "probabilidad_sin_voz": redondear(segmento["probabilidad_sin_voz"], 3),
        })

    f0_con_voz = f0[~np.isnan(f0)]
    rms_dbfs_cuadros = 20.0 * np.log10(np.maximum(rms, 1e-10))
    if segmentos:
        logprob_promedio = float(np.mean([s["confianza_logprob"] for s in segmentos]))
    else:
        logprob_promedio = None

    return {
        "version_contrato": VERSION_CONTRATO,
        "archivo": os.path.basename(args.ruta_audio),
        "duracion_segundos": redondear(len(audio) / FRECUENCIA_MUESTREO, 3),
        "idioma": info.language,
        "probabilidad_idioma": redondear(info.language_probability, 3),
        "modelo": {"motor": "faster-whisper", "nombre": args.modelo, "tipo_calculo": "int8"},
        "baja_confianza_audio": (not segmentos)
        or logprob_promedio < UMBRAL_LOGPROB_BAJA_CONFIANZA,
        "resumen_acustico": {
            "f0_mediana_hz": redondear(np.median(f0_con_voz), 2) if len(f0_con_voz) else None,
            "f0_desviacion_hz": redondear(np.std(f0_con_voz), 2) if len(f0_con_voz) else None,
            "rms_promedio_dbfs": redondear(rms_a_dbfs(rms), 2),
            "rms_maximo_dbfs": redondear(np.max(rms_dbfs_cuadros), 2),
            "confianza_logprob_promedio": redondear(logprob_promedio, 3),
        },
        "tiempos_proceso_segundos": {k: redondear(v, 2) for k, v in duraciones.items()},
        "segmentos": salida_segmentos,
    }


def main(argv):
    inicio_total = time.perf_counter()
    args = leer_argumentos(argv)

    audio = cargar_audio(args.ruta_audio)

    inicio = time.perf_counter()
    segmentos, info = transcribir(audio, args.modelo, args.idioma)
    duracion_transcripcion = time.perf_counter() - inicio

    inicio = time.perf_counter()
    f0, rms, tiempos = analizar_acustica(audio)
    duracion_acustica = time.perf_counter() - inicio

    duraciones = {
        "transcripcion": duracion_transcripcion,
        "acustico": duracion_acustica,
        "total": time.perf_counter() - inicio_total,
    }
    escribir_json(construir_resultado(args, audio, segmentos, info, f0, rms, tiempos, duraciones))


if __name__ == "__main__":
    # Node lee stdout como UTF-8; en Windows la consola usa otra codificacion por defecto.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main(sys.argv[1:])
    except ErrorAnalisis as error:
        escribir_json({"error": {"codigo": error.codigo, "mensaje": error.mensaje,
                                 "detalles": error.detalles}})
        sys.exit(1)
    except Exception as error:  # cualquier fallo inesperado tambien sale en JSON
        escribir_json({"error": {"codigo": "ERROR_INTERNO", "mensaje": "Fallo inesperado.",
                                 "detalles": {"causa": f"{type(error).__name__}: {error}"}}})
        sys.exit(1)
