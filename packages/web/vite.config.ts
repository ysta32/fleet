import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev ports: 4500-4599 only (shared machine). Collector dev default: FLEET_DEV_API (http://127.0.0.1:4500).
const api = process.env.FLEET_DEV_API ?? 'http://127.0.0.1:4500';
export default defineConfig({
  plugins: [react()],
  server: { port: 4501, strictPort: true, proxy: { '/api': { target: api, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
