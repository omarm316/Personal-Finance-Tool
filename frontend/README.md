# Moresheth frontend

React app, bundled by Vite. Replaces the old single-file `v2.html`, which
shipped ~11k lines of JSX to the browser and compiled it there with
Babel-standalone on every page load.

## Commands

```bash
cd frontend
npm install       # first time only
npm run build     # → ../static/app  (what FastAPI serves)
npm run dev       # Vite dev server with HMR, proxies /api to :8000
```

## How it's served

- `vite.config.js` sets `base: '/static/app/'` and `outDir: '../static/app'`.
- FastAPI already mounts `/static`, so no new route is needed. `/`,
  `/v2` and `/plaid/oauth-return` all serve `static/app/index.html` via
  `_frontend_index()` in `main.py`.
- `_frontend_index()` falls back to the legacy `v2.html` when no build is
  present, and logs a warning when it does. That keeps a fresh checkout
  runnable, but **if you see that warning in production, the build didn't
  ship** — don't ignore it.
- In Docker, stage 1 (`node:20-slim`) runs the build and stage 2 copies
  `/static/app` in. Build output is gitignored; it is never committed.

## Gotchas

- `frontend/node_modules` **must** stay in `.dockerignore`. The build stage
  runs `npm ci` and then `COPY frontend/ ./`, so a host `node_modules` would
  overwrite the container's with macOS-native binaries.
- Asset filenames are content-hashed, so the service worker's cache-first
  branch is safe for them. `index.html` is network-first and must stay that
  way, since it points at those hashes. Bump `CACHE_VERSION` in
  `static/sw.js` if you ever need to force-evict a bad shell cache.

## Status

`src/main.jsx` is currently the whole former `v2.html` script as one module —
this was deliberately step one, to prove the toolchain and the deploy
separately from the code split. Breaking it into `components/`, `pages/`,
`hooks/` and `lib/` is the next step.
