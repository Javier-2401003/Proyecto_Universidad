-- =====================================================================
-- VocalAnalytics - Sistema de Evaluacion de Sentimientos en Llamadas
-- Esquema de base de datos para MySQL 8.0 (Wamp + phpMyAdmin)
--
-- Convenciones del proyecto:
--   * Tablas en singular con prefijo TB_ (ej. TB_Usuario).
--   * Columnas en snake_case, tomadas del Diccionario de Datos del Blueprint.
--   * La clave foranea se llama igual que la clave primaria que referencia.
--   * Motor InnoDB (obligatorio para claves foraneas y CHECK).
--
-- Este script es seguro de ejecutar mas de una vez: usa IF NOT EXISTS y
-- NO borra datos. Para reiniciar la base en desarrollo, vea docs/modelo_datos.md.
--
-- Nota tecnica (MySQL 8): una columna que participa en una clave foranea
-- con accion referencial (CASCADE / SET NULL) no puede usarse dentro de un
-- CHECK. Por eso TB_AsignacionSupervisor usa solo RESTRICT.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS db_vocalanalytics
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE db_vocalanalytics;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. TB_Usuario : identidad de quien entra al sistema (Modulo 1, RBAC)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Usuario (
  id_usuario        BIGINT        NOT NULL AUTO_INCREMENT,
  nombre_completo   VARCHAR(100)  NOT NULL,
  correo_electronico VARCHAR(150) NOT NULL,
  password_hash     VARCHAR(255)  NOT NULL COMMENT 'Hash Bcrypt (costo 12). Nunca la contrasena en claro.',
  estado            ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  fecha_creacion    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_usuario_correo (correo_electronico)
) ENGINE=InnoDB COMMENT='Usuarios del sistema (SuperAdmin, Supervisor, Agente)';

-- ---------------------------------------------------------------------
-- 2. TB_Rol : roles configurables (el SuperAdmin puede crear nuevos)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Rol (
  id_rol       INT          NOT NULL AUTO_INCREMENT,
  nombre_rol   VARCHAR(50)  NOT NULL,
  descripcion  VARCHAR(255) NULL,
  PRIMARY KEY (id_rol),
  UNIQUE KEY uq_rol_nombre (nombre_rol)
) ENGINE=InnoDB COMMENT='Roles de usuario';

-- ---------------------------------------------------------------------
-- 3. TB_UsuarioRol : un usuario puede tener varios roles (N a M)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_UsuarioRol (
  id_usuario  BIGINT NOT NULL,
  id_rol      INT    NOT NULL,
  PRIMARY KEY (id_usuario, id_rol),
  KEY ix_usuariorol_rol (id_rol),
  CONSTRAINT fk_usuariorol_usuario FOREIGN KEY (id_usuario)
    REFERENCES TB_Usuario (id_usuario) ON DELETE CASCADE,
  CONSTRAINT fk_usuariorol_rol FOREIGN KEY (id_rol)
    REFERENCES TB_Rol (id_rol) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='Asignacion de roles a usuarios';

-- ---------------------------------------------------------------------
-- 4. TB_Modulo : modulos/menus del sistema que se pueden activar o
--    desactivar (Blueprint 3.1: el SuperAdmin activa o desactiva menus
--    y modulos dinamicamente).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Modulo (
  id_modulo      INT          NOT NULL AUTO_INCREMENT,
  codigo_modulo  VARCHAR(50)  NOT NULL COMMENT 'Codigo estable que usa el codigo fuente',
  nombre_modulo  VARCHAR(100) NOT NULL COMMENT 'Texto que ve el usuario',
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id_modulo),
  UNIQUE KEY uq_modulo_codigo (codigo_modulo)
) ENGINE=InnoDB COMMENT='Modulos del sistema';

