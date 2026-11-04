// Detalle de una llamada (contrato en docs/api.md): resultado del analisis,
// mapa de sentimiento, alertas y transcripcion por hablante. Si hay audio, al
// hacer clic en un momento de la llamada el reproductor salta a ese segundo.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleAlert, FlaskConical, Headphones, TriangleAlert } from 'lucide-react';
import { obtenerAudio, obtenerLlamada } from '../api/llamadas.js';
import { SIMULAR } from '../api/simulacion/activa.js';
import { Cargando } from '../componentes/Cargando.jsx';

const CLASIFICACIONES = {
  POSITIVO: 'Positiva',
  NEUTRO: 'Neutra',
  NEGATIVO: 'Negativa',
  CRITICO: 'Critica',
};

const DIAGNOSTICOS = {
  SIN_CONFLICTO: { texto: 'Sin conflicto', detalle: 'La llamada se desarrollo con normalidad.' },
  CLIENTE_PROBLEMATICO: { texto: 'Cliente problematico', detalle: 'La tension vino del cliente; el agente mantuvo el control.' },
  FALLA_AGENTE: { texto: 'Falla del agente', detalle: 'El agente no siguio el protocolo de atencion.' },
};

const TIPOS_ALERTA = {
  EXCESO_VOLUMEN: 'Exceso de volumen',
  ALTERACION_TONO: 'Alteracion de tono',
  VOCABULARIO_INADECUADO: 'Vocabulario inadecuado',
  OMISION_SCRIPT: 'Omision del guion',
};

const ESTADOS_PENDIENTES = {
  PENDIENTE: 'La llamada todavia no se ha analizado.',
  PROCESANDO: 'La llamada se esta analizando. Vuelva en unos momentos.',
};

const formatoFecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

