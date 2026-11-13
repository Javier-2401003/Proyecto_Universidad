"""Pruebas de RN-02 y RN-03 con senales armadas a mano. Ejecutar: python -m unittest -v"""

import json
import os
import tempfile
import unittest

import numpy as np

from acustico import RUTA_REGLAS, calcular_puntaje, cargar_reglas, evaluar, preparar_audio

REGLAS = cargar_reglas()
SEGUNDOS_POR_CUADRO = 0.02
CUADROS_POR_SEGUNDO = 50
FRECUENCIA = 16000


def senal(tramos_rms, f0=150.0):
    """Arma RMS y F0 de cuadros a partir de una lista de (segundos, amplitud)."""
    rms = np.concatenate([np.full(int(s * CUADROS_POR_SEGUNDO), a) for s, a in tramos_rms])
    return np.full(len(rms), f0), rms


def resultado(f0, rms):
    return evaluar(f0, rms, SEGUNDOS_POR_CUADRO, REGLAS)


def eventos_de_volumen(r):
    return [e for e in r["eventos"] if e["tipo"] == "EXCESO_VOLUMEN"]


def voz_con_pausas(segundos, voz, pausa):
    """Alterna palabra y pausa cada 100 ms, para que el piso de ruido aparezca en los cuadros."""
    rms = np.full(int(segundos * CUADROS_POR_SEGUNDO), float(voz))
    rms[5::10] = pausa
    rms[6::10] = pausa
    rms[7::10] = pausa
    rms[8::10] = pausa
    rms[9::10] = pausa
    return rms


class PruebasPreparacion(unittest.TestCase):
    def test_quita_zumbido_grave_y_conserva_la_voz(self):
        t = np.arange(FRECUENCIA * 3) / FRECUENCIA
        voz = 0.1 * np.sin(2 * np.pi * 300 * t)
        zumbido = 0.5 * np.sin(2 * np.pi * 20 * t)
        preparado = preparar_audio(voz + zumbido, FRECUENCIA, REGLAS)
        self.assertLess(np.corrcoef(voz + zumbido, voz)[0, 1], 0.3)
        self.assertGreater(np.corrcoef(preparado, voz)[0, 1], 0.95)

    def test_grabaciones_fuertes_y_debiles_quedan_al_mismo_nivel(self):
        t = np.arange(FRECUENCIA * 3) / FRECUENCIA
        voz = np.sin(2 * np.pi * 300 * t)
        fuerte = preparar_audio(0.8 * voz, FRECUENCIA, REGLAS)
        debil = preparar_audio(0.01 * voz, FRECUENCIA, REGLAS)
        self.assertAlmostEqual(np.std(fuerte), np.std(debil), places=3)
        self.assertAlmostEqual(20 * np.log10(np.std(fuerte)), REGLAS["normalizar_a_dbfs"], places=0)

    def test_audio_muy_corto_o_en_silencio_no_falla(self):
        self.assertEqual(len(preparar_audio(np.zeros(100), FRECUENCIA, REGLAS)), 100)
        self.assertEqual(len(preparar_audio(np.zeros(FRECUENCIA), FRECUENCIA, REGLAS)), FRECUENCIA)


class PruebasVolumen(unittest.TestCase):
    def test_voz_estable_no_genera_eventos(self):
        r = resultado(*senal([(60, 0.1)]))
        self.assertEqual(r["score_acustico"], 0.0)
        self.assertEqual(r["eventos"], [])

    def test_grito_de_tres_segundos_se_detecta_a_su_hora(self):
        r = resultado(*senal([(20, 0.1), (3, 0.3), (20, 0.1)]))
        volumen = eventos_de_volumen(r)
        self.assertEqual(len(volumen), 1)
        self.assertEqual(volumen[0]["inicio"], 20.0)
        self.assertGreaterEqual(r["subida_continua_segundos"], 2.0)
        self.assertLess(r["score_acustico"], 0.0)

    def test_pico_de_un_segundo_no_alcanza_los_2_s(self):
        self.assertEqual(resultado(*senal([(20, 0.1), (1, 0.3), (20, 0.1)]))["eventos"], [])

    def test_picos_separados_ya_no_se_acumulan(self):
        r = resultado(*senal([(20, 0.1), (1, 0.3), (2, 0.1), (1, 0.3), (20, 0.1)]))
        self.assertEqual(r["eventos"], [])

    def test_una_pausa_corta_no_corta_el_grito(self):
        r = resultado(*senal([(20, 0.1), (1, 0.3), (0.5, 0.1), (1, 0.3), (20, 0.1)]))
        volumen = eventos_de_volumen(r)
        self.assertEqual(len(volumen), 1)
        self.assertEqual((volumen[0]["inicio"], volumen[0]["fin"]), (20.0, 22.5))

    def test_subida_bajo_el_180_por_ciento_no_cuenta(self):
        self.assertEqual(resultado(*senal([(20, 0.1), (5, 0.17), (20, 0.1)]))["eventos"], [])

    def test_subida_sobre_el_180_por_ciento_si_cuenta(self):
        self.assertTrue(eventos_de_volumen(resultado(*senal([(20, 0.1), (5, 0.2), (20, 0.1)]))))

    def test_silencio_no_baja_el_baseline(self):
        r = resultado(*senal([(20, 0.1), (20, 0.0001), (5, 0.1)]))
        self.assertEqual(r["eventos"], [])

    def test_gritos_largos_no_sacan_a_la_voz_normal_del_baseline(self):
        r = resultado(*senal([(30, 0.02), (6, 0.5), (30, 0.02), (6, 0.5), (30, 0.02)]))
        self.assertEqual(len(eventos_de_volumen(r)), 2)

    def test_audio_en_silencio_es_neutro(self):
        r = resultado(*senal([(30, 0.0)]))
        self.assertEqual((r["score_acustico"], r["eventos"]), (0.0, []))

    def test_audio_muy_corto_no_falla(self):
        self.assertEqual(resultado(*senal([(0.1, 0.1)]))["score_acustico"], 0.0)

    def test_un_grito_sostenido_pesa_el_doble(self):
        # Decision del equipo del 11/11: los gritos pesan mas.
        f0, rms = senal([(20, 0.1), (3, 0.3), (20, 0.1)])
        sin_peso = evaluar(f0, rms, SEGUNDOS_POR_CUADRO, {**REGLAS, "peso_tramo_grito": 1.0})
        self.assertEqual(REGLAS["peso_tramo_grito"], 2.0)
        self.assertAlmostEqual(resultado(f0, rms)["score_acustico"], 2 * sin_peso["score_acustico"], places=2)


