import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
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
