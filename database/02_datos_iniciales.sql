-- =====================================================================
-- VocalAnalytics - Datos iniciales (roles, modulos y permisos)
-- Ejecutar DESPUES de 01_esquema.sql.
--
-- Seguro de repetir: usa INSERT IGNORE sobre claves unicas, asi que no
-- duplica filas si se ejecuta otra vez.
--
-- IMPORTANTE: este script NO crea usuarios. Las contrasenas deben
-- guardarse como hash Bcrypt y eso lo hace el backend. El primer
-- SuperAdmin se crea con el script del backend (siguiente tarea).
--
-- La matriz de permisos es una PROPUESTA inicial basada en el Blueprint
-- (seccion 3.1). El SuperAdmin puede cambiarla desde el sistema; si el
-- equipo decide otra cosa, solo se edita este archivo o la tabla.
-- =====================================================================

USE db_vocalanalytics;

SET NAMES utf8mb4;

-- Roles base (Blueprint 3.1)
INSERT IGNORE INTO TB_Rol (nombre_rol, descripcion) VALUES
  ('SUPERADMIN', 'Gestion y configuracion global; lectura general de la plataforma'),
  ('SUPERVISOR', 'Supervisa en tiempo real a los agentes asignados y descarga reportes'),
  ('AGENTE',     'Consulta su propio panel, alertas y retroalimentacion');

-- Modulos del sistema
INSERT IGNORE INTO TB_Modulo (codigo_modulo, nombre_modulo, activo) VALUES
  ('GESTION_USUARIOS',  'Gestion de Usuarios y Permisos', 1),
  ('DASHBOARD_VIVO',    'Dashboard en Tiempo Real',       1),
  ('CARGA_LOTES',       'Carga de Audios por Lotes',      1),
  ('BUSQUEDA_HISTORICA','Busqueda Historica',             1),
  ('REPORTES',          'Reportes',                       1),
  ('PANEL_AGENTE',      'Panel del Agente',               1),
  ('AUDITORIA',         'Registro de Auditoria',          1);

-- Permisos: SUPERADMIN (escribe solo en usuarios; lee el resto, salvo el
-- panel personal del agente)
INSERT IGNORE INTO TB_RolModulo (id_rol, id_modulo, puede_leer, puede_escribir)
SELECT r.id_rol, m.id_modulo, 1,
       CASE WHEN m.codigo_modulo = 'GESTION_USUARIOS' THEN 1 ELSE 0 END
FROM TB_Rol r
JOIN TB_Modulo m
WHERE r.nombre_rol = 'SUPERADMIN'
  AND m.codigo_modulo IN ('GESTION_USUARIOS','DASHBOARD_VIVO','CARGA_LOTES',
                          'BUSQUEDA_HISTORICA','REPORTES','AUDITORIA');

-- Permisos: SUPERVISOR (supervisa, carga lotes de prueba, busca y descarga reportes)
INSERT IGNORE INTO TB_RolModulo (id_rol, id_modulo, puede_leer, puede_escribir)
SELECT r.id_rol, m.id_modulo, 1,
       CASE WHEN m.codigo_modulo = 'CARGA_LOTES' THEN 1 ELSE 0 END
FROM TB_Rol r
JOIN TB_Modulo m
WHERE r.nombre_rol = 'SUPERVISOR'
  AND m.codigo_modulo IN ('DASHBOARD_VIVO','CARGA_LOTES','BUSQUEDA_HISTORICA','REPORTES');

-- Permisos: AGENTE (solo su panel individual)
INSERT IGNORE INTO TB_RolModulo (id_rol, id_modulo, puede_leer, puede_escribir)
SELECT r.id_rol, m.id_modulo, 1, 0
FROM TB_Rol r
JOIN TB_Modulo m
WHERE r.nombre_rol = 'AGENTE'
  AND m.codigo_modulo = 'PANEL_AGENTE';
