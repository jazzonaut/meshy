import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Aura from '@primeuix/themes/aura';
import type { Controller } from '../types';
import { controllerKey } from './useController';
import AppUi from './AppUi.vue';

/**
 * Mount the Vue control layer over the canvas. The engine {@link Controller} is
 * provided to the tree; PrimeVue is registered into its own `primevue` CSS layer
 * so Tailwind utilities can still win the cascade. The host is fixed full-screen
 * but pointer-transparent (see app.css) so orbit/drag passes through the gaps.
 */
export function mountUi(controller: Controller) {
  const host = document.createElement('div');
  host.className = 'ui-root';
  document.body.appendChild(host);

  const app = createApp(AppUi);
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: '.app-dark',
        cssLayer: { name: 'primevue', order: 'theme, base, primevue' },
      },
    },
  });
  app.use(ToastService);
  app.provide(controllerKey, controller);
  app.mount(host);
}
