import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SesionProveedor } from './sesion/SesionContexto.jsx';
import App from './App.jsx';
import './estilos/global.css';

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <BrowserRouter>
      <SesionProveedor>
        <App />
      </SesionProveedor>
    </BrowserRouter>
  </StrictMode>
);
