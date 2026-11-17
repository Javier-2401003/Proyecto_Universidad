"""Pruebas del guion obligatorio (contrato v0.6). Ejecutar desde audio-processing/: python -m unittest -v"""

import json
import os
import tempfile
import unittest

from alertas import cargar_reglas as cargar_reglas_alertas, generar_alertas
from acustico import cargar_reglas as cargar_reglas_acusticas
from guion import CUMPLE, NO_CUMPLE, PENDIENTE, RUTA_GUION, cargar_guion, evaluar_guion
from lexico import cargar_lexico

GUION = cargar_guion()


def segmento(inicio, fin, hablante, texto):
    return {"inicio": inicio, "fin": fin, "hablante": hablante, "texto": texto}


def llamada_completa():
    return [
        segmento(0, 6, "AGENTE", "Banco Central, buenos días, le atiende Marcos. ¿En qué le puedo ayudar?"),
        segmento(6, 14, "CLIENTE", "Mi tarjeta fue rechazada en el supermercado."),
        segmento(14, 24, "AGENTE", "Ya la desbloqueé, puede usarla de inmediato."),
        segmento(24, 28, "CLIENTE", "Muchas gracias."),
        segmento(28, 33, "AGENTE", "Gracias a usted por llamar. Que tenga un excelente día."),
    ]


class PruebasGuion(unittest.TestCase):
    def test_los_cuatro_pasos_cumple(self):
        self.assertEqual(evaluar_guion(llamada_completa(), False, GUION), (CUMPLE, []))

    def test_tolera_errores_chicos_de_whisper(self):
        segmentos = llamada_completa()
        segmentos[0]["texto"] = "Banco central, buenas tarde, le atiendo Marcos, en que le puedo ayuda"
        segmentos[4]["texto"] = "Gracias a usted por yamar, que tenga un exelente dia"
        self.assertEqual(evaluar_guion(segmentos, False, GUION)[0], CUMPLE)

    def test_sin_cierre_no_cumple_y_la_alerta_va_al_ultimo_segmento_del_agente(self):
        segmentos = llamada_completa()
        segmentos[4]["texto"] = "Le envío el número del caso por mensaje."
        self.assertEqual(evaluar_guion(segmentos, False, GUION), (NO_CUMPLE, [("cierre", 28.0)]))

    def test_agente_grosero_sin_apertura(self):
        segmentos = llamada_completa()
        segmentos[0]["texto"] = "Tienda Moda Plus."
        estado, faltan = evaluar_guion(segmentos, False, GUION)
        self.assertEqual(estado, NO_CUMPLE)
        self.assertEqual(faltan, [("saludo", 0.0), ("identificación", 0.0), ("ofrecer ayuda", 0.0)])

    def test_las_frases_del_cliente_no_cuentan(self):
        segmentos = llamada_completa()
        segmentos[0]["texto"] = "Banco Central."
        segmentos[1]["texto"] = "Buenos días, le atiende el cliente, en qué le puedo ayudar."
        self.assertIn(("saludo", 0.0), evaluar_guion(segmentos, False, GUION)[1])

    def test_saludar_despues_de_20_s_no_cuenta_como_saludo(self):
        segmentos = llamada_completa()
        segmentos[0]["texto"] = "Banco Central, le atiende Marcos. ¿En qué le puedo ayudar?"
        segmentos[2].update(inicio=21, fin=24, texto="Buenas tardes, ya la desbloqueé.")
        self.assertEqual(evaluar_guion(segmentos, False, GUION)[1], [("saludo", 0.0)])

    def test_con_baja_confianza_queda_pendiente(self):
        self.assertEqual(evaluar_guion(llamada_completa(), True, GUION), (PENDIENTE, []))

    def test_si_el_agente_casi_no_hablo_queda_pendiente(self):
        segmentos = [segmento(0, 3, "AGENTE", "Diga."), segmento(3, 30, "CLIENTE", "Quiero hacer un reclamo.")]
        self.assertEqual(evaluar_guion(segmentos, False, GUION), (PENDIENTE, []))

    def test_sin_agente_o_sin_segmentos_queda_pendiente(self):
        self.assertEqual(evaluar_guion([segmento(0, 30, "CLIENTE", "Hola")], False, GUION), (PENDIENTE, []))
        self.assertEqual(evaluar_guion([], False, GUION), (PENDIENTE, []))


class PruebasAlertasGuion(unittest.TestCase):
    def test_una_omision_script_por_paso_que_falta(self):
        segmentos = llamada_completa()
        faltan = [("saludo", 0.0), ("cierre", 28.0)]
        alertas = generar_alertas(segmentos, [], [], [], [0.0, 0.02], 0.02, True, cargar_lexico(),
                                  cargar_reglas_acusticas(), cargar_reglas_alertas(), faltan)
        omisiones = [a for a in alertas if a["tipo_alerta"] == "OMISION_SCRIPT"]
        self.assertEqual([(a["origen_evento"], a["timestamp_evento"], a["valor_registrado"]) for a in omisiones],
                         [("AGENTE", 0.0, "Falta: saludo"), ("AGENTE", 28.0, "Falta: cierre")])
        self.assertTrue(all(a["mensaje_sugerencia"] for a in omisiones))


class PruebasCargaGuion(unittest.TestCase):
    def test_acepta_archivo_con_bom(self):
        with open(RUTA_GUION, encoding="utf-8") as archivo:
            contenido = archivo.read()
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "guion.json")
            with open(ruta, "w", encoding="utf-8-sig") as archivo:
                archivo.write(contenido)
            self.assertEqual(cargar_guion(ruta), GUION)

    def test_una_ventana_desconocida_falla_al_cargar(self):
        datos = json.loads(open(RUTA_GUION, encoding="utf-8").read())
        datos["pasos"][0]["ventana"] = "medio"
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "guion.json")
            with open(ruta, "w", encoding="utf-8") as archivo:
                json.dump(datos, archivo)
            with self.assertRaises(ValueError):
                cargar_guion(ruta)


if __name__ == "__main__":
    unittest.main()
