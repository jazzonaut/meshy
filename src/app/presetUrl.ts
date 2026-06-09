import type { FieldParams } from '../field';

/** The shareable state encoded into the URL hash. */
export interface ShareState {
  params: FieldParams;
  count: number;
  pointerMode: 'Off' | 'Push' | 'Pull';
}

// Encode as URI-escaped JSON wrapped in base64 so it survives in a URL hash and
// handles any unicode in the values.
export function encodeState(state: ShareState): string {
  return btoa(encodeURIComponent(JSON.stringify(state)));
}

export function decodeState(encoded: string): ShareState | null {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

/** Parse the current location hash into a share state, or null if absent/invalid. */
export function readHash(): ShareState | null {
  const hash = location.hash.replace(/^#/, '');
  return hash ? decodeState(hash) : null;
}

/** Absolute URL that reproduces the given state. */
export function buildShareUrl(state: ShareState): string {
  return `${location.origin}${location.pathname}#${encodeState(state)}`;
}
