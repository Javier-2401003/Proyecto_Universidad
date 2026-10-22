import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AudioLines, LogIn } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { Cargando } from '../componentes/Cargando.jsx';

export default function Login() {
  const { usuario, cargando, entrar } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  if (cargando) return <Cargando texto="Comprobando la sesion..." pantallaCompleta />;
  if (usuario) return <Navigate to="/" replace />;

  async function alEnviar(evento) {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await entrar(correo.trim(), password);
      navegar(ubicacion.state?.desde || '/', { replace: true });
    } catch (excepcion) {
      setError(excepcion.message);
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <form className="login__tarjeta" onSubmit={alEnviar}>
        <div className="login__marca">
          <AudioLines size={32} aria-hidden="true" />
          <h1>VocalAnalytics</h1>
        </div>
        <p className="texto-secundario">Inicie sesion para continuar</p>

        <label className="campo">
          <span>Correo electronico</span>
          <input
            type="email"
            autoComplete="username"
            required
            maxLength={150}
            value={correo}
            onChange={(evento) => setCorreo(evento.target.value)}
          />
        </label>

        <label className="campo">
          <span>Contrasena</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
          />
        </label>

        {error && (
          <p className="alerta alerta--error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="boton boton--primario boton--ancho" disabled={enviando}>
          <LogIn size={18} aria-hidden="true" />
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
