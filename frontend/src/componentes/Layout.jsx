import { Link, Outlet } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { MenuLateral } from './MenuLateral.jsx';

export function Layout() {
  const { usuario, salir } = useSesion();

  return (
    <div className="disposicion">
      <MenuLateral />
      <div className="disposicion__principal">
        <header className="barra-superior">
          <div className="barra-superior__usuario">
            <strong>{usuario.nombre}</strong>
            <span className="texto-secundario">{usuario.roles.join(', ')}</span>
          </div>
          <Link
            to="/cuenta/contrasena"
            className="boton boton--secundario"
            title="Cambiar contrasena"
            aria-label="Cambiar contrasena"
          >
            <KeyRound size={18} aria-hidden="true" />
            <span className="barra-superior__texto">Cambiar contrasena</span>
          </Link>
          <button type="button" className="boton boton--secundario" onClick={salir}>
            <LogOut size={18} aria-hidden="true" />
            Cerrar sesion
          </button>
        </header>
        <main className="contenido">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
