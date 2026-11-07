// Panel del Agente: resumen de sus ultimos 30 dias (GET /estadisticas/resumen, que para un
// Agente ya trae solo sus llamadas) y la lista de sus llamadas (GET /llamadas) con filtros.
import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { obtenerResumen } from '../api/estadisticas.js';
import { listarLlamadas } from '../api/llamadas.js';
import { SIMULAR_LISTADO } from '../api/simulacion/activa.js';
import { Cargando } from '../componentes/Cargando.jsx';
import { Indicador } from '../componentes/Indicador.jsx';
import { CLASIFICACIONES, ESTADOS, Paginacion, TablaLlamadas } from '../componentes/ListaLlamadas.jsx';

const DIAS_RESUMEN = 30;
const TAMANO_PAGINA = 10;

const FILTROS_VACIOS = { estado: '', clasificacion: '' };

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
  const { usuario } = useSesion();
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    setError('');
    listarLlamadas({ ...filtros, pagina, tamano_pagina: TAMANO_PAGINA }, usuario)
      .then((datos) => !cancelado && setRespuesta(datos))
      .catch((excepcion) => !cancelado && setError(excepcion.message));
    return () => {
      cancelado = true;
    };
  }, [filtros, pagina, usuario]);

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
