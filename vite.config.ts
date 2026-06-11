import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// The generated service worker. Placeholders are filled at build time with the
// real (content-hashed, base-prefixed) asset list, so the whole app is precached
// at install and runs fully offline. Network-first for the document keeps a fresh
// deploy visible online; cache-first for hashed assets is safe (URL == version).
const SW_TEMPLATE = `const CACHE = '__CACHE__';
const PRECACHE = __PRECACHE__;
const NAV_FALLBACK = '__NAV__';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(NAV_FALLBACK, copy));
          return res;
        })
        .catch(() => caches.match(NAV_FALLBACK).then((r) => r || caches.match(req))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
`;

/**
 * Emit a service worker that precaches every built asset (plus the public shell)
 * with the correct base path and a content-derived cache version, so Meshy works
 * fully offline and old caches are purged on each deploy.
 */
function offlinePrecache(): Plugin {
  let base = '/';
  let publicDir = '';
  return {
    name: 'meshy-offline-precache',
    apply: 'build',
    configResolved(cfg) {
      base = cfg.base;
      publicDir = cfg.publicDir;
    },
    generateBundle(_opts, bundle) {
      const assets = Object.keys(bundle).map((f) => base + f);
      // Public-dir files (icons, manifest, favicon) bypass the bundle, so enumerate
      // them so they're cached too; plus the app root for the navigation fallback.
      let publicFiles: string[] = [];
      try {
        publicFiles = readdirSync(publicDir).map((f) => base + f);
      } catch {
        /* no public dir — nothing extra to precache */
      }
      // `base` is the navigation entry; index.html may be emitted after this hook,
      // so list it explicitly. Never precache the service worker itself.
      const all = [base, `${base}index.html`, ...assets, ...publicFiles];
      const precache = [...new Set(all)].filter((u) => !u.endsWith('/sw.js')).sort();
      const version = createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 8);
      const source = SW_TEMPLATE.replace('__CACHE__', `meshy-${version}`)
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__NAV__', base);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// `base` must match the GitHub Pages path. For a project site the app is served
// under https://<user>.github.io/<repo>/, so production builds need '/meshy/';
// local dev stays at '/'. If you rename the repo or move to a custom domain /
// user-page, update this to '/<new-repo>/' or '/' respectively.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/meshy/' : '/',
  plugins: [vue(), tailwindcss(), offlinePrecache()],
  server: { open: true },
  build: {
    rollupOptions: {
      output: {
        // Split the big, rarely-changing dependencies into their own chunks. App
        // code changes every deploy and gets a new hash, but `three` (the bulk of
        // the bundle) and the UI libs keep a stable hash, so returning visitors
        // re-download only the small entry chunk instead of the whole ~1.5 MB.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]three(@|[\\/])/.test(id)) return 'three';
          return 'vendor';
        },
      },
    },
  },
}));
