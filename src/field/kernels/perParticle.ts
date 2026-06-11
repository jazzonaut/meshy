import { Fn, If, instanceIndex, float, mix, pow, step, cross, min, abs, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { cn } from '../tsl/curlNoise';

/**
 * UPDATE pass for the 15 single-pass, attribute-driven force fields (modes 0–14).
 * Every mode is deterministic and reads the particle's state (position, home,
 * species/colour, mass, phase); they only describe forces, while integration +
 * damping are shared at the end.
 */
export function createPerParticleKernel({ u, buffers, forces }: FieldContext, count: number, variant: 'classic' | 'experimental' = 'classic') {
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

    if (variant === 'classic') {
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
    }

    if (variant === 'experimental') {
      // 15 — Data Sonar: expanding scan fronts reveal and push hidden shells.
      If(u.motion.equal(15), () => {
      const dist = pos.length();
      const dirn = pos.div(dist.add(0.001));
      const scan = dist.mul(0.38).sub(u.time.mul(u.timeSpeed.mul(18.0))).add(phase.mul(0.2)).sin();
      const ridge = pow(scan.mul(0.5).add(0.5), 10.0);
      vel.addAssign(dirn.mul(ridge.mul(u.flowStrength.mul(7.0))).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.45)).mul(dt));
      });

    // 16 — Dream Glitch: quantised target planes, scanline tears, then recovery.
    If(u.motion.equal(16), () => {
      const grid = vec3(
        pos.x.mul(0.55).add(phase).sin(),
        pos.y.mul(0.9).add(u.time.mul(u.timeSpeed.mul(10.0))).sin(),
        pos.z.mul(0.55).sub(phase).cos(),
      );
      const tear = step(0.72, phase.add(u.time.mul(u.timeSpeed.mul(8.0))).sin().mul(0.5).add(0.5));
      vel.addAssign(grid.mul(u.flowStrength.mul(tear.add(0.25))).mul(dt));
      vel.addAssign(vec3(phase.sin(), 0, phase.cos()).mul(tear.mul(u.flowStrength.mul(2.0))).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.35)).mul(dt));
    });

    // 17 — Ecosystem: warm/cool species occupy different territories and chase
    // moving nutrient fronts, creating bloom/collapse cycles without extra state.
    If(u.motion.equal(17), () => {
      const temp = sp.mul(2.0).sub(1.0);
      const orbit = u.time.mul(u.timeSpeed.mul(3.0)).add(temp.mul(1.7));
      const nutrient = vec3(orbit.cos(), orbit.mul(1.3).sin().mul(0.45), orbit.sin()).mul(u.radius.mul(0.42));
      const d = nutrient.sub(pos);
      const dn = d.div(d.length().add(0.001));
      const rival = vec3(nutrient.x.mul(-1), nutrient.y.mul(-0.5), nutrient.z.mul(-1));
      const rd = pos.sub(rival);
      vel.addAssign(dn.mul(u.flowStrength.mul(1.4)).mul(dt));
      vel.addAssign(rd.div(rd.length().add(0.001)).mul(temp.mul(u.flowStrength.mul(0.45))).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(vec3(temp, u.time.mul(u.timeSpeed), 0))).mul(u.flowStrength.mul(0.5)).mul(dt));
    });

    // 18 — Gravity Lens: twin invisible masses bend paths into lensing arcs.
    If(u.motion.equal(18), () => {
      const ang = u.time.mul(u.timeSpeed.mul(2.0));
      const lensA = vec3(ang.cos(), ang.mul(0.7).sin().mul(0.25), ang.sin()).mul(u.radius.mul(0.38));
      const lensB = lensA.mul(-1);
      const da = lensA.sub(pos);
      const db = lensB.sub(pos);
      const la = da.length().add(0.6);
      const lb = db.length().add(0.6);
      vel.addAssign(da.div(la).mul(u.flowStrength.mul(12.0).div(la.mul(la).add(1.0))).mul(dt));
      vel.addAssign(db.div(lb).mul(u.flowStrength.mul(12.0).div(lb.mul(lb).add(1.0))).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.12)).mul(dt));
    });

    // 19 — Magnetic Sculptor: particles trace flux loops between animated poles.
    If(u.motion.equal(19), () => {
      const ang = u.time.mul(u.timeSpeed.mul(2.5));
      const poleA = vec3(ang.cos(), 0.18, ang.sin()).mul(u.radius.mul(0.5));
      const poleB = vec3(ang.add(3.14159).cos(), -0.18, ang.add(3.14159).sin()).mul(u.radius.mul(0.5));
      const toA = poleA.sub(pos);
      const toB = poleB.sub(pos);
      const field = toA.div(toA.length().add(0.4)).sub(toB.div(toB.length().add(0.4)));
      vel.addAssign(cross(field.normalize(), vec3(0, 1, 0)).mul(u.flowStrength.mul(1.6)).mul(dt));
      vel.addAssign(field.mul(u.flowStrength.mul(0.9)).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.18)).mul(dt));
    });

    // 20 — Memory Field: home-space filaments act like paths the field keeps
    // returning to; drawn pointer strokes layer on top via the shared pointer well.
    If(u.motion.equal(20), () => {
      const path = vec3(
        home.y.mul(0.28).add(phase).sin().mul(u.radius.mul(0.32)),
        home.y,
        home.y.mul(0.23).add(phase.mul(1.9)).cos().mul(u.radius.mul(0.32)),
      );
      vel.addAssign(path.sub(pos).mul(u.spring.mul(0.75)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(vec3(0, u.time.mul(u.timeSpeed), phase.cos()))).mul(u.flowStrength.mul(0.45)).mul(dt));
    });

    // 21 — Neural Firing: refractory waves charge clusters, then launch pulses
    // along branching axon-like guides.
    If(u.motion.equal(21), () => {
      const charge = phase.add(u.time.mul(u.timeSpeed.mul(14.0))).sin().mul(0.5).add(0.5);
      const fire = pow(charge, 8.0);
      const axis = vec3(home.y.mul(0.17).add(phase).sin(), 1.0, home.x.mul(0.14).add(phase).cos()).normalize();
      vel.addAssign(axis.mul(fire.mul(u.flowStrength.mul(8.0))).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.25)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale.mul(1.8))).mul(u.flowStrength.mul(0.35)).mul(dt));
    });

    // 22 — Origami Fold: animated crease planes fold the volume into facets.
    If(u.motion.equal(22), () => {
      const n = vec3(phase.sin().mul(0.65), 1.0, phase.cos().mul(0.65)).normalize();
      const side = pos.x.mul(n.x).add(pos.y.mul(n.y)).add(pos.z.mul(n.z));
      const crease = side.add(u.time.mul(u.timeSpeed.mul(8.0)).sin().mul(u.radius.mul(0.25)));
      const folded = pos.sub(n.mul(crease.mul(1.6)));
      const target = mix(home, folded, step(0.0, crease));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.15)).mul(dt));
      vel.addAssign(cross(n, pos.normalize()).mul(u.flowStrength.mul(0.45)).mul(dt));
    });

    // 23 — Plasma Globe: central core launches filaments that attach to moving
    // contact points; the shared pointer well makes this especially touchable.
    If(u.motion.equal(23), () => {
      const dist = pos.length();
      const dirn = pos.div(dist.add(0.001));
      const arc = phase.add(u.time.mul(u.timeSpeed.mul(9.0))).sin().mul(0.5).add(0.5);
      const contact = vec3(phase.sin(), phase.mul(1.7).cos().mul(0.55), phase.cos()).mul(u.radius.mul(0.62));
      const wire = contact.mul(arc);
      vel.addAssign(wire.sub(pos).mul(u.spring.mul(0.55)).mul(dt));
      vel.addAssign(dirn.mul(u.flowStrength.mul(0.8).div(dist.mul(0.08).add(1.0))).mul(dt));
    });

    // 24 — Quantum Foam: particles flicker between pair wells, annihilating into
    // radial shocklets that keep the field noisy and microscopic.
    If(u.motion.equal(24), () => {
      const pair = vec3(phase.sin(), phase.mul(1.37).cos(), phase.mul(0.73).sin()).mul(u.radius.mul(0.22));
      const flip = step(0.5, phase.add(u.time.mul(u.timeSpeed.mul(12.0))).sin().mul(0.5).add(0.5)).mul(2.0).sub(1.0);
      const target = pair.mul(flip);
      const dist = pos.sub(target).length();
      const pop = pow(dist.mul(0.5).sub(u.time.mul(u.timeSpeed.mul(10.0))).add(phase).sin().mul(0.5).add(0.5), 9.0);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(0.55)).mul(dt));
      vel.addAssign(pos.div(pos.length().add(0.001)).mul(pop.mul(u.flowStrength.mul(5.0))).mul(dt));
    });

    // 25 — Ritual Circle: symmetric rings, spokes and orbiting glyph knots.
    If(u.motion.equal(25), () => {
      const dist = vec3(pos.x, 0, pos.z).length();
      const dirn = vec3(pos.x, 0, pos.z).div(dist.add(0.001));
      const ring = u.radius.mul(0.22).add(mass.mul(u.radius.mul(0.42)));
      const glyph = phase.mul(6.0).add(u.time.mul(u.timeSpeed.mul(4.0))).sin().mul(u.radius.mul(0.06));
      const target = dirn.mul(ring.add(glyph)).add(vec3(0, phase.sin().mul(u.radius.mul(0.08)), 0));
      vel.addAssign(target.sub(pos).mul(u.spring).mul(dt));
      vel.addAssign(cross(dirn, vec3(0, 1, 0)).mul(u.flowStrength.mul(1.1)).mul(dt));
    });

    // 26 — Swarm Architecture: self-assembling arches and bridge spans.
    If(u.motion.equal(26), () => {
      const lane = step(0.5, sp).mul(2.0).sub(1.0);
      const span = home.x.div(u.radius).mul(3.14159);
      const archY = span.cos().mul(u.radius.mul(0.22)).add(u.radius.mul(0.12));
      const target = vec3(home.x, archY.mul(mass.add(0.45)), lane.mul(u.radius.mul(0.28)));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(0.9)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(vec3(u.time.mul(u.timeSpeed), 0, lane))).mul(u.flowStrength.mul(0.25)).mul(dt));
    });

    // 27 — Tectonic Plates: slabs shear in opposite directions and buckle upward
    // near procedural fault lines.
    If(u.motion.equal(27), () => {
      const plate = step(0.0, home.x.add(home.z.mul(0.35).add(phase.sin().mul(2.0)))).mul(2.0).sub(1.0);
      const fault = pow(float(1).sub(min(abs(home.x.add(home.z.mul(0.35))).div(u.radius.mul(0.45)), 1.0)), 3.0);
      vel.addAssign(vec3(plate.mul(u.flowStrength), fault.mul(u.flowStrength.mul(2.2)), plate.mul(u.flowStrength.mul(-0.45))).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.35)).mul(dt));
    });

    // 28 — Time Echo: delayed-looking orbital selves, using phase offsets and
    // damping to create temporal ghosts without storing history.
    If(u.motion.equal(28), () => {
      const delay = phase.mul(0.35);
      const a = u.time.mul(u.timeSpeed.mul(4.0)).sub(delay);
      const target = vec3(
        home.x.mul(a.cos()).sub(home.z.mul(a.sin())),
        home.y.mul(a.mul(0.7).cos()),
        home.x.mul(a.sin()).add(home.z.mul(a.cos())),
      );
      vel.addAssign(target.sub(pos).mul(u.spring.mul(0.65)).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(vec3(delay.sin(), 0, delay.cos()))).mul(u.flowStrength.mul(0.35)).mul(dt));
    });

    // 29 — Weather System: pressure cells, storm bands and lightning-like gusts.
      If(u.motion.equal(29), () => {
      const pressure = cn(pos.mul(u.flowScale).add(vec3(u.time.mul(u.timeSpeed), phase.sin(), phase.cos())));
      const cell = vec3(pressure.z.mul(-1), pressure.y.mul(0.6), pressure.x);
      const storm = pow(phase.add(u.time.mul(u.timeSpeed.mul(8.0))).sin().mul(0.5).add(0.5), 5.0);
      vel.addAssign(cell.mul(u.flowStrength.mul(1.4)).mul(dt));
      vel.addAssign(vec3(0, storm.mul(u.flowStrength.mul(-1.2)), 0).mul(dt));
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.18)).mul(dt));
      });
    }

    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);

    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(dt));
  })().compute(count);
}
