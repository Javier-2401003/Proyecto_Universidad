"""Separa agente y cliente sin PyTorch ni servicios externos.

Dos caminos, en este orden:
  1. Canales: si el archivo trae dos canales distintos, izquierdo = agente y derecho = cliente
     (Blueprint, 3.2.1).
  2. Agrupacion: reparte los segmentos de Whisper en dos grupos por timbre (MFCC de sus cuadros con
     voz) y tono (F0). Las pistas de reglas_diarizacion.json, de toda la llamada, dicen que grupo
     es el agente: frases de atencion ("le atiende", "permitame", "con gusto"), "su" frente a "mi",
     pedidos ("quiero", "necesito"). Si empatan, es quien habla primero.

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
ITERACIONES_REFINADO = 10
# Piso de la varianza de cada rasgo (ya normalizado) en las gaussianas de refinar_por_cuadros.
VARIANZA_MINIMA = 1e-3


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


def cuadros_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas):
    """Cuadros con voz de cada segmento: (indices medidos, una matriz por segmento).

    Cada fila de la matriz es un cuadro con tono: MFCC sin energia y log del tono. Las pausas y el
    ruido no dicen quien habla.
    """
    mfcc = librosa.feature.mfcc(y=audio, sr=frecuencia, n_mfcc=reglas["numero_mfcc"] + 1,
                                hop_length=salto)[1:]
    cuadros = min(mfcc.shape[1], len(f0))
    segundos_por_cuadro = salto / frecuencia
    minimo = max(1, int(reglas["segundos_minimos_voz"] / segundos_por_cuadro))

    medidos = []
    matrices = []
    for indice, segmento in enumerate(segmentos):
        desde = int(segmento["inicio"] / segundos_por_cuadro)
        hasta = min(int(segmento["fin"] / segundos_por_cuadro), cuadros)
        tono = f0[desde:hasta]
        voz = ~np.isnan(tono)
        if np.count_nonzero(voz) < minimo:
            continue
        matrices.append(np.vstack([mfcc[:, desde:hasta][:, voz], np.log(tono[voz])]).T)
        medidos.append(indice)
    return medidos, matrices


def resumir(matrices):
    """Una fila por segmento: MFCC promedio de sus cuadros con voz y log del tono mediano."""
    return np.array([np.append(np.mean(m[:, :-1], axis=0), np.median(m[:, -1])) for m in matrices])


def caracteristicas_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas):
    """Una fila por segmento con voz (MFCC sin energia + log del tono mediano) y los indices medidos."""
    medidos, matrices = cuadros_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas)
    return resumir(matrices), medidos


def dos_medias(puntos, pesos, primero, segundo):
    """K-means de dos grupos ponderado, desde dos centros dados: (grupos, suma ponderada de distancias)."""
    grupos = None
    for _ in range(ITERACIONES_MAXIMAS):
        nuevos = (np.linalg.norm(puntos - segundo, axis=1)
                  < np.linalg.norm(puntos - primero, axis=1)).astype(int)
        if len(set(nuevos)) < 2:
            return nuevos, np.inf
        if grupos is not None and np.array_equal(nuevos, grupos):
            break
        grupos = nuevos
        primero = np.average(puntos[grupos == 0], axis=0, weights=pesos[grupos == 0])
        segundo = np.average(puntos[grupos == 1], axis=0, weights=pesos[grupos == 1])
    centros = np.where(grupos[:, None] == 0, primero, segundo)
    return grupos, float(np.sum(pesos * np.sum((puntos - centros) ** 2, axis=1)))


def arranques(puntos, pesos, cantidad):
    """Pares de centros iniciales: cada par de los segmentos mas largos y los dos puntos mas lejanos."""
    lejano = int(np.argmax(np.linalg.norm(puntos - np.mean(puntos, axis=0), axis=1)))
    pares = {(lejano, int(np.argmax(np.linalg.norm(puntos - puntos[lejano], axis=1))))}
    largos = sorted(np.argsort(-pesos, kind="stable")[:cantidad])
    pares.update((int(a), int(b)) for i, a in enumerate(largos) for b in largos[i + 1:])
    return sorted(pares)


def agrupar(caracteristicas, reglas, pesos=None):
    """Reparte los segmentos en dos grupos. Sin suavizar: los turnos se alternan.

    Cada segmento pesa lo que duran sus cuadros con voz: el timbre promedio de un segmento corto es poco
    confiable, y con voces del mismo genero desordenaba los grupos. El resultado depende de los centros
    iniciales cuando hay pocos segmentos, asi que se prueban varios (ver arranques) y gana el reparto
    mas compacto. Siempre da el mismo resultado.
    """
    if len(caracteristicas) < 2:
        return np.zeros(len(caracteristicas), dtype=int)
    pesos = np.ones(len(caracteristicas)) if pesos is None else np.asarray(pesos, dtype=float)
    desviacion = np.std(caracteristicas, axis=0)
    desviacion[desviacion == 0] = 1.0
    normalizadas = (caracteristicas - np.mean(caracteristicas, axis=0)) / desviacion
    normalizadas[:, -1] *= reglas["peso_f0"]

    mejores, menor_costo = np.zeros(len(caracteristicas), dtype=int), np.inf
    for a, b in arranques(normalizadas, pesos, reglas["segmentos_para_arrancar"]):
        grupos, costo = dos_medias(normalizadas, pesos, normalizadas[a], normalizadas[b])
        if costo < menor_costo:
            mejores, menor_costo = grupos, costo
    return mejores


def tonos_parecidos(caracteristicas, grupos, reglas):
    """Si los tonos medianos de los dos grupos difieren menos que "razon_tonos_para_refinar".

    Pasa con voces del mismo genero (en las pruebas, razon de 1,11 a 1,48); con un hombre y una mujer
    la razon ronda 2. Cuando los tonos ya separan bien, el tono es la senal mas confiable y no conviene
    que el timbre de un tramo con ruido de fondo lo contradiga.
    """
    if len(set(grupos)) < 2:
        return False
    tonos = [np.median(caracteristicas[grupos == grupo, -1]) for grupo in (0, 1)]
    return bool(np.exp(abs(tonos[0] - tonos[1])) < reglas["razon_tonos_para_refinar"])


def refinar_por_cuadros(matrices, grupos):
    """Pasa cada segmento al grupo cuya gaussiana, hecha con todos los cuadros del grupo, mejor lo explica.

    El promedio de un segmento pierde como se reparten su timbre y su tono; comparar cuadro a cuadro
    separa mejor dos voces parecidas. Si un grupo quedaria vacio, se queda el reparto anterior.
    """
    grupos = np.asarray(grupos, dtype=int)
    if len(matrices) < 2 or len(set(grupos)) < 2:
        return grupos
    cuadros = np.vstack(matrices)
    cuadros = (cuadros - cuadros.mean(axis=0)) / (cuadros.std(axis=0) + 1e-9)
    de_segmento = np.repeat(np.arange(len(matrices)), [len(m) for m in matrices])
    cantidad = np.bincount(de_segmento)
    for _ in range(ITERACIONES_REFINADO):
        verosimilitud = []
        for grupo in (0, 1):
            propios = cuadros[grupos[de_segmento] == grupo]
            media, varianza = propios.mean(axis=0), propios.var(axis=0) + VARIANZA_MINIMA
            por_cuadro = -0.5 * np.sum((cuadros - media) ** 2 / varianza + np.log(varianza), axis=1)
            verosimilitud.append(np.bincount(de_segmento, por_cuadro) / cantidad)
        nuevos = (verosimilitud[1] > verosimilitud[0]).astype(int)
        if np.array_equal(nuevos, grupos) or len(set(nuevos)) < 2:
            break
        grupos = nuevos
    return grupos


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


def contar_pistas(texto, pistas):
    """Veces que aparecen las pistas como palabras completas; las de varias palabras pesan doble.

    Palabras completas: "su" no cuenta dentro de "consulta". Peso doble: "mi nombre es" (del agente)
    pesa mas que el "mi" suelto (del cliente) que lleva adentro.
    """
    relleno = f" {texto} "
    return sum(relleno.count(f" {pista} ") * (2 if " " in pista else 1) for pista in pistas)


def grupo_del_agente(segmentos, asignados, reglas):
    """Grupo con mas pistas de agente frente a pistas de cliente; si empatan, quien habla primero.

    Las pistas son de toda la llamada y no solo del saludo: si Whisper no transcribe una apertura
    corta ("Diga") o el agente no se presenta, con solo las frases de apertura toda la llamada salia
    al reves (14 de 18 llamadas de prueba sin su primer turno; con las pistas, 1).
    """
    puntos = [0, 0]
    for segmento, grupo in zip(segmentos, asignados):
        texto = " ".join(palabras_normalizadas(segmento["texto"]))
        puntos[grupo] += contar_pistas(texto, reglas["frases_agente"])
        puntos[grupo] -= contar_pistas(texto, reglas["frases_cliente"])
    if puntos[0] != puntos[1]:
        return 0 if puntos[0] > puntos[1] else 1
    return asignados[0]


def asignar_hablantes(segmentos, audio, f0, frecuencia, salto, reglas, canales=None):
    """Devuelve un hablante por segmento, en el mismo orden."""
    if not segmentos:
        return []
    if canales is not None and canales_distintos(canales[0], canales[1], reglas):
        return hablante_por_canal(canales[0], canales[1], frecuencia, segmentos)

    medidos, matrices = cuadros_por_segmento(segmentos, audio, f0, frecuencia, salto, reglas)
    caracteristicas = resumir(matrices)
    grupos = agrupar(caracteristicas, reglas, [len(m) for m in matrices])
    if tonos_parecidos(caracteristicas, grupos, reglas):
        grupos = refinar_por_cuadros(matrices, grupos)
    asignados = completar_sin_voz(len(segmentos), medidos, grupos)
    agente = grupo_del_agente(segmentos, asignados, reglas)
    return [AGENTE if grupo == agente else CLIENTE for grupo in asignados]
