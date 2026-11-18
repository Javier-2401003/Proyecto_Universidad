"""Pruebas de la diarizacion con senales armadas a mano. Ejecutar: python -m unittest -v"""

import unittest

import numpy as np

from acustico import calcular_diagnostico, cargar_reglas as cargar_reglas_acusticas, hablante_del_evento
from diarizacion import (AGENTE, CLIENTE, agrupar, asignar_hablantes, canales_distintos, cargar_reglas,
                         caracteristicas_por_segmento, completar_sin_voz, grupo_del_agente,
                         hablante_por_canal, refinar_por_cuadros, tonos_parecidos)
from lexico import analizar_frase, cargar_lexico

REGLAS = cargar_reglas()
REGLAS_ACUSTICAS = cargar_reglas_acusticas()
LEXICO = cargar_lexico()
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

    def test_pocos_segmentos_no_fallan(self):
        self.assertEqual(list(agrupar(np.zeros((1, 14)), REGLAS)), [0])
        self.assertEqual(len(agrupar(np.zeros((0, 14)), REGLAS)), 0)

    def test_turnos_alternados_no_se_suavizan(self):
        # Antes un filtro de mediana unia turnos de un solo segmento con sus vecinos.
        sem = np.random.default_rng(4)
        caracteristicas = np.array([sem.normal(3 * (i % 2), 0.1, 14) for i in range(7)])
        grupos = list(agrupar(caracteristicas, REGLAS))
        self.assertEqual(grupos, [grupos[0], 1 - grupos[0]] * 3 + [grupos[0]])

    def test_un_segmento_corto_y_raro_no_se_queda_con_un_grupo(self):
        # Dos voces parecidas (0 y 1) con segmentos largos y un segmento corto con un timbre raro (6).
        # Sin pesos, el arranque desde los puntos mas lejanos dejaba al corto solo en un grupo.
        sem = np.random.default_rng(5)
        voces = [0, 1, 0, 1, 0, 1, 0, 1]
        caracteristicas = np.array([sem.normal(v, 0.15, 14) for v in voces] + [np.full(14, 6.0)])
        pesos = [200] * len(voces) + [12]
        grupos = list(agrupar(caracteristicas, REGLAS, pesos))
        self.assertEqual(grupos[:8], [grupos[0], 1 - grupos[0]] * 4)

    def test_siempre_da_el_mismo_resultado(self):
        sem = np.random.default_rng(6)
        caracteristicas = sem.normal(0, 1, (30, 14))
        pesos = sem.integers(10, 300, 30)
        self.assertEqual(list(agrupar(caracteristicas, REGLAS, pesos)), list(agrupar(caracteristicas, REGLAS, pesos)))

    def test_refinar_corrige_un_segmento_mal_agrupado(self):
        sem = np.random.default_rng(7)
        matrices = [sem.normal(0.0 if i % 2 == 0 else 1.5, 0.5, (150, 3)) for i in range(8)]
        mal = [0, 1, 0, 1, 1, 1, 0, 1]  # el segmento 4 es de la primera voz
        self.assertEqual(list(refinar_por_cuadros(matrices, mal)), [0, 1, 0, 1, 0, 1, 0, 1])

    def test_refinar_nunca_deja_un_grupo_vacio(self):
        sem = np.random.default_rng(8)
        matrices = [sem.normal(0, 1, (100, 3)) for _ in range(4)]
        grupos = refinar_por_cuadros(matrices, [0, 0, 0, 1])
        self.assertEqual(len(set(grupos)), 2)

    def test_solo_se_refina_si_los_tonos_se_parecen(self):
        # Ultima columna: log del tono. Hombre y mujer (110 y 220 Hz) no; dos hombres (110 y 125 Hz) si.
        def caracteristicas(tono_b):
            return np.array([[0.0] * 13 + [np.log(110.0)], [0.0] * 13 + [np.log(tono_b)]])
        self.assertFalse(tonos_parecidos(caracteristicas(220.0), np.array([0, 1]), REGLAS))
        self.assertTrue(tonos_parecidos(caracteristicas(125.0), np.array([0, 1]), REGLAS))
        self.assertFalse(tonos_parecidos(caracteristicas(125.0), np.array([0, 0]), REGLAS))

    def test_segmento_sin_voz_medida_hereda_el_anterior(self):
        self.assertEqual(completar_sin_voz(3, [0, 2], [1, 0]), [1, 1, 0])

    def test_los_primeros_sin_voz_toman_el_primer_grupo_medido(self):
        self.assertEqual(completar_sin_voz(3, [2], [1]), [1, 1, 1])

    def test_ningun_segmento_medido_no_deja_grupos_vacios(self):
        self.assertEqual(completar_sin_voz(2, [], []), [0, 0])

    def test_las_pausas_no_cambian_el_timbre_del_segmento(self):
        tiempo = np.arange(FRECUENCIA * 4) / FRECUENCIA
        voz = sum(np.sin(2 * np.pi * 150 * k * tiempo) / k for k in range(1, 6)) * 0.1
        audio = np.where(tiempo < 2, voz, 0.0).astype(np.float32)
        f0 = np.where(np.arange(201) * SALTO / FRECUENCIA < 2, 150.0, np.nan)
        con_pausa, _ = caracteristicas_por_segmento([segmento(0, 4)], audio, f0, FRECUENCIA, SALTO, REGLAS)
        sin_pausa, _ = caracteristicas_por_segmento([segmento(0, 2)], audio, f0, FRECUENCIA, SALTO, REGLAS)
        np.testing.assert_allclose(con_pausa, sin_pausa, atol=1e-6)


