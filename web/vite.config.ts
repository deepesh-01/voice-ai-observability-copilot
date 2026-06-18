import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// In dev, proxy API + OAuth to the Express backend so the embedded app talks to one origin.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8095',
      '/oauth': 'http://localhost:8095',
      '/health': 'http://localhost:8095',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
