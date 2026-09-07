import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Inside the dev container both ports keep their defaults and Compose does the
// remapping; on the host they follow the worktree's own PORT and VITE_PORT.
const backend = `127.0.0.1:${process.env.PORT ?? 3000}`;
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/assets': `http://${backend}`,
      '/api': `http://${backend}`,
      '/ws': { target: `ws://${backend}`, ws: true },
    },
  },
  build: { assetsDir: 'static', outDir: '../../dist/client', emptyOutDir: true },
});
