import { Fn, If, Loop, instanceIndex, atomicAdd, atomicLoad, atomicStore, float, int, uint, clamp, dot, min, mix, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { BUCKET_CAP, BOIDS_MODE, PREDATOR_MODE, DROPLET_MODE, CRYSTAL_MODE, GRID_RES, NUM_CELLS } from '../config';

/**
 * The GPU flock pipeline (modes 15–18) shares one spatial-hash grid, rebuilt each
 * frame: clear → populate → mode-specific force → integrate. Positions are
 * read-only during clear/populate/force and only moved in integrate, so the
 * neighbour gather sees a consistent snapshot (no intra-pass position race).
 */
export function createFlockKernels(ctx: FieldContext, count: number) {
  const { u, buffers, grid, forces } = ctx;
  const { cellCount, cellTable, positions, velocities, homes } = buffers;

  // 1. Zero every cell counter.
  const gridClear = Fn(() => {
    atomicStore(cellCount.element(instanceIndex), uint(0));
  })().compute(NUM_CELLS);

  // 2. Each particle appends its index into its cell's bucket. atomicAdd returns
  // the slot claimed; drop the particle if the cell is already full.
  const gridPopulate = Fn(() => {
    const pos = positions.element(instanceIndex);
    const cell = grid.flatCell(grid.cellCoord(pos));
    const slot = atomicAdd(cellCount.element(cell), uint(1)) as any;
    If(slot.lessThan(uint(BUCKET_CAP)), () => {
      cellTable.element(cell.mul(uint(BUCKET_CAP)).add(slot)).assign(instanceIndex);
    });
  })().compute(count);

  // 3. Gather the 3×3×3 cell neighbourhood and apply the mode's steer.
  const force = Fn(() => {
    const self = instanceIndex;
    const pos = positions.element(self);
    const vel = velocities.element(self);

    const sep = vec3(0).toVar(); // away from close neighbours (inverse-square)
    const ali = vec3(0).toVar(); // summed neighbour velocity
    const coh = vec3(0).toVar(); // summed neighbour position
    const n = float(0).toVar(); // neighbour count

    const base = grid.cellCoord(pos);
    const r2 = u.boidPerception.mul(u.boidPerception);

    Loop(3, ({ i: ax }: any) => {
      const ox = float(ax).sub(1.0);
      Loop(3, ({ i: ay }: any) => {
        const oy = float(ay).sub(1.0);
        Loop(3, ({ i: az }: any) => {
          const oz = float(az).sub(1.0);
          const cc = clamp(base.add(vec3(ox, oy, oz)), float(0), float(GRID_RES - 1));
          const cell = grid.flatCell(cc);
          const cnt = int(min(atomicLoad(cellCount.element(cell)) as any, uint(BUCKET_CAP) as any));
          Loop(cnt as any, ({ i: k }: any) => {
            const j = cellTable.element(cell.mul(uint(BUCKET_CAP)).add(uint(k)));
            If(j.notEqual(self), () => {
              const pj = positions.element(j);
              const d = pj.sub(pos);
              const dist2 = dot(d, d);
              If(dist2.lessThan(r2).and(dist2.greaterThan(0.0001)), () => {
                coh.addAssign(pj);
                ali.addAssign(velocities.element(j));
                sep.subAssign(d.div(dist2)); // push away, stronger when closer
                n.addAssign(1.0);
              });
            });
          });
        });
      });
    });

    const dt = u.delta;
    const m = u.motion;

    // Neighbour-driven steering. Each mode mixes separation / alignment / cohesion
    // differently; the baked multipliers are the recipe and the Boids folder
    // sliders scale them globally.
    If(n.greaterThan(0.5), () => {
      const invN = float(1.0).div(n);
      const cohForce = coh.mul(invN).sub(pos); // toward local centre of mass
      const aliForce = ali.mul(invN).sub(vel); // match average heading

      // Boids — balanced classic flocking.
      If(m.equal(BOIDS_MODE), () => {
        vel.addAssign(cohForce.mul(u.boidCoh).mul(dt));
        vel.addAssign(aliForce.mul(u.boidAli).mul(dt));
        vel.addAssign(sep.mul(u.boidSep).mul(dt));
      });
      // Predator Scatter — same flocking; the flee impulse is added below.
      If(m.equal(PREDATOR_MODE), () => {
        vel.addAssign(cohForce.mul(u.boidCoh).mul(dt));
        vel.addAssign(aliForce.mul(u.boidAli).mul(dt));
        vel.addAssign(sep.mul(u.boidSep).mul(dt));
      });
      // Liquid Droplets — surface tension: strong local cohesion + short-range
      // separation bead the field into merging / splitting droplets.
      If(m.equal(DROPLET_MODE), () => {
        vel.addAssign(cohForce.mul(u.boidCoh.mul(2.6)).mul(dt));
        vel.addAssign(sep.mul(u.boidSep.mul(1.3)).mul(dt));
        vel.addAssign(aliForce.mul(u.boidAli.mul(0.35)).mul(dt));
      });
      // Crystallize — even-spacing repulsion + faint cohesion settles the swarm
      // into a shimmering quasi-lattice.
      If(m.equal(CRYSTAL_MODE), () => {
        vel.addAssign(sep.mul(u.boidSep.mul(2.0)).mul(dt));
        vel.addAssign(cohForce.mul(u.boidCoh.mul(0.3)).mul(dt));
      });
    });

    // Stragglers that found NO neighbours get none of the steering above, so the
    // min-speed cruise would carry them off on the shared wind as a coherent,
    // tightly-packed thread — a bright "worm"/arc once bloom hits the star
    // particles in it (worst on a sparse field, e.g. the 250k mobile default).
    // Steer the loners back toward their home so they rejoin the flock and the
    // thread dissolves; particles that are actually flocking are untouched.
    If(n.lessThan(0.5), () => {
      vel.addAssign(homes.element(self).sub(pos).mul(u.spring.mul(0.6)).mul(dt));
    });

    // Predator: a single point sweeps through the flock; nearby boids flee it. It
    // auto-orbits, but follows the cursor whenever the pointer is active.
    If(m.equal(PREDATOR_MODE), () => {
      const pang = u.time.mul(u.timeSpeed.mul(3.0));
      const autoPred = vec3(pang.cos(), pang.mul(0.6).sin().mul(0.45), pang.sin()).mul(u.radius.mul(0.85));
      const predator = mix(autoPred, u.pointer, u.pointerActive);
      const away = pos.sub(predator);
      const pd = away.length().add(0.001);
      const fleeR = u.radius.mul(0.55);
      If(pd.lessThan(fleeR), () => {
        vel.addAssign(away.div(pd).mul(fleeR.sub(pd)).mul(u.flowStrength.mul(4.0)).mul(dt));
      });
    });

    forces.applyWind(pos, vel, dt, u.flowStrength); // Crystallize sets flowStrength 0
    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);
    forces.applyContainment(pos, vel, dt);

    // Max-speed clamp for every GPU mode.
    const spd = vel.length().max(0.0001);
    If(spd.greaterThan(u.boidMaxSpeed), () => {
      vel.assign(vel.div(spd).mul(u.boidMaxSpeed));
    });
    // Min-speed cruise for the moving modes — a real flock never stalls. Crystallize
    // is exempt so it can come to rest and lock into its lattice.
    If(m.notEqual(CRYSTAL_MODE), () => {
      const s2 = vel.length().max(0.0001);
      const minS = u.boidMaxSpeed.mul(0.35);
      If(s2.lessThan(minS), () => {
        vel.assign(vel.div(s2).mul(minS));
      });
    });
  })().compute(count);

  // 4. Damp velocity and advance position.
  const integrate = Fn(() => {
    const vel = velocities.element(instanceIndex);
    const pos = positions.element(instanceIndex);
    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(u.delta));
  })().compute(count);

  return { gridClear, gridPopulate, force, integrate };
}
