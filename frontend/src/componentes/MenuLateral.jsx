import { NavLink } from 'react-router-dom';
import { AudioLines, LayoutDashboard } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { modulosVisibles } from '../modulos.js';

// Solo muestra los modulos que el usuario puede leer (usuario.permisos).
export function MenuLateral() {
  const { usuario } = useSesion();
  const modulos = modulosVisibles(usuario.permisos);

  return (
    <nav className="menu" aria-label="Menu principal">
      <div className="menu__marca">
        <AudioLines size={24} aria-hidden="true" />
        <span>VocalAnalytics</span>
      </div>
      <ul>
        <li>
          <NavLink to="/" end className="menu__enlace">
            <LayoutDashboard size={18} aria-hidden="true" />
            Inicio
          </NavLink>
        </li>
        {modulos.map(({ codigo, ruta, nombre, icono: Icono }) => (
          <li key={codigo}>
            <NavLink to={ruta} className="menu__enlace">
              <Icono size={18} aria-hidden="true" />
              {nombre}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
