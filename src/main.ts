import { reactive } from 'vue';
import { App } from './app/App';
import { mountUi } from './app/ui/vue/mountUi';
import './styles/app.css';

function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Resolve against the deploy base (e.g. /meshy/) so the scope covers the app.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is best-effort; the app itself still runs normally.
    });
  });
}

/** Fade out and remove the loading veil once the first frame is ready. */
function dismissLoader() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('hide');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

/** Entry point: verify WebGPU support, boot the engine, then mount the Vue UI. */
async function main() {
  registerServiceWorker();
  if (!navigator.gpu) {
    document.getElementById('loading')?.remove();
    document.getElementById('unsupported')?.classList.add('show');
    return;
  }
  const container = document.getElementById('app')!;
  // reactive() is injected as the state wrapper so the engine stays Vue-agnostic
  // while the UI tracks every change (presets, demo-reel, shared URLs).
  const app = await App.create(container, { wrapState: <T extends object>(s: T) => reactive(s) as T });
  // Compile the heavy shader pipelines behind the loader so the first visible frame
  // is smooth rather than a compile stall. Non-fatal: the loop compiles lazily if
  // warmup fails, so we still boot.
  try {
    await app.warmup();
  } catch {
    /* fall back to lazy first-frame compilation */
  }
  mountUi(app.controller);
  app.start();
  dismissLoader();
}

main();
