import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El puerto es fijo: el backend solo acepta CORS desde http://localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
