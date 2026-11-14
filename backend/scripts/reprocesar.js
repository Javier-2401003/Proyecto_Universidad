// Vuelve a analizar llamadas ya analizadas con una version anterior del contrato de audio, para que
// el inicio, el Dashboard y los Reportes no mezclen escalas de puntaje (v0.3: maximo 77,5; v0.4: 100).
//
// Uso (desde la carpeta backend):
//   npm run reprocesar -- --antes-de 0.4              muestra cuales se reprocesarian (no cambia nada)
//   npm run reprocesar -- --antes-de 0.4 --confirmar  las vuelve a PENDIENTE
// Opciones:
//   --antes-de 0.x      las analizadas con una version menor (o sin version conocida)
//   --todas             todas las COMPLETADO, en lugar de --antes-de
//   --incluir-errores   tambien reintenta las que quedaron en ERROR
//   --lote <id>         solo ese lote
//   --confirmar         aplica el cambio (sin esta opcion solo muestra la lista)
//   --procesar          ademas las analiza aqui mismo, una a una (si el backend no esta corriendo)
//
// Con el backend corriendo (npm run dev) y el venv de audio instalado, las llamadas en PENDIENTE se
// analizan solas en unos segundos. Mientras tanto, la pantalla las muestra "en analisis".
// El cambio queda en TB_LogAuditoria (REPROCESO_LLAMADAS), a nombre del SuperAdmin de SEED_ADMIN_CORREO.
import { consultar, pool } from '../src/db.js';
import { buscarParaReprocesar, marcarParaReprocesar } from '../src/reproceso.js';
import { procesarPendientes } from '../src/procesamientoAudio.js';

function leerOpciones(argumentos) {
  const opciones = { confirmar: false, procesar: false, incluirErrores: false, todas: false };
  for (let i = 0; i < argumentos.length; i += 1) {
    const argumento = argumentos[i];
    if (argumento === '--antes-de') opciones.antesDe = argumentos[++i];
    else if (argumento === '--lote') opciones.idLote = Number(argumentos[++i]);
    else if (argumento === '--todas') opciones.todas = true;
    else if (argumento === '--incluir-errores') opciones.incluirErrores = true;
    else if (argumento === '--confirmar') opciones.confirmar = true;
    else if (argumento === '--procesar') opciones.procesar = true;
    else throw new Error(`Opcion desconocida: ${argumento}`);
  }
  if (!opciones.todas && opciones.antesDe === undefined) {
    throw new Error('Indique --antes-de 0.x (por ejemplo, --antes-de 0.4) o --todas.');
  }
  if (opciones.todas && opciones.antesDe !== undefined) throw new Error('Use --antes-de o --todas, no las dos.');
  if (opciones.idLote !== undefined && !(Number.isInteger(opciones.idLote) && opciones.idLote > 0)) {
    throw new Error('--lote debe ser un numero entero positivo.');
  }
  if (opciones.procesar && !opciones.confirmar) throw new Error('--procesar necesita --confirmar.');
  return opciones;
}

async function idSuperAdmin() {
  const correo = (process.env.SEED_ADMIN_CORREO || '').trim().toLowerCase();
  const [fila] = correo
    ? await consultar('SELECT id_usuario FROM TB_Usuario WHERE correo_electronico = ?', [correo])
    : [];
  if (!fila) throw new Error('No se encontro el SuperAdmin de SEED_ADMIN_CORREO (backend/.env).');
  return fila.id_usuario;
}

const describir = (llamada) =>
  `  #${llamada.id_llamada} lote ${llamada.id_lote ?? '-'} ${llamada.estado_procesamiento} ` +
  `v${llamada.version ?? '?'}  ${llamada.nombre_archivo_original ?? ''}`;

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  const { aReprocesar, sinAudio, alDia } = await buscarParaReprocesar({
    antesDe: opciones.todas ? undefined : opciones.antesDe,
    idLote: opciones.idLote,
    incluirErrores: opciones.incluirErrores,
  });

  console.log(`Al dia: ${alDia}. Para reprocesar: ${aReprocesar.length}. Sin audio en disco: ${sinAudio.length}.`);
  aReprocesar.forEach((llamada) => console.log(describir(llamada)));
  if (sinAudio.length > 0) {
    console.log('Sin audio en backend/uploads/ (no se pueden reprocesar):');
    sinAudio.forEach((llamada) => console.log(describir(llamada)));
  }
  if (!opciones.confirmar) {
    if (aReprocesar.length > 0) console.log('No se cambio nada. Agregue --confirmar para reprocesarlas.');
    return 0;
  }
  if (aReprocesar.length === 0) return 0;

  const cambiadas = await marcarParaReprocesar(
    aReprocesar.map((llamada) => llamada.id_llamada),
    {
      idUsuario: await idSuperAdmin(),
      motivo: { antes_de: opciones.todas ? null : opciones.antesDe, incluir_errores: opciones.incluirErrores },
    }
  );
  console.log(`${cambiadas} llamadas en PENDIENTE.`);

  if (opciones.procesar) {
    console.log('Analizando...');
    const procesadas = await procesarPendientes({ idLote: opciones.idLote });
    console.log(`${procesadas} llamadas analizadas.`);
  } else {
    console.log('El backend en marcha (npm run dev) las analizara en unos segundos.');
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
