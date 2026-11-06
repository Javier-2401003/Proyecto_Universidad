"""Pruebas de los errores de lectura. Ejecutar desde audio-processing/: python -m unittest -v"""

import os
import tempfile
import unittest

from analizar import ErrorAnalisis, cargar_audio


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


if __name__ == "__main__":
    unittest.main()
