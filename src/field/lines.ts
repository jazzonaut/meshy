import * as THREE from 'three/webgpu';
import { uv, dot, vec2, max, float, mul } from 'three/tsl';
import type { FieldContext } from './context';
import { LINK_DOTS } from './config';

/**
 * The constellation overlay object: an INSTANCED sprite (one instance per dot)
 * whose position / colour / alpha come from the buffers the constellation kernel
 * fills. This is the exact `instancedArray.toAttribute()` + `SpriteNodeMaterial`
 * setup the main particle field uses — the GPU-driven render path proven to work
 * in this stack — so a dense run of dots along each link reads as a glowing
 * filament once additive blending + bloom hit it.
 */
export function createConstellationDots({ u, buffers }: FieldContext) {
  const { linkDots, linkDotCol, linkDotAlpha } = buffers;

  const material = new THREE.SpriteNodeMaterial();
  // Soft round mote (same falloff idea as the particle material).
  const beadXY = uv().mul(2.0).sub(1.0);
  const r2 = dot(beadXY, beadXY);
  const fall = max(float(1).sub(r2), 0.0).pow(1.5);

  material.positionNode = linkDots.toAttribute();
  material.colorNode = mul(linkDotCol.toAttribute(), u.lineBrightness);
  material.opacityNode = fall.mul(linkDotAlpha.toAttribute());
  material.scaleNode = vec2(u.size.mul(2.5), u.size.mul(2.5)); // a touch larger than particles so links read
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.AdditiveBlending;

  const object = new THREE.Sprite(material);
  (object as unknown as { count: number }).count = LINK_DOTS; // instance it like the field
  object.frustumCulled = false;
  object.visible = false; // off until the user enables the overlay

  return { object, material };
}
