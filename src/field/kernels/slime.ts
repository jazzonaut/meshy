import { Fn, If, instanceIndex, atomicAdd, atomicLoad, atomicStore, float, int, uint, clamp, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { TRAIL_FIXED, TRAIL_RES, TRAIL_CELLS } from '../config';

/**
 * The Physarum (slime mould) pipeline (mode 19). Three passes/frame: deposit
 * (agents lay trail) → diffuse (blur + decay the field, in place) → sense/move
 * (agents climb the trail gradient + wander). The feedback loop — deposit where
 * you go, then steer toward where others have been — self-organises into branching
 * transport networks.
 */
export function createSlimeKernels(ctx: FieldContext, count: number) {
  const { u, buffers, trail, forces } = ctx;
  const { positions, velocities, trailDeposit, trailField } = buffers;

  // 1. Each agent adds a fixed-point blob of trail into its current cell.
  const deposit = Fn(() => {
    const pos = positions.element(instanceIndex);
    const cell = trail.trailFlat(trail.trailCoord(pos));
    atomicAdd(trailDeposit.element(cell), uint(Math.round(TRAIL_FIXED)));
  })().compute(count);

  // 2. Diffuse + decay the field. 6-neighbour box blur (in place — the small race
  // is visually harmless), times decay, plus this frame's deposit; then clear the
  // deposit buffer for next frame.
  const diffuse = Fn(() => {
    const idx = instanceIndex;
    const x = int(idx.mod(uint(TRAIL_RES)));
    const y = int(idx.div(uint(TRAIL_RES)).mod(uint(TRAIL_RES)));
    const z = int(idx.div(uint(TRAIL_RES * TRAIL_RES)));
    const here = trailField.element(idx);
    const sum6 = trailField
      .element(trail.flatTrailI(x.add(1), y, z))
      .add(trailField.element(trail.flatTrailI(x.sub(1), y, z)))
      .add(trailField.element(trail.flatTrailI(x, y.add(1), z)))
      .add(trailField.element(trail.flatTrailI(x, y.sub(1), z)))
      .add(trailField.element(trail.flatTrailI(x, y, z.add(1))))
      .add(trailField.element(trail.flatTrailI(x, y, z.sub(1))));
    const blurred = here.add(sum6.mul(0.5)).div(4.0); // weights 1 + 6·0.5 = 4
    const dep = float(atomicLoad(trailDeposit.element(idx)) as any).div(TRAIL_FIXED);
    here.assign(blurred.mul(u.slimeDecay).add(dep));
    atomicStore(trailDeposit.element(idx), uint(0));
  })().compute(TRAIL_CELLS);

  // 3. Sense the trail gradient (central differences), steer up it, plus a
  // curl-noise wander that seeds branches; integrate at a near-constant crawl.
  const move = Fn(() => {
    const pos = positions.element(instanceIndex);
    const vel = velocities.element(instanceIndex);
    const dt = u.delta;

    const cs = trail.trailCellSize();
    const gx = trail.sampleTrail(pos.add(vec3(cs, 0, 0))).sub(trail.sampleTrail(pos.sub(vec3(cs, 0, 0))));
    const gy = trail.sampleTrail(pos.add(vec3(0, cs, 0))).sub(trail.sampleTrail(pos.sub(vec3(0, cs, 0))));
    const gz = trail.sampleTrail(pos.add(vec3(0, 0, cs))).sub(trail.sampleTrail(pos.sub(vec3(0, 0, cs))));
    const grad = vec3(gx, gy, gz);
    const gl = grad.length();
    If(gl.greaterThan(0.0001), () => {
      vel.addAssign(grad.div(gl).mul(u.slimeSense).mul(dt));
    });

    forces.applyWind(pos, vel, dt, u.slimeWander);
    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);
    forces.applyContainment(pos, vel, dt);

    // Near-constant crawl speed (slime agents move steadily, not ballistically).
    vel.mulAssign(u.damping);
    const spd = vel.length().max(0.0001);
    const cruise = clamp(spd, u.boidMaxSpeed.mul(0.5), u.boidMaxSpeed);
    vel.assign(vel.div(spd).mul(cruise));
    pos.addAssign(vel.mul(dt));
  })().compute(count);

  return { deposit, diffuse, move };
}
