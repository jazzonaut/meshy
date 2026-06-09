import * as THREE from 'three/webgpu';
import { instanceIndex, float, max, dot, pow, uv, vec3, mix, step, sqrt, shapeCircle } from 'three/tsl';
import type { FieldContext } from './context';

export type BlendMode = 'additive' | 'normal';

/**
 * Build the sprite material and its style/blend controls. Three looks share the
 * bead shading: Nebula Glow (flat additive), Pearl Dust (lit bead), Metallic
 * Sparks (bright specular). Style is a uniform so switching is instant.
 */
export function createParticleMaterial({ u, buffers }: FieldContext, initialStyle: number) {
  const material = new THREE.SpriteNodeMaterial();
  const particleProps = buffers.props.element(instanceIndex);
  const baseColor = buffers.colors.element(instanceIndex).mul(u.exposure);

  const beadXY = uv().mul(2.0).sub(1.0);
  const beadZ = sqrt(max(float(1).sub(dot(beadXY, beadXY)), 0.0));
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

  material.positionNode = buffers.positions.toAttribute();
  material.colorNode = mix(mix(baseColor, pearlColor, pearlMask), metalColor, metalMask);
  material.scaleNode = u.size.mul(particleProps.w);
  material.opacityNode = shapeCircle();
  material.transparent = true;

  // 'additive' = glowing nebula look (overlaps brighten); 'normal' = solid dots
  // (the proven-safe fallback). Switchable at runtime.
  function setBlendMode(mode: BlendMode) {
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

  function setMaterialStyle(style: number) {
    u.materialStyle.value = style;
    setBlendMode(style === 1 ? 'normal' : 'additive');
  }

  setBlendMode('additive');
  setMaterialStyle(initialStyle);

  return { material, setBlendMode, setMaterialStyle };
}
