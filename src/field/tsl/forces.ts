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
  // Cursor force well: particles within pointerRadius get pushed along
  // (pos − pointer): positive strength repels, negative attracts; linear falloff
  // to the edge. pointerActive zeroes it when the mouse is off-canvas.
  const applyPointer = (pos: any, vel: any, dt: any) => {
    const pd = pos.sub(u.pointer);
    const pl = pd.length().add(0.001);
    If(pl.lessThan(u.pointerRadius), () => {
      vel.addAssign(
        pd.div(pl).mul(u.pointerRadius.sub(pl)).mul(u.pointerStrength).mul(u.pointerActive).mul(dt),
      );
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
