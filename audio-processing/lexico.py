"""Sentimiento por lexico en espanol (RN-01 del Blueprint).

RN-01 fija la escala de -1 a +1 y las palabras clave, pero no la formula. Esta es la
decision del proyecto (se puede ajustar en lexico_es.json):
  - Cada palabra clave suma o resta "peso_por_palabra"; el total se limita a -1 y +1.
  - Un negador hasta "ventana_negacion" palabras antes, en la misma clausula, invierte el signo.
  - El puntaje global es el promedio de las frases con alguna palabra clave.
  - Las palabras de "vocabulario_inadecuado" que no estan en las listas de sentimiento tambien
    restan, y no se niegan: "no sea tonto" sigue siendo un insulto.
  - Decision del equipo del 11/11: la cancelacion y las amenazas ("graves") y todo el
    "vocabulario_inadecuado" valen "peso_grave", mas que la cortesia. Negada, cualquier palabra
    vale "peso_por_palabra" con el signo al reves: "no quiero cancelar" suma 0,5, no 1.
"""

import json
import os
import re
import unicodedata

RUTA_LEXICO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lexico_es.json")
# Una familia de palabras comparte las primeras letras: "queja" y "quejas", "cancelar" y
# "cancelación", "pésimo" y "pésima".
LETRAS_RAIZ = 5
# Con "su"/"sus" el agente habla de lo del cliente: "registro su queja" no es una queja suya.
POSESIVOS = {"su", "sus"}
# Whisper pega o parte palabras: "de inútil" sale "dinutil" y "inútil" sale "in útil". Para el
# vocabulario inadecuado se toleran esos dos errores, pero solo en groserias de 6 letras o mas;
# una palabra normal nunca cuenta por contener una corta: "imputa", "vehículo", "computadora".
# El parecido de letras del 80 % (el del guion) daba decenas de alertas falsas en 769 frases de
# llamadas: "porque" -> porquería, "esta" -> estafa, "tanto" -> tonto, "mientras" -> mierdas.
LARGO_MINIMO_TOLERANTE = 6
# Pegada: lo que sobra va al principio y es lo que queda de la palabra anterior ("d" de "de").
LETRAS_PEGADAS = 2
# Partida: la segunda parte debe tener al menos 4 letras, para que "la calle se llama" no sea "cállese".
LETRAS_MINIMAS_SEGUNDA = 4


def normalizar(texto):
    """Minusculas y sin tildes, para que "pésimo" y "pesimo" sean la misma palabra."""
    descompuesto = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")


def separar_clausulas(texto):
    """Divide en listas de palabras por signos de puntuacion: en "no, gracias" el "no" no niega."""
    clausulas = re.split(r"[,.;:!?¿¡()\"]+", normalizar(texto))
    return [re.findall(r"\w+", clausula) for clausula in clausulas]


