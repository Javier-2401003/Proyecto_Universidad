// Busqueda historica (modulo BUSQUEDA_HISTORICA): llamadas con filtros (GET /llamadas,
// docs/api.md "Listado de llamadas"). Los filtros y la pagina viven en la direccion
// (/busqueda?clasificacion=CRITICO&pagina=2), asi que al volver del detalle se conservan.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, RotateCcw, Search } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { listarAgentesDelListado, listarLlamadas } from '../api/llamadas.js';
import { SIMULAR_LISTADO } from '../api/simulacion/activa.js';
import { Cargando } from '../componentes/Cargando.jsx';
import {
  CLASIFICACIONES,
  DIAGNOSTICOS,
  ESTADOS,
  Paginacion,
  TablaLlamadas,
} from '../componentes/ListaLlamadas.jsx';

const TAMANO_PAGINA = 20;
const CAMPOS = ['desde', 'hasta', 'id_agente', 'estado', 'clasificacion', 'diagnostico', 'buscar'];
const FILTROS_VACIOS = Object.fromEntries(CAMPOS.map((campo) => [campo, '']));

function filtrosDe(parametros) {
  return Object.fromEntries(CAMPOS.map((campo) => [campo, parametros.get(campo) ?? '']));
}

export default function BusquedaHistorica({ nombre }) {
  const { usuario } = useSesion();
  const [parametros, setParametros] = useSearchParams();
  // Lo que el usuario esta escribiendo; se aplica al pulsar Buscar.
  const [borrador, setBorrador] = useState(() => filtrosDe(parametros));
  const [agentes, setAgentes] = useState([]);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState(null);

  const consulta = parametros.toString();
  const pagina = Number(parametros.get('pagina') ?? 1);

  useEffect(() => {
    listarAgentesDelListado()
      .then(setAgentes)
      .catch(() => setAgentes([]));
  }, []);

  // Si la direccion cambia (atras / adelante del navegador), el formulario la sigue.
  useEffect(() => {
    setBorrador(filtrosDe(new URLSearchParams(consulta)));
  }, [consulta]);

  useEffect(() => {
    let cancelado = false;
    setRespuesta(null);
    setError(null);
    const aplicados = filtrosDe(new URLSearchParams(consulta));
    listarLlamadas({ ...aplicados, pagina, tamano_pagina: TAMANO_PAGINA }, usuario)
      .then((datos) => !cancelado && setRespuesta(datos))
      .catch((excepcion) => !cancelado && setError(excepcion));
    return () => {
      cancelado = true;
    };
  }, [consulta, pagina, usuario]);

  function aplicar(filtros, nuevaPagina = 1) {
    const usados = Object.entries(filtros).filter(([, valor]) => valor.trim() !== '');
    if (nuevaPagina > 1) usados.push(['pagina', String(nuevaPagina)]);
    setParametros(new URLSearchParams(usados));
  }

  function cambiar(evento) {
    const { name, value } = evento.target;
    setBorrador((anteriores) => ({ ...anteriores, [name]: value }));
  }

  function alBuscar(evento) {
    evento.preventDefault();
    aplicar(borrador);
  }

  const hayFiltros = CAMPOS.some((campo) => parametros.get(campo));

  return (
    <section className="busqueda">
      <div className="encabezado">
        <div>
          <h1>{nombre || 'Busqueda historica'}</h1>
          <p className="texto-secundario">Llamadas de los agentes que puede ver, de la mas reciente a la mas antigua.</p>
        </div>
      </div>

      <form className="formulario busqueda__filtros" onSubmit={alBuscar}>
        <div className="busqueda__rejilla">
          <label className="campo">
            <span>Desde</span>
            <input type="date" name="desde" value={borrador.desde} max={borrador.hasta || undefined} onChange={cambiar} />
          </label>
          <label className="campo">
            <span>Hasta</span>
            <input type="date" name="hasta" value={borrador.hasta} min={borrador.desde || undefined} onChange={cambiar} />
          </label>
          <label className="campo">
            <span>Agente</span>
            <select name="id_agente" value={borrador.id_agente} onChange={cambiar}>
              <option value="">Todos</option>
              {agentes.map((agente) => (
                <option key={agente.id_usuario} value={String(agente.id_usuario)}>
                  {agente.nombre_completo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Estado</span>
            <select name="estado" value={borrador.estado} onChange={cambiar}>
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
            <select name="clasificacion" value={borrador.clasificacion} onChange={cambiar}>
              <option value="">Todas</option>
              {Object.entries(CLASIFICACIONES).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Diagnostico</span>
            <select name="diagnostico" value={borrador.diagnostico} onChange={cambiar}>
              <option value="">Todos</option>
              {Object.entries(DIAGNOSTICOS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo busqueda__texto">
            <span>Nombre del archivo</span>
            <input
              type="search"
              name="buscar"
              value={borrador.buscar}
              onChange={cambiar}
              minLength={2}
              maxLength={100}
              placeholder="Por ejemplo, llamada_0"
            />
          </label>
        </div>
        <div className="formulario__acciones">
          <button
            type="button"
            className="boton boton--secundario"
            onClick={() => {
              setBorrador(FILTROS_VACIOS);
              aplicar(FILTROS_VACIOS);
            }}
            disabled={!hayFiltros}
          >
            <RotateCcw size={18} aria-hidden="true" />
            Limpiar
          </button>
          <button type="submit" className="boton boton--primario">
            <Search size={18} aria-hidden="true" />
            Buscar
          </button>
        </div>
      </form>

      {SIMULAR_LISTADO && (
        <p className="alerta alerta--aviso">
          <FlaskConical size={18} aria-hidden="true" />
          Modo de prueba: los resultados son de ejemplo hasta que el backend tenga GET /llamadas. El detalle no
          esta disponible.
        </p>
      )}

      {error && (
        <div className="alerta alerta--error" role="alert">
          <span>
            {error.message}
            {error.detalles?.length > 0 && ` ${error.detalles.map((d) => d.mensaje).join(' ')}`}
          </span>
        </div>
      )}
      {!error && !respuesta && <Cargando texto="Buscando llamadas..." />}
      {!error && respuesta && (
        <div className="tarjeta-panel">
          {respuesta.llamadas.length === 0 ? (
            <p className="vacio">
              {hayFiltros ? 'Ninguna llamada cumple los filtros.' : 'Todavia no hay llamadas cargadas.'}
            </p>
          ) : (
            <TablaLlamadas llamadas={respuesta.llamadas} mostrarAgente mostrarDiagnostico mostrarDuracion={false} />
          )}
          <Paginacion respuesta={respuesta} alCambiar={(nueva) => aplicar(filtrosDe(parametros), nueva)} />
        </div>
      )}
    </section>
  );
}
