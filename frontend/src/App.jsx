import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './sesion/SesionContexto.jsx';
import { RutaProtegida } from './sesion/RutaProtegida.jsx';
import { Layout } from './componentes/Layout.jsx';
import { MODULOS } from './modulos.js';
import Login from './paginas/Login.jsx';
import Inicio from './paginas/Inicio.jsx';

export default function App() {
  const { usuario } = useSesion();

  // Nombre visible del modulo segun el backend (ej. "Panel del Agente").
  const nombreDe = (codigo) => usuario?.permisos.find((p) => p.modulo === codigo)?.nombre ?? '';

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RutaProtegida>
            <Layout />
          </RutaProtegida>
        }
      >
        <Route index element={<Inicio />} />
        {MODULOS.map(({ codigo, ruta, pantalla: Pantalla }) => (
          <Route
            key={codigo}
            path={ruta}
            element={
              <RutaProtegida modulo={codigo}>
                <Pantalla nombre={nombreDe(codigo)} />
              </RutaProtegida>
            }
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
