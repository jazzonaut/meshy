import type { FieldBuffers } from './buffers';
import type { FieldUniforms } from './uniforms';
import { createForces, type Forces } from './tsl/forces';
import { createGridHelpers, type GridHelpers } from './tsl/grid';
import { createTrailHelpers, type TrailHelpers } from './tsl/trail';

/**
 * Everything the compute-kernel builders need, assembled once: the uniforms, the
 * GPU buffers, and the TSL helper bundles bound to them. Passing this single
 * object keeps each kernel module free of cross-cutting wiring.
 */
export interface FieldContext {
  u: FieldUniforms;
  buffers: FieldBuffers;
  grid: GridHelpers;
  trail: TrailHelpers;
  forces: Forces;
}

export function createContext(u: FieldUniforms, buffers: FieldBuffers): FieldContext {
  return {
    u,
    buffers,
    grid: createGridHelpers(u),
    trail: createTrailHelpers(u, buffers),
    forces: createForces(u, buffers),
  };
}
