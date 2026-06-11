import type { FieldParams, MorphShape } from '../field';
import type { PointerMode } from './ui/types';

/**
 * Postprocessing look settings. These live on the `post` graph (not FieldParams),
 * but are captured here so Share links / presets / the A/B blend round-trip them
 * too — bloom and lens are a big part of a look. Optional on SceneState so older
 * links/presets without it still decode (then the current post settings are kept).
 */
export interface PostState {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  trails: number;
  dofBokeh: number;
  dofFocus: number;
  dofRange: number;
  ca: number;
  vignette: number;
  dither: number;
  toneExposure: number;
}

/**
 * A full snapshot of the field's look — the unit both the Share link (URL hash)
 * and the saved presets (localStorage) round-trip. `morphShape` / `post` are
 * optional so older share links without them still decode.
 */
export interface SceneState {
  params: FieldParams;
  count: number;
  pointerMode: PointerMode;
  morphShape?: MorphShape;
  post?: PostState;
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
