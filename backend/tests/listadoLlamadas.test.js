// Pruebas de GET /llamadas (listado con filtros) contra la base de datos REAL. Crean sus
// usuarios, un lote y llamadas con fechas fijas, y los borran al terminar. El SuperAdmin
// tambien ve las llamadas de otras pruebas, asi que con el se filtra por agente.
// Necesitan SEED_ADMIN_* en backend/.env.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const { crearApp } = await import('../src/app.js');
const { consultar, pool } = await import('../src/db.js');

const CORREO_ADMIN = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
const PASSWORD_ADMIN = process.env.SEED_ADMIN_PASSWORD || '';
const SIN_ADMIN = CORREO_ADMIN && PASSWORD_ADMIN ? false : 'Falta SEED_ADMIN_* en backend/.env (ver README)';

const SUFIJO = Date.now();
const PASSWORD = 'ClaveDePrueba123';
const CORREOS = {
  supervisor: `test.lst.supervisor.${SUFIJO}@ejemplo.test`,
  ana: `test.lst.ana.${SUFIJO}@ejemplo.test`,
  beto: `test.lst.beto.${SUFIJO}@ejemplo.test`,
  ajeno: `test.lst.ajeno.${SUFIJO}@ejemplo.test`,
};

let servidor;
let base;
let idLote;
const ids = {};
const tokens = {};
const llamadas = {};

async function llamar(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
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

async function insertarLlamada(idAgente, nombre, fecha, campos = {}) {
  const columnas = Object.keys(campos);
  const resultado = await consultar(
    `INSERT INTO TB_Llamada (id_agente, id_lote, nombre_archivo_original, fecha_inicio${columnas.map((c) => `, ${c}`).join('')})
     VALUES (?, ?, ?, ?${columnas.map(() => ', ?').join('')})`,
    [idAgente, idLote, nombre, fecha, ...Object.values(campos)]
  );
  return resultado.insertId;
}

const pedir = (consulta, token) => llamar(`/api/v1/llamadas${consulta}`, { token });
const idsDe = (datos) => datos.llamadas.map((llamada) => llamada.id_llamada);

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
  if (SIN_ADMIN) return;

  tokens.admin = await iniciarSesion(CORREO_ADMIN, PASSWORD_ADMIN);
  for (const [clave, rol] of [['supervisor', 'SUPERVISOR'], ['ana', 'AGENTE'], ['beto', 'AGENTE'], ['ajeno', 'AGENTE']]) {
    const { estado, datos } = await llamar('/api/v1/usuarios', {
      metodo: 'POST',
      token: tokens.admin,
      cuerpo: { nombre_completo: `Prueba Listado ${clave}`, correo_electronico: CORREOS[clave], password: PASSWORD, rol },
    });
    assert.equal(estado, 201);
    ids[clave] = datos.id_usuario;
    tokens[clave] = await iniciarSesion(CORREOS[clave], PASSWORD);
  }
  for (const agente of [ids.ana, ids.beto]) {
    await consultar('INSERT INTO TB_AsignacionSupervisor (id_supervisor, id_agente) VALUES (?, ?)', [ids.supervisor, agente]);
  }

  const lote = await consultar(
    'INSERT INTO TB_LoteAudio (codigo_lote, id_usuario_carga, total_archivos) VALUES (?, ?, 5)',
    [`TEST-LST-${SUFIJO}`.slice(0, 30), ids.supervisor]
  );
  idLote = lote.insertId;

  const completada = (puntaje, clasificacion, diagnostico, extra = {}) => ({
    estado_procesamiento: 'COMPLETADO',
    duracion_segundos: 184,
    puntaje_final: puntaje,
    clasificacion_final: clasificacion,
    diagnostico_conflicto: diagnostico,
    ...extra,
  });

  // Ana: de la mas antigua a la mas reciente.
  llamadas.antes = await insertarLlamada(ids.ana, 'antes.mp3', '2026-10-31 23:59:59', completada(80, 'POSITIVO', 'SIN_CONFLICTO'));
  llamadas.positiva = await insertarLlamada(ids.ana, 'llamada señora Núñez.mp3', '2026-11-01 00:00:00',
    completada(72.5, 'POSITIVO', 'SIN_CONFLICTO', { baja_confianza_audio: 1 }));
  llamadas.critica = await insertarLlamada(ids.ana, 'llamada_100%.mp3', '2026-11-02 10:00:00', completada(10, 'CRITICO', 'FALLA_AGENTE'));
  // Pendiente con los valores por defecto (NEUTRO, SIN_CONFLICTO): no debe salir al filtrar por ellos.
  llamadas.pendiente = await insertarLlamada(ids.ana, 'llamadaX100.wav', '2026-11-02 10:00:00');
  llamadas.error = await insertarLlamada(ids.ana, 'rota.mp3', '2026-11-03 23:59:59', {
    estado_procesamiento: 'ERROR',
    mensaje_error: 'AUDIO_ILEGIBLE: No se pudo leer el audio.',
  });
  llamadas.beto = await insertarLlamada(ids.beto, 'beto.mp3', '2026-11-03 12:00:00', completada(50, 'NEUTRO', 'SIN_CONFLICTO'));
  llamadas.ajena = await insertarLlamada(ids.ajeno, 'ajena.mp3', '2026-11-03 12:00:00', completada(30, 'NEGATIVO', 'CLIENTE_PROBLEMATICO'));

  for (const tipo of ['EXCESO_VOLUMEN', 'OMISION_SCRIPT']) {
    await consultar(
      `INSERT INTO TB_Alerta (id_llamada, tipo_alerta, origen_evento, timestamp_evento) VALUES (?, ?, 'AGENTE', 1)`,
      [llamadas.critica, tipo]
    );
  }
  // En una llamada que no esta COMPLETADO no se cuenta.
  await consultar(
    `INSERT INTO TB_Alerta (id_llamada, tipo_alerta, origen_evento, timestamp_evento) VALUES (?, 'EXCESO_VOLUMEN', 'CLIENTE', 1)`,
    [llamadas.error]
  );
});

