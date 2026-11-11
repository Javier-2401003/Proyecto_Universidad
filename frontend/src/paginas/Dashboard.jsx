// Dashboard en Tiempo Real (modulo DASHBOARD_VIVO: SuperAdmin y Supervisor). El sistema
// analiza grabaciones por lotes, no llamadas en vivo: esta pantalla muestra lo que se esta
// analizando y lo analizado hoy, y se actualiza sola cada pocos segundos con GET /llamadas
// (docs/api.md). Cada usuario ve solo lo que el backend le permite.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, RefreshCw, TriangleAlert, Volume2, VolumeX, Wifi, WifiOff, X } from 'lucide-react';
import { useSesion } from '../sesion/SesionContexto.jsx';
import { listarLlamadas } from '../api/llamadas.js';
import { Indicador } from '../componentes/Indicador.jsx';
import { Cargando } from '../componentes/Cargando.jsx';
import { BarraApilada, SERIES_CLASIFICACION, claseClasificacion } from '../componentes/Graficos.jsx';
import { CLASIFICACIONES, DIAGNOSTICOS, ESTADOS, TablaLlamadas } from '../componentes/ListaLlamadas.jsx';

const INTERVALO_MS = 10000;
// GET /llamadas devuelve como maximo 100 por pagina: el dashboard mira las 100 mas recientes de hoy.
const MAXIMO_HOY = 100;
const EN_COLA_VISIBLES = 8;
const DURACION_AVISO_MS = 12000;

const formatoHora = new Intl.DateTimeFormat('es', { timeStyle: 'medium' });

// Fecha local de hoy en formato AAAA-MM-DD (la que usan los filtros de GET /llamadas).
function hoyIso() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

// Prioridad para "Requieren atencion": criticas, luego negativas por falla del agente,
// luego el resto de negativas; dentro de cada grupo, menor puntaje primero.
function prioridad(llamada) {
  const { clasificacion_final: clase, diagnostico_conflicto: diagnostico } = llamada.resultado;
  if (clase === 'CRITICO') return 0;
  return diagnostico === 'FALLA_AGENTE' ? 1 : 2;
}

// Pitido corto con Web Audio (sin archivos de sonido). El navegador solo lo permite despues
// de que el usuario haya interactuado con la pagina; si no, se ignora.
function pitar() {
  try {
    const contexto = new (window.AudioContext || window.webkitAudioContext)();
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();
    oscilador.frequency.value = 880;
    volumen.gain.setValueAtTime(0.15, contexto.currentTime);
    volumen.gain.exponentialRampToValueAtTime(0.001, contexto.currentTime + 0.4);
    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.4);
  } catch {
    // Sin audio disponible: el aviso visual basta.
  }
}

