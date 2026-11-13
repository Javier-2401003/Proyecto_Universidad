"""Separa agente y cliente sin PyTorch ni servicios externos.

Dos caminos, en este orden:
  1. Canales: si el archivo trae dos canales distintos, izquierdo = agente y derecho = cliente
     (Blueprint, 3.2.1).
  2. Agrupacion: reparte los segmentos de Whisper en dos grupos por timbre (MFCC de sus cuadros con
     voz) y tono (F0). Las frases tipicas de reglas_diarizacion.json dicen que grupo es el agente;
     si no alcanzan, es quien habla primero.

Se agrupan segmentos y no ventanas de 1 s: en llamadas de 40 s, las ventanas se agrupaban por pausas
y por lo que se decia, y acertaban 67 % del tiempo con un hombre y una mujer; por segmento, 99 %.
Cada segmento de Whisper recibe un solo hablante: si dos personas hablan dentro del mismo segmento,
se mezclan sus voces. Siempre devuelve AGENTE o CLIENTE, aunque la separacion no sea segura.
"""

import json
import os

import librosa
import numpy as np

from lexico import normalizar

RUTA_REGLAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reglas_diarizacion.json")
AGENTE = "AGENTE"
CLIENTE = "CLIENTE"
ITERACIONES_MAXIMAS = 50


def cargar_reglas(ruta=RUTA_REGLAS):
    # utf-8-sig: el Bloc de notas de Windows puede guardar el archivo con BOM.
    with open(ruta, encoding="utf-8-sig") as archivo:
        reglas = json.load(archivo)
    reglas["frases_agente"] = [normalizar(frase) for frase in reglas["frases_agente"]]
    reglas["frases_cliente"] = [normalizar(frase) for frase in reglas["frases_cliente"]]
    return reglas


def palabras_normalizadas(texto):
    return "".join(c if c.isalnum() else " " for c in normalizar(texto)).split()


def leer_canales(ruta_audio, frecuencia):
    """Devuelve (izquierdo, derecho) si el archivo es estereo; si no, None."""
    import av
    from faster_whisper import decode_audio

    with av.open(ruta_audio) as contenedor:
        canales = contenedor.streams.audio[0].channels
    if canales != 2:
        return None
    return decode_audio(ruta_audio, sampling_rate=frecuencia, split_stereo=True)


def canales_distintos(izquierdo, derecho, reglas):
    """Muchos estereos repiten la misma mezcla en los dos canales: esos no separan hablantes."""
    if np.std(izquierdo) < 1e-6 or np.std(derecho) < 1e-6:
        return False
    return abs(np.corrcoef(izquierdo, derecho)[0, 1]) < reglas["correlacion_maxima_canales"]


def hablante_por_canal(izquierdo, derecho, frecuencia, segmentos):
    hablantes = []
    for segmento in segmentos:
        desde, hasta = int(segmento["inicio"] * frecuencia), int(segmento["fin"] * frecuencia)
        energia_izquierda = np.sum(np.square(izquierdo[desde:hasta]))
        energia_derecha = np.sum(np.square(derecho[desde:hasta]))
        hablantes.append(AGENTE if energia_izquierda >= energia_derecha else CLIENTE)
    return hablantes


def caracteristicas_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas):
    """Una fila por segmento con voz (MFCC sin energia + log del tono mediano) y los indices medidos.

    El MFCC se promedia solo en los cuadros con tono: las pausas y el ruido no dicen quien habla.
    """
    mfcc = librosa.feature.mfcc(y=audio, sr=frecuencia, n_mfcc=reglas["numero_mfcc"] + 1,
                                hop_length=salto)[1:]
    cuadros = min(mfcc.shape[1], len(f0))
    segundos_por_cuadro = salto / frecuencia
    minimo = max(1, int(reglas["segundos_minimos_voz"] / segundos_por_cuadro))

    filas = []
    medidos = []
    for indice, segmento in enumerate(segmentos):
        desde = int(segmento["inicio"] / segundos_por_cuadro)
        hasta = min(int(segmento["fin"] / segundos_por_cuadro), cuadros)
        tono = f0[desde:hasta]
        voz = ~np.isnan(tono)
        if np.count_nonzero(voz) < minimo:
            continue
        filas.append(np.append(np.mean(mfcc[:, desde:hasta][:, voz], axis=1), np.log(np.median(tono[voz]))))
        medidos.append(indice)
    return np.array(filas), medidos


def dos_medias(puntos):
    """K-means de dos grupos. Empieza en los puntos mas lejanos, asi siempre da el mismo resultado."""
    distancias = np.linalg.norm(puntos - np.mean(puntos, axis=0), axis=1)
    primero = puntos[np.argmax(distancias)]
    segundo = puntos[np.argmax(np.linalg.norm(puntos - primero, axis=1))]
    grupos = np.zeros(len(puntos), dtype=int)
    for _ in range(ITERACIONES_MAXIMAS):
        nuevos = (np.linalg.norm(puntos - segundo, axis=1)
                  < np.linalg.norm(puntos - primero, axis=1)).astype(int)
        if np.array_equal(nuevos, grupos) or len(set(nuevos)) < 2:
            return nuevos
        grupos = nuevos
        primero = np.mean(puntos[grupos == 0], axis=0)
        segundo = np.mean(puntos[grupos == 1], axis=0)
    return grupos


def agrupar(caracteristicas, reglas):
    """Reparte los segmentos en dos grupos. Sin suavizar: los turnos se alternan."""
    if len(caracteristicas) < 2:
        return np.zeros(len(caracteristicas), dtype=int)
    desviacion = np.std(caracteristicas, axis=0)
    desviacion[desviacion == 0] = 1.0
    normalizadas = (caracteristicas - np.mean(caracteristicas, axis=0)) / desviacion
    normalizadas[:, -1] *= reglas["peso_f0"]
    return dos_medias(normalizadas)


def completar_sin_voz(total, medidos, grupos):
    """Grupo de cada segmento; uno sin voz medida toma el del anterior (al principio, el primer medido)."""
    asignados = [None] * total
    for indice, grupo in zip(medidos, grupos):
        asignados[indice] = int(grupo)
    anterior = next((g for g in asignados if g is not None), 0)
    for indice, grupo in enumerate(asignados):
        anterior = anterior if grupo is None else grupo
        asignados[indice] = anterior
    return asignados


def grupo_del_agente(segmentos, asignados, reglas):
    """Grupo con mas frases de agente frente a frases de cliente; si empatan, quien habla primero."""
    puntos = [0, 0]
    for segmento, grupo in zip(segmentos, asignados):
        texto = " ".join(palabras_normalizadas(segmento["texto"]))
        puntos[grupo] += sum(frase in texto for frase in reglas["frases_agente"])
        puntos[grupo] -= sum(frase in texto for frase in reglas["frases_cliente"])
    if puntos[0] != puntos[1]:
        return 0 if puntos[0] > puntos[1] else 1
    return asignados[0]


def asignar_hablantes(segmentos, audio, f0, frecuencia, salto, reglas, canales=None):
    """Devuelve un hablante por segmento, en el mismo orden."""
    if not segmentos:
        return []
    if canales is not None and canales_distintos(canales[0], canales[1], reglas):
        return hablante_por_canal(canales[0], canales[1], frecuencia, segmentos)

    caracteristicas, medidos = caracteristicas_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas)
    asignados = completar_sin_voz(len(segmentos), medidos, agrupar(caracteristicas, reglas))
    agente = grupo_del_agente(segmentos, asignados, reglas)
    return [AGENTE if grupo == agente else CLIENTE for grupo in asignados]
