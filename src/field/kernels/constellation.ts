import { Fn, If, Loop, instanceIndex, float, int, uint, clamp, dot, min, mix, saturate, atomicLoad, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { BUCKET_CAP, GRID_RES, MAX_LINKS, DOTS_PER, LINK_NODES } from '../config';

const SLOTS = MAX_LINKS * DOTS_PER; // dot slots owned by each node

/**
 * Build the constellation dots on the GPU. Runs over the first LINK_NODES particles;
 * each scans its 3×3×3 spatial-hash neighbourhood (the SAME grid the flock modes use —
 * the caller guarantees it's populated this frame) and links to up to MAX_LINKS nearby
 * HIGHER-indexed particles (the `j > self` rule dedupes each edge). For each link it
 * lays DOTS_PER glowing dots interpolated between the two particles, with colour and
 * alpha interpolated too. These dots are rendered as an instanced sprite — the proven
 * particle-render path — so a dense run of dots reads as a glowing filament under bloom.
 *
 * Each node owns a disjoint slice of the dot buffers (no races, no atomics). Unused
 * slots get alpha 0 (hidden). The search radius is clamped to the grid cell so the
 * 3×3×3 scan always covers it. All buffer-index maths stays in uint (the uint/float
 * mixing pitfall silently invalidates the WGSL otherwise).
 */
export function createConstellationKernel({ u, buffers, grid }: FieldContext) {
  const { cellCount, cellTable, positions, colors, linkDots, linkDotCol, linkDotAlpha } = buffers;

  return Fn(() => {
    // Materialise instanceIndex into a uint var before doing arithmetic on it —
    // the raw builtin in index expressions generates invalid WGSL here (matches the
    // r184 gotcha + three's own BitonicSort, which only does math on uint vars).
    const self = uint(instanceIndex).toVar();
    const baseDot = self.mul(uint(SLOTS)).toVar();
    const pos = positions.element(self);
    const col = colors.element(self);

    // Hide all of this node's dots by default (alpha 0, parked at its own position).
    Loop(SLOTS, ({ i: k }: any) => {
      const idx = baseDot.add(uint(k));
      linkDots.element(idx).assign(pos);
      linkDotCol.element(idx).assign(col);
      linkDotAlpha.element(idx).assign(float(0));
    });

    // DIAGNOSTIC (temporary): force each link-node's first dot fully visible at its
    // own position, so ~LINK_NODES bright dots appear regardless of link-finding.
    // If these show, the render path works and only the neighbour search is at fault;
    // if they don't, the render path itself is the problem.
    linkDotAlpha.element(baseDot).assign(float(1));

    const r = min(u.linkRadius, u.cellSize);
    const r2 = r.mul(r);
    const found = uint(0).toVar(); // link counter; uint so all index maths stays uint
    const baseCell = grid.cellCoord(pos);

    Loop(3, ({ i: ax }: any) => {
      const ox = float(ax).sub(1.0);
      Loop(3, ({ i: ay }: any) => {
        const oy = float(ay).sub(1.0);
        Loop(3, ({ i: az }: any) => {
          const oz = float(az).sub(1.0);
          const cc = clamp(baseCell.add(vec3(ox, oy, oz)), float(0), float(GRID_RES - 1));
          const cell = grid.flatCell(cc);
          const cnt = int(min(atomicLoad(cellCount.element(cell)) as any, uint(BUCKET_CAP) as any));
          Loop(cnt as any, ({ i: kk }: any) => {
            const j = cellTable.element(cell.mul(uint(BUCKET_CAP)).add(uint(kk)));
            If(j.greaterThan(self).and(found.lessThan(uint(MAX_LINKS))), () => {
              const pj = positions.element(j);
              const d = pj.sub(pos);
              const dist2 = dot(d, d);
              If(dist2.lessThan(r2), () => {
                const cj = colors.element(j);
                // Fade with length so links don't smear across explosive modes.
                const alpha = saturate(float(1).sub(dist2.sqrt().div(u.linkRadius.mul(2.0))));
                const linkBase = baseDot.add(found.mul(uint(DOTS_PER)));
                Loop(DOTS_PER, ({ i: dd }: any) => {
                  const tt = float(dd).div(float(DOTS_PER - 1));
                  const idx = linkBase.add(uint(dd));
                  linkDots.element(idx).assign(mix(pos, pj, tt));
                  linkDotCol.element(idx).assign(mix(col, cj, tt));
                  linkDotAlpha.element(idx).assign(alpha);
                });
                found.addAssign(uint(1));
              });
            });
          });
        });
      });
    });
  })().compute(LINK_NODES);
}
