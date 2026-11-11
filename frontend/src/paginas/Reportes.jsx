// Reportes (modulo REPORTES: SuperAdmin y Supervisor). Junta las llamadas del periodo con
// GET /llamadas (docs/api.md) y calcula en el navegador el resumen ejecutivo, el desempeno por
// agente, la tendencia semanal y las llamadas criticas. Se descarga en CSV o se guarda como PDF
// con la impresion del navegador. Cada usuario solo recibe las llamadas que el backend le permite.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileText, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { listarAgentesDelListado, listarTodasLasLlamadas } from '../api/llamadas.js';
import { Cargando } from '../componentes/Cargando.jsx';
import { Indicador } from '../componentes/Indicador.jsx';
import { BarraApilada, SERIES_CLASIFICACION, porcentaje } from '../componentes/Graficos.jsx';
import { CLASIFICACIONES, DIAGNOSTICOS, ESTADOS } from '../componentes/ListaLlamadas.jsx';

// Tope de llamadas por reporte (20 paginas de GET /llamadas). Si hay mas, se avisa.
const LIMITE = 2000;
const DIAS_POR_DEFECTO = 30;

const formatoDia = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const formatoFechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

// Fecha local en formato AAAA-MM-DD.
function iso(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}
const fechaLocal = (texto) => new Date(`${texto}T00:00:00`);

function periodoPorDefecto() {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - (DIAS_POR_DEFECTO - 1));
  return { desde: iso(desde), hasta: iso(hasta), id_agente: '' };
}

const promedio = (valores) => (valores.length === 0 ? null : valores.reduce((s, v) => s + v, 0) / valores.length);
const decimal = (valor) => (valor === null ? '-' : valor.toFixed(1));

// Lunes de la semana de una fecha, en AAAA-MM-DD.
function lunesDe(fechaIso) {
  const fecha = new Date(fechaIso);
  const desplazamiento = (fecha.getDay() + 6) % 7;
  fecha.setDate(fecha.getDate() - desplazamiento);
  return iso(fecha);
}

// Calcula todo el reporte a partir de las llamadas. Ver "Como se calcula" al pie de la pantalla.
function calcularReporte(llamadas) {
  const analizadas = llamadas.filter((l) => l.resultado);
  const porClasificacion = Object.fromEntries(SERIES_CLASIFICACION.map(({ clave }) => [clave, 0]));
  for (const l of analizadas) porClasificacion[l.resultado.clasificacion_final] += 1;

  const porAgente = new Map();
  for (const l of llamadas) {
    const clave = l.agente?.id_usuario;
    if (!porAgente.has(clave)) porAgente.set(clave, { agente: l.agente, llamadas: [] });
    porAgente.get(clave).llamadas.push(l);
  }
  const agentes = [...porAgente.values()]
    .map(({ agente, llamadas: propias }) => {
      const suyas = propias.filter((l) => l.resultado);
      const cuenta = (clase) => suyas.filter((l) => l.resultado.clasificacion_final === clase).length;
      // El indice de calidad no cuenta las llamadas en que el conflicto lo causo el cliente.
      const atribuibles = suyas.filter((l) => l.resultado.diagnostico_conflicto !== 'CLIENTE_PROBLEMATICO');
      return {
        agente,
        analizadas: suyas.length,
        positivas: cuenta('POSITIVO'),
        neutras: cuenta('NEUTRO'),
        negativas: cuenta('NEGATIVO'),
        criticas: cuenta('CRITICO'),
        puntaje: promedio(suyas.map((l) => l.resultado.puntaje_final)),
        calidad: promedio(atribuibles.map((l) => l.resultado.puntaje_final)),
        fallas: suyas.filter((l) => l.resultado.diagnostico_conflicto === 'FALLA_AGENTE').length,
        alertas: suyas.reduce((s, l) => s + l.total_alertas, 0),
      };
    })
    .sort((a, b) => (a.calidad ?? Infinity) - (b.calidad ?? Infinity));

  const porSemana = new Map();
  for (const l of analizadas) {
    const lunes = lunesDe(l.fecha_inicio);
    if (!porSemana.has(lunes)) porSemana.set(lunes, []);
    porSemana.get(lunes).push(l);
  }
  let anterior = null;
  const semanas = [...porSemana.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lunes, suyas]) => {
      const puntaje = promedio(suyas.map((l) => l.resultado.puntaje_final));
      const malas = suyas.filter((l) => ['NEGATIVO', 'CRITICO'].includes(l.resultado.clasificacion_final)).length;
      const fila = {
        lunes,
        analizadas: suyas.length,
        puntaje,
        malas: porcentaje(malas, suyas.length),
        variacion: anterior === null ? null : puntaje - anterior,
      };
      anterior = puntaje;
      return fila;
    });

  const criticas = analizadas
    .filter((l) => l.resultado.clasificacion_final === 'CRITICO')
    .sort((a, b) => a.resultado.puntaje_final - b.resultado.puntaje_final);

  return {
    total: llamadas.length,
    analizadas: analizadas.length,
    errores: llamadas.filter((l) => l.estado_procesamiento === 'ERROR').length,
    enCola: llamadas.filter((l) => ['PENDIENTE', 'PROCESANDO'].includes(l.estado_procesamiento)).length,
    puntaje: promedio(analizadas.map((l) => l.resultado.puntaje_final)),
    porClasificacion,
    alertas: analizadas.reduce((s, l) => s + l.total_alertas, 0),
    bajaConfianza: analizadas.filter((l) => l.baja_confianza_audio).length,
    agentes,
    semanas,
    criticas,
  };
}