class PruebasTono(unittest.TestCase):
    def test_tono_estable_no_genera_eventos(self):
        f0, rms = senal([(20, 0.1)])
        self.assertEqual(resultado(f0, rms)["eventos"], [])

    def test_variacion_aguda_baja_el_puntaje_pero_no_cuenta_como_subida_sostenida(self):
        f0, rms = senal([(30, 0.1)], f0=150.0)
        f0[10 * CUADROS_POR_SEGUNDO:13 * CUADROS_POR_SEGUNDO:2] = 400.0
        r = resultado(f0, rms)
        self.assertEqual({e["tipo"] for e in r["eventos"]}, {"ALTERACION_TONO"})
        self.assertLess(r["score_acustico"], 0.0)
        self.assertEqual(r["subida_continua_segundos"], 0.0)

    def test_sin_voz_detectada_no_falla(self):
        f0, rms = senal([(20, 0.1)])
        f0[:] = np.nan
        self.assertEqual(resultado(f0, rms)["score_acustico"], 0.0)

    def test_el_tono_no_pesa_doble(self):
        f0, rms = senal([(30, 0.1)], f0=150.0)
        f0[10 * CUADROS_POR_SEGUNDO:13 * CUADROS_POR_SEGUNDO:2] = 400.0
        sin_peso = evaluar(f0, rms, SEGUNDOS_POR_CUADRO, {**REGLAS, "peso_tramo_grito": 1.0})
        self.assertEqual(resultado(f0, rms)["score_acustico"], sin_peso["score_acustico"])

    def test_eventos_en_todo_el_audio_saturan_en_menos_uno(self):
        f0, rms = senal([(30, 0.1)], f0=150.0)
        f0[::2] = 400.0
        self.assertEqual(resultado(f0, rms)["score_acustico"], -1.0)


class PruebasRuido(unittest.TestCase):
    def rafagas(self, rms):
        for inicio in range(10, 50, 8):
            rms[inicio * CUADROS_POR_SEGUNDO:(inicio + 1) * CUADROS_POR_SEGUNDO] *= 8
        return rms

    def test_ruido_de_fondo_con_rafagas_activa_e1(self):
        rms = self.rafagas(voz_con_pausas(60, 0.05, 0.03))
        self.assertTrue(resultado(np.full(len(rms), 150.0), rms)["ruido_de_fondo"])

    def test_gritos_en_audio_limpio_no_activan_e1(self):
        rms = self.rafagas(voz_con_pausas(60, 0.05, 0.0005))
        self.assertFalse(resultado(np.full(len(rms), 150.0), rms)["ruido_de_fondo"])

    def test_ruido_constante_tambien_activa_e1(self):
        # v0.4: la v0.3 pedia ademas variaciones extremas, y el ruido de calle constante no las tiene.
        rms = voz_con_pausas(60, 0.05, 0.03)
        r = resultado(np.full(len(rms), 150.0), rms)
        self.assertLess(r["rango_db"], 12.0)
        self.assertTrue(r["ruido_de_fondo"])

    def test_ruido_leve_no_activa_e1(self):
        # Voz 20 dB sobre el ruido: el corte es 18 dB.
        rms = voz_con_pausas(60, 0.05, 0.005)
        r = resultado(np.full(len(rms), 150.0), rms)
        self.assertGreater(r["snr_db"], REGLAS["snr_ruidoso_db"])
        self.assertFalse(r["ruido_de_fondo"])


