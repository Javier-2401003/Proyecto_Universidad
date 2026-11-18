"""Guion obligatorio del agente (contrato v0.6, decision 6 del 14/11).

Cuatro pasos buscados solo en los segmentos del AGENTE: saludo, identificacion y ofrecer ayuda al
principio de la llamada, y cierre al final. Las frases estan en guion.json y se pueden editar sin tocar
codigo. Es solo informativo: no cambia el puntaje, la clasificacion ni el diagnostico.

Una frase cuenta si un grupo de palabras del agente se le parece en "parecido_minimo" o mas (sin tildes,
mayusculas ni signos), para tolerar errores de Whisper como "buenas tarde". Una comparacion "fonetica"
(igualar b/v, s/z/c, k/qu...) se probo y se descarto: recuperaba muy poco con ruido y encontraba un
saludo en un agente grosero que no saludaba.
"""

import difflib
import json
import os
import re

from lexico import normalizar

RUTA_GUION = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guion.json")
CUMPLE = "CUMPLE"
NO_CUMPLE = "NO_CUMPLE"
PENDIENTE = "PENDIENTE"


def palabras(texto):
    return re.findall(r"\w+", normalizar(texto))


def cargar_guion(ruta=RUTA_GUION):
    # utf-8-sig: el Bloc de notas de Windows puede guardar el archivo con BOM.
    with open(ruta, encoding="utf-8-sig") as archivo:
        guion = json.load(archivo)
    for paso in guion["pasos"]:
        if paso["ventana"] not in ("inicio", "final"):
            raise ValueError(f"ventana del paso {paso['nombre']} debe ser 'inicio' o 'final'")
        paso["frases"] = [" ".join(palabras(frase)) for frase in paso["frases"]]
    return guion


def aparece(frase, lista, parecido_minimo):
    """Si algun grupo de palabras de la lista (de largo parecido al de la frase) se le parece lo suficiente."""
    largo_frase = len(frase.split())
    for largo in sorted({largo_frase - 1, largo_frase, largo_frase + 1} - {0}):
        for inicio in range(max(1, len(lista) - largo + 1)):
            grupo = " ".join(lista[inicio:inicio + largo])
            if grupo and difflib.SequenceMatcher(None, frase, grupo).ratio() >= parecido_minimo:
                return True
    return False


def evaluar_guion(segmentos, baja_confianza, guion):
    """Devuelve (estado_guion, pasos que faltan como [(nombre, segundo de la alerta)]).

    PENDIENTE cuando no es confiable evaluarlo: con baja confianza, sin segmentos del agente o si el
    agente hablo menos de "segundos_minimos_agente". Las alertas de apertura van en el segundo 0 y la
    del cierre al inicio del ultimo segmento del agente.
    """
    agente = [s for s in segmentos if s["hablante"] == "AGENTE"]
    voz_agente = sum(s["fin"] - s["inicio"] for s in agente)
    if baja_confianza or not agente or voz_agente < guion["segundos_minimos_agente"]:
        return PENDIENTE, []
    fin_llamada = max(s["fin"] for s in segmentos)
    faltan = []
    for paso in guion["pasos"]:
        if paso["ventana"] == "inicio":
            dentro = [s for s in agente if s["inicio"] < paso["segundos"]]
            momento = 0.0
        else:
            dentro = [s for s in agente if s["fin"] >= fin_llamada - paso["segundos"]]
            momento = agente[-1]["inicio"]
        lista = [p for s in dentro for p in palabras(s["texto"])]
        if not any(aparece(frase, lista, guion["parecido_minimo"]) for frase in paso["frases"]):
            faltan.append((paso["nombre"], float(momento)))
    return (NO_CUMPLE if faltan else CUMPLE), faltan
