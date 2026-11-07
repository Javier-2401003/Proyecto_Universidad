"""Alertas para TB_Alerta (contrato v0.3).

Detecta EXCESO_VOLUMEN (las subidas de RN-02 que ya usa score_acustico), ALTERACION_TONO medida por
hablante y VOCABULARIO_INADECUADO por palabras. OMISION_SCRIPT queda para cuando el equipo defina el
guion. Los mensajes estan en reglas_alertas.json.
"""

import json
import os

import numpy as np

from lexico import palabras_inadecuadas

RUTA_REGLAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reglas_alertas.json")


def cargar_reglas(ruta=RUTA_REGLAS):
    # utf-8-sig: el Bloc de notas de Windows puede guardar el archivo con BOM.
    with open(ruta, encoding="utf-8-sig") as archivo:
        return json.load(archivo)


def hablante_en(inicio, fin, segmentos):
    """Hablante con mas tiempo dentro de [inicio, fin]; si ninguno se cruza, el del segmento mas cercano."""
    tiempos = {}
    for segmento in segmentos:
        traslape = min(fin, segmento["fin"]) - max(inicio, segmento["inicio"])
        if traslape > 0:
            tiempos[segmento["hablante"]] = tiempos.get(segmento["hablante"], 0.0) + traslape
    if tiempos:
        return max(tiempos, key=tiempos.get)
    centro = (inicio + fin) / 2
    cercano = min(segmentos, key=lambda s: min(abs(centro - s["inicio"]), abs(centro - s["fin"])))
    return cercano["hablante"]


def alertas_volumen(eventos, segmentos, rms, segundos_por_cuadro):
    """Una alerta por cada subida de volumen; el valor es el cuadro mas fuerte del audio original."""
    alertas = []
    for evento in eventos:
        if evento["tipo"] != "EXCESO_VOLUMEN":
            continue
        desde = int(evento["inicio"] / segundos_por_cuadro)
        hasta = max(desde + 1, int(evento["fin"] / segundos_por_cuadro))
        tramo = np.asarray(rms[desde:hasta])
        pico = 20.0 * np.log10(max(float(np.max(tramo)), 1e-10)) if len(tramo) else None
        alertas.append({
            "tipo_alerta": "EXCESO_VOLUMEN",
            "origen_evento": hablante_en(evento["inicio"], evento["fin"], segmentos),
            "timestamp_evento": evento["inicio"],
            "valor_registrado": f"{pico:.1f} dBFS" if pico is not None else "sin medida",
        })
    return alertas


def quitar_errores_de_octava(f0, cuadros, factor):
    """pyin a veces estima el doble o la mitad del tono real; esos cuadros no son una alteracion.

    En una llamada real de 4 min 44 s, las 7 alertas de tono venian de esos saltos.
    """
    limpio = np.asarray(f0, dtype=float).copy()
    for dentro in cuadros.values():
        todos = np.concatenate(dentro) if dentro else np.array([], dtype=int)
        con_voz = limpio[todos][~np.isnan(limpio[todos])]
        if len(con_voz) == 0:
            continue
        mediana = float(np.median(con_voz))
        valores = limpio[todos]
        valores[(valores > mediana * factor) | (valores < mediana / factor)] = np.nan
        limpio[todos] = valores
    return limpio


