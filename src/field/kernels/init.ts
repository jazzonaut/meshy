import { Fn, hash, instanceIndex, float, sqrt, vec3, vec4, mx_noise_float, mx_fractal_noise_vec3 } from 'three/tsl';
import type { FieldContext } from '../context';

/**
 * INIT pass: arrange particles into warped filaments and assign per-particle
 * attributes (mass / phase / species / size). Colour is computed separately so
 * mode switches can recolour without rebuilding the structure.
 */
export function createInitKernel({ u, buffers }: FieldContext, count: number) {
  return Fn(() => {
    const pos = buffers.positions.element(instanceIndex);
    const home = buffers.homes.element(instanceIndex);
    const vel = buffers.velocities.element(instanceIndex);
    const pr = buffers.props.element(instanceIndex);

    // Build float seeds from the (uint) instance index — never mix uint+float
    // inside one expression or the generated WGSL is invalid.
    const fi = float(instanceIndex);
    const seedF = u.seed.mul(1013.0);
    const h1 = hash(fi.add(seedF).add(0.123)) as any;
    const h2 = hash(fi.mul(2.0).add(seedF).add(11.71)) as any;
    const h3 = hash(fi.mul(3.0).add(seedF).add(101.3)) as any;
    const h4 = hash(fi.mul(5.0).add(seedF).add(57.9)) as any;

    // A Fibonacci sphere gives a well-balanced centroid without mirrored twins.
    // The warp below stays odd-symmetric around the origin, so it does not add a
    // directional DC offset to the balanced base distribution.
    const z = float(1).sub(fi.add(0.5).div(u.particleCount).mul(2.0));
    const xy = sqrt(float(1).sub(z.mul(z)));
    const angle = fi.mul(2.399963229728653).add(seedF);
    const dir = vec3(angle.cos().mul(xy), z, angle.sin().mul(xy));
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

    const t = mx_noise_float(p.mul(0.04).add(seedOffset)).mul(0.5).add(0.5);
    const mass = float(0.5).add(h2.mul(1.0)); // 0.5..1.5
    const phase = h3.mul(6.2831853); // 0..2π
    const species = float(1.0).sub(t); // warm -> 1, cool -> 0
    const sizeFactor = float(0.5).add(h1.pow(4.0).mul(2.5)); // dim≈0.5, stars up to ~3
    pr.assign(vec4(mass, phase, species, sizeFactor));
  })().compute(count);
}
