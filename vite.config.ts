import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:11398',
      '/ws': { target: 'ws://127.0.0.1:11398', ws: true },
      '/pty': { target: 'ws://127.0.0.1:11398', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
