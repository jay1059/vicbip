import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Use the compiled shared dist in production (Docker), source in dev
const sharedEntry = existsSync(resolve(__dirname, '../shared/dist/index.js'))
  ? resolve(__dirname, '../shared/dist/index.js')
  : resolve(__dirname, '../shared/src/index.ts');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vicbip/shared': sharedEntry,
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
