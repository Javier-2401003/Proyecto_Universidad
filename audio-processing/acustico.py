"""Deteccion de subidas de volumen y tono (RN-02), score_acustico y puntaje final (RN-03).

reglas_acusticas.json separa el origen de cada valor:
  - "rn02" y "rn03": vienen del Blueprint.
  - "recalibracion_falsos_positivos": se apartan del Blueprint a proposito, para bajar las
    falsas alarmas (RN-02 dice 150 % durante 1.5 s acumulados; RN-03 no pide sesgo negativo).
  - "decisiones_del_proyecto": lo que el Blueprint no define.

Hasta que exista la diarizacion, el baseline y la media son de toda la mezcla, no de cada
hablante: el cambio entre una voz fuerte y una suave o entre una grave y una aguda puede
marcarse como evento.
"""

import json
import os
from collections import deque

import numpy as np
from scipy.signal import butter, sosfiltfilt

from lexico import analizar_frase, cargar_lexico, puntaje_global, raices_negativas

RUTA_REGLAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reglas_acusticas.json")
ESCALAS_LADO_POSITIVO = ("lineal", "curva")
ORDEN_FILTRO = 4
MUESTRAS_MINIMAS_FILTRO = 1024


def cargar_reglas(ruta=RUTA_REGLAS):
    # utf-8-sig: el Bloc de notas de Windows puede guardar el archivo con BOM.
    with open(ruta, encoding="utf-8-sig") as archivo:
        datos = json.load(archivo)
    reglas = {**datos["rn02"], **datos["rn03"], **datos["recalibracion_falsos_positivos"],
              **datos["decisiones_del_proyecto"]}
    if reglas.get("escala_lado_positivo") not in ESCALAS_LADO_POSITIVO:
        raise ValueError(f"escala_lado_positivo debe ser una de {ESCALAS_LADO_POSITIVO}")
    return reglas


def a_dbfs(valores):
    return 20.0 * np.log10(np.maximum(valores, 1e-10))


def preparar_audio(audio, frecuencia, reglas):
    """Deja solo la banda de la voz y normaliza el nivel, para medir el RMS de RN-02.

    El filtro quita zumbidos graves y siseos agudos. Normalizar no cambia las razones contra
    el baseline; sirve para que el piso de voz signifique lo mismo en grabaciones fuertes y debiles.
    """
    if len(audio) < MUESTRAS_MINIMAS_FILTRO:
        return audio
    filtro = butter(ORDEN_FILTRO, [reglas["filtro_hz_minimo"], reglas["filtro_hz_maximo"]],
                    btype="bandpass", fs=frecuencia, output="sos")
    filtrado = sosfiltfilt(filtro, audio)
    # Se toma el percentil 95 de la energia por bloques para no normalizar contra los silencios.
    bloques = len(filtrado) // MUESTRAS_MINIMAS_FILTRO
    energia = np.sqrt(np.mean(
        np.square(filtrado[:bloques * MUESTRAS_MINIMAS_FILTRO]).reshape(bloques, -1), axis=1))
    referencia = np.percentile(energia, 95)
    if referencia < 1e-6:
        return filtrado
    return filtrado * (10.0 ** (reglas["normalizar_a_dbfs"] / 20.0) / referencia)


def agrupar_rms(rms, cuadros_por_tramo):
    """Energia RMS de cada tramo a partir de los cuadros cortos."""
    total = len(rms) // cuadros_por_tramo
    if total == 0:
        return np.zeros(0)
    cuadros = np.asarray(rms[:total * cuadros_por_tramo]).reshape(total, cuadros_por_tramo)
    return np.sqrt(np.mean(np.square(cuadros), axis=1))


