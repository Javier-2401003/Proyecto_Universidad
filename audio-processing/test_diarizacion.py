"""Pruebas de la diarizacion con senales armadas a mano. Ejecutar: python -m unittest -v"""

import unittest

import numpy as np

from acustico import calcular_diagnostico, cargar_reglas as cargar_reglas_acusticas, hablante_del_evento
from diarizacion import (AGENTE, CLIENTE, agrupar, asignar_hablantes, canales_distintos,
                         cargar_reglas, grupo_del_agente, grupo_por_segmento, hablante_por_canal)

REGLAS = cargar_reglas()
REGLAS_ACUSTICAS = cargar_reglas_acusticas()
FRECUENCIA = 16000
SALTO = 320


def segmento(inicio, fin, texto="hola"):
    return {"inicio": inicio, "fin": fin, "texto": texto}


class PruebasCanales(unittest.TestCase):
    def test_canales_iguales_no_separan(self):
        ruido = np.random.default_rng(1).normal(size=FRECUENCIA)
        self.assertFalse(canales_distintos(ruido, ruido.copy(), REGLAS))

    def test_canales_distintos_si_separan(self):
        sem = np.random.default_rng(2)
        self.assertTrue(canales_distintos(sem.normal(size=FRECUENCIA), sem.normal(size=FRECUENCIA), REGLAS))

    def test_canal_silencioso_no_falla(self):
        self.assertFalse(canales_distintos(np.zeros(FRECUENCIA), np.ones(FRECUENCIA), REGLAS))

    def test_izquierdo_es_agente_y_derecho_es_cliente(self):
        izquierdo = np.concatenate([np.ones(FRECUENCIA), np.zeros(FRECUENCIA)])
        derecho = izquierdo[::-1]
        hablantes = hablante_por_canal(izquierdo, derecho, FRECUENCIA, [segmento(0, 1), segmento(1, 2)])
        self.assertEqual(hablantes, [AGENTE, CLIENTE])


class PruebasAgrupacion(unittest.TestCase):
    def test_separa_dos_tonos_distintos(self):
        sem = np.random.default_rng(3)
        caracteristicas = np.vstack([sem.normal(0, 0.1, (20, 14)), sem.normal(3, 0.1, (20, 14))])
        grupos = agrupar(caracteristicas, REGLAS)
        self.assertEqual(len(set(grupos[:20])), 1)
        self.assertEqual(len(set(grupos[20:])), 1)
        self.assertNotEqual(grupos[0], grupos[20])

    def test_pocas_ventanas_no_fallan(self):
        self.assertEqual(list(agrupar(np.zeros((1, 14)), REGLAS)), [0])
        self.assertEqual(len(agrupar(np.zeros((0, 14)), REGLAS)), 0)

    def test_segmento_toma_el_grupo_con_mas_tiempo(self):
        tiempos = [(0, 1), (1, 2), (2, 3), (3, 4)]
        self.assertEqual(grupo_por_segmento([segmento(0, 3)], tiempos, [0, 0, 1, 1]), [0])

    def test_segmento_sin_voz_medida_hereda_el_anterior(self):
        asignados = grupo_por_segmento([segmento(0, 1), segmento(5, 6)], [(0, 1)], [1])
        self.assertEqual(asignados, [1, 1])

    def test_ningun_segmento_medido_no_deja_grupos_vacios(self):
        self.assertEqual(grupo_por_segmento([segmento(5, 6)], [], []), [0])


class PruebasRoles(unittest.TestCase):
    def test_frases_de_agente_deciden_el_grupo(self):
        segmentos = [segmento(0, 1, "Hola, llevo tres días sin internet"),
                     segmento(1, 2, "Gracias por llamar, ¿en qué le puedo ayudar?")]
        self.assertEqual(grupo_del_agente(segmentos, [0, 1], REGLAS), 1)

    def test_sin_frases_gana_quien_habla_primero(self):
        segmentos = [segmento(0, 1, "buenas"), segmento(1, 2, "hola")]
        self.assertEqual(grupo_del_agente(segmentos, [1, 0], REGLAS), 1)


