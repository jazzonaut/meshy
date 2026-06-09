import { inject, type InjectionKey } from 'vue';
import type { Controller } from '../types';

/** Injection key for the engine {@link Controller}, provided by `mountUi`. */
export const controllerKey: InjectionKey<Controller> = Symbol('field-controller');

export function useController(): Controller {
  const controller = inject(controllerKey);
  if (!controller) throw new Error('Controller was not provided — call mountUi() with the App controller.');
  return controller;
}
