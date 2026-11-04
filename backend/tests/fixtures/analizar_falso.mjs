// Reemplaza a analizar.py en las pruebas (no necesita Python). Se ejecuta igual:
//   node analizar_falso.mjs <ruta_del_audio> --modelo base --idioma es
// El "audio" es un archivo de texto cuyo contenido dice como debe comportarse.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argumentos = process.argv.slice(2);
const ruta = argumentos[0];
const modo = readFileSync(ruta, 'utf8').trim();
writeFileSync(`${ruta}.args.json`, JSON.stringify(argumentos));

const carpeta = path.dirname(ruta);
const registrar = (evento) => appendFileSync(path.join(carpeta, 'registro.txt'), `${evento} ${path.basename(ruta)}\n`);
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const salir = (codigo, texto = '') => {
  registrar('fin');
  process.stdout.write(texto, () => process.exit(codigo));
};
const conError = (codigo, mensaje) => JSON.stringify({ error: { codigo, mensaje, detalles: { ruta } } });

const V02 = {
  version_contrato: '0.2',
  archivo: path.basename(ruta),
  duracion_segundos: 184.6,
  baja_confianza_audio: false,
  score_global_nlp: 0.41,
  score_acustico: -0.125,
  puntaje_final: 72.5,
  clasificacion_final: 'POSITIVO',
  diagnostico_conflicto: 'FALLA_AGENTE',
  segmentos: [
    { indice: 0, inicio: 0, fin: 4.2, texto: 'Buenas tardes, señora Núñez', f0_hz: 180.5, rms_dbfs: -20.25, hablante: 'AGENTE', score_sentimiento: 0.6 },
    { indice: 1, inicio: 4.2, fin: 9, texto: 'Hola', f0_hz: null, rms_dbfs: null, hablante: 'CLIENTE', score_sentimiento: -0.3 },
  ],
};
const SIN_VOZ = {
  ...V02,
  baja_confianza_audio: true,
  score_global_nlp: 0,
  score_acustico: 0,
  puntaje_final: 50,
  clasificacion_final: 'NEUTRO',
  diagnostico_conflicto: 'SIN_CONFLICTO',
  segmentos: [],
};
// Como la v0.1 real: sin puntajes y sin hablante ni score_sentimiento en los segmentos.
const V01 = {
  version_contrato: '0.1',
  duracion_segundos: 10,
  baja_confianza_audio: false,
  segmentos: [{ indice: 0, inicio: 0, fin: 1, texto: 'Hola', f0_hz: 100, rms_dbfs: -20 }],
};

registrar('inicio');
process.stderr.write('Cargando modelo... (stderr no indica error)\n');

switch (modo) {
  case 'exito':
    salir(0, JSON.stringify(V02));
    break;
  case 'lento':
    await esperar(150);
    salir(0, JSON.stringify(V02));
    break;
  case 'version_menor_nueva':
    salir(0, JSON.stringify({ ...V02, version_contrato: '0.9', campo_del_futuro: { a: 1 } }));
    break;
  case 'sin_voz':
    salir(0, JSON.stringify(SIN_VOZ));
    break;
  case 'v01':
    salir(0, JSON.stringify(V01));
    break;
  case 'version_mayor':
    salir(0, JSON.stringify({ ...V02, version_contrato: '2.0' }));
    break;
  case 'puntaje_fuera_de_rango':
    salir(0, JSON.stringify({ ...V02, puntaje_final: 140 }));
    break;
  case 'no_cabe_en_la_columna': // timestamp_inicio es DECIMAL(8,3)
    salir(0, JSON.stringify({ ...V02, segmentos: [{ ...V02.segmentos[0] }, { ...V02.segmentos[1], inicio: 200000, fin: 200001 }] }));
    break;
  case 'error_audio':
    salir(1, conError('AUDIO_ILEGIBLE', 'No se pudo leer el audio.'));
    break;
  case 'error_largo':
    salir(1, conError('ERROR_LARGO', 'x'.repeat(400)));
    break;
  case 'error_interno_siempre':
    salir(1, conError('ERROR_INTERNO', 'Fallo inesperado.'));
    break;
  case 'error_interno_una_vez':
    if (existsSync(`${ruta}.intento`)) {
      salir(0, JSON.stringify(V02));
    } else {
      writeFileSync(`${ruta}.intento`, '1');
      salir(1, conError('ERROR_INTERNO', 'Fallo inesperado.'));
    }
    break;
  case 'sin_json_codigo_3':
    salir(3, 'esto no es JSON');
    break;
  case 'sin_json_codigo_1':
    salir(1);
    break;
  case 'basura_codigo_0':
    salir(0, 'esto no es JSON');
    break;
  case 'colgado': {
    // Como el lanzador del venv en Windows: abre otro proceso que hereda stdout y stderr.
    const nieto = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' });
    writeFileSync(`${ruta}.nieto`, String(nieto.pid));
    await esperar(30000);
    break;
  }
  default:
    salir(9, `modo desconocido: ${modo}`);
}
