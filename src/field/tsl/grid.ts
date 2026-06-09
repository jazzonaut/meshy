import { clamp, float, floor, uint } from 'three/tsl';
import { GRID_RES } from '../config';
import type { FieldUniforms } from '../uniforms';

/**
 * Spatial-hash grid coordinate helpers (flock modes). The grid is centred on the
 * origin and spans ±(GRID_RES/2 · cellSize); coords are clamped so out-of-bounds
 * particles fold into the boundary cells.
 */
export function createGridHelpers(u: FieldUniforms) {
  // World position → float cell coord in [0, GRID_RES-1].
  const cellCoord = (pos: any) => {
    const gridHalf = u.cellSize.mul(GRID_RES * 0.5);
    const c = floor(pos.add(gridHalf).div(u.cellSize));
    return clamp(c, float(0), float(GRID_RES - 1));
  };
  // Flatten an (already-clamped, float) cell coord into a linear uint cell index.
  // Kept in float until the final cast so we never mix uint with float mid-expr.
  const flatCell = (c: any) =>
    uint(c.z.mul(GRID_RES * GRID_RES).add(c.y.mul(GRID_RES)).add(c.x));

  return { cellCoord, flatCell };
}

export type GridHelpers = ReturnType<typeof createGridHelpers>;
