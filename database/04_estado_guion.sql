-- =====================================================================
-- VocalAnalytics - Script 04: estado del guion obligatorio de cada llamada
--
-- Contrato de audio v0.6 (docs/contrato_audio.md, "Guion obligatorio";
-- decision 6 del 14/11 en docs/avance.md). analizar.py devuelve si el agente
-- dijo los cuatro pasos del guion. Es solo informativo: no cambia el
-- puntaje, la clasificacion ni el diagnostico.
--
--   CUMPLE     dijo los cuatro pasos
--   NO_CUMPLE  falto alguno (cada paso que falta es una alerta OMISION_SCRIPT)
--   PENDIENTE  no era confiable evaluarlo (baja confianza o el agente casi no hablo)
--   NULL       no evaluado: la llamada se analizo antes de la v0.6 o aun no se analiza
--
-- Seguro de ejecutar mas de una vez: si la columna ya existe, no hace nada.
-- MySQL 8 no tiene "ADD COLUMN IF NOT EXISTS", por eso se consulta
-- information_schema y se arma la sentencia solo si hace falta.
--
-- Como ejecutarlo: en phpMyAdmin, pestana SQL, pegar y ejecutar. Despues,
-- para que las llamadas ya analizadas tengan su estado, desde backend/:
--   npm run reprocesar -- --antes-de 0.6 --confirmar
-- =====================================================================

USE db_vocalanalytics;

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'TB_Llamada'
     AND COLUMN_NAME = 'estado_guion'
);

SET @sentencia := IF(
  @existe = 0,
  'ALTER TABLE TB_Llamada
     ADD COLUMN estado_guion ENUM(''CUMPLE'',''NO_CUMPLE'',''PENDIENTE'') NULL DEFAULT NULL
     COMMENT ''Guion obligatorio (contrato v0.6). NULL = no evaluado''
     AFTER diagnostico_conflicto',
  'SELECT ''La columna TB_Llamada.estado_guion ya existe: no se hizo ningun cambio.'' AS aviso'
);

PREPARE paso FROM @sentencia;
EXECUTE paso;
DEALLOCATE PREPARE paso;
