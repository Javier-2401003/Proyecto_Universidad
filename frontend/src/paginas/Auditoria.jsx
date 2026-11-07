// Registro de auditoria (modulo AUDITORIA, solo lectura): quien hizo que, cuando, en que
// modulo y desde que IP (GET /auditoria, docs/api.md). Los filtros y la pagina viven en la
// direccion, como en la Busqueda historica.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RotateCcw, Search } from 'lucide-react';
import { listarAuditoria } from '../api/auditoria.js';
import { listarUsuarios } from '../api/usuarios.js';
import { Cargando } from '../componentes/Cargando.jsx';
import { Paginacion } from '../componentes/ListaLlamadas.jsx';

const TAMANO_PAGINA = 25;
const CAMPOS = ['id_usuario', 'accion', 'modulo', 'desde', 'hasta'];
const FILTROS_VACIOS = Object.fromEntries(CAMPOS.map((campo) => [campo, '']));

// Las acciones que existen hoy (tabla del contrato). Una nueva se muestra con su codigo.
const ACCIONES = {
  CREACION_USUARIO: 'Creacion de usuario',
  EDICION_USUARIO: 'Edicion de usuario',
  CAMBIO_ESTADO_USUARIO: 'Cambio de estado',
  ASIGNACION_SUPERVISOR: 'Asignacion de supervisor',
  CARGA_LOTE: 'Carga de lote',
  PROCESAMIENTO_LLAMADA: 'Analisis de llamada',
};

const MODULOS = {
  GESTION_USUARIOS: 'Gestion de usuarios',
  CARGA_LOTES: 'Carga de lotes',
  DASHBOARD_VIVO: 'Dashboard',
  BUSQUEDA_HISTORICA: 'Busqueda historica',
  REPORTES: 'Reportes',
  PANEL_AGENTE: 'Panel del agente',
  AUDITORIA: 'Auditoria',
};

const CAMPOS_EDITABLES = { nombre_completo: 'nombre', correo_electronico: 'correo', rol: 'rol' };
const NOMBRES_ROL = { AGENTE: 'Agente', SUPERVISOR: 'Supervisor', SUPERADMIN: 'SuperAdmin' };
const ESTADOS_USUARIO = { ACTIVO: 'activo', INACTIVO: 'inactivo' };

const formatoDia = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const formatoHora = new Intl.DateTimeFormat('es', { timeStyle: 'medium' });

function filtrosDe(parametros) {
  return Object.fromEntries(CAMPOS.map((campo) => [campo, parametros.get(campo) ?? '']));
}