def marcar_voz(niveles_db, reglas):
    """Tramos con voz: sobre el ruido estimado, para que el ruido no entre al baseline."""
    if len(niveles_db) == 0:
        return np.zeros(0, dtype=bool)
    ruido = np.percentile(niveles_db, 10)
    # Percentil 75, no el maximo: si hay gritos o rafagas largas, la voz normal no debe quedar fuera.
    normal = np.percentile(niveles_db, 75)
    # Sin pausas el percentil 10 ya es voz: el tope evita descartar la voz suave.
    relativo = min(ruido + reglas["margen_voz_db"], normal - reglas["margen_voz_db"])
    return niveles_db >= max(reglas["piso_voz_dbfs"], relativo)


def marcar_volumen(amplitud, voz, reglas):
    """Tramos sobre la razon del promedio movil, si la subida se sostiene sin interrupcion."""
    tramo = reglas["segundos_por_tramo"]
    historial = deque(maxlen=int(reglas["segundos_baseline"] / tramo))
    minimo = int(reglas["segundos_minimos_baseline"] / tramo)
    altos = np.zeros(len(amplitud), dtype=bool)
    for indice, valor in enumerate(amplitud):
        if not voz[indice]:
            continue
        if len(historial) >= minimo and valor > reglas["razon_volumen"] * np.mean(historial):
            altos[indice] = True
        historial.append(valor)

    necesarios = int(np.ceil(reglas["segundos_volumen_continuos"] / tramo))
    tolerancia = int(reglas["segundos_pausa_tolerada"] / tramo)
    confirmados = np.zeros(len(amplitud), dtype=bool)
    inicio = ultimo = None
    # Una pausa corta entre palabras no corta un grito; el indice extra cierra la ultima racha.
    for indice in list(np.flatnonzero(altos)) + [len(amplitud) + tolerancia + 1]:
        if inicio is not None and indice - ultimo - 1 > tolerancia:
            if ultimo - inicio + 1 >= necesarios:
                confirmados[inicio:ultimo + 1] = True
            inicio = None
        if inicio is None:
            inicio = indice
        ultimo = indice
    return confirmados


def marcar_tono(f0, cuadros_por_tramo, total_tramos, reglas):
    """Tramos cuya ventana tiene una desviacion de F0 mayor al 40 % de la media del audio."""
    marcados = np.zeros(total_tramos, dtype=bool)
    con_voz = f0[~np.isnan(f0)]
    if len(con_voz) == 0:
        return marcados

    limite = reglas["razon_desviacion_f0"] * np.mean(con_voz)
    segundos_por_cuadro = reglas["segundos_por_tramo"] / cuadros_por_tramo
    ventana = int(reglas["segundos_ventana_tono"] / segundos_por_cuadro)
    minimo = int(reglas["segundos_minimos_voz_tono"] / segundos_por_cuadro)
    for indice in range(total_tramos):
        fin = (indice + 1) * cuadros_por_tramo
        valores = f0[max(0, fin - ventana):fin]
        valores = valores[~np.isnan(valores)]
        if len(valores) >= minimo and np.std(valores) > limite:
            marcados[indice] = True
    return marcados


def racha_mas_larga(marcados):
    mayor = actual = 0
    for marcado in marcados:
        actual = actual + 1 if marcado else 0
        mayor = max(mayor, actual)
    return mayor


def a_eventos(marcados, tipo, segundos_por_tramo):
    eventos = []
    inicio = None
    for indice, marcado in enumerate(list(marcados) + [False]):
        if marcado and inicio is None:
            inicio = indice
        elif not marcado and inicio is not None:
            eventos.append({"tipo": tipo, "inicio": round(inicio * segundos_por_tramo, 3),
                            "fin": round(indice * segundos_por_tramo, 3)})
            inicio = None
    return eventos


def medir_ruido(cuadros_db, niveles_db, voz, reglas):
    """Flujo E1: audio con ruido de fondo y variaciones de volumen extremas.

    El ruido se mide en cuadros cortos, porque solo ahi aparecen las pausas entre palabras:
    en tramos de 500 ms una voz limpia sin pausas largas parece ruidosa. Por eso un grito en una
    grabacion limpia no activa E1: tiene rango extremo, pero no ruido de fondo.
    """
    if not np.any(voz):
        return {"snr_db": 0.0, "rango_db": 0.0, "ruido_extremo": False}
    # Percentil 90: las rafagas fuertes no deben contar como el nivel normal de la voz.
    snr = float(np.percentile(cuadros_db, 90) - np.percentile(cuadros_db, 5))
    rango = float(np.percentile(niveles_db[voz], 99) - np.percentile(niveles_db[voz], 50))
    return {"snr_db": round(snr, 2), "rango_db": round(rango, 2),
            "ruido_extremo": snr < reglas["snr_ruidoso_db"] and rango >= reglas["rango_extremo_db"]}


