"""Pruebas de las alertas de la v0.3. Ejecutar desde audio-processing/: python -m unittest -v"""

import json
import math
import unittest

import numpy as np

from acustico import cargar_reglas as cargar_reglas_acusticas
from alertas import (alertas_tono, alertas_vocabulario, alertas_volumen, cargar_reglas,
                     generar_alertas, hablante_en)
from lexico import cargar_lexico, palabras_inadecuadas

LEXICO = cargar_lexico()
REGLAS = cargar_reglas()
REGLAS_ACUSTICAS = cargar_reglas_acusticas()
SEGUNDOS_POR_CUADRO = 0.02
TIPOS_DE_LA_TABLA = {"EXCESO_VOLUMEN", "ALTERACION_TONO", "VOCABULARIO_INADECUADO", "OMISION_SCRIPT"}


def segmento(inicio, fin, hablante, texto="hola"):
    return {"inicio": inicio, "fin": fin, "hablante": hablante, "texto": texto}


def tiempos(segundos):
    return np.arange(int(segundos / SEGUNDOS_POR_CUADRO)) * SEGUNDOS_POR_CUADRO


class PruebasVocabulario(unittest.TestCase):
    def test_encuentra_la_palabra_sin_importar_tildes_ni_mayusculas(self):
        self.assertEqual(palabras_inadecuadas("¡Esto es una ESTAFA, son unos INUTILES!", LEXICO),
                         ["estafa", "inútiles"])

    def test_no_coincide_dentro_de_otra_palabra(self):
        self.assertEqual(palabras_inadecuadas("el estafador habló", LEXICO), [])

    def test_plurales_y_groserias_de_una_llamada_real(self):
        self.assertEqual(palabras_inadecuadas("¡Son unos malparidos, qué mierdas, hijueputas!", LEXICO),
                         ["malparidos", "mierdas", "hijueputas"])

    def test_una_alerta_por_palabra_y_segmento_aunque_se_repita(self):
        alertas = alertas_vocabulario([segmento(3.5, 6, "CLIENTE", "estafa, estafa y más estafa")], LEXICO)
        self.assertEqual(alertas, [{"tipo_alerta": "VOCABULARIO_INADECUADO", "origen_evento": "CLIENTE",
                                    "timestamp_evento": 3.5, "valor_registrado": "Palabra: estafa"}])


class PruebasVolumen(unittest.TestCase):
    def test_toma_el_pico_y_al_hablante_que_estaba_hablando(self):
        rms = np.full(500, 0.05)
        rms[260:300] = 0.5
        evento = {"tipo": "EXCESO_VOLUMEN", "inicio": 5.0, "fin": 6.5}
        alertas = alertas_volumen([evento, {"tipo": "ALTERACION_TONO", "inicio": 1, "fin": 2}],
                                  [segmento(0, 4, "AGENTE"), segmento(4, 10, "CLIENTE")], rms, SEGUNDOS_POR_CUADRO)
        self.assertEqual(alertas, [{"tipo_alerta": "EXCESO_VOLUMEN", "origen_evento": "CLIENTE",
                                    "timestamp_evento": 5.0, "valor_registrado": "-6.0 dBFS"}])

    def test_evento_entre_segmentos_usa_el_mas_cercano(self):
        self.assertEqual(hablante_en(10.2, 10.8, [segmento(0, 4, "AGENTE"), segmento(11, 15, "CLIENTE")]), "CLIENTE")


