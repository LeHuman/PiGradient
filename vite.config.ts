import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Fixed deploy base: the Go daemon serves the dashboard under /pigradient
    // (and still at /). Dev server therefore serves http://localhost:3000/pigradient/
    base: '/pigradient/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname ?? '.', '.'),
      },
    },
    server: {
      // Dev-only: proxy API calls (REST + SSE) to the Go daemon.
      // Run `go run ./server/cmd/pigradient` alongside `npm run dev`.
      proxy: {
        // App built with base '/pigradient/' — Vite dev serves it at /pigradient/;
        // proxy the prefixed API path to the daemon, stripping the prefix so it
        // hits the root routes (the daemon serves both, either is fine)
        '^/pigradient/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/pigradient/, ''),
        },
        // Legacy root-relative API path (kept for tools/curl during dev)
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
