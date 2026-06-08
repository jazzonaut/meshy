import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  instanceIndex,
  instancedArray,
  uniform,
  float,
  vec3,
  vec4,
  hash,
  mix,
  step,
  cross,
  shapeCircle,
  mx_noise_float,
  mx_noise_vec3,
  mx_fractal_noise_vec3,
} from 'three/tsl';

/** Motion modes — index matches the `motion` uniform / GUI dropdown order. */
export const MOTION_MODES = [
  'Ambient Curl',
  'Galactic Vortex',
  'Convection (color)',
  'Dual Attractors (color)',
  'Pulse Waves',
] as const;

/**
 * Tunable parameters for the field. Anything used inside `computeInit`
 * (structure / colour) takes effect after calling `regenerate()`. Anything used
 * inside `computeUpdate` (motion) takes effect immediately on the next frame.
 */
export interface FieldParams {
  // Structure (needs regenerate)
  radius: number;
  warpScale: number;
  warpStrength: number;
  // Motion (live)
  speed: number; // global multiplier on the whole simulation timestep
  flowScale: number;
  flowStrength: number;
  timeSpeed: number;
  spring: number;
  damping: number;
  // Look (live)
  size: number;
  exposure: number;
  warmColor: THREE.ColorRepresentation;
  coolColor: THREE.ColorRepresentation;
  // Motion mode index (live)
  motion: number;
}

export const DEFAULT_PARAMS: FieldParams = {
  speed: 1.0,
  radius: 18,
  warpScale: 0.06,
  warpStrength: 14,
  flowScale: 0.12,
  flowStrength: 1.4,
  timeSpeed: 0.06,
  spring: 0.7,
  damping: 0.93,
  size: 0.085,
  exposure: 0.4,
  warmColor: '#e8581f',
  coolColor: '#6fa8ff',
  motion: 0,
};

/**
 * Divergence-free curl of a 3D value-noise potential field. Produces smooth,
 * swirling, incompressible flow — the classic look for drifting dust/nebula.
 */
const curlNoise = /*#__PURE__*/ Fn(([p]: any) => {
  const e = float(0.25);
  const dx = vec3(e, 0, 0);
  const dy = vec3(0, e, 0);
  const dz = vec3(0, 0, e);

  const px0 = mx_noise_vec3(p.sub(dx));
  const px1 = mx_noise_vec3(p.add(dx));
  const py0 = mx_noise_vec3(p.sub(dy));
  const py1 = mx_noise_vec3(p.add(dy));
  const pz0 = mx_noise_vec3(p.sub(dz));
  const pz1 = mx_noise_vec3(p.add(dz));

  const x = py1.z.sub(py0.z).sub(pz1.y.sub(pz0.y));
  const y = pz1.x.sub(pz0.x).sub(px1.z.sub(px0.z));
  const z = px1.y.sub(px0.y).sub(py1.x.sub(py0.x));

  return vec3(x, y, z).div(e.mul(2));
});

export interface ParticleField {
  object: THREE.Object3D;
  uniforms: ReturnType<typeof makeUniforms>;
  count: number;
  /** Re-run the init pass: re-arranges structure & colour with a fresh seed. */
  regenerate: () => void;
  /** Advance the simulation one frame (delta seconds). */
  update: (delta: number) => void;
  /** Switch between glowing additive and solid normal blending. */
  setBlendMode: (mode: 'additive' | 'normal') => void;
  /** Global multiplier on simulation speed (0 = paused). */
  setSpeed: (v: number) => void;
  dispose: () => void;
}

function makeUniforms(p: FieldParams) {
  return {
    delta: uniform(1 / 60),
    time: uniform(0),
    seed: uniform(0),
    radius: uniform(p.radius),
    warpScale: uniform(p.warpScale),
    warpStrength: uniform(p.warpStrength),
    flowScale: uniform(p.flowScale),
    flowStrength: uniform(p.flowStrength),
    timeSpeed: uniform(p.timeSpeed),
    spring: uniform(p.spring),
    damping: uniform(p.damping),
    size: uniform(p.size),
    exposure: uniform(p.exposure),
    motion: uniform(p.motion),
    warm: uniform(new THREE.Color(p.warmColor)),
    cool: uniform(new THREE.Color(p.coolColor)),
  };
}

