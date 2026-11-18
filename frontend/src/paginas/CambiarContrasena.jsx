// Cambiar la contrasena propia (PATCH /auth/password, docs/api.md "Contrasenas"). Para todos los
// roles; se abre desde la barra superior. El token actual sigue valido hasta que vence.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { cambiarPassword } from '../api/auth.js';
import { erroresDeApi, erroresPasswordNueva } from '../contrasenas.js';

const VACIO = { password_actual: '', password_nueva: '', confirmacion: '' };

export default function CambiarContrasena() {
  const navegar = useNavigate();
  const [datos, setDatos] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);

  function cambiar(evento) {
    const { name, value } = evento.target;
    setDatos((anteriores) => ({ ...anteriores, [name]: value }));
    setErrores((anteriores) => ({ ...anteriores, [name]: undefined, general: undefined }));
    setListo(false);
  }

  async function alEnviar(evento) {
    evento.preventDefault();
    const locales = erroresPasswordNueva(datos.password_nueva, datos.confirmacion);
    if (datos.password_actual === '') locales.password_actual = 'Escriba su contrasena actual.';
    if (Object.keys(locales).length > 0) {
      setErrores(locales);
      return;
    }
    setEnviando(true);
    try {
      await cambiarPassword(datos.password_actual, datos.password_nueva);
      setDatos(VACIO);
      setErrores({});
      setListo(true);
    } catch (excepcion) {
      setErrores(erroresDeApi(excepcion));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cambiar-contrasena">
      <div className="encabezado">
        <div>
          <h1>Cambiar contrasena</h1>
          <p className="texto-secundario">Use al menos 8 caracteres. La sesion actual sigue abierta.</p>
        </div>
        <button type="button" className="boton boton--secundario" onClick={() => navegar(-1)}>
          <ArrowLeft size={18} aria-hidden="true" />
          Volver
        </button>
      </div>

      {listo && (
        <p className="alerta alerta--exito" role="status">
          La contrasena se cambio correctamente. Use la nueva la proxima vez que inicie sesion.
        </p>
      )}

      <form className="formulario" onSubmit={alEnviar} noValidate>
        <div className="cambiar-contrasena__campos">
          <Campo etiqueta="Contrasena actual" error={errores.password_actual}>
            <input
              name="password_actual"
              type="password"
              autoComplete="current-password"
              value={datos.password_actual}
              onChange={cambiar}
            />
          </Campo>
          <Campo etiqueta="Contrasena nueva" error={errores.password_nueva}>
            <input
              name="password_nueva"
              type="password"
              autoComplete="new-password"
              value={datos.password_nueva}
              onChange={cambiar}
            />
          </Campo>
          <Campo etiqueta="Repita la contrasena nueva" error={errores.confirmacion}>
            <input
              name="confirmacion"
              type="password"
              autoComplete="new-password"
              value={datos.confirmacion}
              onChange={cambiar}
            />
          </Campo>
        </div>

        {errores.general && (
          <p className="alerta alerta--error" role="alert">
            {errores.general}
          </p>
        )}

        <div className="formulario__acciones">
          <button type="submit" className="boton boton--primario" disabled={enviando}>
            <KeyRound size={18} aria-hidden="true" />
            {enviando ? 'Cambiando...' : 'Cambiar contrasena'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Campo({ etiqueta, error, children }) {
  return (
    <label className={error ? 'campo campo--error' : 'campo'}>
      <span>{etiqueta}</span>
      {children}
      {error && <small className="campo__error">{error}</small>}
    </label>
  );
}
