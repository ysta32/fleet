import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export function fleetSpendPlugin(
  resolve: (id: string) => string = createRequire(import.meta.url).resolve,
): Plugin {
  const virtualId = 'virtual:fleet-spend';
  const stubId = `\0${virtualId}`;
  let entry: string | undefined;
  try {
    entry = resolve('fleet-spend/web');
  } catch {
    // Fleet Spend is an optional installation.
  }
  return {
    name: 'fleet-spend',
    resolveId(id) {
      if (id === virtualId) return entry ?? stubId;
    },
    load(id) {
      if (id === stubId) return 'export const SpendTab = null;';
    },
  };
}

// Dev ports: 4500-4599 only (shared machine). Collector dev default: FLEET_DEV_API (http://127.0.0.1:4500).
const api = process.env.FLEET_DEV_API ?? 'http://127.0.0.1:4500';
export default defineConfig({
  plugins: [react(), fleetSpendPlugin()],
  server: { port: 4501, strictPort: true, proxy: { '/api': { target: api, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2000 },
});
