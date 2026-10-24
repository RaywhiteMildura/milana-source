import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname, 'src/web'),
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'src/shared') } },
  build: { outDir: path.resolve(__dirname, 'dist/web'), emptyOutDir: true },
  server: {
    port: 5173,
    // The browser's own Host goes through (no changeOrigin): the server's cross-site guard compares it with the page's
    // Origin, so writes work whether the dev page is open at localhost, 127.0.0.1 or a LAN address of this machine.
    proxy: { '/api': { target: 'http://localhost:4850', changeOrigin: false } },
  },
});
