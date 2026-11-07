// Panel del Agente: resumen de sus ultimos 30 dias (GET /estadisticas/resumen, que para un
// Agente ya trae solo sus llamadas) y la lista de sus llamadas (GET /llamadas) con filtros.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FlaskConical, TriangleAlert } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { obtenerResumen } from '../api/estadisticas.js';
import { listarLlamadas } from '../api/llamadas.js';
import { SIMULAR_LISTADO } from '../api/simulacion/activa.js';
import { Cargando } from '../componentes/Cargando.jsx';
import { Indicador } from '../componentes/Indicador.jsx';

const DIAS_RESUMEN = 30;
const TAMANO_PAGINA = 10;

const ESTADOS = {
  PENDIENTE: { texto: 'Pendiente', clase: '' },
  PROCESANDO: { texto: 'Procesando', clase: 'etiqueta--procesando' },
  COMPLETADO: { texto: 'Completada', clase: 'etiqueta--completado' },
  ERROR: { texto: 'Error', clase: 'etiqueta--error' },
};

const CLASIFICACIONES = {
  POSITIVO: 'Positiva',
  NEUTRO: 'Neutra',
  NEGATIVO: 'Negativa',
  CRITICO: 'Critica',
};

const FILTROS_VACIOS = { estado: '', clasificacion: '' };

const formatoFecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

// 75 -> "01:15"
function formatoDuracion(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function PanelAgente({ nombre }) {
  return (
    <section className="panel-agente">
      <div className="encabezado">
        <div>
          <h1>{nombre || 'Panel del Agente'}</h1>
          <p className="texto-secundario">Sus resultados y el detalle de cada llamada analizada.</p>
        </div>
      </div>
      <Resumen />
      <MisLlamadas />
    </section>
  );
}

function Resumen() {
  const { usuario } = useSesion();
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    obtenerResumen(DIAS_RESUMEN, usuario)
      .then((datos) => !cancelado && setResumen(datos))
      .catch((excepcion) => !cancelado && setError(excepcion.message));
    return () => {
      cancelado = true;
    };
  }, [usuario]);

  if (error) {
    return (
      <p className="alerta alerta--error" role="alert">
        No se pudo cargar el resumen: {error}
      </p>
    );
  }
  if (!resumen) return <Cargando texto="Cargando el resumen..." />;

  const { llamadas, sentimiento, alertas } = resumen;
  const analizadas = llamadas.por_estado.COMPLETADO;
  return (
    <div>
      <h2 className="panel-agente__subtitulo">Ultimos {DIAS_RESUMEN} dias</h2>
      <ul className="indicadores">
        <Indicador etiqueta="Llamadas analizadas" valor={analizadas} detalle={`de ${llamadas.total} cargadas`} />
        <Indicador
          etiqueta="Puntaje promedio"
          valor={sentimiento.puntaje_promedio === null ? '-' : sentimiento.puntaje_promedio.toFixed(1)}
          detalle="de 100"
        />
        <Indicador
          etiqueta="Llamadas criticas"
          valor={sentimiento.por_clasificacion.CRITICO}
          detalle={`${sentimiento.por_clasificacion.NEGATIVO} ${sentimiento.por_clasificacion.NEGATIVO === 1 ? 'negativa' : 'negativas'}`}
        />
        <Indicador etiqueta="Alertas" valor={alertas.total} />
      </ul>
    </div>
  );
}

