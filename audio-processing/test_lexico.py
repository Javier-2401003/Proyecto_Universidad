"""Pruebas del lexico. Ejecutar desde audio-processing/: python -m unittest -v"""

import os
import tempfile
import unittest

from lexico import RUTA_LEXICO, analizar_frase, cargar_lexico, puntaje_global, raices_negativas

LEXICO = cargar_lexico()


def puntaje(texto):
    return analizar_frase(texto, LEXICO)[0]


class PruebasFrase(unittest.TestCase):
    def test_cada_palabra_oficial_cruza_el_umbral_de_rn01(self):
        for palabra in ["excelente", "gracias", "con gusto", "solucionado", "amable"]:
            self.assertGreater(puntaje(f"esto fue {palabra}"), 0.3, palabra)
        for palabra in ["pésimo", "cancelar", "estafa", "incompetente", "queja", "nunca"]:
            self.assertLess(puntaje(f"esto fue {palabra}"), -0.3, palabra)

    def test_frase_sin_palabras_clave_es_neutra(self):
        self.assertEqual(analizar_frase("Me puede dar su número de contrato", LEXICO), (0.0, 0))

    def test_ignora_tildes_y_mayusculas(self):
        self.assertEqual(puntaje("PESIMO servicio"), puntaje("pésimo servicio"))

    def test_no_coincide_dentro_de_otra_palabra(self):
        self.assertEqual(puntaje("El estafador y la queja"), -0.5)

    def test_el_total_se_limita_a_uno(self):
        self.assertEqual(puntaje("pésimo, estafa, queja, incompetente"), -1.0)
        self.assertEqual(puntaje("gracias, excelente, amable, con gusto"), 1.0)

    def test_positiva_y_negativa_se_compensan_pero_cuentan(self):
        self.assertEqual(analizar_frase("gracias, pero fue pésimo", LEXICO), (0.0, 2))

    def test_negacion_invierte_el_signo(self):
        self.assertEqual(puntaje("no es una estafa"), 0.5)
        self.assertEqual(puntaje("no fue excelente"), -0.5)

    def test_negacion_fuera_de_la_ventana_no_cuenta(self):
        self.assertEqual(puntaje("no creo que sea tan pésimo"), -0.5)

    def test_la_puntuacion_corta_la_negacion(self):
        self.assertEqual(puntaje("no, gracias"), 0.5)

    def test_expresion_de_dos_palabras_cuenta_una_vez(self):
        self.assertEqual(analizar_frase("con gusto", LEXICO), (0.5, 1))
        self.assertEqual(analizar_frase("voy con mi gusto", LEXICO), (0.0, 0))


class PruebasFamilias(unittest.TestCase):
    def test_raices_de_las_negativas_aunque_esten_negadas(self):
        self.assertEqual(raices_negativas("Quiero cancelar, no es una queja. Gracias", LEXICO), {"cance", "queja"})

    def test_la_familia_ignorada_no_cuenta(self):
        self.assertEqual(analizar_frase("Registro su queja y su cancelación", LEXICO, {"queja", "cance"}), (0.0, 0))

    def test_las_demas_palabras_siguen_contando(self):
        self.assertEqual(analizar_frase("Su queja es pésima, nunca", LEXICO, {"queja"}), (-1.0, 2))

    def test_solo_ignora_negativas(self):
        self.assertEqual(analizar_frase("excelente", LEXICO, {"excel"}), (0.5, 1))


class PruebasInsultos(unittest.TestCase):
    def test_todo_el_vocabulario_inadecuado_resta(self):
        for palabra in LEXICO["inadecuadas"].values():
            self.assertLess(puntaje(f"usted es {palabra}"), 0, palabra)

    def test_un_insulto_no_se_niega(self):
        self.assertEqual(puntaje("no sea tonto"), -1.0)
        self.assertEqual(puntaje("no me cuelgue, malparido"), -1.0)

    def test_las_palabras_de_sentimiento_se_siguen_negando(self):
        # "fraude" esta en las dos listas: se niega como palabra de sentimiento.
        self.assertEqual(puntaje("no es un fraude"), 0.5)

    def test_formas_conjugadas_y_expresiones(self):
        self.assertEqual(puntaje("me cancelaron el servicio"), -1.0)
        self.assertEqual(analizar_frase("esto es una falta de respeto", LEXICO), (-0.5, 1))


class PruebasGraves(unittest.TestCase):
    """Decision del equipo del 11/11: cancelacion, amenazas e insultos pesan mas que la cortesia."""

    def test_cancelacion_amenaza_e_insulto_pesan_el_doble_que_la_cortesia(self):
        self.assertEqual(puntaje("voy a cancelar el contrato"), -1.0)
        self.assertEqual(puntaje("voy a poner una denuncia"), -1.0)
        self.assertEqual(puntaje("esto es una estafa"), -1.0)
        self.assertEqual(puntaje("muchas gracias"), 0.5)

    def test_una_grave_no_se_compensa_con_un_gracias(self):
        self.assertEqual(analizar_frase("gracias, pero es una estafa", LEXICO), (-0.5, 2))

    def test_negada_una_grave_vale_lo_normal(self):
        self.assertEqual(puntaje("no quiero cancelar"), 0.5)
        self.assertEqual(puntaje("no es una estafa"), 0.5)

    def test_llamada_de_la_decision_del_11_11(self):
        # Cliente molesto que amenaza con cancelar y con una queja, entre dos "gracias": antes -0,1.
        frases = ["Buenas tardes, gracias por llamar a servicio al cliente.", "Ya estoy muy molesto.",
                  "Si no lo arreglan voy a cancelar el contrato.", "Voy a poner una queja formal.",
                  "No, eso es todo por ahora. Muchas gracias."]
        self.assertEqual(puntaje_global([analizar_frase(f, LEXICO) for f in frases]), -0.2)


class PruebasCarga(unittest.TestCase):
    def test_acepta_archivo_guardado_con_bom(self):
        with open(RUTA_LEXICO, encoding="utf-8") as archivo:
            contenido = archivo.read()
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "lexico.json")
            with open(ruta, "w", encoding="utf-8-sig") as archivo:
                archivo.write(contenido)
            self.assertEqual(cargar_lexico(ruta), LEXICO)


class PruebasGlobal(unittest.TestCase):
    def test_promedia_solo_frases_con_palabras_clave(self):
        self.assertEqual(puntaje_global([(0.0, 0), (0.0, 0), (-0.5, 1), (-1.0, 2)]), -0.75)

    def test_sin_palabras_clave_es_cero(self):
        self.assertEqual(puntaje_global([(0.0, 0)]), 0.0)
        self.assertEqual(puntaje_global([]), 0.0)


if __name__ == "__main__":
    unittest.main()
