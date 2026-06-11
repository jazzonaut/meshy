import * as THREE from 'three/webgpu';
import {
  instanceIndex,
  float,
  max,
  dot,
  pow,
  uv,
  vec2,
  vec3,
  vec4,
  mix,
  step,
  sqrt,
  saturate,
  atan,
  cameraViewMatrix,
  positionView,
} from 'three/tsl';
import type { FieldContext } from './context';

export type BlendMode = 'additive' | 'normal';

/**
 * Build the sprite material and its style/blend controls. Three looks share the
 * bead shading: Nebula Glow (flat additive), Pearl Dust (lit bead), Metallic
 * Sparks (bright specular). Style is a uniform so switching is instant.
 *
 * On top of the styles, four mode-independent "lens" controls shape every
 * particle: `softness` (radial falloff — broad haze ↔ tight mote), `coreGlow`
 * (white-hot center that blows out under bloom), `streak` (velocity stretch into
 * comet trails), and `fogDensity` (distant particles fade toward `fog` for depth).
 */
export function createParticleMaterial({ u, buffers }: FieldContext, initialStyle: number) {
  const material = new THREE.SpriteNodeMaterial();
  const particleProps = buffers.props.element(instanceIndex);
  const baseColor = buffers.colors.element(instanceIndex).mul(u.exposure);

  const beadXY = uv().mul(2.0).sub(1.0);
  const r2 = dot(beadXY, beadXY); // squared radius from sprite center (0..~2)
  const beadZ = sqrt(max(float(1).sub(r2), 0.0));
  const beadNormal = vec3(beadXY.x, beadXY.y, beadZ);
  const lightDir = vec3(-0.45, 0.55, 0.7).normalize();
  const halfDir = vec3(-0.2, 0.25, 1.0).normalize();
  const diffuse = max(dot(beadNormal, lightDir), 0.0);
  const specSoft = pow(max(dot(beadNormal, halfDir), 0.0), 28.0);
  const specTight = pow(max(dot(beadNormal, halfDir), 0.0), 96.0);
  const rim = pow(float(1).sub(beadZ), 2.0);

  const pearlColor = baseColor
    .mul(diffuse.mul(0.55).add(0.45))
    .add(vec3(1.0, 0.94, 0.84).mul(specSoft.mul(0.7)))
    .add(vec3(0.55, 0.72, 1.0).mul(rim.mul(0.2)));
  const metalTint = baseColor.mul(4.2).add(vec3(0.035, 0.025, 0.04));
  const metalShade = diffuse.mul(0.65).add(0.25);
  const metalColor = metalTint
    .mul(metalShade)
    .add(metalTint.mul(specSoft.mul(0.9)))
    .add(vec3(1.0, 0.96, 0.82).mul(specTight.mul(particleProps.w).mul(1.0)))
    .add(metalTint.mul(rim.mul(0.55)));
  const pearlMask = step(0.5, u.materialStyle);
  const metalMask = step(1.5, u.materialStyle);
  const styled = mix(mix(baseColor, pearlColor, pearlMask), metalColor, metalMask);

  // Hot core: brighten the tightest center of each mote IN ITS OWN HUE (a
  // multiplicative boost, not a mix toward white) so the ember stays coloured and
  // only the very peak rolls off to white through tone mapping. coreGlow 0 = off.
  const coreT = max(float(1).sub(r2), 0.0).pow(3.0);
  const hot = styled.mul(float(1.0).add(coreT.mul(u.coreGlow).mul(3.0)));

  // Depth fog: fade distant particles toward the fog colour so the cloud reads as
  // a real volume instead of a flat sheet. fogDensity 0 = no fade.
  const viewDist = positionView.z.negate();
  const fogT = saturate(viewDist.mul(u.fogDensity));
  const litColor = mix(hot, u.fog, fogT);

  // Soft radial opacity: pow falloff turns the hard sprite disc into a soft mote.
  // softness ~0.5 = broad haze, ~3 = tight pinprick.
  const alpha = max(float(1).sub(r2), 0.0).pow(u.softness).mul(u.fieldOpacity);

  // Velocity streaking: orient the sprite along its screen-space velocity and
  // stretch it. Project world velocity into the camera's view plane, take its
  // angle, elongate the long axis by speed·streak (and thin the short axis so the
  // mote keeps roughly constant area). streak 0 → isotropic, so rotation is moot.
  const velView = cameraViewMatrix.mul(vec4(buffers.velocities.element(instanceIndex), 0.0));
  const speed2d = vec2(velView.x, velView.y).length();
  const angle = atan(velView.y, velView.x.add(1e-5)); // +eps avoids atan(0,0)
  const longAxis = float(1).add(speed2d.mul(u.streak));
  const baseScale = u.size.mul(particleProps.w);

  material.positionNode = buffers.positions.toAttribute();
  material.colorNode = litColor;
  material.scaleNode = vec2(baseScale.mul(longAxis), baseScale.div(max(sqrt(longAxis), 1.0)));
  material.rotationNode = angle;
  material.opacityNode = alpha;
  material.transparent = true;

  // Effective depthWrite = what the blend mode wants OR what DoF forces. Tracked
  // separately so toggling one never clobbers the other.
  let blendDepthWrite = false; // additive default
  let dofDepthWrite = false;
  function applyDepthWrite() {
    // No needsUpdate: the WebGPU backend diffs depthWrite/blending/alphaToCoverage
    // against its cached pipeline state every render (WebGPUBackend.needsRenderUpdate),
    // so these re-fetch the right pipeline on their own. needsUpdate would instead
    // force a full shader-program rebuild we don't want here.
    material.depthWrite = blendDepthWrite || dofDepthWrite;
  }

  // 'additive' = glowing nebula look (overlaps brighten); 'normal' = solid dots
  // (the proven-safe fallback). Switchable at runtime.
  function setBlendMode(mode: BlendMode) {
    if (mode === 'additive') {
      material.blending = THREE.AdditiveBlending;
      blendDepthWrite = false;
      material.alphaToCoverage = false;
    } else {
      material.blending = THREE.NormalBlending;
      blendDepthWrite = true;
      material.alphaToCoverage = true;
    }
    applyDepthWrite();
  }

  function setMaterialStyle(style: number) {
    u.materialStyle.value = style;
    setBlendMode(style === 1 ? 'normal' : 'additive');
  }

  // Depth-of-field needs particles to populate the depth buffer so the post pass
  // can read per-pixel viewZ. Additive blend keeps depthWrite off (so glow
  // accumulates), so DoF flips it on while active and restores the blend default
  // when it turns off.
  function setDepthWrite(on: boolean) {
    dofDepthWrite = on;
    applyDepthWrite();
  }

  setBlendMode('additive');
  setMaterialStyle(initialStyle);

  return { material, setBlendMode, setMaterialStyle, setDepthWrite };
}
