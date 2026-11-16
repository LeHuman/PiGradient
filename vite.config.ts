import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Relative asset base: the bundle resolves assets and API calls relative to
    // the URL it is served from, so the Go daemon can serve the dashboard at /
    // (its default base_path) or under any configured prefix (e.g. /pigradient
    // behind a reverse proxy) with the same build. Production
    // import.meta.env.BASE_URL is './' (→ ./assets/..., ./api/v1/...); the dev
    // server serves at / so BASE_URL is '/'.
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname ?? '.', '.'),
      },
    },
    server: {
      // Vite docs default; keep the dev server port predictable.
      port: 3000,
      // Dev-only: proxy API calls (REST + SSE) to the Go daemon.
      // Run `go run ./server/cmd/pigradient` alongside `npm run dev`.
      // The daemon serves root-relative routes (and any base_path prefix), so
      // a plain /api proxy is all the dev server needs.
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
