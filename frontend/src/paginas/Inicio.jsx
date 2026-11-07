// Pagina de inicio: estadisticas de las llamadas que el usuario puede ver
// (contrato en docs/api.md, "Estadisticas del inicio") y accesos a sus modulos.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, TriangleAlert } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { modulosVisibles } from '../modulos.js';
import { PERIODOS, obtenerResumen } from '../api/estadisticas.js';
import { SIMULAR_ESTADISTICAS as SIMULAR } from '../api/simulacion/activa.js';
import { Cargando } from '../componentes/Cargando.jsx';
import { Indicador } from '../componentes/Indicador.jsx';

// Orden y color de cada barra apilada. Los colores son los mismos de las etiquetas
// de carga de lotes y del detalle de una llamada.
const ESTADOS = [
  { clave: 'COMPLETADO', texto: 'Completadas', clase: 'serie--exito' },
  { clave: 'PROCESANDO', texto: 'Procesando', clase: 'serie--primario' },
  { clave: 'PENDIENTE', texto: 'Pendientes', clase: 'serie--neutro' },
  { clave: 'ERROR', texto: 'Con error', clase: 'serie--error' },
];

const CLASIFICACIONES = [
  { clave: 'POSITIVO', texto: 'Positivas', clase: 'serie--exito' },
  { clave: 'NEUTRO', texto: 'Neutras', clase: 'serie--neutro' },
  { clave: 'NEGATIVO', texto: 'Negativas', clase: 'serie--negativo' },
  { clave: 'CRITICO', texto: 'Criticas', clase: 'serie--error' },
];

const TIPOS_ALERTA = {
  EXCESO_VOLUMEN: 'Exceso de volumen',
  ALTERACION_TONO: 'Alteracion de tono',
  VOCABULARIO_INADECUADO: 'Vocabulario inadecuado',
  OMISION_SCRIPT: 'Omision del guion',
};

const formatoFecha = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const formatoNumero = new Intl.NumberFormat('es');

// "2026-11-03" -> fecha local (sin que la zona horaria la mueva un dia).
const fechaLocal = (iso) => new Date(`${iso}T00:00:00`);
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);

