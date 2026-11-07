// Tabla y paginacion de una respuesta de GET /llamadas (docs/api.md, "Listado de llamadas").
// La usan el Panel del Agente y la Busqueda historica; la Auditoria usa solo la paginacion.
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { SIMULAR_LISTADO } from '../api/simulacion/activa.js';

export const ESTADOS = {
  PENDIENTE: { texto: 'Pendiente', clase: '' },
  PROCESANDO: { texto: 'Procesando', clase: 'etiqueta--procesando' },
  COMPLETADO: { texto: 'Completada', clase: 'etiqueta--completado' },
  ERROR: { texto: 'Error', clase: 'etiqueta--error' },
};

export const CLASIFICACIONES = {
  POSITIVO: 'Positiva',
  NEUTRO: 'Neutra',
  NEGATIVO: 'Negativa',
  CRITICO: 'Critica',
};

export const DIAGNOSTICOS = {
  SIN_CONFLICTO: 'Sin conflicto',
  CLIENTE_PROBLEMATICO: 'Cliente problematico',
  FALLA_AGENTE: 'Falla del agente',
};

const formatoDia = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const formatoHora = new Intl.DateTimeFormat('es', { timeStyle: 'short' });

// 75 -> "01:15"
function formatoDuracion(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// mostrarAgente y mostrarDiagnostico agregan esas columnas (la Busqueda historica las usa);
// mostrarDuracion: false la quita para que la tabla quepa con las columnas extra.
export function TablaLlamadas({ llamadas, mostrarAgente = false, mostrarDiagnostico = false, mostrarDuracion = true }) {
  return (
    <div className="tabla-contenedor">
      <table className="tabla tabla--compacta">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Llamada</th>
            {mostrarAgente && <th>Agente</th>}
            {mostrarDuracion && <th className="numero">Duracion</th>}
            <th>Estado</th>
            <th className="numero">Puntaje</th>
            <th>Clasificacion</th>
            {mostrarDiagnostico && <th>Diagnostico</th>}
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
                <td>
                  <div className="usuario-celda">
                    <span>{formatoDia.format(new Date(llamada.fecha_inicio))}</span>
                    <span className="texto-secundario">{formatoHora.format(new Date(llamada.fecha_inicio))}</span>
                  </div>
                </td>
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
                {mostrarAgente && <td className="celda-ajustable">{llamada.agente?.nombre_completo}</td>}
                {mostrarDuracion && (
                  <td className="numero">{resultado ? formatoDuracion(llamada.duracion_segundos) : '-'}</td>
                )}
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
                {mostrarDiagnostico && (
                  <td className="celda-ajustable">
                    {resultado ? (
                      DIAGNOSTICOS[resultado.diagnostico_conflicto] ?? resultado.diagnostico_conflicto
                    ) : (
                      <span className="texto-secundario">-</span>
                    )}
                  </td>
                )}
                <td className="numero">{resultado ? llamada.total_alertas : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// unidades: singular y plural de lo que se cuenta ("1 llamada", "57 llamadas").
export function Paginacion({ respuesta, alCambiar, unidades = ['llamada', 'llamadas'] }) {
  const { pagina, total_paginas: totalPaginas, total } = respuesta;
  const textoTotal = (cantidad) => `${cantidad} ${cantidad === 1 ? unidades[0] : unidades[1]}`;
  if (totalPaginas <= 1) {
    return total > 0 ? <p className="texto-secundario paginacion">{textoTotal(total)}</p> : null;
  }
  return (
    <nav className="paginacion" aria-label="Paginas">
      <span className="texto-secundario">
        Pagina {pagina} de {totalPaginas} · {textoTotal(total)}
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