// 75 -> "01:15"
function formatoTiempo(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Nivel de sentimiento de una frase (-1 a 1), para el color.
function nivelSentimiento(score) {
  if (score <= -0.6) return 'muy-negativo';
  if (score < -0.2) return 'negativo';
  if (score <= 0.2) return 'neutro';
  return 'positivo';
}

export default function DetalleLlamada() {
  const { idLlamada } = useParams();
  const navegar = useNavigate();
  const [llamada, setLlamada] = useState(null);
  const [error, setError] = useState('');
  const [posicion, setPosicion] = useState(null);
  const [urlAudio, setUrlAudio] = useState(null);
  const [errorAudio, setErrorAudio] = useState('');
  const audio = useRef(null);

  useEffect(() => {
    setLlamada(null);
    setError('');
    obtenerLlamada(idLlamada)
      .then(setLlamada)
      .catch((excepcion) => setError(excepcion.message));
  }, [idLlamada]);

  // El audio se descarga con el token y se reproduce desde memoria.
  useEffect(() => {
    if (!llamada?.tiene_audio) return undefined;
    let url = null;
    let cancelado = false;
    obtenerAudio(llamada.id_llamada)
      .then((blob) => {
        if (cancelado) return;
        url = URL.createObjectURL(blob);
        setUrlAudio(url);
      })
      .catch((excepcion) => setErrorAudio(excepcion.message));
    return () => {
      cancelado = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [llamada]);

  function irA(segundo) {
    setPosicion(segundo);
    if (audio.current) {
      audio.current.currentTime = segundo;
      audio.current.play().catch(() => {});
    }
  }

  const volver = (
    <button type="button" className="boton boton--secundario" onClick={() => navegar(-1)}>
      <ArrowLeft size={18} aria-hidden="true" />
      Volver
    </button>
  );

  if (error) {
    return (
      <section>
        {volver}
        <p className="alerta alerta--error" role="alert">
          {error}
        </p>
      </section>
    );
  }
  if (!llamada) return <Cargando texto="Cargando la llamada..." />;

  const { resultado } = llamada;

  return (
    <section className="detalle">
      <div className="encabezado">
        <div>
          <h1 className="detalle__titulo">{llamada.nombre_archivo_original || `Llamada ${llamada.id_llamada}`}</h1>
          <p className="texto-secundario">
            {llamada.agente?.nombre_completo} · {formatoFecha.format(new Date(llamada.fecha_inicio))}
            {llamada.duracion_segundos > 0 && ` · ${formatoTiempo(llamada.duracion_segundos)}`}
            {llamada.codigo_lote && ` · ${llamada.codigo_lote}`}
          </p>
        </div>
        {volver}
      </div>

      {SIMULAR && (
        <p className="alerta alerta--aviso">
          <FlaskConical size={18} aria-hidden="true" />
          Modo de prueba: la transcripcion y los resultados son de ejemplo.
        </p>
      )}

      {llamada.estado_procesamiento === 'ERROR' && (
        <p className="alerta alerta--error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          No se pudo analizar la llamada: {llamada.mensaje_error || 'error desconocido.'}
        </p>
      )}
      {ESTADOS_PENDIENTES[llamada.estado_procesamiento] && (
        <p className="alerta">{ESTADOS_PENDIENTES[llamada.estado_procesamiento]}</p>
      )}

      {resultado && (
        <>
          {llamada.baja_confianza_audio && (
            <p className="alerta alerta--aviso">
              <TriangleAlert size={18} aria-hidden="true" />
              Audio con mucho ruido: el resultado se basa sobre todo en el texto.
            </p>
          )}

          <ResumenResultado resultado={resultado} />

          <div className="tarjeta-panel">
            <h2>Mapa de sentimiento</h2>
            <MapaSentimiento llamada={llamada} posicion={posicion} alSeleccionar={irA} />
            {llamada.tiene_audio ? (
              urlAudio ? (
                <audio
                  ref={audio}
                  className="reproductor"
                  src={urlAudio}
                  controls
                  onTimeUpdate={(evento) => setPosicion(evento.currentTarget.currentTime)}
                />
              ) : (
                <p className="texto-secundario">{errorAudio || 'Cargando el audio...'}</p>
              )
            ) : (
              <p className="texto-secundario reproductor-ausente">
                <Headphones size={16} aria-hidden="true" />
                {SIMULAR ? 'El audio no esta disponible en modo de prueba.' : 'El audio original ya no esta disponible.'}
              </p>
            )}
          </div>

          <div className="detalle__columnas">
            <Transcripcion fragmentos={llamada.transcripcion} posicion={posicion} alSeleccionar={irA} />
            <Alertas alertas={llamada.alertas} alSeleccionar={irA} />
          </div>
        </>
      )}
    </section>
  );
}

function ResumenResultado({ resultado }) {
  const clase = resultado.clasificacion_final.toLowerCase();
  const diagnostico = DIAGNOSTICOS[resultado.diagnostico_conflicto];

  return (
    <div className="resumen-resultado">
      <div className="tarjeta-panel resumen-resultado__puntaje">
        <Odometro valor={resultado.puntaje_final} clase={clase} />
        <span className={`etiqueta etiqueta--${clase}`}>
          {CLASIFICACIONES[resultado.clasificacion_final] ?? resultado.clasificacion_final}
        </span>
      </div>
      <div className="tarjeta-panel">
        <h2>Diagnostico</h2>
        <p className="diagnostico">
          <strong>{diagnostico?.texto ?? resultado.diagnostico_conflicto}</strong>
          <span className="texto-secundario">{diagnostico?.detalle}</span>
        </p>
        <BarraScore etiqueta="Texto (lexico)" valor={resultado.score_global_nlp} />
        <BarraScore etiqueta="Voz (acustico)" valor={resultado.score_acustico} />
      </div>
    </div>
  );
}

// Medidor semicircular del puntaje final (0 a 100).
function Odometro({ valor, clase }) {
  const arco = 'M 10 60 A 50 50 0 0 1 110 60';
  return (
    <figure className="odometro">
      <svg viewBox="0 0 120 68" role="img" aria-label={`Puntaje final ${valor} de 100`}>
        <path d={arco} className="odometro__fondo" pathLength="100" />
        <path
          d={arco}
          className={`odometro__valor odometro__valor--${clase}`}
          pathLength="100"
          strokeDasharray={`${Math.min(100, Math.max(0, valor))} 100`}
        />
      </svg>
      <figcaption>
        <strong>{valor.toFixed(1)}</strong>
        <span className="texto-secundario">de 100</span>
      </figcaption>
    </figure>
  );
}

// Barra de -1 a +1 que crece desde el centro.
function BarraScore({ etiqueta, valor }) {
  const ancho = Math.min(1, Math.abs(valor)) * 50;
  return (
    <div className="barra-score">
      <div className="barra-score__encabezado">
        <span>{etiqueta}</span>
        <strong>{valor > 0 ? `+${valor.toFixed(2)}` : valor.toFixed(2)}</strong>
      </div>
      <div className="barra-score__pista">
        <div
          className={`barra-score__relleno sentimiento--${nivelSentimiento(valor)}`}
          style={{ left: valor < 0 ? `${50 - ancho}%` : '50%', width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

// Una fila por hablante; cada frase es un tramo coloreado segun su sentimiento.
function MapaSentimiento({ llamada, posicion, alSeleccionar }) {
  const duracion = Math.max(1, llamada.duracion_segundos);
  const porcentaje = (segundo) => `${Math.min(100, (segundo / duracion) * 100)}%`;

  return (
    <div className="mapa">
      {['AGENTE', 'CLIENTE'].map((hablante) => (
        <div key={hablante} className="mapa__fila">
          <span className="mapa__hablante">{hablante === 'AGENTE' ? 'Agente' : 'Cliente'}</span>
          <div className="mapa__pista">
            {llamada.transcripcion
              .filter((fragmento) => fragmento.hablante === hablante)
              .map((fragmento) => (
                <button
                  key={fragmento.id_transcripcion}
                  type="button"
                  className={`mapa__tramo sentimiento--${nivelSentimiento(fragmento.score_sentimiento)}`}
                  style={{
                    left: porcentaje(fragmento.timestamp_inicio),
                    width: porcentaje(fragmento.timestamp_fin - fragmento.timestamp_inicio),
                  }}
                  onClick={() => alSeleccionar(fragmento.timestamp_inicio)}
                  title={`${formatoTiempo(fragmento.timestamp_inicio)} · sentimiento ${fragmento.score_sentimiento.toFixed(2)}`}
                  aria-label={`Ir al segundo ${Math.floor(fragmento.timestamp_inicio)}`}
                />
              ))}
            {llamada.alertas
              .filter((alerta) => alerta.origen_evento === hablante)
              .map((alerta) => (
                <span
                  key={alerta.id_alerta}
                  className="mapa__alerta"
                  style={{ left: porcentaje(alerta.timestamp_evento) }}
                  title={`${formatoTiempo(alerta.timestamp_evento)} · ${TIPOS_ALERTA[alerta.tipo_alerta] ?? alerta.tipo_alerta}`}
                />
              ))}
            {posicion !== null && <span className="mapa__cursor" style={{ left: porcentaje(posicion) }} />}
          </div>
        </div>
      ))}
      <div className="mapa__escala texto-secundario">
        <span>00:00</span>
        <span className="mapa__leyenda">
          <i className="sentimiento--positivo" /> Positivo
          <i className="sentimiento--neutro" /> Neutro
          <i className="sentimiento--negativo" /> Negativo
          <i className="sentimiento--muy-negativo" /> Muy negativo
          <i className="mapa__alerta-leyenda" /> Alerta
        </span>
        <span>{formatoTiempo(duracion)}</span>
      </div>
    </div>
  );
}

function Transcripcion({ fragmentos, posicion, alSeleccionar }) {
  return (
    <div className="tarjeta-panel">
      <h2>Transcripcion</h2>
      {fragmentos.length === 0 ? (
        <p className="texto-secundario">No hay transcripcion para esta llamada.</p>
      ) : (
        <ol className="transcripcion">
          {fragmentos.map((fragmento) => {
            const activo =
              posicion !== null && posicion >= fragmento.timestamp_inicio && posicion < fragmento.timestamp_fin;
            const clases = ['frase', `frase--${fragmento.hablante.toLowerCase()}`, activo && 'frase--activa'];
            return (
              <li key={fragmento.id_transcripcion} className={clases.filter(Boolean).join(' ')}>
                <button type="button" className="frase__tiempo" onClick={() => alSeleccionar(fragmento.timestamp_inicio)}>
                  {formatoTiempo(fragmento.timestamp_inicio)}
                </button>
                <div className="frase__cuerpo">
                  <span className="frase__hablante">
                    <i
                      className={`punto sentimiento--${nivelSentimiento(fragmento.score_sentimiento)}`}
                      title={`Sentimiento ${fragmento.score_sentimiento.toFixed(2)}`}
                    />
                    {fragmento.hablante === 'AGENTE' ? 'Agente' : 'Cliente'}
                  </span>
                  <p>{fragmento.texto_transcrito}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Alertas({ alertas, alSeleccionar }) {
  return (
    <div className="tarjeta-panel">
      <h2>Alertas ({alertas.length})</h2>
      {alertas.length === 0 ? (
        <p className="texto-secundario">No se detectaron alertas en esta llamada.</p>
      ) : (
        <ul className="alertas">
          {alertas.map((alerta) => (
            <li key={alerta.id_alerta} className="alerta-llamada">
              <div className="alerta-llamada__encabezado">
                <TriangleAlert size={16} aria-hidden="true" />
                <strong>{TIPOS_ALERTA[alerta.tipo_alerta] ?? alerta.tipo_alerta}</strong>
                <button type="button" className="frase__tiempo" onClick={() => alSeleccionar(alerta.timestamp_evento)}>
                  {formatoTiempo(alerta.timestamp_evento)}
                </button>
              </div>
              <p className="texto-secundario">
                {alerta.origen_evento === 'AGENTE' ? 'Agente' : 'Cliente'}
                {alerta.valor_registrado && ` · ${alerta.valor_registrado}`}
              </p>
              {alerta.mensaje_sugerencia && <p className="alerta-llamada__sugerencia">{alerta.mensaje_sugerencia}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
