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
      // 15 — Prism Lattice: particles snap to animated cube-edge rails, then slide
      // around the cage so the cloud reads as a bright geometric scaffold.
      If(u.motion.equal(15), () => {
        const r = u.radius.mul(0.46);
        const sx = step(0.0, home.x).mul(2.0).sub(1.0);
        const sy = step(0.0, home.y).mul(2.0).sub(1.0);
        const sz = step(0.0, home.z).mul(2.0).sub(1.0);
        const scan = u.time.mul(u.timeSpeed.mul(7.0)).add(phase);
        const railA = vec3(sx.mul(r), sy.mul(r), scan.sin().mul(r));
        const railB = vec3(scan.cos().mul(r), sy.mul(r), sz.mul(r));
        const target = mix(railA, railB, step(1.0, mass));
        const tangent = cross(target.normalize(), vec3(0.45, 1.0, 0.25).normalize()).normalize();
        vel.addAssign(target.sub(pos).mul(u.spring.mul(1.2)).mul(dt));
        vel.addAssign(tangent.mul(u.flowStrength.mul(1.4)).mul(dt));
      });

    // 16 — Rose Knot: layered polar petals rotate through each other and pull the
    // field into a flower-like knot instead of a soft ball.
    If(u.motion.equal(16), () => {
      const a = u.time.mul(u.timeSpeed.mul(5.0)).add(phase);
      const petal = a.mul(4.0).sin().mul(0.5).add(0.5);
      const r = u.radius.mul(0.16).add(pow(petal, 2.0).mul(u.radius.mul(0.34)));
      const target = vec3(
        a.cos().mul(r),
        a.mul(2.0).sin().mul(u.radius.mul(0.18)).add(sp.sub(0.5).mul(u.radius.mul(0.22))),
        a.sin().mul(r),
      );
      const tangent = vec3(a.sin().mul(-1), a.mul(2.0).cos().mul(0.7), a.cos()).normalize();
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.05)).mul(dt));
      vel.addAssign(tangent.mul(u.flowStrength.mul(1.7)).mul(dt));
    });

    // 17 — Lissajous Ribbons: three harmonic curves braid through the volume,
    // with species offsetting into separate luminous strands.
    If(u.motion.equal(17), () => {
      const lane = sp.mul(2.0).sub(1.0);
      const a = u.time.mul(u.timeSpeed.mul(4.5)).add(phase);
      const target = vec3(
        a.mul(3.0).add(lane).sin().mul(u.radius.mul(0.48)),
        a.mul(4.0).add(mass).sin().mul(u.radius.mul(0.28)),
        a.mul(5.0).add(phase.mul(0.35)).sin().mul(u.radius.mul(0.48)),
      );
      const tangent = vec3(
        a.mul(3.0).add(lane).cos().mul(3.0),
        a.mul(4.0).add(mass).cos().mul(2.0),
        a.mul(5.0).add(phase.mul(0.35)).cos().mul(5.0),
      ).normalize();
      vel.addAssign(target.sub(pos).mul(u.spring).mul(dt));
      vel.addAssign(tangent.mul(u.flowStrength.mul(1.5)).mul(dt));
    });

    // 18 — Kaleidoscope Fold: moving mirror planes fold the volume into rotating
    // facets, then throw particles sideways along the crease.
    If(u.motion.equal(18), () => {
      const a = u.time.mul(u.timeSpeed.mul(3.0)).add(phase.mul(0.35));
      const n = vec3(a.sin().mul(0.8), a.mul(1.7).cos().mul(0.6), a.cos().mul(0.8)).normalize();
      const side = pos.x.mul(n.x).add(pos.y.mul(n.y)).add(pos.z.mul(n.z));
      const fold = step(0.0, side.add(a.mul(2.0).sin().mul(u.radius.mul(0.08))));
      const mirrored = pos.sub(n.mul(side.mul(2.0)));
      const radial = home.normalize().mul(u.radius.mul(0.24).add(mass.mul(u.radius.mul(0.24))));
      const target = mix(radial, mirrored, fold);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.25)).mul(dt));
      vel.addAssign(cross(n, pos.normalize()).mul(u.flowStrength.mul(1.15)).mul(dt));
    });

    // 19 — Magnetic Trefoil: a real knot path with a secondary magnetic roll, so
    // particles circulate along a sculptural loop rather than diffuse around poles.
    If(u.motion.equal(19), () => {
      const a = u.time.mul(u.timeSpeed.mul(4.0)).add(phase);
      const target = vec3(
        a.sin().add(a.mul(2.0).sin().mul(2.0)).mul(u.radius.mul(0.16)),
        a.cos().sub(a.mul(2.0).cos().mul(2.0)).mul(u.radius.mul(0.16)),
        a.mul(3.0).sin().mul(u.radius.mul(-0.16)),
      );
      const field = target.sub(pos);
      const tangent = cross(field.normalize(), vec3(a.cos(), 0.7, a.sin()).normalize()).normalize();
      vel.addAssign(field.mul(u.spring.mul(1.15)).mul(dt));
      vel.addAssign(tangent.mul(u.flowStrength.mul(1.8)).mul(dt));
    });

    // 20 — Signal Weave: woven lanes run through the field like oscilloscope wire,
    // alternating over and under by species.
    If(u.motion.equal(20), () => {
      const lane = sp.mul(2.0).sub(1.0);
      const s = home.y.mul(0.22).add(u.time.mul(u.timeSpeed.mul(5.0))).add(phase);
      const target = vec3(
        s.sin().mul(u.radius.mul(0.38)),
        home.y.mul(0.82),
        s.mul(2.0).cos().mul(u.radius.mul(0.18)).add(lane.mul(u.radius.mul(0.22))),
      );
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(vec3(s.cos(), 0.55, s.mul(2.0).sin().mul(-1)).normalize().mul(u.flowStrength.mul(1.35)).mul(dt));
    });

    // 21 — Neon Raceway: particles lap around tilted tracks, with speed streaks
    // and lane changes based on particle species.
    If(u.motion.equal(21), () => {
      const lane = mass.sub(0.5);
      const a = u.time.mul(u.timeSpeed.mul(7.0)).add(phase);
      const r = u.radius.mul(0.26).add(lane.mul(u.radius.mul(0.13)));
      const target = vec3(
        a.cos().mul(r),
        a.mul(2.0).sin().mul(u.radius.mul(0.11)).add(sp.sub(0.5).mul(u.radius.mul(0.2))),
        a.sin().mul(r),
      );
      const boost = pow(a.mul(3.0).sin().mul(0.5).add(0.5), 5.0);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(0.95)).mul(dt));
      vel.addAssign(vec3(a.sin().mul(-1), a.mul(2.0).cos().mul(0.35), a.cos()).normalize().mul(u.flowStrength.mul(1.6).add(boost.mul(3.0))).mul(dt));
    });

    // 22 — Origami Bloom: the cloud opens and closes between a polyhedron and
    // petal arcs, with crisp crease motion.
    If(u.motion.equal(22), () => {
      const a = phase.add(u.time.mul(u.timeSpeed.mul(2.8)));
      const petal = pow(a.mul(6.0).sin().mul(0.5).add(0.5), 2.0);
      const dirn = home.normalize();
      const shell = u.radius.mul(0.18).add(petal.mul(u.radius.mul(0.34)));
      const crease = vec3(a.sin().mul(0.7), a.mul(1.3).cos(), a.cos().mul(0.7)).normalize();
      const folded = dirn.mul(shell).add(crease.mul(petal.sub(0.5).mul(u.radius.mul(0.16))));
      vel.addAssign(folded.sub(pos).mul(u.spring.mul(1.3)).mul(dt));
      vel.addAssign(cross(crease, dirn).mul(u.flowStrength.mul(0.9)).mul(dt));
    });

    // 23 — Helix Conveyor: particles ride counter-wound conveyor helices that
    // climb through the volume.
    If(u.motion.equal(23), () => {
      const handed = sp.mul(2.0).sub(1.0);
      const y = home.y.mul(0.85);
      const a = y.mul(0.28).add(u.time.mul(u.timeSpeed.mul(6.0)).mul(handed)).add(phase);
      const r = u.radius.mul(0.24).add(a.mul(3.0).sin().mul(u.radius.mul(0.05)));
      const target = vec3(a.cos().mul(r), y, a.sin().mul(r));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(vec3(a.sin().mul(-1).mul(handed), 0.8, a.cos().mul(handed)).normalize().mul(u.flowStrength.mul(1.55)).mul(dt));
    });

    // 24 — Torus Flux: particles chase nested torus-knot paths, then roll around
    // the tube so the form keeps moving after it coheres.
    If(u.motion.equal(24), () => {
      const a = u.time.mul(u.timeSpeed.mul(4.2)).add(phase);
      const tube = a.mul(3.0).add(mass).sin();
      const major = u.radius.mul(0.32);
      const minor = u.radius.mul(0.09).add(mass.sub(0.5).mul(u.radius.mul(0.035)));
      const ring = major.add(tube.mul(minor));
      const target = vec3(
        a.mul(2.0).cos().mul(ring),
        a.mul(3.0).cos().mul(minor.mul(1.2)),
        a.mul(2.0).sin().mul(ring),
      );
      vel.addAssign(target.sub(pos).mul(u.spring).mul(dt));
      vel.addAssign(cross(target.normalize(), pos.sub(target).normalize()).mul(u.flowStrength.mul(1.7)).mul(dt));
    });

    // 25 — Polyhedral Orbit: particles select hard-corner vertices and orbit the
    // implied faces, producing a faceted object with moving edges.
    If(u.motion.equal(25), () => {
      const sx = step(0.0, phase.sin()).mul(2.0).sub(1.0);
      const sy = step(0.0, phase.mul(1.7).sin()).mul(2.0).sub(1.0);
      const sz = step(0.0, phase.mul(2.3).cos()).mul(2.0).sub(1.0);
      const vertex = vec3(sx, sy, sz).normalize().mul(u.radius.mul(0.48));
      const a = u.time.mul(u.timeSpeed.mul(4.5)).add(phase);
      const faceOrbit = cross(vertex.normalize(), vec3(0.2, 1.0, 0.35).normalize()).normalize().mul(a.sin().mul(u.radius.mul(0.12)));
      const target = vertex.add(faceOrbit);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.15)).mul(dt));
      vel.addAssign(cross(vertex.normalize(), pos.normalize()).mul(u.flowStrength.mul(1.3)).mul(dt));
    });

    // 26 — Spiral Staircase: stepped orbital shelves with upward travel.
    If(u.motion.equal(26), () => {
      const a = home.y.mul(0.22).add(u.time.mul(u.timeSpeed.mul(4.5))).add(phase.mul(0.2));
      const stepBand = step(0.0, a.mul(5.0).sin()).mul(2.0).sub(1.0);
      const r = u.radius.mul(0.18).add(mass.mul(u.radius.mul(0.18)));
      const target = vec3(
        a.cos().mul(r),
        home.y.mul(0.75).add(stepBand.mul(u.radius.mul(0.045))),
        a.sin().mul(r),
      );
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(vec3(a.sin().mul(-1), 0.65, a.cos()).normalize().mul(u.flowStrength.mul(1.4)).mul(dt));
    });

    // 27 — Faultline Mandala: radial spokes shear across a moving crack and pulse
    // into nested mandala rings.
    If(u.motion.equal(27), () => {
      const dist = vec3(home.x, 0, home.z).length();
      const dirn = vec3(home.x, 0, home.z).div(dist.add(0.001));
      const spoke = pow(dirn.x.mul(5.0).add(dirn.z.mul(3.0)).add(u.time.mul(u.timeSpeed.mul(4.0))).sin().mul(0.5).add(0.5), 4.0);
      const ring = u.radius.mul(0.16).add(mass.mul(u.radius.mul(0.32))).add(spoke.mul(u.radius.mul(0.08)));
      const fault = step(0.0, home.x.add(home.z.mul(0.45)).add(u.time.mul(u.timeSpeed.mul(3.0)).sin().mul(u.radius.mul(0.1)))).mul(2.0).sub(1.0);
      const target = dirn.mul(ring).add(vec3(fault.mul(u.radius.mul(0.06)), spoke.mul(u.radius.mul(0.14)), fault.mul(u.radius.mul(-0.06))));
      vel.addAssign(target.sub(pos).mul(u.spring).mul(dt));
      vel.addAssign(cross(dirn, vec3(0, 1, 0)).mul(u.flowStrength.mul(1.25).mul(fault)).mul(dt));
    });

    // 28 — Time Loom: delayed ellipses weave through each other like animated
    // warp and weft threads.
    If(u.motion.equal(28), () => {
      const delay = phase.mul(0.55);
      const a = u.time.mul(u.timeSpeed.mul(4.6)).sub(delay);
      const lane = step(0.5, sp).mul(2.0).sub(1.0);
      const target = vec3(
        a.sin().mul(u.radius.mul(0.42)),
        a.mul(2.0).add(delay).sin().mul(u.radius.mul(0.22)).add(lane.mul(u.radius.mul(0.16))),
        a.mul(3.0).cos().mul(u.radius.mul(0.34)),
      );
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.05)).mul(dt));
      vel.addAssign(vec3(a.cos(), a.mul(2.0).cos(), a.mul(3.0).sin().mul(-1)).normalize().mul(u.flowStrength.mul(1.35)).mul(dt));
    });

    // 29 — Storm Glyphs: cyclone bands are constrained into sharp moving symbols,
    // with lightning pulses snapping particles between strokes.
      If(u.motion.equal(29), () => {
      const a = u.time.mul(u.timeSpeed.mul(5.4)).add(phase);
      const bolt = pow(a.mul(4.0).sin().mul(0.5).add(0.5), 8.0);
      const r = u.radius.mul(0.18).add(a.mul(3.0).sin().mul(0.5).add(0.5).mul(u.radius.mul(0.34)));
      const glyph = vec3(
        a.cos().mul(r).add(a.mul(5.0).sin().mul(bolt).mul(u.radius.mul(0.12))),
        a.mul(2.0).sin().mul(u.radius.mul(0.24)),
        a.sin().mul(r).add(a.mul(7.0).cos().mul(bolt).mul(u.radius.mul(0.12))),
      );
      vel.addAssign(glyph.sub(pos).mul(u.spring).mul(dt));
      vel.addAssign(vec3(a.sin().mul(-1), bolt.mul(1.6).sub(0.2), a.cos()).normalize().mul(u.flowStrength.mul(1.6).add(bolt.mul(3.5))).mul(dt));
      vel.addAssign(cn(pos.mul(u.flowScale).add(vec3(a.sin(), a.cos(), phase.cos()))).mul(u.flowStrength.mul(0.25)).mul(dt));
      });
    }

    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);

    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(dt));
  })().compute(count);
}
