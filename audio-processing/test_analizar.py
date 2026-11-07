"""Pruebas de los errores de lectura y de la salida JSON. Ejecutar desde audio-processing/: python -m unittest -v"""

import contextlib
import io
import os
import tempfile
import unittest

from analizar import ErrorAnalisis, cargar_audio, escribir_json


class PruebasCargaDeAudio(unittest.TestCase):
    def codigo_de_error(self, ruta):
        with self.assertRaises(ErrorAnalisis) as contexto:
            cargar_audio(ruta)
        return contexto.exception.codigo

    def test_archivo_de_0_bytes_es_audio_vacio(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "vacio.wav")
            open(ruta, "wb").close()
            self.assertEqual(self.codigo_de_error(ruta), "AUDIO_VACIO")

    def test_archivo_inexistente(self):
        self.assertEqual(self.codigo_de_error("no_existe.wav"), "ARCHIVO_NO_ENCONTRADO")

    def test_archivo_que_no_es_audio_es_ilegible(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "texto.wav")
            with open(ruta, "w", encoding="utf-8") as archivo:
                archivo.write("esto no es audio")
            self.assertEqual(self.codigo_de_error(ruta), "AUDIO_ILEGIBLE")


class PruebasSalidaJson(unittest.TestCase):
    def test_nan_falla_antes_de_escribir(self):
        salida = io.StringIO()
        with contextlib.redirect_stdout(salida), self.assertRaises(ValueError):
            escribir_json({"score_acustico": float("nan")})
        self.assertEqual(salida.getvalue(), "")

    def test_salida_normal_es_una_linea_en_utf8(self):
        salida = io.StringIO()
        with contextlib.redirect_stdout(salida):
            escribir_json({"texto": "¿En qué le ayudo?"})
        self.assertEqual(salida.getvalue(), '{"texto": "¿En qué le ayudo?"}\n')


if __name__ == "__main__":
    unittest.main()
