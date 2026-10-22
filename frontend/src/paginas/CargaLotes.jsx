// Carga de audios por lotes (contrato en docs/api.md). Se elige el agente, se
// agregan 5, 10 o 15 audios WAV/MP3 y, tras subirlos, se sigue el avance del
// procesamiento de cada llamada.
import { useEffect, useRef, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  FileAudio,
  FlaskConical,
  LoaderCircle,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { LIMITES, SIMULAR, listarAgentes, obtenerLote, subirLote } from '../api/lotes.js';
import { Cargando } from '../componentes/Cargando.jsx';

const MAX_BYTES = LIMITES.maxMegabytes * 1024 * 1024;
const INTERVALO_CONSULTA_MS = 2000;
// "5, 10 o 15"
const TEXTO_TAMANOS = LIMITES.tamanosPermitidos.join(', ').replace(/, (\d+)$/, ' o $1');

const formatoTamano = (bytes) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const extensionValida = (nombre) => LIMITES.extensiones.some((ext) => nombre.toLowerCase().endsWith(ext));
const huella = (archivo) => `${archivo.name}|${archivo.size}`;

// Revisa la seleccion antes de subirla: el mismo criterio que el backend, para
// avisar sin esperar al servidor. Devuelve un mensaje por archivo (o null).
function erroresLocales(archivos) {
  const vistos = new Set();
  return archivos.map((archivo) => {
    const clave = huella(archivo);
    const repetido = vistos.has(clave);
    vistos.add(clave);
    if (!extensionValida(archivo.name)) return 'Solo se permiten archivos WAV o MP3.';
    if (archivo.size > MAX_BYTES) return `El archivo supera ${LIMITES.maxMegabytes} MB.`;
    if (repetido) return 'El audio esta repetido en el lote.';
    return null;
  });
}

export default function CargaLotes({ nombre }) {
  const { tienePermiso } = useSesion();
  const puedeCargar = tienePermiso('CARGA_LOTES', 'escribir');
  const [lote, setLote] = useState(null);

  return (
    <section>
      <h1>{nombre || 'Carga de audios por lotes'}</h1>
      <p className="texto-secundario">
        Suba {TEXTO_TAMANOS} audios WAV o MP3 de hasta{' '}
        {LIMITES.maxMegabytes} MB, todos de un mismo agente.
      </p>

      {SIMULAR && (
        <p className="alerta alerta--aviso">
          <FlaskConical size={18} aria-hidden="true" />
          Modo de prueba: los agentes y el procesamiento son simulados. Los archivos no salen de su computadora.
        </p>
      )}

      {!puedeCargar ? (
        <p className="alerta">Su usuario puede consultar este modulo, pero no tiene permiso para cargar lotes.</p>
      ) : lote ? (
        <ResultadoLote loteInicial={lote} alTerminar={() => setLote(null)} />
      ) : (
        <FormularioLote alSubir={setLote} />
      )}
    </section>
  );
}

function FormularioLote({ alSubir }) {
  const [agentes, setAgentes] = useState([]);
  const [cargandoAgentes, setCargandoAgentes] = useState(true);
  const [idAgente, setIdAgente] = useState('');
  const [archivos, setArchivos] = useState([]);
  // Errores que devolvio el servidor, por nombre de archivo.
  const [erroresServidor, setErroresServidor] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [progreso, setProgreso] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const entradaArchivos = useRef(null);

  useEffect(() => {
    listarAgentes()
      .then(setAgentes)
      .catch((excepcion) => setErrorGeneral(excepcion.message))
      .finally(() => setCargandoAgentes(false));
  }, []);

  const errores = erroresLocales(archivos);
  const subiendo = progreso !== null;
  const cantidadValida = LIMITES.tamanosPermitidos.includes(archivos.length);
  const listo = idAgente && cantidadValida && errores.every((error) => !error);

  function agregar(lista) {
    setArchivos((anteriores) => [...anteriores, ...lista]);
    setErroresServidor({});
    setErrorGeneral('');
  }

  function quitar(indice) {
    setArchivos((anteriores) => anteriores.filter((_, i) => i !== indice));
    setErroresServidor({});
  }

  function alSoltar(evento) {
    evento.preventDefault();
    setArrastrando(false);
    if (!subiendo) agregar([...evento.dataTransfer.files]);
  }

  async function alEnviar(evento) {
    evento.preventDefault();
    if (!listo) return;
    setErrorGeneral('');
    setErroresServidor({});
    setProgreso(0);
    try {
      alSubir(await subirLote({ idAgente: Number(idAgente), archivos }, setProgreso));
    } catch (excepcion) {
      setProgreso(null);
      const porArchivo = (excepcion.detalles ?? []).filter((detalle) => detalle.archivo);
      setErroresServidor(Object.fromEntries(porArchivo.map((d) => [d.archivo, d.mensaje])));
      setErrorGeneral(excepcion.message);
    }
  }

  if (cargandoAgentes) return <Cargando texto="Cargando agentes..." />;

  return (
    <form className="formulario" onSubmit={alEnviar}>
      <label className="campo campo--corto">
        <span>Agente que atendio las llamadas</span>
        <select value={idAgente} onChange={(evento) => setIdAgente(evento.target.value)} required disabled={subiendo}>
          <option value="">Seleccione un agente</option>
          {agentes.map((agente) => (
            <option key={agente.id_usuario} value={agente.id_usuario}>
              {agente.nombre_completo}
            </option>
          ))}
        </select>
      </label>
      {agentes.length === 0 && !errorGeneral && (
        <p className="alerta">No tiene agentes asignados. Pida al administrador que le asigne agentes.</p>
      )}

      <div
        className={arrastrando ? 'zona-archivos zona-archivos--activa' : 'zona-archivos'}
        onDragOver={(evento) => {
          evento.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
      >
        <Upload size={28} aria-hidden="true" />
        <p>Arrastre los audios aqui o</p>
        <button
          type="button"
          className="boton boton--secundario"
          onClick={() => entradaArchivos.current.click()}
          disabled={subiendo}
        >
          Elegir archivos
        </button>
        <input
          ref={entradaArchivos}
          type="file"
          accept={`${LIMITES.extensiones.join(',')},audio/wav,audio/mpeg`}
          multiple
          hidden
          onChange={(evento) => {
            agregar([...evento.target.files]);
            evento.target.value = '';
          }}
        />
      </div>

      {archivos.length > 0 && (
        <>
          <p className={cantidadValida ? 'contador' : 'contador contador--error'}>
            {archivos.length} {archivos.length === 1 ? 'audio seleccionado' : 'audios seleccionados'}
            {!cantidadValida && ` - el lote debe tener ${TEXTO_TAMANOS}`}
          </p>
          <ul className="lista-archivos">
            {archivos.map((archivo, indice) => {
              const error = errores[indice] || erroresServidor[archivo.name];
              return (
                <li key={`${huella(archivo)}-${indice}`} className={error ? 'archivo archivo--error' : 'archivo'}>
                  <FileAudio size={18} aria-hidden="true" />
                  <div className="archivo__datos">
                    <span className="archivo__nombre">{archivo.name}</span>
                    <small className={error ? 'campo__error' : 'texto-secundario'}>
                      {error || formatoTamano(archivo.size)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="boton boton--icono"
                    onClick={() => quitar(indice)}
                    disabled={subiendo}
                    aria-label={`Quitar ${archivo.name}`}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {errorGeneral && (
        <p className="alerta alerta--error" role="alert">
          {errorGeneral}
        </p>
      )}

      {subiendo && (
        <div className="progreso" role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100}>
          <div className="progreso__barra" style={{ width: `${progreso}%` }} />
          <span>Subiendo... {progreso}%</span>
        </div>
      )}

      <div className="formulario__acciones">
        {archivos.length > 0 && (
          <button type="button" className="boton boton--secundario" onClick={() => setArchivos([])} disabled={subiendo}>
            Quitar todos
          </button>
        )}
        <button type="submit" className="boton boton--primario" disabled={!listo || subiendo}>
          <Upload size={18} aria-hidden="true" />
          Subir lote
        </button>
      </div>
    </form>
  );
}

const ESTADOS_LLAMADA = {
  PENDIENTE: { texto: 'Pendiente', icono: Clock },
  PROCESANDO: { texto: 'Procesando', icono: LoaderCircle },
  COMPLETADO: { texto: 'Completado', icono: CircleCheck },
  ERROR: { texto: 'Error', icono: CircleX },
};

const ESTADOS_LOTE = {
  PROCESANDO: 'Procesando',
  COMPLETADO: 'Completado',
  CON_ERRORES: 'Completado con errores',
};

// Muestra el lote recien subido y consulta su estado hasta que termina.
function ResultadoLote({ loteInicial, alTerminar }) {
  const [lote, setLote] = useState(loteInicial);
  const [errorConsulta, setErrorConsulta] = useState('');
  const enProceso = lote.estado_lote === 'PROCESANDO';

  useEffect(() => {
    if (!enProceso) return undefined;
    const temporizador = setTimeout(() => {
      obtenerLote(loteInicial.id_lote)
        .then((actual) => {
          setLote(actual);
          setErrorConsulta('');
        })
        .catch((excepcion) => setErrorConsulta(excepcion.message));
    }, INTERVALO_CONSULTA_MS);
    return () => clearTimeout(temporizador);
  }, [lote, enProceso, loteInicial.id_lote]);

  const completadas = lote.llamadas.filter((l) => l.estado_procesamiento === 'COMPLETADO').length;

  return (
    <div className="formulario">
      <p className="alerta alerta--exito" role="status">
        <CircleCheck size={18} aria-hidden="true" />
        Lote {lote.codigo_lote} cargado: {lote.total_archivos} audios.
      </p>

      <div className="resumen-lote">
        <div>
          <span className="texto-secundario">Estado</span>
          <strong>{ESTADOS_LOTE[lote.estado_lote] ?? lote.estado_lote}</strong>
        </div>
        <div>
          <span className="texto-secundario">Analizadas</span>
          <strong>
            {completadas} de {lote.total_archivos}
          </strong>
        </div>
        {lote.agente && (
          <div>
            <span className="texto-secundario">Agente</span>
            <strong>{lote.agente.nombre_completo}</strong>
          </div>
        )}
      </div>

      {errorConsulta && (
        <p className="alerta alerta--error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          No se pudo actualizar el estado: {errorConsulta} Se reintentara automaticamente.
        </p>
      )}

      <ul className="lista-archivos">
        {lote.llamadas.map((llamada) => {
          const estado = ESTADOS_LLAMADA[llamada.estado_procesamiento] ?? ESTADOS_LLAMADA.PENDIENTE;
          const Icono = estado.icono;
          return (
            <li key={llamada.id_llamada} className="archivo">
              <FileAudio size={18} aria-hidden="true" />
              <div className="archivo__datos">
                <span className="archivo__nombre">{llamada.nombre_archivo_original}</span>
                {llamada.mensaje_error && <small className="campo__error">{llamada.mensaje_error}</small>}
              </div>
              <span className={`etiqueta etiqueta--${llamada.estado_procesamiento.toLowerCase()}`}>
                <Icono
                  size={14}
                  aria-hidden="true"
                  className={llamada.estado_procesamiento === 'PROCESANDO' ? 'icono-girando' : undefined}
                />
                {estado.texto}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="formulario__acciones">
        <button type="button" className="boton boton--primario" onClick={alTerminar}>
          <RotateCcw size={18} aria-hidden="true" />
          Cargar otro lote
        </button>
      </div>
    </div>
  );
}
