import { Fn, instanceIndex, float, uint, floor, fract, mix, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { SPECTRO_W, SPECTRO_D, SPECTRO_CELLS } from '../config';

/**
 * Spectrogram Waterfall (mode index SPECTRO_MODE). Lays the particles out as a 3D
 * FFT terrain: X = frequency column, Z = time (history scrolling away from the
 * camera), Y = amplitude. The amplitude history lives in `buffers.audioField` as a
 * ring of SPECTRO_D rows; the CPU writes one fresh row per frame (see
 * ParticleField.pushAudioRow) and points `u.audioHead` at the newest row.
 *
 * Each particle maps to a grid cell `instanceIndex mod SPECTRO_CELLS`; when the
 * particle count exceeds the grid (the usual case) the surplus particles fill the
 * same cells with a per-particle jitter, so the terrain reads as a dense glowing
 * sheet rather than a sparse lattice. Before the mic is enabled (`audioActive` 0) a
 * slow procedural ripple keeps the surface alive instead of dead-flat.
 *
 * All cell-index maths is done in float (then cast to uint only to index the
 * buffer) to avoid the uint/float-mixing pitfall that silently invalidates WGSL.
 */
export function createSpectrogramKernel({ u, buffers }: FieldContext, count: number) {
  const W = SPECTRO_W;
  const D = SPECTRO_D;
  return Fn(() => {
    const pos = buffers.positions.element(instanceIndex);
    const fi = float(instanceIndex);

    // Cell within the grid, then split into frequency column (gx) and visual depth
    // row (d, 0 = newest/front). float mod is exact for these integer magnitudes.
    const cell = fi.mod(float(SPECTRO_CELLS));
    const gx = cell.mod(float(W));
    const d = floor(cell.div(float(W)));

    // Ring lookup: newest row sits at audioHead; depth d steps back in time. The
    // large +D·64 keeps the value positive before the wrap.
    const physRow = floor(u.audioHead).sub(d).add(float(D * 64)).mod(float(D));
    const sampleIdx = physRow.mul(float(W)).add(gx);
    const amp = buffers.audioField.element(uint(sampleIdx));

    // Idle ripple shown until the mic is on, so the mode never looks broken.
    const ripple = gx
      .mul(0.20)
      .add(u.time.mul(u.timeSpeed.mul(6.0)))
      .sin()
      .mul(d.mul(0.18).sub(u.time.mul(u.timeSpeed.mul(4.0))).sin())
      .mul(0.25)
      .add(0.25);
    const height = mix(ripple, amp, u.audioActive);

    // World layout: centre the sheet on the origin, span ~the field radius.
    const span = u.radius.mul(1.7);
    const x = gx.div(float(W - 1)).sub(0.5).mul(span);
    const z = d.div(float(D - 1)).sub(0.5).mul(span);
    const y = height.mul(u.spectroHeight.mul(u.radius)).sub(u.radius.mul(0.3));

    // Per-particle jitter so the many particles sharing each cell spread across it.
    const jitter = span.div(float(W)).mul(0.5);
    const j1 = fract(fi.mul(0.0009173).add(fi.mul(12.9898).sin().mul(43758.5453))).sub(0.5);
    const j2 = fract(fi.mul(0.0007531).add(fi.mul(78.233).sin().mul(12543.654))).sub(0.5);
    const target = vec3(x.add(j1.mul(jitter)), y, z.add(j2.mul(jitter)));

    // Ease onto the target; clamp so it never overshoots at high framerates. This
    // gives the surface a fluid settle. u.delta already folds in the speed
    // multiplier (set by update()), so the speed slider scales responsiveness.
    const k = u.delta.mul(6.0).min(1.0);
    pos.assign(mix(pos, target, k));
  })().compute(count);
}
