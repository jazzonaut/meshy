import { Fn, float, vec3, mx_noise_vec3 } from 'three/tsl';

/**
 * Divergence-free curl of a 3D value-noise potential field. Produces smooth,
 * swirling, incompressible flow — the classic look for drifting dust/nebula.
 */
export const curlNoise = /*#__PURE__*/ Fn(([p]: any) => {
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

/** Loosely-typed curl-noise callable for use inside compute kernels. */
export const cn = curlNoise as (p: any) => any;