after(async () => {
  try {
    if (idLote) {
      await consultar('DELETE FROM TB_Llamada WHERE id_lote = ?', [idLote]); // alertas en cascada
      await consultar('DELETE FROM TB_LoteAudio WHERE id_lote = ?', [idLote]);
    }
    if (ids.supervisor) {
      await consultar('DELETE FROM TB_AsignacionSupervisor WHERE id_supervisor = ?', [ids.supervisor]);
    }
    await consultar('DELETE FROM TB_Usuario WHERE correo_electronico IN (?, ?, ?, ?)', Object.values(CORREOS));
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await pool.end();
  }
});

test('sin token: 401', async () => {
  const { estado, datos } = await pedir('');
  assert.equal(estado, 401);
  assert.equal(datos.error.codigo, 'NO_AUTENTICADO');
});

test('Agente: solo las suyas, de la mas reciente a la mas antigua', { skip: SIN_ADMIN }, async () => {
  const { estado, datos } = await pedir('', tokens.ana);
  assert.equal(estado, 200);
  assert.equal(datos.total, 5);
  assert.equal(datos.tamano_pagina, 20);
  // Misma fecha: primero el id mayor.
  assert.deepEqual(idsDe(datos), [llamadas.error, llamadas.pendiente, llamadas.critica, llamadas.positiva, llamadas.antes]);
});

test('forma de cada llamada: resultado solo si COMPLETADO, alertas solo si COMPLETADO', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedir('', tokens.ana);
  const porId = new Map(datos.llamadas.map((llamada) => [llamada.id_llamada, llamada]));

  assert.deepEqual(porId.get(llamadas.critica), {
    id_llamada: llamadas.critica,
    id_lote: idLote,
    codigo_lote: `TEST-LST-${SUFIJO}`.slice(0, 30),
    nombre_archivo_original: 'llamada_100%.mp3',
    agente: { id_usuario: ids.ana, nombre_completo: 'Prueba Listado ana' },
    fecha_inicio: porId.get(llamadas.critica).fecha_inicio,
    duracion_segundos: 184,
    estado_procesamiento: 'COMPLETADO',
    mensaje_error: null,
    baja_confianza_audio: false,
    resultado: { puntaje_final: 10, clasificacion_final: 'CRITICO', diagnostico_conflicto: 'FALLA_AGENTE' },
    total_alertas: 2,
  });
  assert.equal(porId.get(llamadas.positiva).baja_confianza_audio, true);
  assert.equal(porId.get(llamadas.pendiente).resultado, null);
  assert.equal(porId.get(llamadas.error).resultado, null);
  assert.equal(porId.get(llamadas.error).total_alertas, 0);
  assert.equal(porId.get(llamadas.error).mensaje_error, 'AUDIO_ILEGIBLE: No se pudo leer el audio.');
});

test('Supervisor: las de sus agentes asignados, no las de otros', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedir('', tokens.supervisor);
  assert.equal(datos.total, 6);
  assert.ok(idsDe(datos).includes(llamadas.beto));
  assert.ok(!idsDe(datos).includes(llamadas.ajena));

  // Pedir un agente que no puede ver no es un error: no hay resultados.
  const ajeno = await pedir(`?id_agente=${ids.ajeno}`, tokens.supervisor);
  assert.equal(ajeno.estado, 200);
  assert.equal(ajeno.datos.total, 0);
  assert.deepEqual(ajeno.datos.llamadas, []);
});

test('SuperAdmin: ve tambien a un agente que no es de su equipo', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedir(`?id_agente=${ids.ajeno}`, tokens.admin);
  assert.deepEqual(idsDe(datos), [llamadas.ajena]);
  const lote = await pedir(`?id_lote=${idLote}`, tokens.admin);
  assert.equal(lote.datos.total, 7);
});

