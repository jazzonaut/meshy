import type { FieldParams, MorphShape } from '../field';

/**
 * A full snapshot of the field's look — the unit both the Share link (URL hash)
 * and the saved presets (localStorage) round-trip. `morphShape` is optional so
 * older share links without it still decode.
 */
export interface SceneState {
  params: FieldParams;
  count: number;
  pointerMode: 'Off' | 'Push' | 'Pull';
  morphShape?: MorphShape;
}

// Encode as URI-escaped JSON wrapped in base64 so it survives in a URL hash and
// handles any unicode in the values.
export function encodeState(state: SceneState): string {
  return btoa(encodeURIComponent(JSON.stringify(state)));
}

export function decodeState(encoded: string): SceneState | null {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

/** Parse the current location hash into a scene state, or null if absent/invalid. */
export function readHash(): SceneState | null {
  const hash = location.hash.replace(/^#/, '');
  return hash ? decodeState(hash) : null;
}

/** Absolute URL that reproduces the given state. */
export function buildShareUrl(state: SceneState): string {
  return `${location.origin}${location.pathname}#${encodeState(state)}`;
}
