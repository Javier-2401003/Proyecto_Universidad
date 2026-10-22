// Estado de la sesion compartido por toda la aplicacion: quien esta conectado y
// que modulos puede usar.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { iniciarSesion, obtenerSesion } from '../api/auth.js';
import { borrarToken, obtenerToken, registrarPerdidaDeSesion } from '../api/cliente.js';

const SesionContexto = createContext(null);

export function SesionProveedor({ children }) {
  const [usuario, setUsuario] = useState(null);
  // Si hay un token guardado, hay que preguntar al backend antes de decidir.
  const [cargando, setCargando] = useState(() => Boolean(obtenerToken()));

  useEffect(() => {
    registrarPerdidaDeSesion(() => setUsuario(null));
    if (!obtenerToken()) return;

    obtenerSesion()
      .then(setUsuario)
      .catch(() => {
        borrarToken();
        setUsuario(null);
      })
      .finally(() => setCargando(false));
  }, []);

  const entrar = useCallback(async (correo, password) => {
    setUsuario(await iniciarSesion(correo, password));
  }, []);

  const salir = useCallback(() => {
    borrarToken();
    setUsuario(null);
  }, []);

  const tienePermiso = useCallback(
    (modulo, accion = 'leer') =>
      Boolean(usuario?.permisos.some((permiso) => permiso.modulo === modulo && permiso[accion])),
    [usuario]
  );

  const valor = useMemo(
    () => ({ usuario, cargando, entrar, salir, tienePermiso }),
    [usuario, cargando, entrar, salir, tienePermiso]
  );

  return <SesionContexto.Provider value={valor}>{children}</SesionContexto.Provider>;
}

export function useSesion() {
  const contexto = useContext(SesionContexto);
  if (!contexto) {
    throw new Error('useSesion debe usarse dentro de <SesionProveedor>.');
  }
  return contexto;
}
