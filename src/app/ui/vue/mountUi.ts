import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import type { Controller } from '../types';
import { controllerKey } from './useController';
import AppUi from './AppUi.vue';

// A slimmed Aura: thinner focus ring and slightly tighter corners for a flatter,
// more minimal feel. (For an even flatter look, swap the base to Nora:
// `import Nora from '@primeuix/themes/nora'` and pass it instead of Aura.)
const Slim = definePreset(Aura, {
  primitive: {
    borderRadius: { none: '0', xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px' },
  },
  semantic: {
    focusRing: { width: '1px', style: 'solid', offset: '1px' },
  },
});

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
    ripple: false, // flatter, no click ripple
    theme: {
      preset: Slim,
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
