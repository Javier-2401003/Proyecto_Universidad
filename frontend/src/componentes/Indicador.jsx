// Numero destacado con su etiqueta y un detalle opcional. Va dentro de <ul className="indicadores">.
export function Indicador({ etiqueta, valor, detalle }) {
  return (
    <li className="indicador">
      <span className="indicador__etiqueta">{etiqueta}</span>
      <strong className="indicador__valor">{valor}</strong>
      {detalle && <span className="texto-secundario indicador__detalle">{detalle}</span>}
    </li>
  );
}