def cargar_lexico(ruta=RUTA_LEXICO):
    # utf-8-sig: el Bloc de notas de Windows puede guardar el archivo con BOM.
    with open(ruta, encoding="utf-8-sig") as archivo:
        datos = json.load(archivo)

    pesos = {}
    for grupo in (datos["oficial_rn01"], datos["ampliacion_no_oficial"]):
        for palabra in grupo["positivas"]:
            pesos[tuple(normalizar(palabra).split())] = datos["peso_por_palabra"]
        for palabra in grupo["negativas"]:
            pesos[tuple(normalizar(palabra).split())] = -datos["peso_por_palabra"]

    # En una llamada real, 17 frases con insultos daban 0 porque ninguno estaba en el lexico.
    insultos = set()
    graves = {tuple(normalizar(palabra).split()) for palabra in datos.get("graves", [])}
    for palabra in datos.get("vocabulario_inadecuado", []):
        expresion = tuple(normalizar(palabra).split())
        if expresion not in pesos:
            insultos.add(expresion)
        graves.add(expresion)
    for expresion in graves:
        pesos[expresion] = -datos.get("peso_grave", datos["peso_por_palabra"])

    # Lista provisional para VOCABULARIO_INADECUADO (contrato v0.3): palabras y frases enteras
    # ("vete a la mierda"), como tuplas de palabras normalizadas.
    inadecuadas = {tuple(normalizar(p).split()): p for p in datos.get("vocabulario_inadecuado", [])}
    # Expresiones que contienen una groseria pero no lo son: "sueldo bruto", "peso bruto".
    no_inadecuadas = {tuple(normalizar(p).split()) for p in datos.get("no_inadecuadas", [])}
    return {
        "pesos": pesos,
        "peso_por_palabra": datos["peso_por_palabra"],
        "largo_maximo": max(len(frase) for frase in list(pesos) + list(no_inadecuadas)),
        "negadores": {normalizar(n) for n in datos["negadores"]},
        "ventana_negacion": datos["ventana_negacion"],
        "insultos_sin_negacion": insultos,
        "inadecuadas": inadecuadas,
        "no_inadecuadas": no_inadecuadas,
        # Groserias de una palabra que toleran errores de Whisper, la mas larga primero.
        "tolerables": sorted((e[0] for e in inadecuadas if len(e) == 1 and len(e[0]) >= LARGO_MINIMO_TOLERANTE),
                             key=len, reverse=True),
    }


def expresion_mas_larga(palabras, inicio, expresiones, largo_maximo):
    """La expresion (tupla de palabras) mas larga del conjunto que empieza en esa posicion, o None."""
    for largo in range(min(largo_maximo, len(palabras) - inicio), 0, -1):
        candidata = tuple(palabras[inicio:inicio + largo])
        if candidata in expresiones:
            return candidata
    return None


def excepcion_en(palabras, inicio, lexico):
    """Expresion que contiene una groseria pero no lo es ("sueldo bruto"), o None."""
    return expresion_mas_larga(palabras, inicio, lexico["no_inadecuadas"], lexico["largo_maximo"])


def groseria_mal_transcrita(palabras, inicio, lexico):
    """Groseria larga que Whisper pego o partio: (expresion, palabras que ocupa) o (None, 1).

    Pegada: la palabra termina con la groseria y le sobran 1 o 2 letras al principio ("dinutil").
    Partida: la palabra y la siguiente juntas la forman ("in util"). Gana la groseria mas larga.
    """
    palabra = palabras[inicio]
    siguiente = palabras[inicio + 1] if inicio + 1 < len(palabras) else ""
    for clave in lexico["tolerables"]:
        if palabra.endswith(clave) and 0 < len(palabra) - len(clave) <= LETRAS_PEGADAS:
            return (clave,), 1
        if len(siguiente) >= LETRAS_MINIMAS_SEGUNDA and palabra + siguiente == clave:
            return (clave,), 2
    return None, 1


def palabras_inadecuadas(texto, lexico):
    """Palabras y frases de "vocabulario_inadecuado" en el texto, una vez cada una y como estan en la lista.

    En cada posicion: una excepcion ("sueldo bruto") no cuenta; si no, gana la frase mas larga
    ("vete a la mierda" y no solo "mierda"); si no hay ninguna exacta, una groseria larga que
    Whisper pego o partio (groseria_mal_transcrita).
    """
    encontradas = []
    for palabras in separar_clausulas(texto):
        i = 0
        while i < len(palabras):
            excepcion = excepcion_en(palabras, i, lexico)
            if excepcion is not None:
                i += len(excepcion)
                continue
            expresion = expresion_mas_larga(palabras, i, lexico["inadecuadas"], lexico["largo_maximo"])
            ocupa = len(expresion) if expresion is not None else 1
            if expresion is None:
                expresion, ocupa = groseria_mal_transcrita(palabras, i, lexico)
            if expresion is not None and lexico["inadecuadas"][expresion] not in encontradas:
                encontradas.append(lexico["inadecuadas"][expresion])
            i += ocupa
    return encontradas