test('desde y hasta: fecha de carga, con el dia completo', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedir('?desde=2026-11-01&hasta=2026-11-02', tokens.ana);
  assert.deepEqual(idsDe(datos), [llamadas.pendiente, llamadas.critica, llamadas.positiva]);
  const ultimoDia = await pedir('?desde=2026-11-03', tokens.ana);
  assert.deepEqual(idsDe(ultimoDia.datos), [llamadas.error]);
});

test('estado, clasificacion y diagnostico (estos dos solo COMPLETADO)', { skip: SIN_ADMIN }, async () => {
  const errores = await pedir('?estado=error', tokens.ana);
  assert.deepEqual(idsDe(errores.datos), [llamadas.error]);

  const positivas = await pedir('?clasificacion=POSITIVO', tokens.ana);
  assert.deepEqual(idsDe(positivas.datos), [llamadas.positiva, llamadas.antes]);

  // La pendiente tiene NEUTRO y SIN_CONFLICTO por defecto: no debe aparecer.
  const neutras = await pedir('?clasificacion=NEUTRO', tokens.ana);
  assert.deepEqual(idsDe(neutras.datos), []);
  const sinConflicto = await pedir('?diagnostico=SIN_CONFLICTO', tokens.ana);
  assert.deepEqual(idsDe(sinConflicto.datos), [llamadas.positiva, llamadas.antes]);

  const combinados = await pedir('?estado=COMPLETADO&diagnostico=FALLA_AGENTE', tokens.supervisor);
  assert.deepEqual(idsDe(combinados.datos), [llamadas.critica]);
});

test('buscar: parte del nombre, con % y _ como texto y con acentos', { skip: SIN_ADMIN }, async () => {
  const porcentaje = await pedir(`?buscar=${encodeURIComponent('0%')}`, tokens.ana);
  assert.deepEqual(idsDe(porcentaje.datos), [llamadas.critica]);
  const guionBajo = await pedir(`?buscar=${encodeURIComponent('a_1')}`, tokens.ana);
  assert.deepEqual(idsDe(guionBajo.datos), [llamadas.critica]);
  const acento = await pedir(`?buscar=${encodeURIComponent('Núñez')}`, tokens.ana);
  assert.deepEqual(idsDe(acento.datos), [llamadas.positiva]);
});

test('paginacion: total_paginas y una pagina despues de la ultima', { skip: SIN_ADMIN }, async () => {
  const segunda = await pedir('?tamano_pagina=2&pagina=2', tokens.ana);
  assert.equal(segunda.datos.total, 5);
  assert.equal(segunda.datos.total_paginas, 3);
  assert.deepEqual(idsDe(segunda.datos), [llamadas.critica, llamadas.positiva]);

  const fuera = await pedir('?tamano_pagina=2&pagina=4', tokens.ana);
  assert.equal(fuera.estado, 200);
  assert.deepEqual(fuera.datos.llamadas, []);
});

test('sin resultados: total 0 y total_paginas 0', { skip: SIN_ADMIN }, async () => {
  const { datos } = await pedir('?desde=2020-01-01&hasta=2020-01-02', tokens.ana);
  assert.deepEqual(datos, { pagina: 1, tamano_pagina: 20, total: 0, total_paginas: 0, llamadas: [] });
});

test('parametros invalidos: 400 DATOS_INVALIDOS con el campo', { skip: SIN_ADMIN }, async () => {
  const casos = [
    ['?estado=TERMINADA', 'estado'],
    ['?clasificacion=BUENA', 'clasificacion'],
    ['?diagnostico=OTRO', 'diagnostico'],
    ['?tamano_pagina=0', 'tamano_pagina'],
    ['?tamano_pagina=101', 'tamano_pagina'],
    ['?pagina=abc', 'pagina'],
    ['?id_agente=-3', 'id_agente'],
    ['?id_lote=1.5', 'id_lote'],
    ['?buscar=a', 'buscar'],
    ['?desde=2026-11-31', 'desde'],
    ['?desde=2026-11-05&hasta=2026-11-01', 'desde'],
  ];
  for (const [consulta, campo] of casos) {
    const { estado, datos } = await pedir(consulta, tokens.ana);
    assert.equal(estado, 400, consulta);
    assert.equal(datos.error.codigo, 'DATOS_INVALIDOS', consulta);
    assert.ok(datos.error.detalles.some((detalle) => detalle.campo === campo), `${consulta}: ${JSON.stringify(datos.error.detalles)}`);
  }
});

test('las rutas de lotes y de detalle siguen respondiendo', { skip: SIN_ADMIN }, async () => {
  const detalle = await pedir(`/${llamadas.critica}`, tokens.ana);
  assert.equal(detalle.estado, 200);
  assert.equal(detalle.datos.id_llamada, llamadas.critica);
  const lote = await pedir(`/lotes/${idLote}`, tokens.supervisor);
  assert.equal(lote.estado, 200);
});
