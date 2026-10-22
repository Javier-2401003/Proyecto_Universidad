import { LoaderCircle } from 'lucide-react';

export function Cargando({ texto = 'Cargando...', pantallaCompleta = false }) {
  return (
    <div className={pantallaCompleta ? 'cargando cargando--pantalla' : 'cargando'} role="status">
      <LoaderCircle className="icono-girando" size={20} aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}