class PruebasAsignacion(unittest.TestCase):
    def test_sin_segmentos_no_hay_hablantes(self):
        self.assertEqual(asignar_hablantes([], np.zeros(FRECUENCIA), np.full(50, np.nan), FRECUENCIA, SALTO, REGLAS), [])

    def test_audio_sin_tono_siempre_da_un_hablante_valido(self):
        hablantes = asignar_hablantes([segmento(0, 1), segmento(1, 2)], np.zeros(FRECUENCIA * 2),
                                      np.full(100, np.nan), FRECUENCIA, SALTO, REGLAS)
        self.assertEqual(len(hablantes), 2)
        self.assertTrue(set(hablantes) <= {AGENTE, CLIENTE})

    def test_dos_voces_sinteticas_se_separan(self):
        tiempo = np.arange(FRECUENCIA * 8) / FRECUENCIA
        grave = sum(np.sin(2 * np.pi * 110 * k * tiempo) / k for k in range(1, 6))
        aguda = sum(np.sin(2 * np.pi * 240 * k * tiempo) / k for k in range(1, 4))
        audio = (np.where(tiempo < 4, grave, aguda) * 0.1).astype(np.float32)
        f0 = np.where(np.arange(401) * SALTO / FRECUENCIA < 4, 110.0, 240.0)
        hablantes = asignar_hablantes([segmento(0, 4, "gracias por llamar"), segmento(4, 8, "quiero cancelar")],
                                      audio, f0, FRECUENCIA, SALTO, REGLAS)
        self.assertEqual(hablantes, [AGENTE, CLIENTE])


class PruebasDiagnostico(unittest.TestCase):
    def diagnostico(self, clasificacion, frases, eventos=(), baja_confianza=False):
        segmentos = [{"hablante": AGENTE, "inicio": 0, "fin": 5}, {"hablante": CLIENTE, "inicio": 5, "fin": 10}]
        return calcular_diagnostico(clasificacion, segmentos, frases, list(eventos), baja_confianza, REGLAS_ACUSTICAS)

    def test_llamada_buena_no_tiene_conflicto(self):
        self.assertEqual(self.diagnostico("NEUTRO", [(-1.0, 2), (-1.0, 2)]), "SIN_CONFLICTO")

    def test_texto_negativo_del_agente_es_su_falla(self):
        self.assertEqual(self.diagnostico("NEGATIVO", [(-0.5, 1), (0.0, 0)]), "FALLA_AGENTE")

    def test_solo_el_cliente_negativo_es_cliente_problematico(self):
        self.assertEqual(self.diagnostico("NEGATIVO", [(0.5, 1), (-1.0, 2)]), "CLIENTE_PROBLEMATICO")

    def test_grito_se_atribuye_a_quien_hablaba(self):
        grito = {"tipo": "EXCESO_VOLUMEN", "inicio": 6, "fin": 8}
        self.assertEqual(self.diagnostico("CRITICO", [(0.0, 0), (0.0, 0)], [grito]), "CLIENTE_PROBLEMATICO")

    def test_grito_que_roza_el_final_del_agente_es_del_cliente(self):
        # Llamada 07 de las muestras: el evento empieza 0.5 s antes de que acabe el turno del agente.
        grito = {"tipo": "EXCESO_VOLUMEN", "inicio": 4.5, "fin": 8}
        self.assertEqual(self.diagnostico("CRITICO", [(0.0, 0), (-0.5, 1)], [grito]), "CLIENTE_PROBLEMATICO")

    def test_grito_del_agente_que_se_pasa_al_cliente_es_del_agente(self):
        grito = {"tipo": "EXCESO_VOLUMEN", "inicio": 2, "fin": 5.5}
        self.assertEqual(self.diagnostico("CRITICO", [(0.0, 0), (-0.5, 1)], [grito]), "FALLA_AGENTE")

    def test_grito_fuera_de_los_segmentos_no_es_de_nadie(self):
        grito = {"tipo": "EXCESO_VOLUMEN", "inicio": 11, "fin": 12}
        self.assertEqual(self.diagnostico("NEGATIVO", [(0.0, 0), (0.0, 0)], [grito]), "SIN_CONFLICTO")

    def test_el_evento_suma_todos_los_turnos_de_cada_hablante(self):
        segmentos = [{"hablante": AGENTE, "inicio": 0, "fin": 1}, {"hablante": CLIENTE, "inicio": 1, "fin": 2},
                     {"hablante": AGENTE, "inicio": 2, "fin": 3}]
        # Agente: 0.5 + 0.8 s; cliente: 1 s.
        self.assertEqual(hablante_del_evento({"inicio": 0.5, "fin": 2.8}, segmentos), AGENTE)

    def test_baja_confianza_ignora_la_voz(self):
        grito = {"tipo": "EXCESO_VOLUMEN", "inicio": 1, "fin": 3}
        self.assertEqual(self.diagnostico("NEGATIVO", [(0.0, 0), (-0.5, 1)], [grito], True), "CLIENTE_PROBLEMATICO")

    def test_negativa_sin_responsable_claro(self):
        self.assertEqual(self.diagnostico("NEGATIVO", [(0.0, 0), (0.0, 0)]), "SIN_CONFLICTO")


if __name__ == "__main__":
    unittest.main()
