import { Color } from 'three';
import type { SceneState, PostState } from './presetUrl';
import type { FieldParams } from '../field';

/**
 * Continuous params that blend smoothly between two presets. Everything else is
 * SNAPPED to the nearer preset (t < 0.5 → A, else B):
 *  - structural radius / warp* would force a per-tick re-seed (and reshuffle) if
 *    lerped, so they jump once at the midpoint instead;
 *  - discrete motion / materialStyle indices have no meaningful in-between.
 */
const LERP_KEYS = [
  'speed', 'flowScale', 'flowStrength', 'timeSpeed', 'spring', 'damping',
  'boidSep', 'boidAli', 'boidCoh', 'boidPerception', 'boidMaxSpeed',
  'pointerRadius', 'pointerStrength', 'slimeSense', 'slimeWander', 'slimeDecay',
  'morphAmount', 'morphStrength', 'audioReactivity', 'audioGain', 'spectroHeight',
  'size', 'exposure', 'softness', 'coreGlow', 'streak', 'fogDensity',
] as const satisfies readonly (keyof FieldParams)[];

const COLOR_KEYS = ['warmColor', 'coolColor', 'fogColor'] as const satisfies readonly (keyof FieldParams)[];

const POST_KEYS: (keyof PostState)[] = [
  'bloomStrength', 'bloomRadius', 'bloomThreshold', 'trails', 'dofBokeh',
  'dofFocus', 'dofRange', 'ca', 'vignette', 'dither', 'toneExposure',
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Lerp two postprocessing snapshots field-by-field (all numeric). */
function lerpPost(a: PostState, b: PostState, t: number): PostState {
  const out = {} as PostState;
  for (const k of POST_KEYS) out[k] = lerp(a[k], b[k], t);
  return out;
}

/**
 * Lerp two colours and return a #rrggbb string. Interpolates in sRGB byte space
 * (not THREE.Color's linear-light space) so the halfway point is the perceptual
 * midpoint a user expects — e.g. black↔white at 0.5 reads as mid-grey #808080.
 * Inputs are normalised through Color first so any ColorRepresentation works.
 */
function lerpColor(a: FieldParams[(typeof COLOR_KEYS)[number]], b: FieldParams[(typeof COLOR_KEYS)[number]], t: number): string {
  const ha = parseInt(new Color(a as Color).getHexString(), 16);
  const hb = parseInt(new Color(b as Color).getHexString(), 16);
  const ch = (hex: number, shift: number) => (hex >> shift) & 255;
  const r = Math.round(lerp(ch(ha, 16), ch(hb, 16), t));
  const g = Math.round(lerp(ch(ha, 8), ch(hb, 8), t));
  const bl = Math.round(lerp(ch(ha, 0), ch(hb, 0), t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/**
 * Blend two saved scene states into a new one at position `t` ∈ [0,1]. Live look /
 * motion params lerp continuously; structural, discrete, count, pointer and morph
 * snap to the nearer preset. The result is a {@link SceneState} that can be fed
 * straight into App.applyPreset — which applies the live values without a re-seed
 * (and only re-seeds/rebuilds on the one tick a snapped structural/count crosses).
 */
export function blendStates(a: SceneState, b: SceneState, t: number): SceneState {
  const u = Math.max(0, Math.min(1, t));
  const near = u < 0.5 ? a : b;
  const params: FieldParams = { ...near.params };
  for (const k of LERP_KEYS) params[k] = lerp(a.params[k], b.params[k], u);
  for (const k of COLOR_KEYS) params[k] = lerpColor(a.params[k], b.params[k], u);
  // Post (bloom/lens/tone) blends continuously when both presets carry it; older
  // presets without a post snapshot fall back to the nearer side.
  const post = a.post && b.post ? lerpPost(a.post, b.post, u) : near.post;
  return {
    params,
    count: near.count,
    pointerMode: near.pointerMode,
    morphShape: near.morphShape,
    post,
  };
}
