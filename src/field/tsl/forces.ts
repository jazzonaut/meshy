import { If, instanceIndex, vec3 } from 'three/tsl';
import type { FieldUniforms } from '../uniforms';
import type { FieldBuffers } from '../buffers';
import { cn } from './curlNoise';

/**
 * Shared force terms reused across the update kernels, so the containment / wind /
 * pointer / morph logic lives in exactly one place. Each emits nodes into the
 * current compute stack and mutates the given velocity element.
 */
export function createForces(u: FieldUniforms, buffers: FieldBuffers) {
  // Cursor force well: particles within pointerRadius react to the cursor, with a
  // linear falloff to the edge. pointerMode (see POINTER_MODES in ui/types.ts)
  // selects the action; pointerActive zeroes everything when the mouse is
  // off-canvas. All actions share the cursor position, strength and radius.
  const applyPointer = (pos: any, vel: any, dt: any) => {
    const pd = pos.sub(u.pointer);
    const pl = pd.length().add(0.001);
    If(pl.lessThan(u.pointerRadius), () => {
      const dir = pd.div(pl); // outward unit vector from the cursor
      const fall = u.pointerRadius.sub(pl); // 0 at the edge, max at the centre
      const k = u.pointerStrength.mul(u.pointerActive).mul(dt); // shared scalar

      // 1 Push — shove particles outward.
      If(u.pointerMode.equal(1), () => {
        vel.addAssign(dir.mul(fall).mul(k));
      });
      // 2 Pull — draw particles inward.
      If(u.pointerMode.equal(2), () => {
        vel.subAssign(dir.mul(fall).mul(k));
      });
      // 3 Swirl — tangential orbit around the cursor (about world up).
      If(u.pointerMode.equal(3), () => {
        vel.addAssign(dir.cross(vec3(0, 1, 0)).normalize().mul(fall).mul(k));
      });
      // 4 Black Hole — swirl + inward pull, so particles spiral into the cursor.
      If(u.pointerMode.equal(4), () => {
        const tan = dir.cross(vec3(0, 1, 0)).normalize();
        vel.addAssign(tan.mul(0.7).sub(dir).mul(fall).mul(k));
      });
      // 5 Stir — inject local curl-noise turbulence to agitate the field.
      If(u.pointerMode.equal(5), () => {
        vel.addAssign(cn(pos.mul(u.flowScale.mul(3)).add(u.pointer)).mul(fall.div(u.pointerRadius)).mul(k));
      });
      // 6 Freeze — drain velocity toward stasis wherever the cursor passes.
      If(u.pointerMode.equal(6), () => {
        vel.subAssign(vel.mul(fall.div(u.pointerRadius)).mul(k.mul(0.4)));
      });
      // 7 Shell / Magnet — push toward a sphere shell at half the well radius:
      // outside it pulls in, inside it pushes out, so particles settle on the shell.
      If(u.pointerMode.equal(7), () => {
        vel.addAssign(dir.mul(u.pointerRadius.mul(0.5).sub(pl)).mul(k));
      });
      // 8 Tornado — strong tangential swirl + gentle inward pull + upward lift, so
      // particles wind up a funnel column instead of collapsing to a point (Black
      // Hole) or orbiting flat (Swirl).
      If(u.pointerMode.equal(8), () => {
        const tan = dir.cross(vec3(0, 1, 0)).normalize();
        vel.addAssign(tan.sub(dir.mul(0.4)).add(vec3(0, 0.6, 0)).mul(fall).mul(k));
      });
    });
  };

  // Soft spherical containment: particles roam freely inside the volume and are
  // only pushed back once they cross the boundary radius (radius · 1.3).
  const applyContainment = (pos: any, vel: any, dt: any) => {
    const dist = pos.length();
    const bound = u.radius.mul(1.3);
    If(dist.greaterThan(bound), () => {
      vel.addAssign(pos.div(dist).mul(bound.sub(dist)).mul(u.spring).mul(dt));
    });
  };

  // Slowly scrolling curl-noise "wind" current. `weight` is a uniform so callers
  // can drive it from flowStrength (flock) or slimeWander (slime).
  const applyWind = (pos: any, vel: any, dt: any, weight: any) => {
    const tY = vec3(0, u.time.mul(u.timeSpeed), 0);
    vel.addAssign(cn(pos.mul(u.flowScale).add(tY)).mul(weight).mul(dt));
  };

  // Spring pull toward this particle's morph target. At morphAmount 0 the term is
  // zero, so every mode behaves exactly as before until morphing is dialled in.
  const applyMorph = (pos: any, vel: any, dt: any) => {
    const target = buffers.targets.element(instanceIndex);
    vel.addAssign(target.sub(pos).mul(u.morphStrength.mul(u.morphAmount)).mul(dt));
  };

  return { applyPointer, applyContainment, applyWind, applyMorph };
}

export type Forces = ReturnType<typeof createForces>;