-- ---------------------------------------------------------------------
-- 5. TB_RolModulo : matriz de permisos (Historia 2 / CU-02: el SuperAdmin
--    marca checkboxes por modulo, por ejemplo "solo lectura en Reportes").
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_RolModulo (
  id_rol           INT        NOT NULL,
  id_modulo        INT        NOT NULL,
  puede_leer       TINYINT(1) NOT NULL DEFAULT 1,
  puede_escribir   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id_rol, id_modulo),
  KEY ix_rolmodulo_modulo (id_modulo),
  CONSTRAINT fk_rolmodulo_rol FOREIGN KEY (id_rol)
    REFERENCES TB_Rol (id_rol) ON DELETE CASCADE,
  CONSTRAINT fk_rolmodulo_modulo FOREIGN KEY (id_modulo)
    REFERENCES TB_Modulo (id_modulo) ON DELETE CASCADE,
  CONSTRAINT ck_rolmodulo_escritura CHECK (puede_escribir = 0 OR puede_leer = 1)
) ENGINE=InnoDB COMMENT='Permisos de cada rol sobre cada modulo';

-- ---------------------------------------------------------------------
-- 6. TB_AsignacionSupervisor : que agentes supervisa cada supervisor
--    (RN-08: tabla asociativa, reasignable sin tocar el codigo).
--    El backend debe validar que id_supervisor tenga rol SUPERVISOR y
--    id_agente tenga rol AGENTE (una clave foranea sola no puede).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_AsignacionSupervisor (
  id_asignacion     BIGINT   NOT NULL AUTO_INCREMENT,
  id_supervisor     BIGINT   NOT NULL,
  id_agente         BIGINT   NOT NULL,
  fecha_asignacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_asignacion),
  UNIQUE KEY uq_asignacion_par (id_supervisor, id_agente),
  KEY ix_asignacion_agente (id_agente),
  CONSTRAINT fk_asignacion_supervisor FOREIGN KEY (id_supervisor)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT fk_asignacion_agente FOREIGN KEY (id_agente)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT ck_asignacion_distintos CHECK (id_supervisor <> id_agente)
) ENGINE=InnoDB COMMENT='Equipos: supervisor y agentes a su cargo';

-- ---------------------------------------------------------------------
-- 7. TB_LoteAudio : carga por lotes de 5, 10 o 15 audios (Blueprint 3.2.1).
--    El tamano maximo del lote es configuracion del backend (.env),
--    no una regla fija de la base de datos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_LoteAudio (
  id_lote           BIGINT      NOT NULL AUTO_INCREMENT,
  codigo_lote       VARCHAR(30) NOT NULL COMMENT 'Ej. LOTE-2026-0814-01',
  id_usuario_carga  BIGINT      NOT NULL COMMENT 'Quien subio el lote',
  total_archivos    INT         NOT NULL,
  estado_lote       ENUM('PROCESANDO','COMPLETADO','CON_ERRORES') NOT NULL DEFAULT 'PROCESANDO',
  fecha_creacion    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_lote),
  UNIQUE KEY uq_lote_codigo (codigo_lote),
  KEY ix_lote_usuario (id_usuario_carga),
  CONSTRAINT fk_lote_usuario FOREIGN KEY (id_usuario_carga)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT ck_lote_total CHECK (total_archivos > 0)
) ENGINE=InnoDB COMMENT='Lotes de audios cargados para procesamiento';

