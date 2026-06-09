import { clamp, float, floor, int, uint } from 'three/tsl';
import { TRAIL_RES } from '../config';
import type { FieldBuffers } from '../buffers';
import type { FieldUniforms } from '../uniforms';

/**
 * Physarum trail-field coordinate + sampling helpers. The field extent tracks the
 * containment radius so it always covers the agents.
 */
export function createTrailHelpers(u: FieldUniforms, buffers: FieldBuffers) {
  const trailHalf = () => u.radius.mul(1.3);
  const trailCellSize = () => u.radius.mul(2.6 / TRAIL_RES);

  // World position → float trail coord in [0, TRAIL_RES-1].
  const trailCoord = (p: any) =>
    clamp(floor(p.add(trailHalf()).div(trailCellSize())), float(0), float(TRAIL_RES - 1));
  const trailFlat = (c: any) =>
    uint(c.z.mul(TRAIL_RES * TRAIL_RES).add(c.y.mul(TRAIL_RES)).add(c.x));

  // Flatten integer cell coords (clamped to bounds) — used by the diffusion pass
  // where neighbour indices come from int arithmetic (avoids uint underflow at 0).
  const clampI = (v: any) => (clamp as any)(v, int(0), int(TRAIL_RES - 1));
  const flatTrailI = (xi: any, yi: any, zi: any) =>
    uint(clampI(zi).mul(TRAIL_RES * TRAIL_RES).add(clampI(yi).mul(TRAIL_RES)).add(clampI(xi)));

  // Sample the trail field at a world position (nearest cell).
  const sampleTrail = (p: any) => buffers.trailField.element(trailFlat(trailCoord(p)));

  return { trailCellSize, trailCoord, trailFlat, flatTrailI, sampleTrail };
}

export type TrailHelpers = ReturnType<typeof createTrailHelpers>;