class PruebasRoles(unittest.TestCase):
    def test_frases_de_agente_deciden_el_grupo(self):
        segmentos = [segmento(0, 1, "Hola, llevo tres días sin internet"),
                     segmento(1, 2, "Gracias por llamar, ¿en qué le puedo ayudar?")]
        self.assertEqual(grupo_del_agente(segmentos, [0, 1], REGLAS), 1)

    def test_sin_frases_gana_quien_habla_primero(self):
        segmentos = [segmento(0, 1, "buenas"), segmento(1, 2, "hola")]
        self.assertEqual(grupo_del_agente(segmentos, [1, 0], REGLAS), 1)

    def test_sin_apertura_deciden_las_pistas_de_toda_la_llamada(self):
        # Whisper no transcribio el "Diga" del agente: el primero que habla es el cliente.
        segmentos = [segmento(0, 3, "Llamo porque mi póliza vino con un cargo que no reconozco."),
                     segmento(3, 6, "Su póliza tiene un cargo de mantenimiento, señora."),
                     segmento(6, 9, "Quiero que me lo quiten."),
                     segmento(9, 12, "Permítame, le confirmo en un momento.")]
        self.assertEqual(grupo_del_agente(segmentos, [1, 0, 1, 0], REGLAS), 0)

    def test_las_pistas_cuentan_como_palabras_completas(self):
        # "consulta" lleva "su" adentro y "camisa" lleva "mi": no son pistas.
        segmentos = [segmento(0, 1, "una consulta"), segmento(1, 2, "la camisa")]
        self.assertEqual(grupo_del_agente(segmentos, [1, 0], REGLAS), 1)

    def test_mi_nombre_es_cuenta_para_el_agente(self):
        segmentos = [segmento(0, 1, "buenas"), segmento(1, 2, "mi nombre es Carla")]
        self.assertEqual(grupo_del_agente(segmentos, [1, 0], REGLAS), 0)


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

    def test_dos_voces_del_mismo_genero_con_turnos_cortos(self):
        # Tonos de 118 y 132 Hz (mismo genero) y timbres distintos; turnos de 3 s y uno de 0,5 s.
        turnos = [(0, 3), (3, 6), (6, 9), (9, 9.5), (9.5, 12.5), (12.5, 15.5)]
        voces = [0, 1, 0, 1, 1, 0]
        tiempo = np.arange(int(FRECUENCIA * 15.5)) / FRECUENCIA
        cuadros = np.arange(int(15.5 * FRECUENCIA / SALTO) + 1) * SALTO / FRECUENCIA
        audio = np.zeros_like(tiempo)
        f0 = np.full(len(cuadros), np.nan)
        for (inicio, fin), voz in zip(turnos, voces):
            tono, armonicos = (118.0, [1, 0.6, 0.4, 0.2]) if voz == 0 else (132.0, [0.3, 0.5, 1, 0.8, 0.6])
            tramo = (tiempo >= inicio) & (tiempo < fin)
            audio[tramo] = sum(a * np.sin(2 * np.pi * tono * (k + 1) * tiempo[tramo]) for k, a in enumerate(armonicos))
            f0[(cuadros >= inicio) & (cuadros < fin)] = tono
        textos = ["gracias por llamar, en qué le puedo ayudar", "quiero cancelar", "con gusto", "sí", "necesito",
                  "permítame"]
        hablantes = asignar_hablantes([segmento(i, f, t) for (i, f), t in zip(turnos, textos)],
                                      (audio * 0.1).astype(np.float32), f0, FRECUENCIA, SALTO, REGLAS)
        self.assertEqual(hablantes, [AGENTE if v == 0 else CLIENTE for v in voces])


