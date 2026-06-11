import { describe, it, expect } from 'vitest';
import { blendStates } from './blendPresets';
import { DEFAULT_PARAMS } from '../field/config';
import type { SceneState } from './presetUrl';

function state(overrides: Partial<typeof DEFAULT_PARAMS>, extra: Partial<SceneState> = {}): SceneState {
  return { params: { ...DEFAULT_PARAMS, ...overrides }, count: 250_000, pointerMode: 'Off', ...extra };
}

describe('blendStates', () => {
  const a = state({ size: 0.0, exposure: 1.0, radius: 10, motion: 0, warmColor: '#000000' }, { count: 100_000, pointerMode: 'Off', morphShape: 'None' });
  const b = state({ size: 1.0, exposure: 2.0, radius: 50, motion: 5, warmColor: '#ffffff' }, { count: 500_000, pointerMode: 'Swirl', morphShape: 'Sphere' });

  it('lerps continuous params at the midpoint', () => {
    const mid = blendStates(a, b, 0.5);
    expect(mid.params.size).toBeCloseTo(0.5);
    expect(mid.params.exposure).toBeCloseTo(1.5);
  });

  it('lerps colours in RGB', () => {
    expect(blendStates(a, b, 0.5).params.warmColor).toBe('#808080');
  });

  it('returns the endpoints exactly at t=0 and t=1', () => {
    expect(blendStates(a, b, 0).params.size).toBeCloseTo(0.0);
    expect(blendStates(a, b, 1).params.size).toBeCloseTo(1.0);
  });

  it('snaps structural + discrete + count + pointer + morph to the nearer preset', () => {
    const lo = blendStates(a, b, 0.49);
    const hi = blendStates(a, b, 0.51);
    // radius / motion are snapped (not lerped), count/pointer/morph follow the nearer side
    expect(lo.params.radius).toBe(10);
    expect(hi.params.radius).toBe(50);
    expect(lo.params.motion).toBe(0);
    expect(hi.params.motion).toBe(5);
    expect(lo.count).toBe(100_000);
    expect(hi.count).toBe(500_000);
    expect(lo.pointerMode).toBe('Off');
    expect(hi.pointerMode).toBe('Swirl');
    expect(lo.morphShape).toBe('None');
    expect(hi.morphShape).toBe('Sphere');
  });

  it('clamps t outside [0,1]', () => {
    expect(blendStates(a, b, -1).params.size).toBeCloseTo(0.0);
    expect(blendStates(a, b, 2).params.size).toBeCloseTo(1.0);
  });

  it('lerps the post snapshot when both presets carry one', () => {
    const post = (bloom: number, vig: number) => ({
      bloomStrength: bloom, bloomRadius: 0, bloomThreshold: 0, trails: 0,
      dofBokeh: 0, dofFocus: 0, dofRange: 0, ca: 0, vignette: vig, dither: 0, toneExposure: 1,
    });
    const pa = { ...a, post: post(0, 0) };
    const pb = { ...b, post: post(2, 1) };
    const mid = blendStates(pa, pb, 0.5);
    expect(mid.post?.bloomStrength).toBeCloseTo(1.0);
    expect(mid.post?.vignette).toBeCloseTo(0.5);
  });

  it('falls back to the nearer post when only one side has it', () => {
    expect(blendStates({ ...a, post: undefined }, b, 0.3).post).toBeUndefined();
  });
});
