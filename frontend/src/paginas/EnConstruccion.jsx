import { Construction } from 'lucide-react';

// Pantalla provisional para los modulos que todavia no tienen interfaz.
export default function EnConstruccion({ nombre }) {
  return (
    <section>
      <h1>{nombre}</h1>
      <div className="vacio">
        <Construction size={40} aria-hidden="true" />
        <p>Este modulo esta en construccion.</p>
      </div>
    </section>
  );
}
