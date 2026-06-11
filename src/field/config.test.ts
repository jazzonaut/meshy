import { describe, it, expect } from 'vitest';
import {
  MOTION_MODES,
  MOTION_GROUPS,
  MATERIAL_STYLES,
  MOTION_PRESETS,
  AUDIO_RESPONSE,
  DEFAULT_PARAMS,
  BOIDS_MODE,
  PREDATOR_MODE,
  DROPLET_MODE,
  CRYSTAL_MODE,
  SLIME_MODE,
  SPECTRO_MODE,
  FIRST_EXPERIMENTAL_MODE,
  LAST_EXPERIMENTAL_MODE,
  FIRST_GPU_MODE,
  type MotionPreset,
} from './config';

// These guard the seams between the modules: when someone adds a motion mode they
// must add a matching preset and (if it's a GPU mode) keep the index constants
// contiguous, or one of these fails loudly instead of silently mis-routing.

describe('motion modes ↔ presets', () => {
  it('has one preset per motion mode', () => {
    expect(MOTION_PRESETS).toHaveLength(MOTION_MODES.length);
  });

  it('gives every preset the full set of MotionPreset keys with finite numbers', () => {
    const keys: (keyof MotionPreset)[] = ['speed', 'flowScale', 'flowStrength', 'timeSpeed', 'spring', 'damping'];
    for (const [i, preset] of MOTION_PRESETS.entries()) {
      for (const key of keys) {
        expect(Number.isFinite(preset[key]), `preset ${i} (${MOTION_MODES[i]}) key "${key}"`).toBe(true);
      }
    }
  });

  it('has no duplicate mode labels', () => {
    expect(new Set(MOTION_MODES).size).toBe(MOTION_MODES.length);
  });

  it('has one audio-motion response row per mode with finite, non-negative weights', () => {
    expect(AUDIO_RESPONSE).toHaveLength(MOTION_MODES.length);
    const keys = ['pulse', 'swirl', 'jitter', 'lift'] as const;
    for (const [i, row] of AUDIO_RESPONSE.entries()) {
      for (const key of keys) {
        const v = row[key];
        expect(Number.isFinite(v), `AUDIO_RESPONSE ${i} (${MOTION_MODES[i]}) key "${key}"`).toBe(true);
        expect(v, `AUDIO_RESPONSE ${i} (${MOTION_MODES[i]}) key "${key}"`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts every mode in exactly one picker group', () => {
    const grouped = MOTION_GROUPS.flatMap((group) => group.modes);
    expect(grouped).toHaveLength(MOTION_MODES.length);
    expect(new Set(grouped).size).toBe(MOTION_MODES.length);
    for (const mode of grouped) {
      expect(MOTION_MODES).toContain(mode);
    }
  });
});

describe('mode-index constants', () => {
  it('resolved every GPU mode to a real index (indexOf never returned -1)', () => {
    for (const idx of [BOIDS_MODE, PREDATOR_MODE, DROPLET_MODE, CRYSTAL_MODE, SLIME_MODE]) {
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the GPU modes contiguous in the documented order', () => {
    expect([PREDATOR_MODE, DROPLET_MODE, CRYSTAL_MODE, SLIME_MODE]).toEqual([
      BOIDS_MODE + 1,
      BOIDS_MODE + 2,
      BOIDS_MODE + 3,
      BOIDS_MODE + 4,
    ]);
  });

  it('starts the GPU pipeline range at the boids mode', () => {
    expect(FIRST_GPU_MODE).toBe(BOIDS_MODE);
  });

  it('keeps experimental modes contiguous before the GPU pipeline', () => {
    expect(FIRST_EXPERIMENTAL_MODE).toBeGreaterThan(0);
    expect(LAST_EXPERIMENTAL_MODE).toBe(FIRST_GPU_MODE - 1);
    expect(MOTION_MODES.slice(FIRST_EXPERIMENTAL_MODE, FIRST_GPU_MODE)).toHaveLength(15);
  });

  it('keeps Slime + Spectrogram special-cased past the flock range', () => {
    // ParticleField.update() checks `=== SPECTRO_MODE` and `=== SLIME_MODE` before
    // the `>= FIRST_GPU_MODE` flock branch, so both must sit above the flock range
    // (which ends at Crystallize) for that routing to stay correct.
    expect(SLIME_MODE).toBeGreaterThan(CRYSTAL_MODE);
    expect(SPECTRO_MODE).toBeGreaterThan(CRYSTAL_MODE);
    expect(SPECTRO_MODE).toBe(MOTION_MODES.length - 1); // Spectrogram is the last mode
    expect(SPECTRO_MODE).not.toBe(SLIME_MODE);
  });
});

describe('default params', () => {
  it('points at valid motion and material indices', () => {
    expect(DEFAULT_PARAMS.motion).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.motion).toBeLessThan(MOTION_MODES.length);
    expect(DEFAULT_PARAMS.materialStyle).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PARAMS.materialStyle).toBeLessThan(MATERIAL_STYLES.length);
  });

  it('keeps damping in the (0,1) range the GUI sliders assume', () => {
    expect(DEFAULT_PARAMS.damping).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.damping).toBeLessThan(1);
  });
});