class PruebasPuntaje(unittest.TestCase):
    def calcular(self, nlp, acustico, baja_confianza=False, subida=0.0):
        return calcular_puntaje(nlp, acustico, baja_confianza, subida, REGLAS)

    def test_aplica_la_formula_de_rn03_con_la_escala_de_la_v04(self):
        # combinado = 0,55 x 0,5 + 0,45 x -0,2 = 0,185; 50 + 50 x 0,185 / 0,55
        self.assertEqual(self.calcular(0.5, -0.2)["puntaje_final"], 66.82)

    def test_la_escala_va_de_0_a_100_y_el_centro_es_50(self):
        self.assertEqual(self.calcular(-1.0, -1.0)["puntaje_final"], 0.0)
        # score_acustico nunca es positivo: el maximo real es texto +1 sin subidas (77,5 en la v0.3).
        self.assertEqual(self.calcular(1.0, 0.0)["puntaje_final"], 100.0)
        resultado_neutro = self.calcular(0.0, 0.0)
        self.assertEqual(resultado_neutro, {"puntaje_final": 50.0, "clasificacion_final": "NEUTRO"})

    def test_el_lado_negativo_es_igual_que_en_la_v03(self):
        # (-0,75; -1,0) da 6,875: el empate al redondear tiene que caer igual que en la v0.3.
        for nlp, acustico in [(-0.5, -0.2), (0.0, -0.5), (-1.0, -0.5), (0.2, -0.8), (-0.75, -1.0)]:
            combinado = 0.55 * nlp + 0.45 * acustico
            self.assertEqual(self.calcular(nlp, acustico)["puntaje_final"], round((combinado + 1) * 50, 2))

    def test_sin_subidas_el_ruido_ya_no_sube_el_puntaje(self):
        # Efecto que senalo Willy en la v0.3: texto 0,8 daba 72 en una llamada limpia y 90 con ruido.
        limpia = self.calcular(0.8, 0.0)["puntaje_final"]
        self.assertEqual(limpia, 90.0)
        self.assertEqual(self.calcular(0.8, 0.0, baja_confianza=True)["puntaje_final"], limpia)

    def test_alternativa_en_curva(self):
        curva = {**REGLAS, "escala_lado_positivo": "curva"}
        self.assertEqual(calcular_puntaje(1.0, 0.0, False, 0.0, curva)["puntaje_final"], 100.0)
        self.assertEqual(calcular_puntaje(0.5, 0.0, False, 0.0, curva)["puntaje_final"], 62.5)
        self.assertEqual(calcular_puntaje(-0.5, -0.2, False, 0.0, curva)["puntaje_final"], 31.75)

    def test_una_escala_desconocida_falla_al_cargar(self):
        with open(RUTA_REGLAS, encoding="utf-8") as archivo:
            datos = json.load(archivo)
        datos["decisiones_del_proyecto"]["escala_lado_positivo"] = "otra"
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "reglas.json")
            with open(ruta, "w", encoding="utf-8") as archivo:
                json.dump(datos, archivo)
            with self.assertRaises(ValueError):
                cargar_reglas(ruta)

    def test_voz_sostenida_y_texto_negativo_dan_alerta_roja(self):
        self.assertEqual(self.calcular(-0.5, -0.2, subida=2.0)["clasificacion_final"], "CRITICO")

    def test_voz_sostenida_con_texto_neutro_solo_baja_el_puntaje(self):
        tranquila = self.calcular(0.0, 0.0)
        sostenida = self.calcular(0.0, -0.5, subida=5.0)
        self.assertEqual(sostenida["clasificacion_final"], "NEUTRO")
        self.assertLess(sostenida["puntaje_final"], tranquila["puntaje_final"])

    def test_voz_sostenida_con_texto_positivo_no_da_alerta_roja(self):
        self.assertNotEqual(self.calcular(0.8, -0.5, subida=5.0)["clasificacion_final"], "CRITICO")

    def test_el_limite_de_rn01_no_cuenta_como_negativo(self):
        self.assertNotEqual(self.calcular(-0.3, 0.0, subida=5.0)["clasificacion_final"], "CRITICO")

    def test_texto_negativo_sin_voz_sostenida_no_da_alerta_roja(self):
        r = self.calcular(-0.8, 0.0, subida=1.5)
        self.assertEqual(r["clasificacion_final"], "NEGATIVO")

    def test_baja_confianza_usa_solo_el_texto_y_anula_la_alerta(self):
        r = self.calcular(-0.5, -1.0, baja_confianza=True, subida=5.0)
        self.assertEqual(r, {"puntaje_final": 25.0, "clasificacion_final": "NEGATIVO"})

    def test_cortes_de_clasificacion(self):
        self.assertEqual(self.calcular(-1.0, -0.5)["clasificacion_final"], "NEGATIVO")
        self.assertEqual(self.calcular(1.0, 0.0)["clasificacion_final"], "POSITIVO")


if __name__ == "__main__":
    unittest.main()
