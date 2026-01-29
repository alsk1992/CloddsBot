import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/docs/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3001,
    open: true,
  },
});
