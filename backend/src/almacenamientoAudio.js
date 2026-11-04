// Motor de almacenamiento para multer. Guarda cada audio en una carpeta
// temporal y, mientras lo recibe, calcula su SHA-256, mide su tamano y lee sus
// primeros bytes para saber si de verdad es WAV o MP3.
//
// Un archivo demasiado grande no corta la subida: se deja de guardar y se marca,
// asi la respuesta puede listar TODOS los archivos con problemas (docs/api.md).
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const BYTES_CABECERA = 12;

// "WAV", "MP3" o null segun los primeros bytes del archivo.
export function detectarFormato(cabecera) {
  if (
    cabecera.length >= 12 &&
    cabecera.toString('latin1', 0, 4) === 'RIFF' &&
    cabecera.toString('latin1', 8, 12) === 'WAVE'
  ) {
    return 'WAV';
  }
  // MP3 con etiqueta ID3 al inicio, o que empieza directo con un frame de audio.
  if (cabecera.length >= 3 && cabecera.toString('latin1', 0, 3) === 'ID3') return 'MP3';
  if (cabecera.length >= 2 && cabecera[0] === 0xff && (cabecera[1] & 0xe0) === 0xe0) return 'MP3';
  return null;
}

function recibir(entrada, ruta, maxBytes) {
  return new Promise((resolver, rechazar) => {
    const hash = createHash('sha256');
    const destino = createWriteStream(ruta);
    let tamano = 0;
    let cabecera = Buffer.alloc(0);
    let guardando = true;

    const fallar = (error) => {
      destino.destroy();
      rechazar(error);
    };
    destino.on('error', fallar);
    entrada.on('error', fallar);

    entrada.on('data', (trozo) => {
      tamano += trozo.length;
      if (cabecera.length < BYTES_CABECERA) {
        cabecera = Buffer.concat([cabecera, trozo.subarray(0, BYTES_CABECERA - cabecera.length)]);
      }
      if (!guardando) return;
      if (tamano > maxBytes) {
        // Se sigue leyendo (sin guardar) para llegar a los demas archivos.
        guardando = false;
        destino.destroy();
        entrada.resume();
        return;
      }
      hash.update(trozo);
      if (!destino.write(trozo)) {
        entrada.pause();
        destino.once('drain', () => entrada.resume());
      }
    });

    entrada.on('end', () => {
      const terminar = () =>
        resolver({
          path: ruta,
          size: tamano,
          formato: detectarFormato(cabecera),
          hash: guardando ? hash.digest('hex') : null,
          demasiadoGrande: !guardando,
        });
      if (guardando) destino.end();
      if (destino.closed) terminar();
      else destino.once('close', terminar);
    });
  });
}

export function crearAlmacenamientoAudio({ carpeta, maxBytes }) {
  return {
    _handleFile(_req, archivo, cb) {
      const ruta = path.join(carpeta, `${randomUUID()}.tmp`);
      mkdir(carpeta, { recursive: true })
        .then(() => recibir(archivo.stream, ruta, maxBytes))
        .then(
          (info) => cb(null, info),
          // Si fallo a medias, multer no conoce la ruta: se borra aqui.
          (error) =>
            rm(ruta, { force: true })
              .catch(() => {})
              .then(() => cb(error))
        );
    },
    _removeFile(_req, archivo, cb) {
      rm(archivo.path, { force: true }).then(() => cb(null), cb);
    },
  };
}
