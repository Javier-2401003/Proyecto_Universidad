// Gestion de usuarios (contrato en docs/api.md): lista para quien puede leer el modulo;
// crear, editar, asignar supervisor y activar o desactivar para quien puede escribir.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Power, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import {
  asignarSupervisor,
  cambiarEstado,
  crearUsuario,
  editarUsuario,
  listarRoles,
  listarUsuarios,
} from '../api/usuarios.js';
import { Cargando } from '../componentes/Cargando.jsx';

// Nombre visible de cada rol; un rol nuevo en TB_Rol se muestra con su codigo.
const NOMBRES_ROL = { AGENTE: 'Agente', SUPERVISOR: 'Supervisor', SUPERADMIN: 'SuperAdmin' };
const nombreRol = (rol) => NOMBRES_ROL[rol] ?? rol;

const SIN_SUPERVISOR = '';

const formatoFecha = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

export default function GestionUsuarios({ nombre }) {
  const { usuario: sesion, tienePermiso } = useSesion();
  const puedeEscribir = tienePermiso('GESTION_USUARIOS', 'escribir');

  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState('');
  // null: sin formulario; { modo: 'crear' } o { modo: 'editar', usuario }.
  const [formulario, setFormulario] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(null);

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

  // Los roles solo hacen falta para el formulario.
  useEffect(() => {
    if (!puedeEscribir) return;
    listarRoles()
      .then((lista) => setRoles(lista.map((rol) => rol.nombre_rol)))
      .catch(() => setRoles(Object.keys(NOMBRES_ROL)));
  }, [puedeEscribir]);

  // El backend responde con el usuario actualizado: se reemplaza la fila sin pedir la lista.
  const reemplazar = useCallback((actualizado) => {
    setUsuarios((lista) => lista.map((u) => (u.id_usuario === actualizado.id_usuario ? actualizado : u)));
  }, []);

  function abrir(nuevoFormulario) {
    setAviso(null);
    setFormulario(nuevoFormulario);
  }

  function alTerminar(mensaje, tipo = 'exito') {
    setFormulario(null);
    setAviso({ texto: mensaje, tipo });
  }

  async function alternarEstado(usuario) {
    const nuevo = usuario.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    if (
      nuevo === 'INACTIVO' &&
      !window.confirm(
        `¿Desactivar a ${usuario.nombre_completo}? No podra iniciar sesion hasta que se reactive. ` +
          'Sus llamadas y asignaciones se conservan.'
      )
    ) {
      return;
    }
    setAviso(null);
    setCambiandoEstado(usuario.id_usuario);
    try {
      reemplazar(await cambiarEstado(usuario.id_usuario, nuevo));
      setAviso({
        texto: `${usuario.nombre_completo} quedo ${nuevo === 'ACTIVO' ? 'activo' : 'inactivo'}.`,
        tipo: 'exito',
      });
    } catch (excepcion) {
      setAviso({ texto: excepcion.message, tipo: 'error' });
    } finally {
      setCambiandoEstado(null);
    }
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
          {puedeEscribir && formulario?.modo !== 'crear' && (
            <button type="button" className="boton boton--primario" onClick={() => abrir({ modo: 'crear' })}>
              <Plus size={18} aria-hidden="true" />
              Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {aviso && (
        <p className={`alerta alerta--${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
          {aviso.texto}
        </p>
      )}

      {formulario && (
        <FormularioUsuario
          key={formulario.usuario?.id_usuario ?? 'nuevo'}
          usuario={formulario.usuario}
          roles={roles}
          usuarios={usuarios}
          esUnoMismo={formulario.usuario?.id_usuario === sesion.id}
          alCambiar={reemplazar}
          alCrear={cargar}
          alTerminar={alTerminar}
          alCancelar={() => setFormulario(null)}
        />
      )}

      {errorLista && (
        <p className="alerta alerta--error" role="alert">
          {errorLista}
        </p>
      )}

      {cargando ? (
        <Cargando texto="Cargando usuarios..." />
      ) : (
        !errorLista && (
          <TablaUsuarios
            usuarios={usuarios}
            idSesion={sesion.id}
            puedeEscribir={puedeEscribir}
            cambiandoEstado={cambiandoEstado}
            alEditar={(usuario) => abrir({ modo: 'editar', usuario })}
            alAlternarEstado={alternarEstado}
          />
        )
      )}
    </section>
  );
}

function TablaUsuarios({ usuarios, idSesion, puedeEscribir, cambiandoEstado, alEditar, alAlternarEstado }) {
  if (usuarios.length === 0) {
    return <p className="vacio">No hay usuarios registrados.</p>;
  }

  const estadoPorId = new Map(usuarios.map((u) => [u.id_usuario, u.estado]));

  return (
    <div className="tabla-contenedor">
      <table className="tabla">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Supervisor</th>
            <th>Estado</th>
            <th>Creado</th>
            {puedeEscribir && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {usuarios.map((usuario) => {
            const esUnoMismo = usuario.id_usuario === idSesion;
            const activo = usuario.estado === 'ACTIVO';
            return (
              <tr key={usuario.id_usuario}>
                <td>
                  <div className="usuario-celda">
                    <span>
                      {usuario.nombre_completo}
                      {esUnoMismo && <span className="texto-secundario"> (usted)</span>}
                    </span>
                    <span className="texto-secundario">{usuario.correo_electronico}</span>
                  </div>
                </td>
                <td>{usuario.roles.map(nombreRol).join(', ') || '-'}</td>
                <td>
                  <CeldaSupervisor usuario={usuario} estadoPorId={estadoPorId} />
                </td>
                <td>
                  <span className={`etiqueta etiqueta--${usuario.estado.toLowerCase()}`}>{usuario.estado}</span>
                </td>
                <td>{formatoFecha.format(new Date(usuario.fecha_creacion))}</td>
                {puedeEscribir && (
                  <td>
                    <div className="acciones-fila">
                      <button
                        type="button"
                        className="boton boton--secundario boton--chico"
                        onClick={() => alEditar(usuario)}
                      >
                        <Pencil size={16} aria-hidden="true" />
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton boton--secundario boton--chico"
                        onClick={() => alAlternarEstado(usuario)}
                        disabled={esUnoMismo || cambiandoEstado === usuario.id_usuario}
                        title={esUnoMismo ? 'No puede desactivarse a si mismo.' : undefined}
                      >
                        <Power size={16} aria-hidden="true" />
                        {activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Un supervisor desactivado conserva a sus agentes (docs/api.md): se marca para que el
// SuperAdmin sepa que debe reasignarlos.
function CeldaSupervisor({ usuario, estadoPorId }) {
  if (!usuario.roles.includes('AGENTE')) return <span className="texto-secundario">-</span>;
  if (!usuario.supervisor) return <span className="texto-secundario">Sin supervisor</span>;
  const inactivo = estadoPorId.get(usuario.supervisor.id_usuario) === 'INACTIVO';
  return (
    <span className={inactivo ? 'supervisor-inactivo' : undefined}>
      {usuario.supervisor.nombre_completo}
      {inactivo && (
        <span className="supervisor-inactivo__aviso" title="El supervisor esta desactivado: reasigne a este agente.">
          <TriangleAlert size={14} aria-hidden="true" />
          inactivo
        </span>
      )}
    </span>
  );
}

// Campo del formulario al que corresponde cada codigo de error del backend.
const CAMPO_POR_CODIGO = {
  CORREO_DUPLICADO: 'correo_electronico',
  ROL_INEXISTENTE: 'rol',
  SUPERVISOR_INVALIDO: 'id_supervisor',
};

// Crear (usuario ausente) o editar. Al editar solo se envian los campos que cambiaron;
// el supervisor va en su propia peticion, y solo si el rol final es AGENTE.
function FormularioUsuario({ usuario, roles, usuarios, esUnoMismo, alCambiar, alCrear, alTerminar, alCancelar }) {
  const editando = Boolean(usuario);
  const original = {
    nombre_completo: usuario?.nombre_completo ?? '',
    correo_electronico: usuario?.correo_electronico ?? '',
    rol: usuario?.roles[0] ?? 'AGENTE',
    id_supervisor: usuario?.supervisor ? String(usuario.supervisor.id_usuario) : SIN_SUPERVISOR,
  };
  const [datos, setDatos] = useState({ ...original, password: '' });
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [enviando, setEnviando] = useState(false);
  const formulario = useRef(null);

  // Al abrirlo desde una fila de abajo, el formulario queda fuera de la vista.
  useEffect(() => {
    formulario.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Supervisores activos, mas el actual si esta desactivado (para que el selector lo muestre).
  const supervisores = usuarios.filter(
    (u) =>
      u.roles.includes('SUPERVISOR') && (u.estado === 'ACTIVO' || String(u.id_usuario) === original.id_supervisor)
  );
  const opcionesRol = roles.length > 0 ? roles : [original.rol];

  function cambiar(evento) {
    const { name, value } = evento.target;
    setDatos((anteriores) => ({ ...anteriores, [name]: value }));
    setErrores((anteriores) => ({ ...anteriores, [name]: undefined }));
  }

  function mostrarError(excepcion) {
    // DATOS_INVALIDOS trae un mensaje por campo; los demas errores, uno solo.
    if (excepcion.detalles?.length) {
      setErrores(Object.fromEntries(excepcion.detalles.map((d) => [d.campo, d.mensaje])));
    } else if (CAMPO_POR_CODIGO[excepcion.codigo]) {
      setErrores({ [CAMPO_POR_CODIGO[excepcion.codigo]]: excepcion.message });
    } else {
      setErrorGeneral(excepcion.message);
    }
  }

  const idSupervisorElegido = datos.id_supervisor === SIN_SUPERVISOR ? null : Number(datos.id_supervisor);

  async function crear() {
    const correo = datos.correo_electronico.trim().toLowerCase();
    const { id_usuario: idNuevo } = await crearUsuario({
      nombre_completo: datos.nombre_completo.trim(),
      correo_electronico: datos.correo_electronico,
      password: datos.password,
      rol: datos.rol,
    });
    if (datos.rol === 'AGENTE' && idSupervisorElegido !== null) {
      try {
        await asignarSupervisor(idNuevo, idSupervisorElegido);
      } catch (excepcion) {
        alCrear();
        alTerminar(`Usuario ${correo} creado, pero no se pudo asignar el supervisor: ${excepcion.message}`, 'aviso');
        return;
      }
    }
    alCrear();
    alTerminar(`Usuario ${correo} creado correctamente.`);
  }

  async function guardarCambios() {
    const cambios = {};
    const nombreLimpio = datos.nombre_completo.trim();
    if (nombreLimpio !== original.nombre_completo) cambios.nombre_completo = nombreLimpio;
    if (datos.correo_electronico.trim().toLowerCase() !== original.correo_electronico) {
      cambios.correo_electronico = datos.correo_electronico.trim();
    }
    if (datos.rol !== original.rol) cambios.rol = datos.rol;
    const cambiaSupervisor = datos.rol === 'AGENTE' && datos.id_supervisor !== original.id_supervisor;

    if (Object.keys(cambios).length === 0 && !cambiaSupervisor) {
      alTerminar('No habia cambios que guardar.', 'aviso');
      return;
    }
    if (Object.keys(cambios).length > 0) alCambiar(await editarUsuario(usuario.id_usuario, cambios));
    if (cambiaSupervisor) alCambiar(await asignarSupervisor(usuario.id_usuario, idSupervisorElegido));
    alTerminar(`Cambios de ${nombreLimpio} guardados.`);
  }

  async function alEnviar(evento) {
    evento.preventDefault();
    setErrores({});
    setErrorGeneral('');
    setEnviando(true);
    try {
      await (editando ? guardarCambios() : crear());
    } catch (excepcion) {
      setEnviando(false);
      mostrarError(excepcion);
    }
  }

  return (
    <form ref={formulario} className="formulario" onSubmit={alEnviar}>
      <div className="formulario__titulo">
        <h2>{editando ? `Editar a ${usuario.nombre_completo}` : 'Nuevo usuario'}</h2>
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
        {!editando && (
          <Campo etiqueta="Contrasena (minimo 8 caracteres)" error={errores.password}>
            <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={datos.password} onChange={cambiar} />
          </Campo>
        )}
        <Campo
          etiqueta="Rol"
          error={errores.rol}
          ayuda={esUnoMismo ? 'No puede cambiar su propio rol.' : undefined}
        >
          <select name="rol" value={datos.rol} onChange={cambiar} disabled={esUnoMismo}>
            {opcionesRol.map((rol) => (
              <option key={rol} value={rol}>
                {nombreRol(rol)}
              </option>
            ))}
          </select>
        </Campo>
        {datos.rol === 'AGENTE' && (
          <Campo
            etiqueta="Supervisor"
            error={errores.id_supervisor}
            ayuda={supervisores.length === 0 ? 'No hay supervisores activos. Cree uno primero.' : undefined}
          >
            <select name="id_supervisor" value={datos.id_supervisor} onChange={cambiar}>
              <option value={SIN_SUPERVISOR}>Sin supervisor</option>
              {supervisores.map((s) => (
                <option key={s.id_usuario} value={String(s.id_usuario)}>
                  {s.nombre_completo}
                  {s.estado === 'INACTIVO' ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>

      {editando && original.rol !== datos.rol && (
        <p className="alerta alerta--aviso">
          <TriangleAlert size={18} aria-hidden="true" />
          {original.rol === 'SUPERVISOR'
            ? 'Al dejar de ser Supervisor, sus agentes quedaran sin supervisor.'
            : original.rol === 'AGENTE'
              ? 'Al dejar de ser Agente, perdera su supervisor.'
              : 'El cambio de rol cambia los modulos a los que tiene acceso.'}
        </p>
      )}

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
          {enviando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear usuario'}
        </button>
      </div>
    </form>
  );
}

function Campo({ etiqueta, error, ayuda, children }) {
  return (
    <label className={error ? 'campo campo--error' : 'campo'}>
      <span>{etiqueta}</span>
      {children}
      {error ? (
        <small className="campo__error">{error}</small>
      ) : (
        ayuda && <small className="campo__ayuda">{ayuda}</small>
      )}
    </label>
  );
}