export default function Dashboard({ nombre }) {
  const { usuario } = useSesion();
  const [datos, setDatos] = useState(null);
  const [actualizado, setActualizado] = useState(null);
  const [desconectado, setDesconectado] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [avisos, setAvisos] = useState([]);
  const [sonido, setSonido] = useState(true);
  // Criticas ya vistas: solo se avisa de las nuevas, nunca en la primera carga.
  const vistas = useRef(null);
  const sonidoRef = useRef(sonido);
  sonidoRef.current = sonido;

  const consultar = useCallback(async () => {
    setConsultando(true);
    try {
      const hoy = hoyIso();
      const [deHoy, procesando, pendientes] = await Promise.all([
        listarLlamadas({ desde: hoy, hasta: hoy, tamano_pagina: MAXIMO_HOY }, usuario),
        listarLlamadas({ estado: 'PROCESANDO', tamano_pagina: EN_COLA_VISIBLES }, usuario),
        listarLlamadas({ estado: 'PENDIENTE', tamano_pagina: EN_COLA_VISIBLES }, usuario),
      ]);
      const criticas = deHoy.llamadas.filter((l) => l.resultado?.clasificacion_final === 'CRITICO');
      if (vistas.current) {
        const nuevas = criticas.filter((l) => !vistas.current.has(l.id_llamada));
        if (nuevas.length > 0) {
          setAvisos((anteriores) => [
            ...nuevas.map((l) => ({ id: l.id_llamada, llamada: l, hasta: Date.now() + DURACION_AVISO_MS })),
            ...anteriores,
          ]);
          if (sonidoRef.current) pitar();
        }
      }
      vistas.current = new Set(criticas.map((l) => l.id_llamada));
      setDatos({ deHoy, procesando, pendientes });
      setActualizado(new Date());
      setDesconectado(false);
    } catch {
      // No se borran los datos anteriores, pero se marcan como desactualizados.
      setDesconectado(true);
    } finally {
      setConsultando(false);
    }
  }, [usuario]);

  useEffect(() => {
    consultar();
    const intervalo = setInterval(consultar, INTERVALO_MS);
    return () => clearInterval(intervalo);
  }, [consultar]);

  // Los avisos se van solos.
  useEffect(() => {
    if (avisos.length === 0) return undefined;
    const temporizador = setInterval(() => {
      setAvisos((anteriores) => anteriores.filter((aviso) => aviso.hasta > Date.now()));
    }, 1000);
    return () => clearInterval(temporizador);
  }, [avisos.length]);

  return (
    <section className="dashboard">
      <div className="encabezado">
        <div>
          <h1>{nombre || 'Dashboard en Tiempo Real'}</h1>
          <p className="texto-secundario">
            Llamadas que se estan analizando y resultados de hoy. Se actualiza cada {INTERVALO_MS / 1000} segundos.
          </p>
        </div>
        <div className="encabezado__acciones">
          <EstadoConexion desconectado={desconectado} actualizado={actualizado} />
          <button
            type="button"
            className="boton boton--secundario"
            onClick={() => setSonido((anterior) => !anterior)}
            aria-pressed={sonido}
            title={sonido ? 'Silenciar el aviso de llamadas criticas' : 'Activar el aviso sonoro'}
          >
            {sonido ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
            {sonido ? 'Sonido' : 'Silencio'}
          </button>
          <button type="button" className="boton boton--secundario" onClick={consultar} disabled={consultando}>
            <RefreshCw size={18} aria-hidden="true" className={consultando ? 'icono-girando' : undefined} />
            Actualizar
          </button>
        </div>
      </div>

      {desconectado && (
        <p className="alerta alerta--error" role="alert">
          <WifiOff size={18} aria-hidden="true" />
          Sin conexion con el servidor. Reintentando cada {INTERVALO_MS / 1000} segundos; los datos de abajo
          {actualizado ? ` son de las ${formatoHora.format(actualizado)} y` : ''} pueden estar desactualizados.
        </p>
      )}

      {!datos ? (
        !desconectado && <Cargando texto="Cargando el dashboard..." />
      ) : (
        <div className={desconectado ? 'dashboard__contenido dashboard__contenido--viejo' : 'dashboard__contenido'}>
          <Contenido datos={datos} />
        </div>
      )}

      <Avisos avisos={avisos} alCerrar={(id) => setAvisos((anteriores) => anteriores.filter((a) => a.id !== id))} />
    </section>
  );
}

function EstadoConexion({ desconectado, actualizado }) {
  if (desconectado) {
    return (
      <span className="estado-conexion estado-conexion--caida">
        <WifiOff size={16} aria-hidden="true" />
        Desconectado - Reintentando...
      </span>
    );
  }
  return (
    <span className="estado-conexion" role="status">
      <Wifi size={16} aria-hidden="true" />
      {actualizado ? `Actualizado ${formatoHora.format(actualizado)}` : 'Conectando...'}
    </span>
  );
}

function Contenido({ datos }) {
  const { deHoy, procesando, pendientes } = datos;
  const analizadas = deHoy.llamadas.filter((l) => l.resultado);
  const porClasificacion = Object.fromEntries(SERIES_CLASIFICACION.map(({ clave }) => [clave, 0]));
  for (const llamada of analizadas) porClasificacion[llamada.resultado.clasificacion_final] += 1;
  const alertas = analizadas.reduce((suma, l) => suma + l.total_alertas, 0);
  const promedio =
    analizadas.length > 0
      ? analizadas.reduce((suma, l) => suma + l.resultado.puntaje_final, 0) / analizadas.length
      : null;
  const atencion = analizadas
    .filter((l) => ['CRITICO', 'NEGATIVO'].includes(l.resultado.clasificacion_final))
    .sort((a, b) => prioridad(a) - prioridad(b) || a.resultado.puntaje_final - b.resultado.puntaje_final);
  const enCola = [...procesando.llamadas, ...pendientes.llamadas].slice(0, EN_COLA_VISIBLES);
  const totalEnCola = procesando.total + pendientes.total;

  return (
    <>
      <ul className="indicadores">
        <Indicador etiqueta="En analisis ahora" valor={totalEnCola} detalle={`${procesando.total} procesando`} />
        <Indicador etiqueta="Analizadas hoy" valor={analizadas.length} detalle={`de ${deHoy.total} cargadas hoy`} />
        <Indicador etiqueta="Puntaje promedio hoy" valor={promedio === null ? '-' : promedio.toFixed(1)} detalle="de 100" />
        <Indicador etiqueta="Criticas hoy" valor={porClasificacion.CRITICO} detalle={`${alertas} alertas en total`} />
      </ul>
      {deHoy.total > MAXIMO_HOY && (
        <p className="texto-secundario nota-grafico">
          Hoy hay {deHoy.total} llamadas cargadas; los numeros de hoy se calculan con las {MAXIMO_HOY} mas recientes.
        </p>
      )}

      <div className="dashboard__columnas">
        <div className="tarjeta-panel">
          <h2>Requieren atencion</h2>
          {atencion.length === 0 ? (
            <p className="texto-secundario">Ninguna llamada analizada hoy es negativa ni critica.</p>
          ) : (
            <ul className="atencion">
              {atencion.slice(0, 8).map((llamada) => (
                <TarjetaAtencion key={llamada.id_llamada} llamada={llamada} />
              ))}
            </ul>
          )}
          {atencion.length > 8 && (
            <p className="texto-secundario nota-grafico">
              Y {atencion.length - 8} mas: vealas en la tabla de abajo o en la Busqueda historica.
            </p>
          )}
        </div>

        <div className="dashboard__lateral">
          <div className="tarjeta-panel">
            <h2>En analisis ({totalEnCola})</h2>
            {enCola.length === 0 ? (
              <p className="texto-secundario">No hay llamadas en cola.</p>
            ) : (
              <ul className="cola">
                {enCola.map((llamada) => {
                  const estado = ESTADOS[llamada.estado_procesamiento];
                  return (
                    <li key={llamada.id_llamada} className="cola__fila">
                      <div className="usuario-celda">
                        <span>{llamada.nombre_archivo_original}</span>
                        <span className="texto-secundario">{llamada.agente?.nombre_completo}</span>
                      </div>
                      <span className={`etiqueta ${estado?.clase ?? ''}`}>{estado?.texto ?? llamada.estado_procesamiento}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {totalEnCola > enCola.length && (
              <p className="texto-secundario nota-grafico">Y {totalEnCola - enCola.length} mas en cola.</p>
            )}
          </div>
          <div className="tarjeta-panel">
            <h2>Sentimiento de hoy</h2>
            {analizadas.length === 0 ? (
              <p className="texto-secundario">Todavia no hay llamadas analizadas hoy.</p>
            ) : (
              <BarraApilada
                series={SERIES_CLASIFICACION}
                valores={porClasificacion}
                total={analizadas.length}
                unidad="llamadas analizadas hoy"
              />
            )}
          </div>
        </div>
      </div>

      <div className="tarjeta-panel">
        <h2>Llamadas de hoy</h2>
        {deHoy.llamadas.length === 0 ? (
          <p className="vacio">Todavia no se cargaron llamadas hoy.</p>
        ) : (
          <TablaLlamadas llamadas={deHoy.llamadas} mostrarAgente mostrarDuracion={false} />
        )}
      </div>
    </>
  );
}

function TarjetaAtencion({ llamada }) {
  const { resultado } = llamada;
  return (
    <li className="atencion__tarjeta">
      <i className={`semaforo ${claseClasificacion(resultado.clasificacion_final)}`} aria-hidden="true" />
      <div className="atencion__cuerpo">
        <Link to={`/llamadas/${llamada.id_llamada}`} className="enlace">
          {llamada.nombre_archivo_original}
        </Link>
        <span className="texto-secundario">
          {llamada.agente?.nombre_completo} · {DIAGNOSTICOS[resultado.diagnostico_conflicto] ?? resultado.diagnostico_conflicto}
          {llamada.total_alertas > 0 && ` · ${llamada.total_alertas} ${llamada.total_alertas === 1 ? 'alerta' : 'alertas'}`}
        </span>
        {llamada.baja_confianza_audio && (
          <span className="atencion__aviso">
            <TriangleAlert size={14} aria-hidden="true" />
            Baja confianza en el audio
          </span>
        )}
      </div>
      <div className="atencion__puntaje">
        <strong>{resultado.puntaje_final.toFixed(1)}</strong>
        <span className={`etiqueta etiqueta--${resultado.clasificacion_final.toLowerCase()}`}>
          {CLASIFICACIONES[resultado.clasificacion_final]}
        </span>
      </div>
    </li>
  );
}

function Avisos({ avisos, alCerrar }) {
  if (avisos.length === 0) return null;
  return (
    <div className="avisos" role="alert">
      {avisos.map(({ id, llamada }) => (
        <div key={id} className="aviso-critico">
          <CircleAlert size={20} aria-hidden="true" />
          <div>
            <strong>Llamada critica</strong>
            <p>
              <Link to={`/llamadas/${llamada.id_llamada}`} className="enlace">
                {llamada.nombre_archivo_original}
              </Link>{' '}
              · {llamada.agente?.nombre_completo} · puntaje {llamada.resultado.puntaje_final.toFixed(1)}
            </p>
          </div>
          <button type="button" className="boton boton--icono" onClick={() => alCerrar(id)} aria-label="Cerrar aviso">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
