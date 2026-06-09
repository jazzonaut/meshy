import { reactive } from 'vue';
import { App } from './app/App';
import { mountUi } from './app/ui/vue/mountUi';
import './styles/app.css';

/** Entry point: verify WebGPU support, boot the engine, then mount the Vue UI. */
async function main() {
  if (!navigator.gpu) {
    document.getElementById('unsupported')?.classList.add('show');
    return;
  }
  const container = document.getElementById('app')!;
  // reactive() is injected as the state wrapper so the engine stays Vue-agnostic
  // while the UI tracks every change (presets, demo-reel, shared URLs).
  const app = await App.create(container, { wrapState: <T extends object>(s: T) => reactive(s) as T });
  mountUi(app.controller);
  app.start();
}

main();