// CSV con una fila por llamada. Separado por ";" y con BOM, para que Excel en espanol lo abra
// con las columnas y las tildes bien.
function descargarCsv(llamadas, nombreArchivo) {
  const columnas = [
    ['id_llamada', (l) => l.id_llamada],
    ['fecha', (l) => l.fecha_inicio],
    ['archivo', (l) => l.nombre_archivo_original],
    ['lote', (l) => l.codigo_lote],
    ['agente', (l) => l.agente?.nombre_completo],
    ['estado', (l) => l.estado_procesamiento],
    ['puntaje_final', (l) => l.resultado?.puntaje_final],
    ['clasificacion', (l) => l.resultado?.clasificacion_final],
    ['diagnostico', (l) => l.resultado?.diagnostico_conflicto],
    ['alertas', (l) => (l.resultado ? l.total_alertas : '')],
    ['baja_confianza_audio', (l) => (l.resultado ? (l.baja_confianza_audio ? 'si' : 'no') : '')],
    ['duracion_segundos', (l) => (l.resultado ? l.duracion_segundos : '')],
    ['mensaje_error', (l) => l.mensaje_error],
  ];
  const celda = (valor) => {
    const texto = valor == null ? '' : String(valor);
    return /[;"\n\r]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
  };
  const lineas = [
    columnas.map(([nombre]) => nombre).join(';'),
    ...llamadas.map((l) => columnas.map(([, valor]) => celda(valor(l))).join(';')),
  ];
  const archivo = new Blob([`﻿${lineas.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}

export default function Reportes({ nombre }) {
  const { usuario } = useSesion();
  const [parametros, setParametros] = useSearchParams();
  const aplicados = {
    desde: parametros.get('desde') ?? periodoPorDefecto().desde,
    hasta: parametros.get('hasta') ?? periodoPorDefecto().hasta,
    id_agente: parametros.get('id_agente') ?? '',
  };
  const consulta = `${aplicados.desde}|${aplicados.hasta}|${aplicados.id_agente}`;
  const [borrador, setBorrador] = useState(aplicados);
  const [agentes, setAgentes] = useState([]);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [generado, setGenerado] = useState(null);

  useEffect(() => {
    listarAgentesDelListado()
      .then(setAgentes)
      .catch(() => setAgentes([]));
  }, []);

  useEffect(() => {
    const [desde, hasta, idAgente] = consulta.split('|');
    setBorrador({ desde, hasta, id_agente: idAgente });
    let cancelado = false;
    setDatos(null);
    setError(null);
    listarTodasLasLlamadas({ desde, hasta, id_agente: idAgente }, usuario, LIMITE)
      .then((respuesta) => {
        if (cancelado) return;
        setDatos(respuesta);
        setGenerado(new Date());
      })
      .catch((excepcion) => !cancelado && setError(excepcion));
    return () => {
      cancelado = true;
    };
  }, [consulta, usuario]);

  function cambiar(evento) {
    const { name, value } = evento.target;
    setBorrador((anteriores) => ({ ...anteriores, [name]: value }));
  }

  function aplicar(filtros) {
    setParametros(new URLSearchParams(Object.entries(filtros).filter(([, valor]) => valor !== '')));
  }

  const agenteElegido = agentes.find((a) => String(a.id_usuario) === aplicados.id_agente);
  const descripcionFiltros = `Del ${formatoDia.format(fechaLocal(aplicados.desde))} al ${formatoDia.format(
    fechaLocal(aplicados.hasta)
  )} · ${agenteElegido ? agenteElegido.nombre_completo : 'Todos los agentes visibles'}`;
  const reporte = datos && datos.llamadas.length > 0 ? calcularReporte(datos.llamadas) : null;

  return (
    <section className="busqueda reporte">
      <div className="encabezado">
        <div>
          <h1>{nombre || 'Reportes'}</h1>
          <p className="texto-secundario">{descripcionFiltros}</p>
          {generado && (
            <p className="texto-secundario reporte__generado">
              Generado el {formatoFechaHora.format(generado)} por {usuario.nombre}
            </p>
          )}
        </div>
        <div className="encabezado__acciones solo-pantalla">
          <button
            type="button"
            className="boton boton--secundario"
            disabled={!reporte}
            onClick={() =>
              descargarCsv(datos.llamadas, `reporte_llamadas_${aplicados.desde}_${aplicados.hasta}.csv`)
            }
          >
            <Download size={18} aria-hidden="true" />
            Descargar CSV
          </button>
          <button type="button" className="boton boton--secundario" disabled={!reporte} onClick={() => window.print()}>
            <FileText size={18} aria-hidden="true" />
            Guardar PDF
          </button>
        </div>
      </div>

      <form
        className="formulario busqueda__filtros solo-pantalla"
        onSubmit={(evento) => {
          evento.preventDefault();
          aplicar(borrador);
        }}
      >
        <div className="busqueda__rejilla">
          <label className="campo">
            <span>Desde</span>
            <input type="date" name="desde" required value={borrador.desde} max={borrador.hasta} onChange={cambiar} />
          </label>
          <label className="campo">
            <span>Hasta</span>
            <input type="date" name="hasta" required value={borrador.hasta} min={borrador.desde} onChange={cambiar} />
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
        </div>
        <div className="formulario__acciones">
          <button type="button" className="boton boton--secundario" onClick={() => aplicar(periodoPorDefecto())}>
            <RotateCcw size={18} aria-hidden="true" />
            Ultimos {DIAS_POR_DEFECTO} dias
          </button>
          <button type="submit" className="boton boton--primario">
            <Search size={18} aria-hidden="true" />
            Generar reporte
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
      {!error && !datos && <Cargando texto="Generando el reporte..." />}
      {!error && datos && !reporte && <p className="vacio">No hay llamadas para los filtros seleccionados.</p>}
      {reporte && (
        <>
          {datos.recortado && (
            <p className="alerta alerta--aviso">
              <TriangleAlert size={18} aria-hidden="true" />
              El periodo tiene {datos.total} llamadas; el reporte usa las {LIMITE} mas recientes. Acorte el periodo para
              incluirlas todas.
            </p>
          )}
          <ResumenEjecutivo reporte={reporte} />
          <DesempenoPorAgente agentes={reporte.agentes} />
          <TendenciaSemanal semanas={reporte.semanas} />
          <LlamadasCriticas criticas={reporte.criticas} />
          <ComoSeCalcula />
        </>
      )}
    </section>
  );
}

function ResumenEjecutivo({ reporte }) {
  const { porClasificacion } = reporte;
  return (
    <div className="tarjeta-panel reporte__seccion">
      <h2>Resumen ejecutivo</h2>
      <ul className="indicadores">
        <Indicador
          etiqueta="Llamadas analizadas"
          valor={reporte.analizadas}
          detalle={`de ${reporte.total} cargadas${reporte.errores ? `; ${reporte.errores} con error` : ''}${
            reporte.enCola ? `; ${reporte.enCola} en cola` : ''
          }`}
        />
        <Indicador etiqueta="Puntaje promedio" valor={decimal(reporte.puntaje)} detalle="de 100" />
        <Indicador
          etiqueta="Llamadas criticas"
          valor={porClasificacion.CRITICO}
          detalle={`${porcentaje(porClasificacion.CRITICO, reporte.analizadas)} % de las analizadas`}
        />
        <Indicador
          etiqueta="Alertas"
          valor={reporte.alertas}
          detalle={`${reporte.bajaConfianza} con audio de baja confianza`}
        />
      </ul>
      {reporte.analizadas > 0 && (
        <div className="reporte__barra">
          <h3>Distribucion de satisfaccion</h3>
          <BarraApilada
            series={SERIES_CLASIFICACION}
            valores={porClasificacion}
            total={reporte.analizadas}
            unidad="llamadas analizadas"
          />
        </div>
      )}
    </div>
  );
}

function DesempenoPorAgente({ agentes }) {
  return (
    <div className="tarjeta-panel reporte__seccion">
      <h2>Desempeno por agente</h2>
      <p className="texto-secundario reporte__nota">Primero los de menor indice de calidad.</p>
      <div className="tabla-contenedor">
        <table className="tabla tabla--compacta tabla--titulos-ajustables">
          <thead>
            <tr>
              <th>Agente</th>
              <th className="numero">Analizadas</th>
              <th className="numero">Positivas</th>
              <th className="numero">Neutras</th>
              <th className="numero">Negativas</th>
              <th className="numero">Criticas</th>
              <th className="numero">Puntaje</th>
              <th className="numero">Indice de calidad</th>
              <th className="numero">Fallas del agente</th>
              <th className="numero">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {agentes.map((fila) => (
              <tr key={fila.agente?.id_usuario ?? 'sin-agente'}>
                <td className="celda-ajustable">{fila.agente?.nombre_completo ?? '-'}</td>
                <td className="numero">{fila.analizadas}</td>
                <td className="numero">{fila.positivas}</td>
                <td className="numero">{fila.neutras}</td>
                <td className="numero">{fila.negativas}</td>
                <td className="numero">{fila.criticas}</td>
                <td className="numero">{decimal(fila.puntaje)}</td>
                <td className="numero">
                  <strong>{decimal(fila.calidad)}</strong>
                </td>
                <td className="numero">{fila.fallas}</td>
                <td className="numero">{fila.alertas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TendenciaSemanal({ semanas }) {
  return (
    <div className="tarjeta-panel reporte__seccion">
      <h2>Tendencia semanal</h2>
      {semanas.length === 0 ? (
        <p className="texto-secundario">No hay llamadas analizadas en el periodo.</p>
      ) : (
        <div className="tabla-contenedor">
          <table className="tabla tabla--compacta">
            <thead>
              <tr>
                <th>Semana del</th>
                <th className="numero">Analizadas</th>
                <th className="numero">Puntaje promedio</th>
                <th className="numero">Variacion</th>
                <th className="numero">Negativas y criticas</th>
              </tr>
            </thead>
            <tbody>
              {semanas.map((semana) => (
                <tr key={semana.lunes}>
                  <td>{formatoDia.format(fechaLocal(semana.lunes))}</td>
                  <td className="numero">{semana.analizadas}</td>
                  <td className="numero">{decimal(semana.puntaje)}</td>
                  <td className="numero">
                    {semana.variacion === null ? (
                      <span className="texto-secundario">-</span>
                    ) : (
                      `${semana.variacion > 0 ? '+' : ''}${semana.variacion.toFixed(1)}`
                    )}
                  </td>
                  <td className="numero">{semana.malas} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LlamadasCriticas({ criticas }) {
  return (
    <div className="tarjeta-panel reporte__seccion">
      <h2>Llamadas criticas ({criticas.length})</h2>
      {criticas.length === 0 ? (
        <p className="texto-secundario">No hubo llamadas criticas en el periodo.</p>
      ) : (
        <div className="tabla-contenedor">
          <table className="tabla tabla--compacta">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Llamada</th>
                <th>Agente</th>
                <th className="numero">Puntaje</th>
                <th>Diagnostico</th>
                <th className="numero">Alertas</th>
              </tr>
            </thead>
            <tbody>
              {criticas.map((llamada) => (
                <tr key={llamada.id_llamada}>
                  <td>{formatoFechaHora.format(new Date(llamada.fecha_inicio))}</td>
                  <td>
                    <Link to={`/llamadas/${llamada.id_llamada}`} className="enlace">
                      {llamada.nombre_archivo_original}
                    </Link>
                  </td>
                  <td className="celda-ajustable">{llamada.agente?.nombre_completo}</td>
                  <td className="numero">{llamada.resultado.puntaje_final.toFixed(1)}</td>
                  <td className="celda-ajustable">
                    {DIAGNOSTICOS[llamada.resultado.diagnostico_conflicto] ?? llamada.resultado.diagnostico_conflicto}
                  </td>
                  <td className="numero">{llamada.total_alertas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ComoSeCalcula() {
  return (
    <div className="reporte__definiciones texto-secundario">
      <h3>Como se calcula</h3>
      <ul>
        <li>
          El periodo cuenta por <strong>fecha de carga</strong> del audio. Solo las llamadas{' '}
          {ESTADOS.COMPLETADO.texto.toLowerCase()}s tienen puntaje, clasificacion y alertas.
        </li>
        <li>
          Clasificacion ({Object.values(CLASIFICACIONES).join(', ')}): la del analisis de audio, con los cortes
          provisionales 35 y 65 (acuerdo del 11/11/2026).
        </li>
        <li>
          <strong>Llamadas criticas:</strong> llamadas con clasificacion Critica, contadas una vez por llamada.
        </li>
        <li>
          <strong>Indice de calidad del agente:</strong> promedio del puntaje final sin contar las llamadas
          diagnosticadas como cliente problematico, para no castigar al agente por el cliente.
        </li>
        <li>
          <strong>Variacion:</strong> diferencia del puntaje promedio contra la semana anterior del mismo reporte.
        </li>
        <li>El cumplimiento del guion todavia no se mide: la omision del guion aun no se detecta.</li>
      </ul>
    </div>
  );
}