export default function Auditoria({ nombre }) {
  const [parametros, setParametros] = useSearchParams();
  const [borrador, setBorrador] = useState(() => filtrosDe(parametros));
  // id -> nombre, para mostrar nombres en lugar de ids en el detalle.
  const [usuarios, setUsuarios] = useState([]);
  const [respuesta, setRespuesta] = useState(null);
  const [error, setError] = useState(null);

  const consulta = parametros.toString();
  const pagina = Number(parametros.get('pagina') ?? 1);

  // GET /usuarios necesita GESTION_USUARIOS leer (el SuperAdmin lo tiene). Sin el, el
  // filtro por usuario y los nombres del detalle se quedan con los ids.
  useEffect(() => {
    listarUsuarios()
      .then(setUsuarios)
      .catch(() => setUsuarios([]));
  }, []);

  useEffect(() => {
    setBorrador(filtrosDe(new URLSearchParams(consulta)));
  }, [consulta]);

  useEffect(() => {
    let cancelado = false;
    setRespuesta(null);
    setError(null);
    const aplicados = filtrosDe(new URLSearchParams(consulta));
    listarAuditoria({ ...aplicados, pagina, tamano_pagina: TAMANO_PAGINA })
      .then((datos) => !cancelado && setRespuesta(datos))
      .catch((excepcion) => !cancelado && setError(excepcion));
    return () => {
      cancelado = true;
    };
  }, [consulta, pagina]);

  function aplicar(filtros, nuevaPagina = 1) {
    const usados = Object.entries(filtros).filter(([, valor]) => valor.trim() !== '');
    if (nuevaPagina > 1) usados.push(['pagina', String(nuevaPagina)]);
    setParametros(new URLSearchParams(usados));
  }

  function cambiar(evento) {
    const { name, value } = evento.target;
    setBorrador((anteriores) => ({ ...anteriores, [name]: value }));
  }

  const hayFiltros = CAMPOS.some((campo) => parametros.get(campo));
  const nombrePorId = new Map(usuarios.map((u) => [u.id_usuario, u.nombre_completo]));

  return (
    <section className="busqueda">
      <div className="encabezado">
        <div>
          <h1>{nombre || 'Registro de auditoria'}</h1>
          <p className="texto-secundario">Quien hizo cada cambio, cuando y desde donde. Solo lectura.</p>
        </div>
      </div>

      <form
        className="formulario busqueda__filtros"
        onSubmit={(evento) => {
          evento.preventDefault();
          aplicar(borrador);
        }}
      >
        <div className="busqueda__rejilla">
          <label className="campo">
            <span>Usuario</span>
            <select name="id_usuario" value={borrador.id_usuario} onChange={cambiar}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id_usuario} value={String(u.id_usuario)}>
                  {u.nombre_completo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Accion</span>
            <select name="accion" value={borrador.accion} onChange={cambiar}>
              <option value="">Todas</option>
              {Object.entries(ACCIONES).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Modulo</span>
            <select name="modulo" value={borrador.modulo} onChange={cambiar}>
              <option value="">Todos</option>
              {Object.entries(MODULOS).map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Desde</span>
            <input type="date" name="desde" value={borrador.desde} max={borrador.hasta || undefined} onChange={cambiar} />
          </label>
          <label className="campo">
            <span>Hasta</span>
            <input type="date" name="hasta" value={borrador.hasta} min={borrador.desde || undefined} onChange={cambiar} />
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

      {error && (
        <div className="alerta alerta--error" role="alert">
          <span>
            {error.message}
            {error.detalles?.length > 0 && ` ${error.detalles.map((d) => d.mensaje).join(' ')}`}
          </span>
        </div>
      )}
      {!error && !respuesta && <Cargando texto="Cargando el registro..." />}
      {!error && respuesta && (
        <div className="tarjeta-panel">
          {respuesta.registros.length === 0 ? (
            <p className="vacio">{hayFiltros ? 'Ningun registro cumple los filtros.' : 'Todavia no hay registros.'}</p>
          ) : (
            <TablaAuditoria registros={respuesta.registros} nombrePorId={nombrePorId} />
          )}
          <Paginacion
            respuesta={respuesta}
            alCambiar={(nueva) => aplicar(filtrosDe(parametros), nueva)}
            unidades={['registro', 'registros']}
          />
        </div>
      )}
    </section>
  );
}

function TablaAuditoria({ registros, nombrePorId }) {
  return (
    <div className="tabla-contenedor">
      <table className="tabla tabla--compacta">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Accion</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {registros.map((registro) => {
            const fecha = new Date(registro.fecha_evento);
            return (
              <tr key={registro.id_log}>
                <td>
                  <div className="usuario-celda">
                    <span>{formatoDia.format(fecha)}</span>
                    <span className="texto-secundario">{formatoHora.format(fecha)}</span>
                  </div>
                </td>
                <td>
                  <div className="usuario-celda">
                    <span>{registro.usuario.nombre_completo}</span>
                    <span className="texto-secundario">{registro.usuario.correo_electronico}</span>
                    <span className="texto-secundario">IP {registro.direccion_ip}</span>
                  </div>
                </td>
                <td>
                  <div className="usuario-celda">
                    <span>{ACCIONES[registro.accion_ejecutada] ?? registro.accion_ejecutada}</span>
                    <span className="texto-secundario">
                      {MODULOS[registro.modulo_afectado] ?? registro.modulo_afectado}
                    </span>
                  </div>
                </td>
                <td
                  className="auditoria__detalle"
                  title={registro.detalle_cambio ? JSON.stringify(registro.detalle_cambio) : undefined}
                >
                  <Detalle registro={registro} nombrePorId={nombrePorId} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Una frase legible por accion (las formas de detalle_cambio estan en cada endpoint de
// docs/api.md). Una accion desconocida se muestra como el JSON guardado. Al pasar el mouse
// sobre la celda se ve el JSON completo.
function Detalle({ registro, nombrePorId }) {
  const d = registro.detalle_cambio;
  if (!d) return <span className="texto-secundario">-</span>;
  const persona = (id) => (id == null ? 'ninguno' : (nombrePorId.get(id) ?? `usuario #${id}`));
  const valor = (campo, v) => (campo === 'rol' ? (NOMBRES_ROL[v] ?? v) : v);

  switch (registro.accion_ejecutada) {
    case 'CREACION_USUARIO':
      return `Creo a ${persona(d.id_usuario_creado)} con rol ${NOMBRES_ROL[d.rol] ?? d.rol}.`;
    case 'EDICION_USUARIO':
      return `${persona(d.id_usuario)}: ${Object.entries(d.cambios ?? {})
        .map(([campo, { anterior, nuevo }]) => `${CAMPOS_EDITABLES[campo] ?? campo} ${valor(campo, anterior)} → ${valor(campo, nuevo)}`)
        .join('; ')}.`;
    case 'CAMBIO_ESTADO_USUARIO':
      return `${persona(d.id_usuario)}: ${ESTADOS_USUARIO[d.estado_anterior] ?? d.estado_anterior} → ${
        ESTADOS_USUARIO[d.estado_nuevo] ?? d.estado_nuevo
      }.`;
    case 'ASIGNACION_SUPERVISOR':
      return `Agente ${persona(d.id_agente)}: supervisor ${persona(d.id_supervisor_anterior)} → ${persona(d.id_supervisor_nuevo)}.`;
    case 'CARGA_LOTE':
      return `Lote #${d.id_lote}: ${d.total_archivos} audios de ${persona(d.id_agente)}.`;
    case 'PROCESAMIENTO_LLAMADA':
      return (
        <>
          <Link to={`/llamadas/${d.id_llamada}`} className="enlace">
            Llamada #{d.id_llamada}
          </Link>
          {d.estado_procesamiento === 'COMPLETADO'
            ? `: analizada (${d.segmentos} segmentos, contrato v${d.version_contrato}).`
            : `: error. ${d.mensaje_error ?? ''}`}
        </>
      );
    default:
      return <code className="auditoria__json">{JSON.stringify(d)}</code>;
  }
}