def alertas_tono(f0, tiempos, segmentos, reglas_acusticas, factor_error_octava=2.0):
    """RN-02 por hablante: ventanas de un solo hablante con F0 que varia mas del 40 % de SU media."""
    tiempos = np.asarray(tiempos)
    segundos_por_cuadro = float(tiempos[1] - tiempos[0]) if len(tiempos) > 1 else 0.02
    ancho = int(reglas_acusticas["segundos_ventana_tono"] / segundos_por_cuadro)
    avance = max(1, int(reglas_acusticas["segundos_por_tramo"] / segundos_por_cuadro))
    minimo = int(reglas_acusticas["segundos_minimos_voz_tono"] / segundos_por_cuadro)

    cuadros = {}
    for segmento in segmentos:
        dentro = np.flatnonzero((tiempos >= segmento["inicio"]) & (tiempos < segmento["fin"]))
        cuadros.setdefault(segmento["hablante"], []).append(dentro)
    f0 = quitar_errores_de_octava(f0, cuadros, factor_error_octava)

    alertas = []
    for hablante, listas in cuadros.items():
        todos = np.concatenate(listas) if listas else np.array([], dtype=int)
        con_voz = f0[todos][~np.isnan(f0[todos])]
        if len(con_voz) < minimo:
            continue
        media = float(np.mean(con_voz))
        limite = reglas_acusticas["razon_desviacion_f0"] * media
        tramos = []
        for dentro in listas:
            for inicio in range(0, max(1, len(dentro) - ancho + 1), avance):
                ventana = f0[dentro[inicio:inicio + ancho]]
                ventana = ventana[~np.isnan(ventana)]
                if len(ventana) >= minimo and np.std(ventana) > limite:
                    desde = float(tiempos[dentro[inicio]])
                    hasta = float(tiempos[dentro[min(inicio + ancho, len(dentro)) - 1]])
                    tramos.append((desde, hasta, float(np.median(ventana)), float(np.std(ventana)) / media))
        # Ventanas que se tocan son una sola alteracion: una alerta, con la mayor variacion medida.
        for desde, hasta, mediana, variacion in sorted(tramos):
            if alertas and alertas[-1]["_hablante"] == hablante and desde <= alertas[-1]["_fin"]:
                ultima = alertas[-1]
                ultima["_fin"] = max(ultima["_fin"], hasta)
                if variacion > ultima["_variacion"]:
                    ultima["_variacion"], ultima["_mediana"] = variacion, mediana
                continue
            alertas.append({"tipo_alerta": "ALTERACION_TONO", "origen_evento": hablante,
                            "timestamp_evento": desde, "_hablante": hablante, "_fin": hasta,
                            "_mediana": mediana, "_variacion": variacion})
    for alerta in alertas:
        alerta["valor_registrado"] = f"{alerta['_mediana']:.0f} Hz (variación {alerta['_variacion'] * 100:.0f} %)"
        for clave in ("_hablante", "_fin", "_mediana", "_variacion"):
            del alerta[clave]
    return alertas


def alertas_vocabulario(segmentos, lexico):
    """Una alerta por palabra inadecuada en cada segmento, al inicio del segmento."""
    return [{"tipo_alerta": "VOCABULARIO_INADECUADO", "origen_evento": segmento["hablante"],
             "timestamp_evento": segmento["inicio"], "valor_registrado": f"Palabra: {palabra}"}
            for segmento in segmentos for palabra in palabras_inadecuadas(segmento["texto"], lexico)]


def generar_alertas(segmentos, eventos, f0, rms, tiempos, segundos_por_cuadro, baja_confianza,
                    lexico, reglas_acusticas, reglas):
    """Todas las alertas, ordenadas por tiempo. Con baja confianza solo las de vocabulario (flujo E1)."""
    if not segmentos:
        return []
    alertas = alertas_vocabulario(segmentos, lexico)
    if not baja_confianza:
        alertas += alertas_volumen(eventos, segmentos, rms, segundos_por_cuadro)
        alertas += alertas_tono(f0, tiempos, segmentos, reglas_acusticas, reglas["factor_error_octava"])
    for alerta in alertas:
        alerta["timestamp_evento"] = round(float(alerta["timestamp_evento"]), 3)
        alerta["valor_registrado"] = alerta["valor_registrado"][:reglas["largo_maximo_valor"]]
        mensaje = reglas["mensajes"][alerta["tipo_alerta"]][alerta["origen_evento"]]
        alerta["mensaje_sugerencia"] = mensaje[:reglas["largo_maximo_mensaje"]]
    return sorted(alertas, key=lambda a: (a["timestamp_evento"], a["tipo_alerta"]))
