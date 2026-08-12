import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['Chrome >= 74'],
      modernPolyfills: true,
    }),
  ],
  build: {
    target: 'es2018',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
