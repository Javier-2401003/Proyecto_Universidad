// Pruebas de GET /agentes y POST /llamadas/lotes contra la base de datos REAL.
// Crean su propio supervisor y agentes de prueba y los borran al terminar.
// Necesitan SEED_ADMIN_* en backend/.env, igual que api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

// Limite chico solo en esta prueba (cada archivo de prueba corre en su propio proceso),
// para probar ARCHIVO_DEMASIADO_GRANDE sin generar audios de 25 MB.
process.env.AUDIO_MAX_MB = '1';
const { crearApp } = await import('../src/app.js');
const { consultar, pool } = await import('../src/db.js');
const { config } = await import('../src/config.js');

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const SUFIJO = Date.now();
const PASSWORD = 'ClaveDePrueba123';
const CORREOS = {
  supervisor: `test.supervisor.${SUFIJO}@ejemplo.test`,
  agenteAsignado: `test.agente.asignado.${SUFIJO}@ejemplo.test`,
  agenteAjeno: `test.agente.ajeno.${SUFIJO}@ejemplo.test`,
  supervisorAjeno: `test.supervisor.ajeno.${SUFIJO}@ejemplo.test`,
};

let servidor;
let base;
const ids = {};
const tokens = {};
let loteCreado;

async function llamar(ruta, { metodo = 'GET', token, cuerpo, formulario } = {}) {
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formulario ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  return { estado: respuesta.status, datos: await respuesta.json() };
}

async function iniciarSesion(correo, password) {
  const { estado, datos } = await llamar('/api/v1/auth/login', {
    metodo: 'POST',
    cuerpo: { correo_electronico: correo, password },
  });
  assert.equal(estado, 200, `no se pudo iniciar sesion con ${correo}`);
  return datos.token_acceso;
}

// WAV minimo valido (cabecera de 44 bytes) con datos al azar, para que cada uno tenga otro SHA-256.
function wav(bytesDatos = 2000) {
  const datos = randomBytes(bytesDatos);
  const cabecera = Buffer.alloc(44);
  cabecera.write('RIFF', 0, 'latin1');
  cabecera.writeUInt32LE(36 + datos.length, 4);
  cabecera.write('WAVEfmt ', 8, 'latin1');
  cabecera.writeUInt32LE(16, 16);
  cabecera.writeUInt16LE(1, 20); // PCM
  cabecera.writeUInt16LE(1, 22); // mono
  cabecera.writeUInt32LE(8000, 24);
  cabecera.writeUInt32LE(16000, 28);
  cabecera.writeUInt16LE(2, 32);
  cabecera.writeUInt16LE(16, 34);
  cabecera.write('data', 36, 'latin1');
  cabecera.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cabecera, datos]);
}

function mp3() {
  return Buffer.concat([Buffer.from('ID3', 'latin1'), randomBytes(1000)]);
}

function variosWav(cantidad) {
  return Array.from({ length: cantidad }, (_, i) => ({ nombre: `llamada${i + 1}.wav`, contenido: wav() }));
}

function formulario(idAgente, audios) {
  const datos = new FormData();
  if (idAgente !== undefined) datos.append('id_agente', String(idAgente));
  for (const audio of audios) datos.append('audios', new Blob([audio.contenido]), audio.nombre);
  return datos;
}

