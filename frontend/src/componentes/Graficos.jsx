// Graficos compartidos por el inicio, el Dashboard y los Reportes.

export const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);

// Orden y color de cada clasificacion: los mismos de las etiquetas del detalle de una llamada.
export const SERIES_CLASIFICACION = [
  { clave: 'POSITIVO', texto: 'Positivas', clase: 'serie--exito' },
  { clave: 'NEUTRO', texto: 'Neutras', clase: 'serie--neutro' },
  { clave: 'NEGATIVO', texto: 'Negativas', clase: 'serie--negativo' },
  { clave: 'CRITICO', texto: 'Criticas', clase: 'serie--error' },
];

// Clase de color (semaforo) de una llamada analizada segun su clasificacion.
export const claseClasificacion = (clasificacion) =>
  SERIES_CLASIFICACION.find((serie) => serie.clave === clasificacion)?.clase ?? 'serie--neutro';

export // Una barra horizontal dividida por categoria. La leyenda repite cada valor, asi
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
