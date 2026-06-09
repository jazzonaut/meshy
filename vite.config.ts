import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// `base` must match the GitHub Pages path. For a project site the app is served
// under https://<user>.github.io/<repo>/, so production builds need '/meshy/';
// local dev stays at '/'. If you rename the repo or move to a custom domain /
// user-page, update this to '/<new-repo>/' or '/' respectively.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/meshy/' : '/',
  plugins: [vue(), tailwindcss()],
  server: { open: true },
}));