-- ---------------------------------------------------------------------
-- 8. TB_Llamada : una llamada = un archivo de audio analizado
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Llamada (
  id_llamada             BIGINT        NOT NULL AUTO_INCREMENT,
  id_agente              BIGINT        NOT NULL,
  id_lote                BIGINT        NULL COMMENT 'Nulo si se cargo un audio suelto',
  id_cliente             VARCHAR(100)  NULL COMMENT 'Identificador o telefono del cliente',
  nombre_archivo_original VARCHAR(255) NULL,
  hash_archivo           CHAR(64)      NULL COMMENT 'SHA-256 del archivo, para detectar duplicados',
  fecha_inicio           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_fin              DATETIME      NULL,
  duracion_segundos      INT           NOT NULL DEFAULT 0,
  ruta_audio_storage     VARCHAR(255)  NULL COMMENT 'Ruta del archivo en disco local',
  estado_procesamiento   ENUM('PENDIENTE','PROCESANDO','COMPLETADO','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  mensaje_error          VARCHAR(255)  NULL,
  baja_confianza_audio   TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Flujo E1: ruido extremo, se prioriza el texto',
  score_global_nlp       DECIMAL(4,3)  NOT NULL DEFAULT 0.000 COMMENT 'Analisis lexico, de -1.000 a +1.000',
  score_acustico         DECIMAL(4,3)  NOT NULL DEFAULT 0.000 COMMENT 'Analisis acustico, de -1.000 a +1.000',
  puntaje_final          DECIMAL(5,2)  NOT NULL DEFAULT 0.00  COMMENT 'Odometro, de 0.00 a 100.00',
  clasificacion_final    ENUM('POSITIVO','NEUTRO','NEGATIVO','CRITICO') NOT NULL DEFAULT 'NEUTRO',
  diagnostico_conflicto  ENUM('FALLA_AGENTE','CLIENTE_PROBLEMATICO','SIN_CONFLICTO') NOT NULL DEFAULT 'SIN_CONFLICTO',
  PRIMARY KEY (id_llamada),
  KEY ix_llamada_agente_fecha (id_agente, fecha_inicio),
  KEY ix_llamada_lote (id_lote),
  KEY ix_llamada_clasificacion (clasificacion_final),
  KEY ix_llamada_estado (estado_procesamiento),
  KEY ix_llamada_hash (hash_archivo),
  CONSTRAINT fk_llamada_agente FOREIGN KEY (id_agente)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT fk_llamada_lote FOREIGN KEY (id_lote)
    REFERENCES TB_LoteAudio (id_lote) ON DELETE RESTRICT,
  CONSTRAINT ck_llamada_duracion CHECK (duracion_segundos >= 0),
  CONSTRAINT ck_llamada_fechas   CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT ck_llamada_nlp      CHECK (score_global_nlp BETWEEN -1.000 AND 1.000),
  CONSTRAINT ck_llamada_acustico CHECK (score_acustico BETWEEN -1.000 AND 1.000),
  CONSTRAINT ck_llamada_puntaje  CHECK (puntaje_final BETWEEN 0.00 AND 100.00)
) ENGINE=InnoDB COMMENT='Llamadas (archivos de audio) y su resultado consolidado';

-- ---------------------------------------------------------------------
-- 9. TB_Transcripcion : texto por hablante con marcas de tiempo
--    (alimenta el reproductor sincronizado y el mapa de sentimiento).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Transcripcion (
  id_transcripcion  BIGINT        NOT NULL AUTO_INCREMENT,
  id_llamada        BIGINT        NOT NULL,
  hablante          ENUM('AGENTE','CLIENTE') NOT NULL COMMENT 'Resultado de la diarizacion',
  texto_transcrito  TEXT          NOT NULL COMMENT 'Salida de Whisper',
  timestamp_inicio  DECIMAL(8,3)  NOT NULL COMMENT 'Segundo de inicio del fragmento',
  timestamp_fin     DECIMAL(8,3)  NOT NULL COMMENT 'Segundo de fin del fragmento',
  score_sentimiento DECIMAL(4,3)  NOT NULL COMMENT 'NLP de la frase, de -1.000 a +1.000',
  nivel_volumen_rms DECIMAL(6,2)  NULL,
  tono_f0_hz        DECIMAL(6,2)  NULL,
  PRIMARY KEY (id_transcripcion),
  KEY ix_transcripcion_llamada_tiempo (id_llamada, timestamp_inicio),
  CONSTRAINT fk_transcripcion_llamada FOREIGN KEY (id_llamada)
    REFERENCES TB_Llamada (id_llamada) ON DELETE CASCADE,
  CONSTRAINT ck_transcripcion_tiempo CHECK (timestamp_fin >= timestamp_inicio),
  CONSTRAINT ck_transcripcion_score  CHECK (score_sentimiento BETWEEN -1.000 AND 1.000)
) ENGINE=InnoDB COMMENT='Fragmentos de transcripcion por hablante';

-- ---------------------------------------------------------------------
-- 10. TB_Alerta : infracciones lexicas/acusticas detectadas (RN-01, RN-02)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_Alerta (
  id_alerta           BIGINT       NOT NULL AUTO_INCREMENT,
  id_llamada          BIGINT       NOT NULL,
  tipo_alerta         ENUM('EXCESO_VOLUMEN','ALTERACION_TONO','VOCABULARIO_INADECUADO','OMISION_SCRIPT') NOT NULL,
  origen_evento       ENUM('AGENTE','CLIENTE') NOT NULL,
  timestamp_evento    DECIMAL(8,3) NOT NULL COMMENT 'Segundo de la llamada en que ocurrio',
  valor_registrado    VARCHAR(100) NULL COMMENT 'Ej. "88 dB" o "Palabra: estafa"',
  mensaje_sugerencia  VARCHAR(255) NULL COMMENT 'Orientacion mostrada al agente',
  PRIMARY KEY (id_alerta),
  KEY ix_alerta_llamada_tiempo (id_llamada, timestamp_evento),
  CONSTRAINT fk_alerta_llamada FOREIGN KEY (id_llamada)
    REFERENCES TB_Llamada (id_llamada) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Alertas generadas durante el analisis de una llamada';

-- ---------------------------------------------------------------------
-- 11. TB_LogAuditoria : trazabilidad (RN-04). No se guardan contrasenas
--     ni tokens en detalle_cambio.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_LogAuditoria (
  id_log            BIGINT       NOT NULL AUTO_INCREMENT,
  id_usuario        BIGINT       NOT NULL,
  accion_ejecutada  VARCHAR(100) NOT NULL COMMENT 'Ej. MODIFICACION_ROL',
  modulo_afectado   VARCHAR(50)  NOT NULL,
  detalle_cambio    JSON         NULL COMMENT 'Valores anteriores y nuevos',
  direccion_ip      VARCHAR(45)  NOT NULL COMMENT 'IPv4 o IPv6',
  fecha_evento      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_log),
  KEY ix_log_usuario_fecha (id_usuario, fecha_evento),
  KEY ix_log_fecha (fecha_evento),
  CONSTRAINT fk_log_usuario FOREIGN KEY (id_usuario)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='Auditoria de acciones administrativas y de seguridad';

-- ---------------------------------------------------------------------
-- 12. TB_MetricaDiariaAgente : resumen diario para cargar rapido el panel
--     del agente y los reportes. Es una tabla de resumen (derivada de
--     TB_Llamada) y esta en el Blueprint; la calcula el backend.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS TB_MetricaDiariaAgente (
  id_metrica          BIGINT       NOT NULL AUTO_INCREMENT,
  id_agente           BIGINT       NOT NULL,
  fecha               DATE         NOT NULL,
  total_llamadas      INT          NOT NULL DEFAULT 0,
  llamadas_positivas  INT          NOT NULL DEFAULT 0,
  llamadas_neutras    INT          NOT NULL DEFAULT 0,
  llamadas_negativas  INT          NOT NULL DEFAULT 0 COMMENT 'Incluye las criticas',
  promedio_puntaje    DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  cumplimiento_script DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Porcentaje de 0.00 a 100.00',
  PRIMARY KEY (id_metrica),
  UNIQUE KEY uq_metrica_agente_fecha (id_agente, fecha),
  CONSTRAINT fk_metrica_agente FOREIGN KEY (id_agente)
    REFERENCES TB_Usuario (id_usuario) ON DELETE RESTRICT,
  CONSTRAINT ck_metrica_conteos CHECK (
    llamadas_positivas + llamadas_neutras + llamadas_negativas <= total_llamadas),
  CONSTRAINT ck_metrica_promedio CHECK (promedio_puntaje BETWEEN 0.00 AND 100.00),
  CONSTRAINT ck_metrica_script   CHECK (cumplimiento_script BETWEEN 0.00 AND 100.00)
) ENGINE=InnoDB COMMENT='Resumen diario de desempeno por agente';