function MisLlamadas() {
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    setError('');
    listarLlamadas({ ...filtros, pagina, tamano_pagina: TAMANO_PAGINA })
      .then((datos) => !cancelado && setRespuesta(datos))
      .catch((excepcion) => !cancelado && setError(excepcion.message));
    return () => {
      cancelado = true;
    };
  }, [filtros, pagina]);

  function cambiarFiltro(evento) {
    const { name, value } = evento.target;
    setFiltros((anteriores) => ({ ...anteriores, [name]: value }));
    setPagina(1);
  }

  const hayFiltros = filtros.estado || filtros.clasificacion;

  return (
    <div className="tarjeta-panel">
      <div className="panel-agente__barra">
        <h2>Mis llamadas</h2>
        <div className="filtros">
          <label className="campo">
            <span>Estado</span>
            <select name="estado" value={filtros.estado} onChange={cambiarFiltro}>
              <option value="">Todos</option>
              {Object.entries(ESTADOS).map(([valor, { texto }]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Clasificacion</span>
            <select name="clasificacion" value={filtros.clasificacion} onChange={cambiarFiltro}>
              <option value="">Todas</option>
              {Object.entries(CLASIFICACIONES).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {SIMULAR_LISTADO && (
        <p className="alerta alerta--aviso">
          <FlaskConical size={18} aria-hidden="true" />
          Modo de prueba: esta lista es de ejemplo hasta que el backend tenga GET /llamadas. El detalle no
          esta disponible.
        </p>
      )}

      {error && (
        <p className="alerta alerta--error" role="alert">
          {error}
        </p>
      )}
      {!error && !respuesta && <Cargando texto="Cargando sus llamadas..." />}
      {!error && respuesta && (
        <>
          {respuesta.llamadas.length === 0 ? (
            <p className="vacio">
              {hayFiltros ? 'Ninguna llamada cumple los filtros.' : 'Todavia no tiene llamadas cargadas.'}
            </p>
          ) : (
            <TablaLlamadas llamadas={respuesta.llamadas} />
          )}
          <Paginacion respuesta={respuesta} alCambiar={setPagina} />
        </>
      )}
    </div>
  );
}

function TablaLlamadas({ llamadas }) {
  return (
    <div className="tabla-contenedor">
      <table className="tabla tabla--compacta">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Llamada</th>
            <th className="numero">Duracion</th>
            <th>Estado</th>
            <th className="numero">Puntaje</th>
            <th>Clasificacion</th>
            <th className="numero">Alertas</th>
          </tr>
        </thead>
        <tbody>
          {llamadas.map((llamada) => {
            const estado = ESTADOS[llamada.estado_procesamiento] ?? ESTADOS.PENDIENTE;
            const { resultado } = llamada;
            // En modo de prueba la llamada no existe en el backend: sin enlace al detalle.
            const conDetalle = resultado && !SIMULAR_LISTADO;
            return (
              <tr key={llamada.id_llamada}>
                <td>{formatoFecha.format(new Date(llamada.fecha_inicio))}</td>
                <td>
                  <div className="usuario-celda">
                    {conDetalle ? (
                      <Link to={`/llamadas/${llamada.id_llamada}`} className="enlace">
                        {llamada.nombre_archivo_original}
                      </Link>
                    ) : (
                      <span>{llamada.nombre_archivo_original}</span>
                    )}
                    <span className="texto-secundario">{llamada.codigo_lote}</span>
                  </div>
                </td>
                <td className="numero">{resultado ? formatoDuracion(llamada.duracion_segundos) : '-'}</td>
                <td>
                  <span className={`etiqueta ${estado.clase}`} title={llamada.mensaje_error ?? undefined}>
                    {estado.texto}
                  </span>
                </td>
                <td className="numero">{resultado ? resultado.puntaje_final.toFixed(1) : '-'}</td>
                <td>
                  {resultado ? (
                    <span className="clasificacion-celda">
                      <span className={`etiqueta etiqueta--${resultado.clasificacion_final.toLowerCase()}`}>
                        {CLASIFICACIONES[resultado.clasificacion_final] ?? resultado.clasificacion_final}
                      </span>
                      {llamada.baja_confianza_audio && (
                        <span
                          className="icono-aviso"
                          role="img"
                          aria-label="Audio con mucho ruido"
                          title="Audio con mucho ruido: el resultado se basa sobre todo en el texto."
                        >
                          <TriangleAlert size={14} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="texto-secundario">-</span>
                  )}
                </td>
                <td className="numero">{resultado ? llamada.total_alertas : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Paginacion({ respuesta, alCambiar }) {
  const { pagina, total_paginas: totalPaginas, total } = respuesta;
  if (totalPaginas <= 1) {
    return total > 0 ? <p className="texto-secundario paginacion">{total} llamadas</p> : null;
  }
  return (
    <nav className="paginacion" aria-label="Paginas">
      <span className="texto-secundario">
        Pagina {pagina} de {totalPaginas} · {total} llamadas
      </span>
      <div className="paginacion__botones">
        <button
          type="button"
          className="boton boton--secundario boton--chico"
          onClick={() => alCambiar(pagina - 1)}
          disabled={pagina <= 1}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Anterior
        </button>
        <button
          type="button"
          className="boton boton--secundario boton--chico"
          onClick={() => alCambiar(pagina + 1)}
          disabled={pagina >= totalPaginas}
        >
          Siguiente
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
