// Envuelve una pantalla: sin sesion lleva al login; sin permiso sobre el modulo
// lleva al inicio. El backend vuelve a comprobar el permiso en cada peticion.
import { Navigate, useLocation } from 'react-router-dom';
import { useSesion } from './SesionContexto.jsx';
import { Cargando } from '../componentes/Cargando.jsx';

export function RutaProtegida({ modulo, children }) {
  const { usuario, cargando, tienePermiso } = useSesion();
  const ubicacion = useLocation();

  if (cargando) return <Cargando texto="Comprobando la sesion..." pantallaCompleta />;
  if (!usuario) return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />;
  if (modulo && !tienePermiso(modulo, 'leer')) return <Navigate to="/" replace />;

  return children;
}