def buscar_coincidencia(palabras, inicio, lexico):
    """Devuelve la expresion mas larga del lexico que empieza en esa posicion, o None."""
    return expresion_mas_larga(palabras, inicio, lexico["pesos"], lexico["largo_maximo"])


def expresiones_con_contexto(texto, lexico):
    """Expresiones del lexico en el texto, en orden, con si estan negadas y las palabras de antes.

    Las excepciones ("sueldo bruto") se saltan: no restan en el sentimiento.
    """
    for palabras in separar_clausulas(texto):
        indice = 0
        while indice < len(palabras):
            excepcion = excepcion_en(palabras, indice, lexico)
            if excepcion is not None:
                indice += len(excepcion)
                continue
            expresion = buscar_coincidencia(palabras, indice, lexico)
            if expresion is None:
                indice += 1
                continue
            previas = palabras[max(0, indice - lexico["ventana_negacion"]):indice]
            negada = (expresion not in lexico["insultos_sin_negacion"]
                      and any(palabra in lexico["negadores"] for palabra in previas))
            yield expresion, negada, previas
            indice += len(expresion)


def encontrar_expresiones(texto, lexico):
    """Expresiones del lexico en el texto, en orden, junto con si estan negadas."""
    for expresion, negada, _ in expresiones_con_contexto(texto, lexico):
        yield expresion, negada


def raiz(expresion):
    """Familia de una expresion del lexico (una tupla de palabras normalizadas)."""
    return "".join(expresion)[:LETRAS_RAIZ]


def raices_negativas(texto, lexico):
    """Familias de las palabras negativas del texto, esten o no negadas."""
    return {raiz(expresion) for expresion, _ in encontrar_expresiones(texto, lexico)
            if lexico["pesos"][expresion] < 0}


def tiene_posesivo(texto):
    """Si el texto tiene "su" o "sus" como palabra."""
    return any(POSESIVOS & set(palabras) for palabras in separar_clausulas(texto))


def nombra_lo_del_otro(expresion, previas, lexico):
    """Si la palabra negativa va despues de "su"/"sus": "su queja", "su solicitud de cancelacion".

    Asi el agente nombra el problema del cliente, no es hostil. Un insulto puro no se salva con eso.
    """
    return expresion not in lexico["insultos_sin_negacion"] and any(p in POSESIVOS for p in previas)


def analizar_frase(texto, lexico, ignorar_negativas=(), ignorar_lo_del_otro=False):
    """Devuelve (puntaje de -1 a +1, cuantas palabras clave se encontraron).

    Las palabras negativas cuya familia esta en ignorar_negativas no cuentan. Con ignorar_lo_del_otro,
    tampoco las que van despues de "su"/"sus" (ver nombra_lo_del_otro).
    """
    total = 0.0
    coincidencias = 0
    for expresion, negada, previas in expresiones_con_contexto(texto, lexico):
        peso = lexico["pesos"][expresion]
        if peso < 0 and (raiz(expresion) in ignorar_negativas
                         or (ignorar_lo_del_otro and nombra_lo_del_otro(expresion, previas, lexico))):
            continue
        if negada:
            peso = lexico["peso_por_palabra"] if peso < 0 else -lexico["peso_por_palabra"]
        total += peso
        coincidencias += 1
    return round(max(-1.0, min(1.0, total)), 3), coincidencias


def puntaje_global(frases_analizadas):
    """Promedio de las frases con palabras clave; 0 si no hubo ninguna.

    Promediar todas las frases diluiria una sola "estafa" entre 40 frases neutras.
    """
    con_palabras = [puntaje for puntaje, coincidencias in frases_analizadas if coincidencias > 0]
    if not con_palabras:
        return 0.0
    return round(sum(con_palabras) / len(con_palabras), 3)
