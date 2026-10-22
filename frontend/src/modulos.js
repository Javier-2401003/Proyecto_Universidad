// Modulos de la plataforma (TB_Modulo). El nombre visible viene del backend
// (usuario.permisos[].nombre); aqui solo se decide la ruta, el icono y la pantalla.
// Para agregar una pantalla nueva, cambie EnConstruccion por su componente.
import { Activity, FileText, Search, ShieldCheck, Upload, UserRound, Users } from 'lucide-react';
import GestionUsuarios from './paginas/GestionUsuarios.jsx';
import EnConstruccion from './paginas/EnConstruccion.jsx';

// El orden de esta lista es el orden del menu lateral.
export const MODULOS = [
  { codigo: 'PANEL_AGENTE', ruta: '/panel-agente', icono: UserRound, pantalla: EnConstruccion },
  { codigo: 'DASHBOARD_VIVO', ruta: '/dashboard', icono: Activity, pantalla: EnConstruccion },
  { codigo: 'CARGA_LOTES', ruta: '/carga-lotes', icono: Upload, pantalla: EnConstruccion },
  { codigo: 'BUSQUEDA_HISTORICA', ruta: '/busqueda', icono: Search, pantalla: EnConstruccion },
  { codigo: 'REPORTES', ruta: '/reportes', icono: FileText, pantalla: EnConstruccion },
  { codigo: 'GESTION_USUARIOS', ruta: '/usuarios', icono: Users, pantalla: GestionUsuarios },
  { codigo: 'AUDITORIA', ruta: '/auditoria', icono: ShieldCheck, pantalla: EnConstruccion },
];

// Modulos que el usuario puede leer, en el orden del menu, con su nombre visible.
export function modulosVisibles(permisos) {
  return MODULOS.flatMap((modulo) => {
    const permiso = permisos.find((p) => p.modulo === modulo.codigo && p.leer);
    return permiso ? [{ ...modulo, nombre: permiso.nombre }] : [];
  });
}
