import { Fn, If, instanceIndex, float, mix, pow, step, cross, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { cn } from '../tsl/curlNoise';

/**
 * UPDATE pass for the 15 single-pass, attribute-driven force fields (modes 0–14).
 * Every mode is deterministic and reads the particle's state (position, home,
 * species/colour, mass, phase); they only describe forces, while integration +
 * damping are shared at the end.
 */
export function createPerParticleKernel({ u, buffers, forces }: FieldContext, count: number) {
  return Fn(() => {
    const pos = buffers.positions.element(instanceIndex);
    const home = buffers.homes.element(instanceIndex);
    const vel = buffers.velocities.element(instanceIndex);
    const pr = buffers.props.element(instanceIndex);

    const dt = u.delta;
    const mass = pr.x;
    const phase = pr.y;
    const sp = pr.z; // species: warm≈1, cool≈0
    const tY = vec3(0, u.time.mul(u.timeSpeed), 0);

    // 0 — Ambient Curl: smooth divergence-free drift + spring to home.
    If(u.motion.equal(0), () => {
      const flow = cn(pos.mul(u.flowScale).add(tY));
      vel.addAssign(flow.mul(u.flowStrength).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring).mul(dt));
    });

    // 1 — Galactic Vortex: differential rotation about Y (faster near the
    // centre -> shearing spiral arms), gentle pull to home, light turbulence.
    If(u.motion.equal(1), () => {
      const tangent = vec3(pos.z.mul(-1), float(0), pos.x).normalize();
      const rho = vec3(pos.x, float(0), pos.z).length();
      const speed = u.flowStrength.mul(3.0).div(rho.mul(0.15).add(1.0));
      vel.addAssign(tangent.mul(speed).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.4)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale)).mul(u.flowStrength.mul(0.25)).mul(dt));
    });

    // 2 — Convection (colour-driven): warm particles rise, cool ones sink,
    // with curl turbulence — a buoyancy/fluid feel that separates by colour.
    If(u.motion.equal(2), () => {
      const temp = sp.mul(2.0).sub(1.0); // warm +1, cool -1
      vel.addAssign(vec3(0, temp.mul(u.flowStrength), 0).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(tY)).mul(u.flowStrength.mul(0.6)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.3)).mul(dt));
    });

    // 3 — Dual Attractors (colour-driven): two orbiting wells; warm is drawn to
    // one, cool to the other, each with a tangential push so they swirl.
    If(u.motion.equal(3), () => {
      const ang = u.time.mul(u.timeSpeed.mul(2.0));
      const A = vec3(ang.cos(), float(0), ang.sin()).mul(u.radius.mul(0.55));
      const B = A.mul(-1);
      const target = mix(B, A, step(0.5, sp));
      const d = target.sub(pos);
      const dirn = d.div(d.length().add(0.001));
      vel.addAssign(dirn.mul(u.flowStrength).mul(dt)); // attraction
      const tang = cross(dirn, vec3(0, 1, 0)).normalize();
      vel.addAssign(tang.mul(u.flowStrength.mul(1.6)).mul(dt)); // orbit
    });

    // 4 — Pulse Waves: radial sine waves travel outward; phase varies per
    // particle and amplitude scales with mass. Strong spring -> it oscillates.
    If(u.motion.equal(4), () => {
      const dist = pos.length();
      const wave = dist
        .mul(u.flowScale.mul(15.0))
        .sub(u.time.mul(u.timeSpeed.mul(15.0)))
        .add(phase)
        .sin();
      const dirn = pos.div(dist.add(0.001));
      vel.addAssign(dirn.mul(wave.mul(u.flowStrength).mul(mass)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring).mul(dt));
    });

    // 5 — Magnetic Field Lines: dipole-like loops around Y, with a soft pull
    // back to home so the cloud keeps its volume instead of becoming a ring.
    If(u.motion.equal(5), () => {
      const rho = vec3(pos.x, float(0), pos.z).length();
      const tangent = vec3(pos.z.mul(-1), float(0), pos.x).div(rho.add(0.001));
      const radial = vec3(pos.x, float(0), pos.z).div(rho.add(0.001));
      const loop = rho.mul(0.28).add(pos.y.mul(0.18)).add(phase).add(u.time.mul(u.timeSpeed.mul(6.0))).sin();
      vel.addAssign(tangent.mul(u.flowStrength.mul(1.7)).mul(dt));
      vel.addAssign(radial.mul(loop.mul(u.flowStrength.mul(0.6))).mul(dt));
      vel.addAssign(vec3(0, loop.mul(u.flowStrength.mul(0.8)), 0).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.35)).mul(dt));
    });

    // 6 — Tornado Column: radius-dependent spin, inward draw, and upward lift.
    If(u.motion.equal(6), () => {
      const rho = vec3(pos.x, float(0), pos.z).length();
      const tangent = vec3(pos.z.mul(-1), float(0), pos.x).div(rho.add(0.001));
      const inward = vec3(pos.x.mul(-1), float(0), pos.z.mul(-1)).div(rho.add(0.001));
      const core = float(1).div(rho.mul(0.12).add(1.0));
      const lift = core.mul(u.flowStrength.mul(2.2)).add((phase.add(u.time)).sin().mul(u.flowStrength.mul(0.15)));
      vel.addAssign(tangent.mul(core.mul(u.flowStrength.mul(5.0))).mul(dt));
      vel.addAssign(inward.mul(u.flowStrength.mul(0.55)).mul(dt));
      vel.addAssign(vec3(0, lift, 0).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.2)).mul(dt));
    });

    // 7 — Breathing Nebula: home positions expand/contract with phase offsets.
    If(u.motion.equal(7), () => {
      const dist = home.length();
      const dirn = home.div(dist.add(0.001));
      const breath = u.time.mul(u.timeSpeed.mul(8.0)).add(dist.mul(0.22)).add(phase).sin();
      const target = home.add(dirn.mul(breath.mul(u.flowStrength.mul(3.0))));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(tY)).mul(u.flowStrength.mul(0.18)).mul(dt));
    });

    // 8 — Implosion / Supernova: long collapse with sharp outward bursts.
    If(u.motion.equal(8), () => {
      const dist = pos.length();
      const dirn = pos.div(dist.add(0.001));
      const cycle = u.time.mul(u.timeSpeed.mul(4.0)).add(phase.mul(0.2)).sin().mul(0.5).add(0.5);
      const burst = pow(cycle, 7.0);
      const collapse = float(1).sub(burst).mul(-0.75);
      const force = burst.mul(9.0).add(collapse).mul(u.flowStrength);
      vel.addAssign(dirn.mul(force).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.15)).mul(dt));
    });

    // 9 — Orbital Shells: particles settle onto rotating spherical layers.
    If(u.motion.equal(9), () => {
      const dist = pos.length();
      const dirn = pos.div(dist.add(0.001));
      const shellRadius = u.radius.mul(0.35).add(mass.sub(0.5).mul(u.radius.mul(0.32)));
      const shellTarget = dirn.mul(shellRadius);
      const axis = vec3(0.35, 1.0, 0.2).normalize();
      const tangent = cross(dirn, axis).normalize();
      vel.addAssign(shellTarget.sub(pos).mul(u.spring.mul(0.7)).mul(dt));
      vel.addAssign(tangent.mul(u.flowStrength.mul(2.0)).mul(dt));
    });

    // 10 — Color Sorting: warm and cool particles separate, then curl back.
    If(u.motion.equal(10), () => {
      const temp = sp.mul(2.0).sub(1.0);
      const target = home.add(vec3(temp.mul(u.radius.mul(0.45)), float(0), temp.mul(u.radius.mul(-0.18))));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(0.65)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(tY)).mul(u.flowStrength.mul(0.45)).mul(dt));
    });

    // 11 — Electric Arcs: snap toward procedural branching filaments.
    If(u.motion.equal(11), () => {
      const travel = u.time.mul(u.timeSpeed.mul(10.0));
      const wire = vec3(
        pos.y.mul(0.45).add(phase).add(travel).sin().mul(u.radius.mul(0.42)),
        pos.y,
        pos.y.mul(0.63).add(phase.mul(1.7)).sub(travel).cos().mul(u.radius.mul(0.42)),
      );
      const d = wire.sub(pos);
      const snap = d.div(d.length().add(0.001));
      vel.addAssign(snap.mul(u.flowStrength.mul(2.1)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale.mul(1.6)).add(tY)).mul(u.flowStrength.mul(0.75)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.18)).mul(dt));
    });

    // 12 — Black Hole Accretion: fast inner orbit, inward drag, vertical squash.
    If(u.motion.equal(12), () => {
      const rho = vec3(pos.x, float(0), pos.z).length();
      const tangent = vec3(pos.z.mul(-1), float(0), pos.x).div(rho.add(0.001));
      const inward = vec3(pos.x.mul(-1), float(0), pos.z.mul(-1)).div(rho.add(0.001));
      const core = float(1).div(rho.mul(0.1).add(1.0));
      vel.addAssign(tangent.mul(core.mul(u.flowStrength.mul(6.0))).mul(dt));
      vel.addAssign(inward.mul(core.mul(u.flowStrength.mul(1.0))).mul(dt));
      vel.addAssign(vec3(0, pos.y.mul(u.flowStrength.mul(-0.65)), 0).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.08)).mul(dt));
    });

    // 13 — Flocking Swarm: procedural alignment-like flow plus weak cohesion.
    If(u.motion.equal(13), () => {
      const flow = cn(pos.mul(u.flowScale.mul(0.75)).add(vec3(phase.sin(), u.time.mul(u.timeSpeed), phase.cos())));
      const guide = cn(home.mul(u.flowScale.mul(0.35)).add(tY));
      vel.addAssign(flow.add(guide.mul(0.5)).mul(u.flowStrength.mul(1.15)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.28)).mul(dt));
    });

    // 14 — Ash Fall: downward drift with curl-wind and gentle home cohesion.
    If(u.motion.equal(14), () => {
      const wind = cn(pos.mul(u.flowScale).add(vec3(u.time.mul(u.timeSpeed), phase.sin(), 0)));
      const fall = vec3(0, mass.mul(u.flowStrength.mul(-0.8)), 0);
      vel.addAssign(fall.mul(dt));
      vel.addAssign(wind.mul(u.flowStrength.mul(0.65)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.22)).mul(dt));
    });

    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);

    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(dt));
  })().compute(count);
}
