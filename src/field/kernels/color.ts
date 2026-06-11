import { Fn, instanceIndex, float, min, mix, pow, step, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';

/**
 * COLOR pass: per-mode palette strategies selected by `u.motion`. Each line blends
 * in a mode's palette gated by a step window around its index, so the modes don't
 * interfere. Runs every frame (cheap) so motion that affects colour stays live.
 */
export function createColorKernel({ u, buffers, trail }: FieldContext, count: number) {
  return Fn(() => {
    const home = buffers.homes.element(instanceIndex);
    const pos = buffers.positions.element(instanceIndex);
    const vel = buffers.velocities.element(instanceIndex);
    const col = buffers.colors.element(instanceIndex);
    const pr = buffers.props.element(instanceIndex);

    const dist = home.length();
    const r01 = min(dist.div(u.radius.mul(1.65)), 1.0);
    const speed01 = min(vel.length().mul(0.35), 1.0);
    const height01 = home.y.div(u.radius).mul(0.5).add(0.5);
    const mass = pr.x;
    const phase = pr.y;
    const sp = pr.z;
    const star = pr.w;
    const baseBright = star.mul(0.12).add(0.035);
    const userWarmCool = mix(u.cool, u.warm, sp);
    const cycle = u.time.mul(u.timeSpeed.mul(4.0)).add(phase.mul(0.2)).sin().mul(0.5).add(0.5);
    const pulse = dist.mul(u.flowScale.mul(18.0)).sub(u.time.mul(u.timeSpeed.mul(12.0))).add(phase).sin().mul(0.5).add(0.5);

    let color = mix(userWarmCool, vec3(0.44, 0.72, 1.0), r01.mul(0.45)).mul(baseBright);
    color = mix(color, mix(vec3(1.0, 0.72, 0.25), vec3(0.18, 0.42, 1.0), r01).mul(baseBright.mul(1.15)), step(0.5, u.motion).mul(float(1).sub(step(1.5, u.motion))));
    color = mix(color, mix(vec3(0.14, 0.42, 1.0), vec3(1.0, 0.32, 0.1), sp).mul(baseBright.mul(1.25)), step(1.5, u.motion).mul(float(1).sub(step(2.5, u.motion))));
    color = mix(color, mix(vec3(0.0, 0.82, 1.0), vec3(1.0, 0.16, 0.66), sp).mul(baseBright.mul(1.35)), step(2.5, u.motion).mul(float(1).sub(step(3.5, u.motion))));
    color = mix(color, mix(vec3(0.2, 0.25, 1.0), vec3(1.0, 0.85, 0.28), pulse).mul(baseBright.mul(1.3)), step(3.5, u.motion).mul(float(1).sub(step(4.5, u.motion))));
    color = mix(color, mix(vec3(0.12, 0.22, 1.0), vec3(1.0, 0.16, 0.1), step(0.5, height01)).add(vec3(0.75, 0.9, 1.0).mul(pulse.mul(0.35))).mul(baseBright), step(4.5, u.motion).mul(float(1).sub(step(5.5, u.motion))));
    color = mix(color, mix(vec3(0.08, 0.5, 0.58), vec3(1.0, 0.48, 0.16), height01).add(vec3(1.0, 0.9, 0.64).mul(speed01)).mul(baseBright), step(5.5, u.motion).mul(float(1).sub(step(6.5, u.motion))));
    color = mix(color, mix(vec3(0.42, 0.25, 1.0), vec3(1.0, 0.42, 0.62), pulse).mul(baseBright.mul(1.2)), step(6.5, u.motion).mul(float(1).sub(step(7.5, u.motion))));
    color = mix(color, mix(vec3(0.8, 0.08, 0.02), vec3(1.0, 0.96, 0.72), pow(cycle, 5.0)).mul(baseBright.mul(1.55)), step(7.5, u.motion).mul(float(1).sub(step(8.5, u.motion))));
    color = mix(color, mix(vec3(0.13, 0.55, 1.0), vec3(0.95, 0.35, 1.0), mass.sub(0.5)).mul(baseBright.mul(1.1)), step(8.5, u.motion).mul(float(1).sub(step(9.5, u.motion))));
    color = mix(color, mix(vec3(0.0, 0.55, 1.0), vec3(1.0, 0.22, 0.05), sp).mul(baseBright.mul(1.45)), step(9.5, u.motion).mul(float(1).sub(step(10.5, u.motion))));
    color = mix(color, mix(vec3(0.1, 0.35, 1.0), vec3(0.7, 1.0, 1.0), pulse).mul(baseBright.mul(1.65)), step(10.5, u.motion).mul(float(1).sub(step(11.5, u.motion))));
    color = mix(color, mix(vec3(0.02, 0.04, 0.18), vec3(1.0, 0.65, 0.18), float(1).sub(r01)).add(vec3(0.15, 0.45, 1.0).mul(speed01)).mul(baseBright.mul(1.25)), step(11.5, u.motion).mul(float(1).sub(step(12.5, u.motion))));
    color = mix(color, mix(vec3(0.25, 1.0, 0.48), vec3(0.42, 0.42, 1.0), phase.sin().mul(0.5).add(0.5)).add(vec3(0.0, 0.9, 1.0).mul(speed01.mul(0.35))).mul(baseBright), step(12.5, u.motion).mul(float(1).sub(step(13.5, u.motion))));
    color = mix(color, mix(vec3(0.22, 0.08, 0.035), vec3(1.0, 0.34, 0.08), pulse.mul(float(1).sub(height01).add(0.15))).mul(baseBright.mul(1.15)), step(13.5, u.motion).mul(float(1).sub(step(14.5, u.motion))));
    // 15–29 — Experimental modes. Each is still a single pass; palettes are keyed
    // by the same index windows as the motion branches above.
    color = mix(color, mix(vec3(0.02, 0.16, 0.32), vec3(0.7, 1.0, 1.0), pulse).mul(baseBright.mul(1.7)), step(14.5, u.motion).mul(float(1).sub(step(15.5, u.motion))));
    color = mix(color, mix(vec3(0.9, 0.08, 0.55), vec3(0.1, 0.95, 1.0), phase.sin().mul(0.5).add(0.5)).mul(baseBright.mul(1.45)), step(15.5, u.motion).mul(float(1).sub(step(16.5, u.motion))));
    color = mix(color, mix(vec3(0.22, 0.95, 0.42), vec3(1.0, 0.3, 0.18), sp).mul(baseBright.mul(1.35)).add(vec3(0.95, 1.0, 0.5).mul(speed01.mul(0.35))), step(16.5, u.motion).mul(float(1).sub(step(17.5, u.motion))));
    color = mix(color, mix(vec3(0.03, 0.02, 0.12), vec3(0.95, 0.72, 1.0), float(1).sub(r01)).add(vec3(0.25, 0.55, 1.0).mul(speed01)), step(17.5, u.motion).mul(float(1).sub(step(18.5, u.motion))));
    color = mix(color, mix(vec3(0.05, 0.45, 0.7), vec3(1.0, 0.28, 0.12), phase.sin().mul(0.5).add(0.5)).add(vec3(0.9, 1.0, 1.0).mul(speed01.mul(0.45))).mul(baseBright.mul(1.35)), step(18.5, u.motion).mul(float(1).sub(step(19.5, u.motion))));
    color = mix(color, mix(vec3(0.08, 0.12, 0.18), vec3(0.35, 1.0, 0.72), pulse).add(userWarmCool.mul(0.25)).mul(baseBright.mul(1.4)), step(19.5, u.motion).mul(float(1).sub(step(20.5, u.motion))));
    color = mix(color, mix(vec3(0.1, 0.18, 0.38), vec3(1.0, 0.94, 0.36), pow(cycle, 8.0)).add(vec3(0.25, 0.65, 1.0).mul(speed01)).mul(baseBright.mul(1.55)), step(20.5, u.motion).mul(float(1).sub(step(21.5, u.motion))));
    color = mix(color, mix(vec3(0.82, 0.16, 0.8), vec3(0.95, 0.78, 0.42), step(0.5, height01)).mul(baseBright.mul(1.3)), step(21.5, u.motion).mul(float(1).sub(step(22.5, u.motion))));
    color = mix(color, mix(vec3(0.08, 0.24, 0.55), vec3(1.0, 0.18, 0.72), pulse).add(vec3(0.55, 0.8, 1.0).mul(speed01.mul(0.5))).mul(baseBright.mul(1.55)), step(22.5, u.motion).mul(float(1).sub(step(23.5, u.motion))));
    color = mix(color, mix(vec3(0.25, 0.1, 0.65), vec3(1.0, 0.92, 0.72), pow(cycle, 5.0)).mul(baseBright.mul(1.7)), step(23.5, u.motion).mul(float(1).sub(step(24.5, u.motion))));
    color = mix(color, mix(vec3(0.42, 0.05, 0.58), vec3(1.0, 0.68, 0.22), r01).add(vec3(0.75, 0.45, 1.0).mul(pulse.mul(0.35))).mul(baseBright.mul(1.4)), step(24.5, u.motion).mul(float(1).sub(step(25.5, u.motion))));
    color = mix(color, mix(vec3(0.18, 0.5, 0.92), vec3(1.0, 0.88, 0.5), mass).add(vec3(1.0, 1.0, 1.0).mul(star.mul(0.05))).mul(baseBright.mul(1.35)), step(25.5, u.motion).mul(float(1).sub(step(26.5, u.motion))));
    color = mix(color, mix(vec3(0.25, 0.48, 0.42), vec3(1.0, 0.22, 0.08), height01).add(vec3(1.0, 0.85, 0.5).mul(speed01.mul(0.45))).mul(baseBright.mul(1.3)), step(26.5, u.motion).mul(float(1).sub(step(27.5, u.motion))));
    color = mix(color, mix(vec3(0.15, 0.22, 0.55), vec3(0.9, 0.95, 1.0), phase.sin().mul(0.5).add(0.5)).mul(baseBright.mul(1.35)).add(userWarmCool.mul(0.12)), step(27.5, u.motion).mul(float(1).sub(step(28.5, u.motion))));
    color = mix(color, mix(vec3(0.05, 0.18, 0.28), vec3(0.95, 0.95, 0.72), speed01).add(vec3(0.35, 0.7, 1.0).mul(pulse.mul(0.35))).mul(baseBright.mul(1.45)), step(28.5, u.motion).mul(float(1).sub(step(29.5, u.motion))));
    // 30 — Boids: colour by speed (cool when cruising, hot when darting), with a
    // faint white kick so fast-moving leaders flare under bloom.
    color = mix(color, mix(vec3(0.12, 0.45, 1.0), vec3(1.0, 0.42, 0.12), speed01).add(vec3(0.7, 0.85, 1.0).mul(pow(speed01, 3.0).mul(0.6))).mul(baseBright.mul(1.4)), step(29.5, u.motion).mul(float(1).sub(step(30.5, u.motion))));
    // 31 — Predator Scatter: calm cyan cruising → hot red/white panic when fleeing.
    color = mix(color, mix(vec3(0.1, 0.6, 0.9), vec3(1.0, 0.14, 0.05), speed01).add(vec3(1.0, 0.9, 0.78).mul(pow(speed01, 2.0).mul(0.8))).mul(baseBright.mul(1.5)), step(30.5, u.motion).mul(float(1).sub(step(31.5, u.motion))));
    // 32 — Liquid Droplets: mercury/teal — deep teal pooling to bright cyan-white
    // along the fast-moving surface of each bead.
    color = mix(color, mix(vec3(0.02, 0.18, 0.22), vec3(0.55, 0.95, 1.0), speed01).add(vec3(0.85, 1.0, 1.0).mul(pow(speed01, 3.0).mul(0.55))).mul(baseBright.mul(1.5)), step(31.5, u.motion).mul(float(1).sub(step(32.5, u.motion))));
    // 33 — Crystallize: icy prism — violet → cyan → white by radius, plus a hard
    // white sparkle on the star particles for a faceted, gem-like glint.
    color = mix(color, mix(mix(vec3(0.35, 0.2, 0.9), vec3(0.2, 0.8, 1.0), r01), vec3(0.9, 0.95, 1.0), pow(r01, 3.0)).mul(baseBright.mul(1.5)).add(vec3(1.0, 1.0, 1.0).mul(star.mul(0.06))), step(32.5, u.motion).mul(float(1).sub(step(33.5, u.motion))));
    // 34 — Slime Mold: bioluminescent veins — brightness from the local trail
    // density so the self-organised network glows along its strands.
    const trailGlow = min(trail.sampleTrail(pos).mul(0.6), 1.0);
    color = mix(color, mix(vec3(0.0, 0.12, 0.09), vec3(0.25, 1.0, 0.65), trailGlow).add(vec3(0.6, 1.0, 0.85).mul(pow(trailGlow, 2.0).mul(0.7))).mul(baseBright.mul(1.6)), step(33.5, u.motion));

    col.assign(color);
  })().compute(count);
}