export default function Inicio() {
  const { usuario } = useSesion();
  const modulos = modulosVisibles(usuario.permisos);
  const [dias, setDias] = useState(30);
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;
    setResumen(null);
    setError('');
    obtenerResumen(dias, usuario)
      .then((datos) => !cancelado && setResumen(datos))
      .catch((excepcion) => !cancelado && setError(excepcion.message));
    return () => {
      cancelado = true;
    };
  }, [dias, usuario]);

  // El Agente solo ve sus propias llamadas: la tabla por agente no le aporta nada.
  const veOtrosAgentes = usuario.roles?.some((rol) => rol === 'SUPERADMIN' || rol === 'SUPERVISOR');

  return (
    <section className="inicio">
      <div className="encabezado">
        <div>
          <h1>Bienvenido, {usuario.nombre}</h1>
          <p className="texto-secundario">
            {resumen
              ? `Resumen del ${formatoFecha.format(fechaLocal(resumen.periodo.desde))} al ${formatoFecha.format(fechaLocal(resumen.periodo.hasta))}.`
              : 'Resumen de las llamadas que puede ver.'}
          </p>
        </div>
        <div className="selector-periodo" role="group" aria-label="Periodo">
          {PERIODOS.map((opcion) => (
            <button
              key={opcion}
              type="button"
              className={opcion === dias ? 'selector-periodo__opcion selector-periodo__opcion--activa' : 'selector-periodo__opcion'}
              aria-pressed={opcion === dias}
              onClick={() => setDias(opcion)}
            >
              {opcion} dias
            </button>
          ))}
        </div>
      </div>

      {SIMULAR && (
        <p className="alerta alerta--aviso">
          <FlaskConical size={18} aria-hidden="true" />
          Modo de prueba: las estadisticas son de ejemplo.
        </p>
      )}

      {error && (
        <p className="alerta alerta--error" role="alert">
          No se pudieron cargar las estadisticas: {error}
        </p>
      )}
      {!error && !resumen && <Cargando texto="Cargando estadisticas..." />}
      {resumen && <Estadisticas resumen={resumen} veOtrosAgentes={veOtrosAgentes} />}

      <h2 className="inicio__subtitulo">Sus modulos</h2>
      {modulos.length === 0 ? (
        <p className="alerta">Su usuario no tiene modulos asignados. Contacte al administrador.</p>
      ) : (
        <ul className="tarjetas">
          {modulos.map(({ codigo, ruta, nombre, icono: Icono }) => (
            <li key={codigo}>
              <Link to={ruta} className="tarjeta">
                <Icono size={24} aria-hidden="true" />
                <span>{nombre}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Estadisticas({ resumen, veOtrosAgentes }) {
  const { llamadas, sentimiento, alertas, agentes } = resumen;
  const completadas = llamadas.por_estado.COMPLETADO;

  if (llamadas.total === 0) {
    return <p className="vacio">No hay llamadas en este periodo.</p>;
  }

  return (
    <>
      <ul className="indicadores">
        <Indicador etiqueta="Llamadas" valor={formatoNumero.format(llamadas.total)} />
        <Indicador
          etiqueta="Analizadas"
          valor={formatoNumero.format(completadas)}
          detalle={`${porcentaje(completadas, llamadas.total)} % del total`}
        />
        <Indicador
          etiqueta="Puntaje promedio"
          valor={sentimiento.puntaje_promedio === null ? '-' : sentimiento.puntaje_promedio.toFixed(1)}
          detalle="de 100"
        />
        <Indicador
          etiqueta="Alertas"
          valor={formatoNumero.format(alertas.total)}
          detalle={completadas > 0 ? `${(alertas.total / completadas).toFixed(1)} por llamada analizada` : undefined}
        />
      </ul>

      <div className="inicio__graficos">
        <div className="tarjeta-panel">
          <h2>Llamadas por estado</h2>
          <BarraApilada series={ESTADOS} valores={llamadas.por_estado} total={llamadas.total} unidad="llamadas" />
        </div>
        <div className="tarjeta-panel">
          <h2>Sentimiento de las llamadas analizadas</h2>
          {completadas === 0 ? (
            <p className="texto-secundario">Todavia no hay llamadas analizadas en este periodo.</p>
          ) : (
            <>
              <BarraApilada
                series={CLASIFICACIONES}
                valores={sentimiento.por_clasificacion}
                total={completadas}
                unidad="llamadas analizadas"
              />
              {sentimiento.baja_confianza_audio > 0 && (
                <p className="texto-secundario nota-grafico">
                  <TriangleAlert size={14} aria-hidden="true" />
                  {sentimiento.baja_confianza_audio} con audio ruidoso (resultado basado sobre todo en el texto).
                </p>
              )}
            </>
          )}
        </div>
        <div className="tarjeta-panel">
          <h2>Alertas por tipo</h2>
          <BarrasAlertas porTipo={alertas.por_tipo} />
        </div>
      </div>

      {veOtrosAgentes && (
        <div className="tarjeta-panel">
          <h2>Por agente</h2>
          <TablaAgentes agentes={agentes} />
        </div>
      )}
    </>
  );
}

// Una barra horizontal dividida por categoria. La leyenda repite cada valor, asi
// que el color nunca es la unica forma de leerlo.
function BarraApilada({ series, valores, total, unidad }) {
  const descripcion = series.map(({ clave, texto }) => `${texto}: ${valores[clave]}`).join(', ');
  return (
    <div className="barra-apilada">
      <div className="barra-apilada__pista" role="img" aria-label={`${descripcion} (de ${total} ${unidad})`}>
        {series
          .filter(({ clave }) => valores[clave] > 0)
          .map(({ clave, texto, clase }) => (
            <span
              key={clave}
              className={`barra-apilada__tramo ${clase}`}
              style={{ flexGrow: valores[clave] }}
              title={`${texto}: ${valores[clave]} (${porcentaje(valores[clave], total)} %)`}
            />
          ))}
      </div>
      <ul className="leyenda">
        {series.map(({ clave, texto, clase }) => (
          <li key={clave}>
            <i className={clase} aria-hidden="true" />
            <span>{texto}</span>
            <strong>{valores[clave]}</strong>
            <span className="texto-secundario">{porcentaje(valores[clave], total)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Barras horizontales de un solo color, de mayor a menor, con el valor al final.
function BarrasAlertas({ porTipo }) {
  const filas = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);
  const maximo = Math.max(1, ...filas.map(([, cantidad]) => cantidad));

  if (filas.every(([, cantidad]) => cantidad === 0)) {
    // Las alertas llegan con la v0.3 del contrato de audio; hasta entonces siempre seran 0.
    return (
      <p className="texto-secundario">
        Sin alertas registradas. La deteccion automatica de alertas todavia no esta disponible.
      </p>
    );
  }

  return (
    <ul className="barras">
      {filas.map(([tipo, cantidad]) => (
        <li key={tipo} className="barras__fila">
          <span className="barras__etiqueta">{TIPOS_ALERTA[tipo] ?? tipo}</span>
          <span className="barras__pista">
            <span className="barras__relleno" style={{ width: `${(cantidad / maximo) * 100}%` }} />
          </span>
          <strong className="barras__valor">{cantidad}</strong>
        </li>
      ))}
    </ul>
  );
}

// Primero los agentes con menor puntaje promedio: son los que mas necesitan apoyo.
function TablaAgentes({ agentes }) {
  if (agentes.length === 0) {
    return <p className="texto-secundario">Ningun agente tiene llamadas en este periodo.</p>;
  }

  const ordenados = [...agentes].sort(
    (a, b) => (a.puntaje_promedio ?? Infinity) - (b.puntaje_promedio ?? Infinity)
  );

  return (
    <div className="tabla-contenedor">
      <table className="tabla tabla--compacta">
        <thead>
          <tr>
            <th>Agente</th>
            <th className="numero">Analizadas</th>
            <th>Puntaje promedio</th>
            <th className="numero">Criticas</th>
            <th className="numero">Alertas</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((agente) => (
            <tr key={agente.id_usuario}>
              <td>{agente.nombre_completo}</td>
              <td className="numero">{agente.llamadas_completadas}</td>
              <td>
                {agente.puntaje_promedio === null ? (
                  <span className="texto-secundario">Sin analizar</span>
                ) : (
                  <span className="medidor">
                    <span className="medidor__pista">
                      <span className="medidor__relleno" style={{ width: `${agente.puntaje_promedio}%` }} />
                    </span>
                    {agente.puntaje_promedio.toFixed(1)}
                  </span>
                )}
              </td>
              <td className="numero">{agente.llamadas_criticas}</td>
              <td className="numero">{agente.alertas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