function subirLote(token, idAgente, audios) {
  return llamar('/api/v1/llamadas/lotes', { metodo: 'POST', token, formulario: formulario(idAgente, audios) });
}

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  const crear = async (correo, rol) => {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba ${rol}`, correo_electronico: correo, password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    return datos.id_usuario;
  };
  ids.supervisor = await crear(CORREOS.supervisor, 'SUPERVISOR');
  ids.agenteAsignado = await crear(CORREOS.agenteAsignado, 'AGENTE');
  ids.agenteAjeno = await crear(CORREOS.agenteAjeno, 'AGENTE');
  ids.supervisorAjeno = await crear(CORREOS.supervisorAjeno, 'SUPERVISOR');
  // Aun no hay endpoint para asignar supervisor: se hace directo en la base.
  await consultar('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [
    ids.supervisor,
    ids.agenteAsignado,
  ]);

  tokens.supervisor = await iniciarSesion(CORREOS.supervisor, PASSWORD);
  tokens.agente = await iniciarSesion(CORREOS.agenteAsignado, PASSWORD);
  tokens.supervisorAjeno = await iniciarSesion(CORREOS.supervisorAjeno, PASSWORD);
});

after(async () => {
  try {
    if (ids.supervisor) {
      const agentes = [ids.agenteAsignado, ids.agenteAjeno];
      await consultar('DELETE FROM TB_Llamada WHERE id_agente IN (?, ?)', agentes);
      await consultar('DELETE FROM TB_LoteAudio WHERE id_usuario_carga = ?', [ids.supervisor]);
      await consultar('DELETE FROM TB_LogAuditoria WHERE id_usuario = ?', [ids.supervisor]);
      await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ?', [ids.supervisor]);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?, ?)', Object.values(CORREOS));
    if (loteCreado) {
      await rm(path.join(config.lotes.carpetaUploads, 'lotes', String(loteCreado.id_lote)), {
        recursive: true,
        force: true,
      });
    }
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

// --- GET /agentes ---

test('GET /agentes: el SuperAdmin ve a todos los agentes activos', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/agentes', { token: tokens.admin });
  assert.equal(estado, 200);
  const visibles = datos.map((agente) => agente.id_usuario);
  assert.ok(visibles.includes(ids.agenteAsignado));
  assert.ok(visibles.includes(ids.agenteAjeno));
  assert.ok(!visibles.includes(ids.supervisor));
  assert.deepEqual(Object.keys(datos[0]).sort(), ['correo_electronico', 'id_usuario', 'nombre_completo']);
});

test('GET /agentes: el Supervisor solo ve a sus agentes asignados', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/agentes', { token: tokens.supervisor });
  assert.equal(estado, 200);
  assert.deepEqual(
    datos.map((agente) => agente.id_usuario),
    [ids.agenteAsignado]
  );
});

test('GET /agentes: un Agente no tiene permiso (403)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await llamar('/api/v1/agentes', { token: tokens.agente });
  assert.equal(estado, 403);
  assert.equal(datos.error.codigo, 'PROHIBIDO');
});

// --- POST /llamadas/lotes: rechazos (no se guarda nada) ---

test('POST /llamadas/lotes sin token responde 401', async () => {
  const { estado } = await llamar('/api/v1/llamadas/lotes', { metodo: 'POST', formulario: formulario(1, []) });
  assert.equal(estado, 401);
});

test('POST /llamadas/lotes: el SuperAdmin solo lee CARGA_LOTES (403)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await subirLote(tokens.admin, ids.agenteAsignado, variosWav(5));
  assert.equal(estado, 403);
  assert.equal(datos.error.codigo, 'PROHIBIDO');
});

test('POST /llamadas/lotes sin id_agente responde 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await subirLote(tokens.supervisor, undefined, variosWav(5));
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'DATOS_INVALIDOS');
  assert.equal(datos.error.detalles[0].campo, 'id_agente');
});

test('POST /llamadas/lotes con los audios en otro campo responde 400 DATOS_INVALIDOS', { skip: SIN_ADMIN }, async () => {
  const datos = new FormData();
  datos.append('id_agente', String(ids.agenteAsignado));
  datos.append('audio', new Blob([wav()]), 'llamada.wav');
  const respuesta = await llamar('/api/v1/llamadas/lotes', { metodo: 'POST', token: tokens.supervisor, formulario: datos });
  assert.equal(respuesta.estado, 400);
  assert.equal(respuesta.datos.error.codigo, 'DATOS_INVALIDOS');
  assert.equal(respuesta.datos.error.detalles[0].campo, 'audio');
});

test('POST /llamadas/lotes con un agente no asignado responde 400 AGENTE_INVALIDO', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAjeno, variosWav(5));
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'AGENTE_INVALIDO');
});

test('POST /llamadas/lotes con 4 audios responde 400 CANTIDAD_INVALIDA', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, variosWav(4));
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'CANTIDAD_INVALIDA');
  assert.match(datos.error.mensaje, /4 audios/);
});

test('POST /llamadas/lotes con archivos que no son WAV/MP3 responde 400 con detalle por archivo', { skip: SIN_ADMIN }, async () => {
  const audios = [
    ...variosWav(3),
    { nombre: 'notas.ogg', contenido: wav() },
    { nombre: 'falso.mp3', contenido: Buffer.from('esto es texto, no audio') },
  ];
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, audios);
  assert.equal(estado, 400);
  assert.equal(datos.error.codigo, 'FORMATO_NO_PERMITIDO');
  assert.deepEqual(
    datos.error.detalles.map((detalle) => detalle.archivo),
    ['notas.ogg', 'falso.mp3']
  );
  assert.equal(datos.error.detalles[0].campo, 'audios');
});

test('POST /llamadas/lotes con un audio de mas de AUDIO_MAX_MB responde 413', { skip: SIN_ADMIN }, async () => {
  const audios = [...variosWav(4), { nombre: 'enorme.wav', contenido: wav(1024 * 1024) }];
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, audios);
  assert.equal(estado, 413);
  assert.equal(datos.error.codigo, 'ARCHIVO_DEMASIADO_GRANDE');
  assert.deepEqual(
    datos.error.detalles.map((detalle) => detalle.archivo),
    ['enorme.wav']
  );
});

test('POST /llamadas/lotes con un audio repetido dentro del lote responde 409', { skip: SIN_ADMIN }, async () => {
  const audios = variosWav(5);
  audios[4] = { nombre: 'copia.wav', contenido: audios[0].contenido };
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, audios);
  assert.equal(estado, 409);
  assert.equal(datos.error.codigo, 'AUDIO_DUPLICADO');
  assert.equal(datos.error.detalles[0].archivo, 'copia.wav');
});

test('los lotes rechazados no dejaron nada guardado', { skip: SIN_ADMIN }, async () => {
  const lotes = await consultar('SELECT COUNT(*) AS total FROM TB_LoteAudio WHERE id_usuario_carga = ?', [ids.supervisor]);
  assert.equal(lotes[0].total, 0);
  const llamadas = await consultar('SELECT COUNT(*) AS total FROM TB_Llamada WHERE id_agente = ?', [ids.agenteAsignado]);
  assert.equal(llamadas[0].total, 0);
  const temporales = await readdir(path.join(config.lotes.carpetaUploads, 'temporal')).catch(() => []);
  assert.deepEqual(temporales, []);
});

// --- POST /llamadas/lotes: carga correcta ---

const AUDIOS_BUENOS = [...variosWav(4), { nombre: 'llamada señora Pérez.MP3', contenido: mp3() }];

test('el Supervisor carga un lote de 5 audios (201)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, AUDIOS_BUENOS);
  assert.equal(estado, 201);
  assert.match(datos.codigo_lote, /^LOTE-\d{8}-\d{4,}$/);
  assert.equal(datos.total_archivos, 5);
  assert.equal(datos.estado_lote, 'PROCESANDO');
  assert.deepEqual(
    datos.llamadas.map((llamada) => llamada.nombre_archivo_original),
    AUDIOS_BUENOS.map((audio) => audio.nombre)
  );
  assert.ok(datos.llamadas.every((llamada) => llamada.estado_procesamiento === 'PENDIENTE'));
  loteCreado = datos;
});

test('las llamadas del lote quedaron en la base y en disco', { skip: SIN_ADMIN }, async () => {
  const filas = await consultar(
    `SELECT id_agente, hash_archivo, ruta_audio_storage FROM TB_Llamada WHERE id_lote = ? ORDER BY id_llamada`,
    [loteCreado.id_lote]
  );
  assert.equal(filas.length, 5);
  for (const fila of filas) {
    assert.equal(fila.id_agente, ids.agenteAsignado);
    assert.match(fila.hash_archivo, /^[0-9a-f]{64}$/);
    await access(path.join(config.lotes.carpetaUploads, fila.ruta_audio_storage));
  }
  assert.ok(filas[4].ruta_audio_storage.endsWith('.mp3'));
});

test('la carga del lote quedo registrada en la auditoria', { skip: SIN_ADMIN }, async () => {
  const filas = await consultar(
    `SELECT modulo_afectado, detalle_cambio FROM TB_LogAuditoria
      WHERE id_usuario = ? AND accion_ejecutada = 'CARGA_LOTE'`,
    [ids.supervisor]
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].modulo_afectado, 'CARGA_LOTES');
  assert.deepEqual(filas[0].detalle_cambio, {
    id_lote: loteCreado.id_lote,
    id_agente: ids.agenteAsignado,
    total_archivos: 5,
  });
});

test('volver a subir un audio ya cargado responde 409 con id_llamada_existente', { skip: SIN_ADMIN }, async () => {
  const audios = [...variosWav(4), AUDIOS_BUENOS[2]];
  const { estado, datos } = await subirLote(tokens.supervisor, ids.agenteAsignado, audios);
  assert.equal(estado, 409);
  assert.equal(datos.error.codigo, 'AUDIO_DUPLICADO');
  assert.equal(datos.error.detalles.length, 1);
  assert.equal(datos.error.detalles[0].archivo, AUDIOS_BUENOS[2].nombre);
  assert.equal(datos.error.detalles[0].id_llamada_existente, loteCreado.llamadas[2].id_llamada);
});

// --- GET /llamadas/lotes/:id_lote ---

function verLote(idLote, token) {
  return llamar(`/api/v1/llamadas/lotes/${idLote}`, { token });
}

test('GET lote: el Supervisor ve el estado del lote y de cada llamada', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLote(loteCreado.id_lote, tokens.supervisor);
  assert.equal(estado, 200);
  assert.equal(datos.id_lote, loteCreado.id_lote);
  assert.equal(datos.codigo_lote, loteCreado.codigo_lote);
  assert.equal(datos.estado_lote, 'PROCESANDO');
  assert.equal(datos.total_archivos, 5);
  assert.ok(!Number.isNaN(Date.parse(datos.fecha_creacion)));
  assert.deepEqual(datos.agente, { id_usuario: ids.agenteAsignado, nombre_completo: 'Prueba AGENTE' });
  assert.deepEqual(
    datos.llamadas,
    loteCreado.llamadas.map((llamada) => ({ ...llamada, mensaje_error: null }))
  );
});

test('GET lote: el SuperAdmin tambien lo ve', { skip: SIN_ADMIN }, async () => {
  const { estado } = await verLote(loteCreado.id_lote, tokens.admin);
  assert.equal(estado, 200);
});

test('GET lote: un Supervisor sin ese agente asignado recibe 404 (no se revela que existe)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLote(loteCreado.id_lote, tokens.supervisorAjeno);
  assert.equal(estado, 404);
  assert.equal(datos.error.codigo, 'NO_ENCONTRADO');
});

test('GET lote: sigue visible aunque el agente se haya desactivado despues', { skip: SIN_ADMIN }, async () => {
  await consultar("UPDATE TB_Usuario SET estado = 'INACTIVO' WHERE id_usuario = ?", [ids.agenteAsignado]);
  try {
    const { estado } = await verLote(loteCreado.id_lote, tokens.supervisor);
    assert.equal(estado, 200);
  } finally {
    await consultar("UPDATE TB_Usuario SET estado = 'ACTIVO' WHERE id_usuario = ?", [ids.agenteAsignado]);
  }
});

test('GET lote que no existe responde 404 y un id no numerico 400', { skip: SIN_ADMIN }, async () => {
  const noExiste = await verLote(999999999, tokens.supervisor);
  assert.equal(noExiste.estado, 404);
  assert.equal(noExiste.datos.error.codigo, 'NO_ENCONTRADO');

  const texto = await verLote('abc', tokens.supervisor);
  assert.equal(texto.estado, 400);
  assert.equal(texto.datos.error.codigo, 'DATOS_INVALIDOS');
});

test('GET lote: un Agente no tiene permiso (403)', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await verLote(loteCreado.id_lote, tokens.agente);
  assert.equal(estado, 403);
  assert.equal(datos.error.codigo, 'PROHIBIDO');
});
