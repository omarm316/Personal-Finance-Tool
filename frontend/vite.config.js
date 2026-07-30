import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Built assets land in ../static/app, which FastAPI already serves via the
// existing app.mount("/static", ...) — so no new mount or route is needed
// beyond pointing "/" at the built index.html. `base` must match that URL
// prefix or the hashed asset <script>/<link> tags resolve to the wrong path.
export default defineConfig({
  plugins: [react()],
  base: '/static/app/',
  build: {
    outDir: '../static/app',
    emptyOutDir: true,
    // The app is one large bundle today; this keeps the build quiet until the
    // Phase 2 component split makes real code-splitting meaningful.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // `npm run dev` proxies API calls to the running FastAPI server so the
    // Vite dev server can be used standalone with HMR.
    proxy: {
      '/api': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
    },
  },
});