def evaluar(f0, rms, segundos_por_cuadro, reglas):
    """Devuelve score_acustico, la subida continua mas larga, los eventos y la medida de ruido.

    "rms" debe venir del audio de preparar_audio. Sin eventos el puntaje es 0, no positivo: una
    voz tranquila no prueba satisfaccion. Baja hasta -1 cuando los eventos llegan a
    "fraccion_saturacion" del tiempo con voz. Cada tramo de grito sostenido cuenta
    "peso_tramo_grito" veces (decision del equipo del 11/11: los gritos pesan mas); los tramos
    de tono cuentan una vez, porque tambien aparecen en llamadas tranquilas.
    """
    tramo = reglas["segundos_por_tramo"]
    cuadros_por_tramo = int(round(tramo / segundos_por_cuadro))
    amplitud = agrupar_rms(rms, cuadros_por_tramo)
    niveles_db = a_dbfs(amplitud)
    voz = marcar_voz(niveles_db, reglas)

    volumen = marcar_volumen(amplitud, voz, reglas)
    tono = marcar_tono(np.asarray(f0), cuadros_por_tramo, len(amplitud), reglas) & voz
    puntos = np.count_nonzero(tono & ~volumen) + reglas["peso_tramo_grito"] * np.count_nonzero(volumen)

    tramos_con_voz = np.count_nonzero(voz)
    fraccion = puntos / tramos_con_voz if tramos_con_voz else 0.0
    return {
        "score_acustico": round(-min(1.0, fraccion / reglas["fraccion_saturacion"]), 3) + 0.0,
        # Solo volumen: la ventana de 2 s del tono hace que un solo cambio de voz ya dure 2 s.
        "subida_continua_segundos": racha_mas_larga(volumen) * tramo,
        # Los tipos son los de TB_Alerta.tipo_alerta, para que la v0.3 los guarde sin traducir.
        "eventos": a_eventos(volumen, "EXCESO_VOLUMEN", tramo)
        + a_eventos(tono, "ALTERACION_TONO", tramo),
        **medir_ruido(a_dbfs(np.asarray(rms)), niveles_db, voz, reglas),
    }


def escalar(combinado, reglas):
    """Lleva el puntaje combinado a 0-100 con 50 como neutro (contrato v0.4, decision 3 del 11/11).

    El combinado va de -1 a "peso_nlp", porque score_acustico nunca es positivo: en la v0.3 el
    maximo era 77,5. El lado positivo se estira hasta 100, en linea recta ("lineal") o en curva
    ("curva", la alternativa del contrato); el negativo queda como en la v0.3.
    """
    if combinado <= 0:
        # La misma expresion que la v0.3, para que el redondeo de 2 decimales de identico.
        return (combinado + 1.0) * 50.0
    proporcion = min(1.0, combinado / reglas["peso_nlp"])
    if reglas["escala_lado_positivo"] == "curva":
        proporcion = proporcion ** 2
    return 50.0 + 50.0 * proporcion


