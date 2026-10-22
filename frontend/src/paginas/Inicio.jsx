import { Link } from 'react-router-dom';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { modulosVisibles } from '../modulos.js';

export default function Inicio() {
  const { usuario } = useSesion();
  const modulos = modulosVisibles(usuario.permisos);

  return (
    <section>
      <h1>Bienvenido, {usuario.nombre}</h1>
      <p className="texto-secundario">Estos son los modulos a los que tiene acceso.</p>

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
