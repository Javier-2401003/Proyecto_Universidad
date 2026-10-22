// Gestion de usuarios: lista para quien puede leer el modulo y formulario de
// creacion para quien puede escribir. Editar y desactivar llegan cuando el
// backend tenga esos endpoints.
import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { crearUsuario, listarUsuarios } from '../api/usuarios.js';
import { Cargando } from '../componentes/Cargando.jsx';

// Roles base de 02_datos_iniciales.sql (el backend aun no tiene un endpoint de roles).
const ROLES = [
  { valor: 'AGENTE', texto: 'Agente' },
  { valor: 'SUPERVISOR', texto: 'Supervisor' },
  { valor: 'SUPERADMIN', texto: 'SuperAdmin' },
];

const FORMULARIO_VACIO = { nombre_completo: '', correo_electronico: '', password: '', rol: 'AGENTE' };

const formatoFecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

export default function GestionUsuarios({ nombre }) {
  const { tienePermiso } = useSesion();
  const puedeCrear = tienePermiso('GESTION_USUARIOS', 'escribir');

  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState('');
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorLista('');
    try {
      setUsuarios(await listarUsuarios());
    } catch (excepcion) {
      setErrorLista(excepcion.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function alCrear(correo) {
    setMostrarFormulario(false);
    setAviso(`Usuario ${correo} creado correctamente.`);
    cargar();
  }

  return (
    <section>
      <div className="encabezado">
        <h1>{nombre || 'Gestion de usuarios'}</h1>
        <div className="encabezado__acciones">
          <button type="button" className="boton boton--secundario" onClick={cargar} disabled={cargando}>
            <RefreshCw size={18} aria-hidden="true" />
            Actualizar
          </button>
          {puedeCrear && !mostrarFormulario && (
            <button
              type="button"
              className="boton boton--primario"
              onClick={() => {
                setAviso('');
                setMostrarFormulario(true);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {aviso && (
        <p className="alerta alerta--exito" role="status">
          {aviso}
        </p>
      )}

      {mostrarFormulario && (
        <FormularioUsuario alCrear={alCrear} alCancelar={() => setMostrarFormulario(false)} />
      )}

      {errorLista && (
        <p className="alerta alerta--error" role="alert">
          {errorLista}
        </p>
      )}

      {cargando ? (
        <Cargando texto="Cargando usuarios..." />
      ) : (
        !errorLista && <TablaUsuarios usuarios={usuarios} />
      )}
    </section>
  );
}

function TablaUsuarios({ usuarios }) {
  if (usuarios.length === 0) {
    return <p className="vacio">No hay usuarios registrados.</p>;
  }

  return (
    <div className="tabla-contenedor">
      <table className="tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Correo</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Creado</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((usuario) => (
            <tr key={usuario.id_usuario}>
              <td>{usuario.nombre_completo}</td>
              <td>{usuario.correo_electronico}</td>
              <td>{usuario.roles.join(', ') || '-'}</td>
              <td>
                <span className={`etiqueta etiqueta--${usuario.estado.toLowerCase()}`}>{usuario.estado}</span>
              </td>
              <td>{formatoFecha.format(new Date(usuario.fecha_creacion))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Campo del formulario al que corresponde cada codigo de error del backend.
const CAMPO_POR_CODIGO = {
  CORREO_DUPLICADO: 'correo_electronico',
  ROL_INEXISTENTE: 'rol',
};

function FormularioUsuario({ alCrear, alCancelar }) {
  const [datos, setDatos] = useState(FORMULARIO_VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [enviando, setEnviando] = useState(false);

  function cambiar(evento) {
    const { name, value } = evento.target;
    setDatos((anteriores) => ({ ...anteriores, [name]: value }));
    setErrores((anteriores) => ({ ...anteriores, [name]: undefined }));
  }

  async function alEnviar(evento) {
    evento.preventDefault();
    setErrores({});
    setErrorGeneral('');
    setEnviando(true);
    try {
      await crearUsuario({ ...datos, nombre_completo: datos.nombre_completo.trim() });
      alCrear(datos.correo_electronico.trim().toLowerCase());
    } catch (excepcion) {
      setEnviando(false);
      // DATOS_INVALIDOS trae un mensaje por campo; los demas errores, uno solo.
      if (excepcion.detalles?.length) {
        setErrores(Object.fromEntries(excepcion.detalles.map((d) => [d.campo, d.mensaje])));
      } else if (CAMPO_POR_CODIGO[excepcion.codigo]) {
        setErrores({ [CAMPO_POR_CODIGO[excepcion.codigo]]: excepcion.message });
      } else {
        setErrorGeneral(excepcion.message);
      }
    }
  }

  return (
    <form className="formulario" onSubmit={alEnviar}>
      <div className="formulario__titulo">
        <h2>Nuevo usuario</h2>
        <button type="button" className="boton boton--icono" onClick={alCancelar} aria-label="Cerrar formulario">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="formulario__rejilla">
        <Campo etiqueta="Nombre completo" error={errores.nombre_completo}>
          <input name="nombre_completo" required minLength={2} maxLength={100} value={datos.nombre_completo} onChange={cambiar} />
        </Campo>
        <Campo etiqueta="Correo electronico" error={errores.correo_electronico}>
          <input name="correo_electronico" type="email" required maxLength={150} value={datos.correo_electronico} onChange={cambiar} />
        </Campo>
        <Campo etiqueta="Contrasena (minimo 8 caracteres)" error={errores.password}>
          <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={datos.password} onChange={cambiar} />
        </Campo>
        <Campo etiqueta="Rol" error={errores.rol}>
          <select name="rol" value={datos.rol} onChange={cambiar}>
            {ROLES.map((rol) => (
              <option key={rol.valor} value={rol.valor}>
                {rol.texto}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {errorGeneral && (
        <p className="alerta alerta--error" role="alert">
          {errorGeneral}
        </p>
      )}

      <div className="formulario__acciones">
        <button type="button" className="boton boton--secundario" onClick={alCancelar}>
          Cancelar
        </button>
        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Creando...' : 'Crear usuario'}
        </button>
      </div>
    </form>
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
