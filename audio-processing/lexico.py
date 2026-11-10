"""Sentimiento por lexico en espanol (RN-01 del Blueprint).

RN-01 fija la escala de -1 a +1 y las palabras clave, pero no la formula. Esta es la
decision del proyecto (se puede ajustar en lexico_es.json):
  - Cada palabra clave suma o resta "peso_por_palabra"; el total se limita a -1 y +1.
  - Un negador hasta "ventana_negacion" palabras antes, en la misma clausula, invierte el signo.
  - El puntaje global es el promedio de las frases con alguna palabra clave.
"""

import json
import os
import re
import unicodedata

RUTA_LEXICO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lexico_es.json")
# Una familia de palabras comparte las primeras letras: "queja" y "quejas", "cancelar" y
# "cancelación", "pésimo" y "pésima".
LETRAS_RAIZ = 5


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

    return {
        "pesos": pesos,
        "largo_maximo": max(len(frase) for frase in pesos),
        "negadores": {normalizar(n) for n in datos["negadores"]},
        "ventana_negacion": datos["ventana_negacion"],
    }


def buscar_coincidencia(palabras, inicio, lexico):
    """Devuelve la expresion mas larga del lexico que empieza en esa posicion, o None."""
    for largo in range(lexico["largo_maximo"], 0, -1):
        candidata = tuple(palabras[inicio:inicio + largo])
        if len(candidata) == largo and candidata in lexico["pesos"]:
            return candidata
    return None


def encontrar_expresiones(texto, lexico):
    """Expresiones del lexico en el texto, en orden, junto con si estan negadas."""
    for palabras in separar_clausulas(texto):
        indice = 0
        while indice < len(palabras):
            expresion = buscar_coincidencia(palabras, indice, lexico)
            if expresion is None:
                indice += 1
                continue
            previas = palabras[max(0, indice - lexico["ventana_negacion"]):indice]
            yield expresion, any(palabra in lexico["negadores"] for palabra in previas)
            indice += len(expresion)


def raiz(expresion):
    """Familia de una expresion del lexico (una tupla de palabras normalizadas)."""
    return "".join(expresion)[:LETRAS_RAIZ]


def raices_negativas(texto, lexico):
    """Familias de las palabras negativas del texto, esten o no negadas."""
    return {raiz(expresion) for expresion, _ in encontrar_expresiones(texto, lexico)
            if lexico["pesos"][expresion] < 0}


def analizar_frase(texto, lexico, ignorar_negativas=()):
    """Devuelve (puntaje de -1 a +1, cuantas palabras clave se encontraron).

    Las palabras negativas cuya familia esta en ignorar_negativas no cuentan.
    """
    total = 0.0
    coincidencias = 0
    for expresion, negada in encontrar_expresiones(texto, lexico):
        peso = lexico["pesos"][expresion]
        if peso < 0 and raiz(expresion) in ignorar_negativas:
            continue
        total += -peso if negada else peso
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
