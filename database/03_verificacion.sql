-- =====================================================================
-- VocalAnalytics - Verificacion del esquema (solo lectura, no modifica nada)
-- Ejecutar en phpMyAdmin (pestana SQL) despues de 01 y 02.
-- =====================================================================

USE db_vocalanalytics;

-- 1) Deben aparecer 12 tablas, todas InnoDB y con prefijo TB_.
SELECT table_name AS tabla, engine AS motor
FROM information_schema.tables
WHERE table_schema = 'db_vocalanalytics'
ORDER BY table_name;

-- 2) Deben aparecer 13 claves foraneas (integridad referencial real).
SELECT constraint_name AS clave_foranea,
       table_name AS tabla,
       referenced_table_name AS referencia,
       delete_rule AS al_borrar
FROM information_schema.referential_constraints
WHERE constraint_schema = 'db_vocalanalytics'
ORDER BY table_name, constraint_name;

-- 3) Deben aparecer las restricciones CHECK (MySQL 8.0.16 o superior las aplica).
SELECT tc.table_name AS tabla, tc.constraint_name AS restriccion
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'db_vocalanalytics'
  AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, tc.constraint_name;

-- 4) Matriz de permisos cargada: 3 roles, 7 modulos, 11 permisos
--    (6 de SUPERADMIN + 4 de SUPERVISOR + 1 de AGENTE).
SELECT r.nombre_rol AS rol, m.codigo_modulo AS modulo,
       rm.puede_leer AS leer, rm.puede_escribir AS escribir
FROM TB_RolModulo rm
JOIN TB_Rol r    ON r.id_rol = rm.id_rol
JOIN TB_Modulo m ON m.id_modulo = rm.id_modulo
ORDER BY r.nombre_rol, m.codigo_modulo;

-- 5) Version del servidor: debe decir 8.x y NO "MariaDB".
SELECT VERSION() AS version_servidor;