export function createParticleField(
  renderer: THREE.WebGPURenderer,
  count: number,
  params: FieldParams,
): ParticleField {
  const u = makeUniforms(params);

  // GPU storage buffers — never touched by the CPU after creation.
  const positions = instancedArray(count, 'vec3');
  const homes = instancedArray(count, 'vec3'); // anchor each particle drifts around
  const velocities = instancedArray(count, 'vec3');
  const colors = instancedArray(count, 'vec3');
  // Per-particle attributes that motion logic reads:
  // x = mass (inertia / force response), y = phase (wave offset),
  // z = species (0 = cool, 1 = warm — tied to colour), w = size factor.
  const props = instancedArray(count, 'vec4');

  // ---- INIT: arrange particles into warped filaments, assign colour ----------
  const computeInit = Fn(() => {
    const pos = positions.element(instanceIndex);
    const home = homes.element(instanceIndex);
    const vel = velocities.element(instanceIndex);
    const col = colors.element(instanceIndex);
    const pr = props.element(instanceIndex);

    // Build float seeds from the (uint) instance index — never mix uint+float
    // inside one expression or the generated WGSL is invalid.
    const fi = float(instanceIndex);
    const seedF = u.seed.mul(1013.0);
    const h1 = hash(fi.add(seedF).add(0.123)) as any;
    const h2 = hash(fi.mul(2.0).add(seedF).add(11.71)) as any;
    const h3 = hash(fi.mul(3.0).add(seedF).add(101.3)) as any;
    const h4 = hash(fi.mul(5.0).add(seedF).add(57.9)) as any;

    // Independent random directions — centroid is ~0 for large counts, and the
    // structure stays organic (no forced symmetry). Fill the whole ball with an
    // outward bias so the centre stays sparse rather than a dense blob; the odd-
    // symmetric warp below keeps the noise bias from drifting it off-origin.
    const dir = vec3(h1, h2, h3).mul(2).sub(1).normalize();
    const r = h4.pow(0.5).mul(u.radius);
    const seedOffset = vec3(u.seed.mul(3.17), u.seed.mul(1.91), u.seed.mul(2.53));
    const base = dir.mul(r);

    // Warp into wispy filaments. We use an ODD-symmetric noise displacement
    // — 0.5*(noise(+q) - noise(-q)) — which is an odd function of position, so
    // displacements cancel across the symmetric shell and the cloud's centroid
    // stays pinned at the origin (otherwise the noise DC offset drifts it off).
    const q1 = base.mul(u.warpScale);
    const w1 = mx_fractal_noise_vec3(q1.add(seedOffset))
      .sub(mx_fractal_noise_vec3(q1.mul(-1).add(seedOffset)))
      .mul(0.5)
      .mul(u.warpStrength);
    const q2 = base.mul(u.warpScale.mul(2.3));
    const w2 = mx_fractal_noise_vec3(q2.add(seedOffset))
      .sub(mx_fractal_noise_vec3(q2.mul(-1).add(seedOffset)))
      .mul(0.5)
      .mul(u.warpStrength.mul(0.4));
    const p = base.add(w1).add(w2);

    home.assign(p);
    pos.assign(p);
    vel.assign(vec3(0));

    // Colour: blend warm<->cool by a low-frequency noise field, vary brightness
    // so most particles are dim dust and a few burn bright (the "stars").
    const t = mx_noise_float(p.mul(0.04).add(seedOffset)).mul(0.5).add(0.5);
    const tint = mix(u.warm, u.cool, t);
    // Most particles are very dim dust; a steep curve lets a rare few burn
    // bright. Overall brightness comes from additive overlap + exposure, so keep
    // the per-particle baseline low to avoid the blown-out white core.
    const bright = h1.pow(5.0).mul(0.9).add(0.03);
    col.assign(tint.mul(bright));

    // Per-particle attributes. species = 1 for warm (t≈0), 0 for cool (t≈1),
    // so colour and motion stay visually correlated. Bright particles ("stars")
    // are also bigger.
    const mass = float(0.5).add(h2.mul(1.0)); // 0.5..1.5
    const phase = h3.mul(6.2831853); // 0..2π
    const species = float(1.0).sub(t); // warm -> 1, cool -> 0
    const sizeFactor = float(0.5).add(h1.pow(4.0).mul(2.5)); // dim≈0.5, stars up to ~3
    pr.assign(vec4(mass, phase, species, sizeFactor));
  })().compute(count);

  // ---- UPDATE: attribute-driven force fields, selected by u.motion ----------
  // Every mode is deterministic and reads the particle's state (position, home,
  // species/colour, mass, phase). They write into `vel`; integration + damping
  // are shared below so the modes only describe forces.
  const cn = curlNoise as any;
  const computeUpdate = Fn(() => {
    const pos = positions.element(instanceIndex);
    const home = homes.element(instanceIndex);
    const vel = velocities.element(instanceIndex);
    const pr = props.element(instanceIndex);

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

    vel.mulAssign(u.damping);
    pos.addAssign(vel.mul(dt));
  })().compute(count);

  // ---- RENDER: additive round sprites ---------------------------------------
  const material = new THREE.SpriteNodeMaterial();
  material.positionNode = positions.toAttribute();
  material.colorNode = colors.element(instanceIndex).mul(u.exposure);
  material.scaleNode = u.size.mul(props.element(instanceIndex).w);
  material.opacityNode = shapeCircle();
  material.transparent = true;

  // 'additive' = glowing nebula look (overlaps brighten); 'normal' = solid dots
  // (the proven-safe fallback). Switchable at runtime.
  function setBlendMode(mode: 'additive' | 'normal') {
    if (mode === 'additive') {
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
      material.alphaToCoverage = false;
    } else {
      material.blending = THREE.NormalBlending;
      material.depthWrite = true;
      material.alphaToCoverage = true;
    }
    material.needsUpdate = true;
  }
  setBlendMode('additive');

  const sprites = new THREE.Sprite(material);
  (sprites as any).count = count;
  sprites.frustumCulled = false;

  renderer.compute(computeInit);

  // Speed scales the whole timestep. We integrate our own simulation clock so
  // field evolution (noise scroll, attractor orbit, waves) tracks the same
  // multiplier as the particle motion — one dial controls everything.
  let speed = params.speed;
  let simTime = 0;

  return {
    object: sprites,
    uniforms: u,
    count,
    regenerate() {
      u.seed.value += 1;
      renderer.compute(computeInit);
    },
    update(delta: number) {
      const dt = Math.min(delta, 1 / 30) * speed; // clamp first, then scale
      simTime += dt;
      u.delta.value = dt;
      u.time.value = simTime;
      renderer.compute(computeUpdate);
    },
    setBlendMode,
    setSpeed(v: number) {
      speed = v;
    },
    dispose() {
      material.dispose();
      positions.dispose?.();
      homes.dispose?.();
      velocities.dispose?.();
      colors.dispose?.();
      props.dispose?.();
    },
  };
}
