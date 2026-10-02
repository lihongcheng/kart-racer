import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4175' },
  },
  preview: { port: 4176, strictPort: true, host: '127.0.0.1', proxy: {} },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