class PruebasTono(unittest.TestCase):
    def test_variacion_dentro_de_un_hablante_genera_una_sola_alerta(self):
        t = tiempos(20)
        f0 = np.full(len(t), 120.0)
        bloque = np.flatnonzero((t >= 12) & (t < 15))
        f0[bloque[::2]] = 230.0
        f0[bloque[1::2]] = 70.0
        alertas = alertas_tono(f0, t, [segmento(0, 10, "AGENTE"), segmento(10, 20, "CLIENTE")], REGLAS_ACUSTICAS)
        self.assertEqual(len(alertas), 1)
        self.assertEqual((alertas[0]["origen_evento"], alertas[0]["tipo_alerta"]), ("CLIENTE", "ALTERACION_TONO"))
        self.assertGreaterEqual(alertas[0]["timestamp_evento"], 10.0)
        self.assertRegex(alertas[0]["valor_registrado"], r"^\d+ Hz \(variación \d+ %\)$")

    def test_errores_de_octava_de_pyin_no_son_alteracion(self):
        t = tiempos(20)
        f0 = np.full(len(t), 120.0)
        bloque = np.flatnonzero((t >= 12) & (t < 15))
        f0[bloque[::2]] = 260.0
        f0[bloque[1::2]] = 55.0
        self.assertEqual(alertas_tono(f0, t, [segmento(0, 20, "CLIENTE")], REGLAS_ACUSTICAS), [])

    def test_dos_voces_distintas_no_son_alteracion(self):
        t = tiempos(20)
        f0 = np.where(t < 10, 110.0, 240.0)
        alertas = alertas_tono(f0, t, [segmento(0, 10, "AGENTE"), segmento(10, 20, "CLIENTE")], REGLAS_ACUSTICAS)
        self.assertEqual(alertas, [])

    def test_sin_voz_no_falla(self):
        t = tiempos(10)
        self.assertEqual(alertas_tono(np.full(len(t), np.nan), t, [segmento(0, 10, "AGENTE")], REGLAS_ACUSTICAS), [])


class PruebasGenerar(unittest.TestCase):
    def generar(self, segmentos, eventos=(), baja_confianza=False):
        t = tiempos(20)
        rms = np.full(len(t), 0.05)
        return generar_alertas(segmentos, list(eventos), np.full(len(t), 150.0), rms, t, SEGUNDOS_POR_CUADRO,
                               baja_confianza, LEXICO, REGLAS_ACUSTICAS, REGLAS)

    def test_sin_segmentos_no_hay_alertas(self):
        self.assertEqual(self.generar([], [{"tipo": "EXCESO_VOLUMEN", "inicio": 1, "fin": 3}]), [])

    def test_baja_confianza_solo_deja_vocabulario(self):
        alertas = self.generar([segmento(0, 10, "CLIENTE", "es una estafa")],
                               [{"tipo": "EXCESO_VOLUMEN", "inicio": 1, "fin": 3}], baja_confianza=True)
        self.assertEqual([a["tipo_alerta"] for a in alertas], ["VOCABULARIO_INADECUADO"])

    def test_cumple_el_contrato_y_cabe_en_tb_alerta(self):
        alertas = self.generar([segmento(0, 6, "AGENTE", "eres un idiota"), segmento(6, 12, "CLIENTE", "estafa")],
                               [{"tipo": "EXCESO_VOLUMEN", "inicio": 7, "fin": 9.5}])
        self.assertEqual([a["timestamp_evento"] for a in alertas], sorted(a["timestamp_evento"] for a in alertas))
        for alerta in alertas:
            self.assertEqual(set(alerta), {"tipo_alerta", "origen_evento", "timestamp_evento", "valor_registrado",
                                           "mensaje_sugerencia"})
            self.assertIn(alerta["tipo_alerta"], TIPOS_DE_LA_TABLA)
            self.assertIn(alerta["origen_evento"], {"AGENTE", "CLIENTE"})
            self.assertTrue(0 <= alerta["timestamp_evento"] <= 99999.999)
            self.assertLessEqual(len(alerta["valor_registrado"]), 100)
            self.assertLessEqual(len(alerta["mensaje_sugerencia"]), 255)
            self.assertFalse(math.isnan(alerta["timestamp_evento"]))
        json.dumps(alertas, allow_nan=False)
        self.assertEqual(alertas[0]["mensaje_sugerencia"], REGLAS["mensajes"]["VOCABULARIO_INADECUADO"]["AGENTE"])

    def test_cada_tipo_y_origen_tiene_mensaje_que_cabe(self):
        for tipo in ("EXCESO_VOLUMEN", "ALTERACION_TONO", "VOCABULARIO_INADECUADO"):
            for origen in ("AGENTE", "CLIENTE"):
                self.assertLessEqual(len(REGLAS["mensajes"][tipo][origen]), 255)


if __name__ == "__main__":
    unittest.main()