def calcular_puntaje(score_nlp, score_acustico, baja_confianza, subida_continua, reglas):
    """Puntaje de 0 a 100 (100 es lo mejor) y clasificacion, segun RN-03 recalibrado.

    Con baja confianza (flujo E1) cuenta solo el texto. La alerta roja exige voz sostenida Y
    texto negativo; con texto neutro o positivo, la voz solo baja el puntaje de forma proporcional.
    """
    if baja_confianza:
        puntaje = (score_nlp + 1.0) * 50.0
    else:
        puntaje = escalar(reglas["peso_nlp"] * score_nlp + reglas["peso_acustico"] * score_acustico, reglas)
    puntaje = round(max(0.0, min(100.0, puntaje)), 2)

    alerta_roja = (not baja_confianza
                   and subida_continua >= reglas["segundos_subida_continua"]
                   and score_nlp < reglas["umbral_nlp_negativo"])
    if alerta_roja:
        clasificacion = "CRITICO"
    elif puntaje < reglas["puntaje_negativo_menor_a"]:
        clasificacion = "NEGATIVO"
    elif puntaje > reglas["puntaje_positivo_mayor_a"]:
        clasificacion = "POSITIVO"
    else:
        clasificacion = "NEUTRO"
    return {"puntaje_final": puntaje, "clasificacion_final": clasificacion}


def hablante_del_evento(evento, segmentos):
    """Hablante con mas tiempo dentro del evento, o None si el evento no toca ningun segmento.

    No basta con que se crucen: el volumen se mide en tramos de 0.5 s y Whisper pega un turno con el
    siguiente, asi que un grito del cliente suele rozar unas decimas el final del turno del agente.
    Es el mismo criterio con que alertas.py (v0.3) llena origen_evento.
    """
    tiempos = {}
    for segmento in segmentos:
        traslape = min(evento["fin"], segmento["fin"]) - max(evento["inicio"], segmento["inicio"])
        if traslape > 0:
            tiempos[segmento["hablante"]] = tiempos.get(segmento["hablante"], 0.0) + traslape
    return max(tiempos, key=tiempos.get) if tiempos else None


def frases_sin_eco(segmentos, frases_analizadas, lexico):
    """Frases analizadas sin las palabras negativas que el agente repite de lo que ya dijo el cliente.

    "Registro su queja y su solicitud de cancelacion" no es una falla del agente si el cliente ya
    se quejo y pidio cancelar. Se compara por familia de palabras (lexico.raiz).
    """
    dichas_por_cliente = set()
    resultado = []
    for segmento, frase in zip(segmentos, frases_analizadas):
        if segmento["hablante"] == "AGENTE" and dichas_por_cliente:
            frase = analizar_frase(segmento["texto"], lexico, dichas_por_cliente)
        elif segmento["hablante"] == "CLIENTE":
            dichas_por_cliente |= raices_negativas(segmento["texto"], lexico)
        resultado.append(frase)
    return resultado


def calcular_diagnostico(clasificacion, segmentos, frases_analizadas, eventos, baja_confianza, reglas,
                         lexico=None):
    """Origen del conflicto en una llamada mala (Blueprint, 3.3, punto 4).

    Solo se diagnostican llamadas NEGATIVO o CRITICO. Si el agente tiene texto negativo o gritos, es
    FALLA_AGENTE; si solo los tiene el cliente, CLIENTE_PROBLEMATICO. Cada grito es de quien mas
    tiempo habla dentro de el, y al agente no le cuentan las palabras negativas que repite del
    cliente. Con baja confianza no cuenta la voz. Todavia no revisa si el agente omitio el script ni
    si interrumpio. Sin lexico, usa el de lexico_es.json.
    """
    if clasificacion not in ("NEGATIVO", "CRITICO"):
        return "SIN_CONFLICTO"

    gritones = set() if baja_confianza else {
        hablante_del_evento(e, segmentos) for e in eventos if e["tipo"] == "EXCESO_VOLUMEN"}
    frases = frases_sin_eco(segmentos, frases_analizadas,
                            lexico if lexico is not None else cargar_lexico())

    def tiene_conflicto(hablante):
        propias = [f for s, f in zip(segmentos, frases) if s["hablante"] == hablante]
        return puntaje_global(propias) < reglas["umbral_nlp_negativo"] or hablante in gritones

    if tiene_conflicto("AGENTE"):
        return "FALLA_AGENTE"
    if tiene_conflicto("CLIENTE"):
        return "CLIENTE_PROBLEMATICO"
    return "SIN_CONFLICTO"