class PruebasDiagnostico(unittest.TestCase):
    def diagnostico(self, clasificacion, frases, eventos=(), baja_confianza=False):
        segmentos = [{"hablante": AGENTE, "inicio": 0, "fin": 5, "texto": ""},
                     {"hablante": CLIENTE, "inicio": 5, "fin": 10, "texto": ""}]
        return calcular_diagnostico(clasificacion, segmentos, frases, list(eventos), baja_confianza, REGLAS_ACUSTICAS)

    def diagnostico_de_turnos(self, *turnos):
        """Llamada NEGATIVO sin gritos, con un turno de 5 s por cada (hablante, texto)."""
        segmentos = [{"hablante": h, "inicio": 5 * i, "fin": 5 * i + 5, "texto": t} for i, (h, t) in enumerate(turnos)]
        frases = [analizar_frase(t, LEXICO) for _, t in turnos]
        return calcular_diagnostico("NEGATIVO", segmentos, frases, [], False, REGLAS_ACUSTICAS, LEXICO)

    def test_agente_que_repite_la_queja_del_cliente_no_es_su_falla(self):
        self.assertEqual(self.diagnostico_de_turnos(
            (CLIENTE, "Quiero cancelar el servicio y poner una queja."),
            (AGENTE, "Dejo registrada su queja y su solicitud de cancelación.")), "CLIENTE_PROBLEMATICO")

    def test_agente_que_dice_queja_antes_que_el_cliente_si_es_su_falla(self):
        self.assertEqual(self.diagnostico_de_turnos(
            (AGENTE, "Su queja no me importa, nunca hacemos devoluciones."),
            (CLIENTE, "Entonces voy a poner una queja.")), "FALLA_AGENTE")

    def test_palabras_negativas_nuevas_del_agente_siguen_contando(self):
        self.assertEqual(self.diagnostico_de_turnos(
            (CLIENTE, "Quiero poner una queja."),
            (AGENTE, "Su queja es una pésima idea, nunca devolvemos nada.")), "FALLA_AGENTE")

    def test_el_agente_que_nombra_la_queja_del_cliente_no_es_su_falla(self):
        # Prueba de Willy del 14/11: el cliente nunca dijo "queja", pero el agente la registra.
        self.assertEqual(self.diagnostico_de_turnos(
            (CLIENTE, "Esto es una estafa, son unos ladrones."),
            (AGENTE, "Voy a registrar su queja.")), "CLIENTE_PROBLEMATICO")

    def test_su_solicitud_de_cancelacion_tampoco_es_falla_del_agente(self):
        self.assertEqual(self.diagnostico_de_turnos(
            (CLIENTE, "El servicio es pésimo."),
            (AGENTE, "Dejo registrada su solicitud de cancelación.")), "CLIENTE_PROBLEMATICO")

    def test_un_insulto_despues_de_sus_sigue_siendo_falla_del_agente(self):
        self.assertEqual(self.diagnostico_de_turnos(
            (CLIENTE, "Buenas tardes, tengo un problema."),
            (AGENTE, "Usted y sus tontos reclamos.")), "FALLA_AGENTE")

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
