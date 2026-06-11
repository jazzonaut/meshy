import { Fn, If, instanceIndex, float, mix, pow, step, cross, max, sign, fract, acos, atan, dot, vec3 } from 'three/tsl';
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
      // 15 — Lorenz Drift: advect particles through the Lorenz strange attractor.
      // The flow direction (normalised for stability) condenses the cloud onto the
      // slowly tumbling twin-lobe butterfly. Fills a large region of the volume.
      If(u.motion.equal(15), () => {
        const sc = u.radius.div(26.0); // map attractor coords → our volume
        const x = pos.x.div(sc);
        const y = pos.y.div(sc);
        const z = pos.z.div(sc).add(25.0); // re-centre (Lorenz sits around z≈25)
        const d = vec3(
          y.sub(x).mul(10.0),
          x.mul(float(28.0).sub(z)).sub(y),
          x.mul(y).sub(z.mul(2.6667)),
        );
        vel.addAssign(d.div(d.length().add(0.01)).mul(u.flowStrength.mul(3.2)).mul(dt));
        forces.applyContainment(pos, vel, dt);
      });

    // 16 — Aizawa Orbit: the Aizawa attractor — a rotating spherical shell pierced
    // by a vertical spike. Constantly folds, so it never settles into a static ball.
    If(u.motion.equal(16), () => {
      const sc = u.radius.div(1.7);
      const x = pos.x.div(sc);
      const y = pos.y.div(sc);
      const z = pos.z.div(sc);
      const d = vec3(
        z.sub(0.7).mul(x).sub(y.mul(3.5)),
        x.mul(3.5).add(z.sub(0.7).mul(y)),
        float(0.6)
          .add(z.mul(0.95))
          .sub(z.mul(z).mul(z).div(3.0))
          .sub(x.mul(x).add(y.mul(y)).mul(z.mul(0.25).add(1.0)))
          .add(z.mul(x).mul(x).mul(x).mul(0.1)),
      );
      vel.addAssign(d.div(d.length().add(0.01)).mul(u.flowStrength.mul(2.6)).mul(dt));
      forces.applyContainment(pos, vel, dt);
    });

    // 17 — Cymatic Plate: particles slide down the gradient of a Chladni standing-
    // wave function so they settle onto its nodal lines, painting intricate
    // symmetric figures across a large flat plate. The (m,n) modes morph over time.
    If(u.motion.equal(17), () => {
      const t = u.time.mul(u.timeSpeed);
      const m = float(3.0).add(t.mul(0.7).sin().mul(0.5).add(0.5).mul(4.0)).floor();
      const n = float(2.0).add(t.mul(0.5).add(1.7).sin().mul(0.5).add(0.5).mul(4.0)).floor();
      const a = m.mul(3.14159265); // π·m
      const b = n.mul(3.14159265);
      const xc = pos.x.div(u.radius).mul(0.5).add(0.5); // 0..1 across the plate
      const zc = pos.z.div(u.radius).mul(0.5).add(0.5);
      const f = a.mul(xc).sin().mul(b.mul(zc).sin()).sub(b.mul(xc).sin().mul(a.mul(zc).sin()));
      const dfdx = a.mul(a.mul(xc).cos()).mul(b.mul(zc).sin()).sub(b.mul(b.mul(xc).cos()).mul(a.mul(zc).sin()));
      const dfdz = b.mul(a.mul(xc).sin()).mul(b.mul(zc).cos()).sub(a.mul(b.mul(xc).sin()).mul(a.mul(zc).cos()));
      // descend f² (= 2f∇f); /radius converts the [0,1] grad back to world units
      const gx = f.mul(dfdx).mul(2.0).div(u.radius);
      const gz = f.mul(dfdz).mul(2.0).div(u.radius);
      vel.subAssign(vec3(gx, float(0), gz).mul(u.flowStrength.mul(6.0)).mul(dt));
      // flatten onto the plate and hold a light x/z anchor so they stay spread out
      vel.addAssign(vec3(home.x.sub(pos.x).mul(0.06), pos.y.mul(-1.0), home.z.sub(pos.z).mul(0.06)).mul(u.spring).mul(dt));
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

    // 19 — Vortex Ring: a smoke ring. Particles settle onto a fat torus tube and
    // roll poloidally around it while the whole ring slowly tumbles, so the form
    // keeps drifting like a real vortex. Fills a large doughnut of the volume.
    If(u.motion.equal(19), () => {
      const major = u.radius.mul(0.5);
      const minor = u.radius.mul(0.22);
      const rho = vec3(pos.x, 0, pos.z).length().add(0.001);
      const radial = vec3(pos.x, 0, pos.z).div(rho);
      const core = radial.mul(major); // nearest point on the ring's core circle
      const toCore = pos.sub(core);
      const td = toCore.length().add(0.001);
      const tubeDir = toCore.div(td);
      const ringTan = vec3(pos.z.mul(-1), 0, pos.x).div(rho); // tangent around +y
      vel.addAssign(cross(ringTan, tubeDir).mul(u.flowStrength.mul(2.2)).mul(dt)); // poloidal roll
      vel.addAssign(tubeDir.mul(minor.sub(td)).mul(u.spring.mul(1.1)).mul(dt)); // hug the tube
      vel.addAssign(cross(vec3(1, 0, 0), pos).mul(u.timeSpeed.mul(0.6)).mul(dt)); // slow tumble
    });

    // 20 — Interference Lattice: three standing waves cross, and particles climb
    // the gradient of their summed field toward the antinodes, condensing into a
    // shimmering 3D egg-crate grid that breathes as the phases drift.
    If(u.motion.equal(20), () => {
      const t = u.time.mul(u.timeSpeed);
      const k = float(9.0).div(u.radius); // ~3 cells across the diameter
      const px = pos.x.mul(k).add(t.mul(6.0));
      const py = pos.y.mul(k).add(t.mul(7.8));
      const pz = pos.z.mul(k).add(t.mul(4.2));
      const phi = px.cos().add(py.cos()).add(pz.cos());
      const grad = vec3(px.sin(), py.sin(), pz.sin()).mul(-1.0).mul(k); // ∇φ
      vel.addAssign(grad.mul(phi).mul(2.0).mul(u.flowStrength.mul(0.5)).mul(dt)); // ascend φ²
      vel.addAssign(home.sub(pos).mul(u.spring.mul(0.05)).mul(dt)); // keep the volume filled
      forces.applyContainment(pos, vel, dt);
    });

    // 21 — Slipstream: no home spring — particles are free, advected fast along a
    // scrolling curl-noise current plus a gentle global swirl, tracing long flowing
    // filaments across the whole volume. Pairs beautifully with the streak control.
    If(u.motion.equal(21), () => {
      const flow = cn(pos.mul(u.flowScale.mul(0.6)).add(tY));
      vel.addAssign(flow.mul(u.flowStrength.mul(3.0)).mul(dt));
      const rho = vec3(pos.x, 0, pos.z).length().add(0.5);
      vel.addAssign(vec3(pos.z.mul(-1), 0, pos.x).div(rho).mul(u.flowStrength.mul(0.5)).mul(dt));
      forces.applyContainment(pos, vel, dt);
    });

    // 22 — Phyllotaxis Sphere: every particle takes a slot on a golden-spiral
    // sphere (Fibonacci/sunflower packing) so the surface is mesmerisingly even.
    // The shell breathes and rotates. A big sphere that fills the frame.
    If(u.motion.equal(22), () => {
      const i01 = fract(phase.mul(0.15915494)); // phase / 2π → 0..1 (per-particle slot)
      const yy = i01.mul(2.0).sub(1.0); // latitude −1..1
      const rr = max(float(1.0).sub(yy.mul(yy)), 0.0).sqrt();
      const ang = i01.mul(6.2831853).mul(150.0).add(u.time.mul(u.timeSpeed.mul(3.0))); // 150-turn spiral, rotating
      const shell = u.radius.mul(0.6).add(u.time.mul(u.timeSpeed.mul(2.0)).sin().mul(u.radius.mul(0.08)));
      const target = vec3(ang.cos().mul(rr), yy, ang.sin().mul(rr)).mul(shell);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(cross(vec3(0, 1, 0), pos).mul(u.timeSpeed.mul(0.5)).mul(dt));
    });

    // 23 — Möbius Band: a large half-twisted ribbon. Particles spread across its
    // width (mass) and flow around its length, so the single-sided surface reads
    // clearly as it rotates.
    If(u.motion.equal(23), () => {
      const uu = phase.add(u.time.mul(u.timeSpeed.mul(2.0))); // travel around the band
      const w = mass.mul(2.0).sub(1.0).mul(u.radius.mul(0.22)); // across the width
      const half = uu.mul(0.5);
      const rad = u.radius.mul(0.5).add(w.mul(half.cos()));
      const target = vec3(rad.mul(uu.cos()), w.mul(half.sin()), rad.mul(uu.sin()));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.05)).mul(dt));
      vel.addAssign(vec3(uu.sin().mul(-1), 0, uu.cos()).mul(u.flowStrength.mul(1.3)).mul(dt));
    });

    // 24 — Harmonic Bloom: a sphere whose radius is modulated by spherical-harmonic
    // lobes that animate, so the form blooms and pulls in like a deep-sea organism.
    If(u.motion.equal(24), () => {
      const dir = home.div(home.length().add(0.001)); // stable per-particle direction
      const theta = acos(dir.y); // polar angle
      const phi = atan(dir.z, dir.x); // azimuth
      const lobes = theta.mul(4.0).add(u.time.mul(u.timeSpeed.mul(2.0))).sin().mul(phi.mul(3.0).sin());
      const shell = u.radius.mul(0.45).add(lobes.abs().mul(u.radius.mul(0.4)));
      const target = dir.mul(shell);
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.1)).mul(dt));
      vel.addAssign(cross(vec3(0.2, 1.0, 0.1).normalize(), pos).mul(u.timeSpeed.mul(0.45)).mul(dt));
    });

    // 25 — Gravity Wells: three attractors orbit the centre; particles are pulled
    // by all three (softened inverse-distance) plus a tangential kick, so they
    // slingshot between the wells in restless streams that fill the volume.
    If(u.motion.equal(25), () => {
      const orb = u.radius.mul(0.5);
      const a0 = u.time.mul(u.timeSpeed.mul(3.0));
      const a1 = a0.add(2.0944); // +120°
      const a2 = a0.add(4.18879); // +240°
      const w1 = vec3(a0.cos(), a0.mul(0.5).sin().mul(0.6), a0.sin()).mul(orb);
      const w2 = vec3(a1.cos(), a1.mul(0.5).sin().mul(0.6), a1.sin()).mul(orb);
      const w3 = vec3(a2.cos(), a2.mul(0.5).sin().mul(0.6), a2.sin()).mul(orb);
      const soft = u.radius.mul(u.radius).mul(0.02);
      const pull = (w: any) => {
        const d = w.sub(pos);
        return d.div(dot(d, d).add(soft)).mul(u.radius);
      };
      vel.addAssign(pull(w1).add(pull(w2)).add(pull(w3)).mul(u.flowStrength.mul(1.2)).mul(dt));
      vel.addAssign(cross(w1.sub(pos), vec3(0, 1, 0)).normalize().mul(u.flowStrength.mul(0.6)).mul(dt));
      forces.applyContainment(pos, vel, dt);
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

    // 27 — Tesseract: 16 hypercube vertices rotated in 4D (x-w and y-z planes),
    // then perspective-projected to 3D. The wireframe-like cloud turns itself
    // inside-out in ways no 3D object can. Each particle holds one vertex.
    If(u.motion.equal(27), () => {
      const s1 = sign(phase.sin());
      const s2 = sign(phase.mul(1.7).cos());
      const s3 = sign(phase.mul(2.3).sin());
      const s4 = sign(mass.mul(13.0).add(phase).sin());
      const al = u.time.mul(u.timeSpeed.mul(2.0)); // x-w plane rotation
      const be = u.time.mul(u.timeSpeed.mul(1.3)); // y-z plane rotation
      const xr = s1.mul(al.cos()).sub(s4.mul(al.sin()));
      const wr = s1.mul(al.sin()).add(s4.mul(al.cos()));
      const yr = s2.mul(be.cos()).sub(s3.mul(be.sin()));
      const zr = s2.mul(be.sin()).add(s3.mul(be.cos()));
      const persp = float(2.2).div(float(2.2).sub(wr)); // project the 4th dimension in
      const target = vec3(xr, yr, zr).mul(persp).mul(u.radius.mul(0.42));
      vel.addAssign(target.sub(pos).mul(u.spring.mul(1.2)).mul(dt));
      vel.addAssign(cross(target.div(target.length().add(0.001)), vec3(0.3, 1.0, 0.2).normalize()).mul(u.flowStrength.mul(0.5)).mul(dt));
    });

    // 28 — Magnetosphere: particles ride a dipole's field lines, arcing pole-to-
    // pole on a glowing shell while gyrating around each line — Earth's aurora belts.
    If(u.motion.equal(28), () => {
      const rmag = pos.length().add(0.001);
      const rhat = pos.div(rmag);
      const mdip = vec3(0, 1, 0);
      const B = rhat.mul(dot(rhat, mdip).mul(3.0)).sub(mdip); // dipole field direction
      const Bdir = B.div(B.length().add(0.001));
      const handed = sp.mul(2.0).sub(1.0); // species sets travel direction
      vel.addAssign(Bdir.mul(handed).mul(u.flowStrength.mul(2.0)).mul(dt)); // run along the line
      vel.addAssign(cross(Bdir, rhat).mul(u.flowStrength.mul(0.8)).mul(dt)); // gyrate
      vel.addAssign(rhat.mul(u.radius.mul(0.6).sub(rmag)).mul(u.spring.mul(0.5)).mul(dt)); // hold the shell
    });

    // 29 — Thomas Tangle: the Thomas cyclically-symmetric attractor. A gentle,
    // perfectly symmetric flow that fills a cubic region with interlocking loops —
    // calmer and more lattice-like than the Lorenz/Aizawa butterflies.
      If(u.motion.equal(29), () => {
      const sc = u.radius.div(4.5);
      const x = pos.x.div(sc);
      const y = pos.y.div(sc);
      const z = pos.z.div(sc);
      const d = vec3(
        y.sin().sub(x.mul(0.19)),
        z.sin().sub(y.mul(0.19)),
        x.sin().sub(z.mul(0.19)),
      );
      vel.addAssign(d.div(d.length().add(0.01)).mul(u.flowStrength.mul(2.4)).mul(dt));
      forces.applyContainment(pos, vel, dt);
      });
    }

    forces.applyMorph(pos, vel, dt);
    forces.applyPointer(pos, vel, dt);

    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(dt));
  })().compute(count);
}
