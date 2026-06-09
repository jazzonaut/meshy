import * as THREE from 'three/webgpu';
import { instanceIndex } from 'three/tsl';
import { FIRST_GPU_MODE, SLIME_MODE, type FieldParams } from './config';
import { createUniforms, type FieldUniforms } from './uniforms';
import { createBuffers, disposeBuffers, type FieldBuffers } from './buffers';
import { createContext } from './context';
import { createInitKernel } from './kernels/init';
import { createColorKernel } from './kernels/color';
import { createPerParticleKernel } from './kernels/perParticle';
import { createFlockKernels } from './kernels/flock';
import { createSlimeKernels } from './kernels/slime';
import { createParticleMaterial, type BlendMode } from './material';

/**
 * Owns one particle system: its GPU buffers, uniforms, compute kernels, and sprite
 * material. Dispatches the right kernel pipeline per frame based on the active
 * motion mode. Construct one per particle count; call `dispose()` before replacing.
 */
export class ParticleField {
  readonly object: THREE.Object3D;
  readonly uniforms: FieldUniforms;
  readonly count: number;

  private readonly renderer: THREE.WebGPURenderer;
  private readonly buffers: FieldBuffers;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly setMaterialStyleImpl: (style: number) => void;
  private readonly setBlendModeImpl: (mode: BlendMode) => void;

  private readonly kInit: ReturnType<typeof createInitKernel>;
  private readonly kColor: ReturnType<typeof createColorKernel>;
  private readonly kPerParticle: ReturnType<typeof createPerParticleKernel>;
  private readonly kFlock: ReturnType<typeof createFlockKernels>;
  private readonly kSlime: ReturnType<typeof createSlimeKernels>;

  private speed: number;
  private simTime = 0;

  constructor(renderer: THREE.WebGPURenderer, count: number, params: FieldParams) {
    this.renderer = renderer;
    this.count = count;
    this.speed = params.speed;

    this.uniforms = createUniforms(params, count);
    this.buffers = createBuffers(count);
    const ctx = createContext(this.uniforms, this.buffers);

    this.kInit = createInitKernel(ctx, count);
    this.kColor = createColorKernel(ctx, count);
    this.kPerParticle = createPerParticleKernel(ctx, count);
    this.kFlock = createFlockKernels(ctx, count);
    this.kSlime = createSlimeKernels(ctx, count);

    const mat = createParticleMaterial(ctx, params.materialStyle);
    this.material = mat.material;
    this.setMaterialStyleImpl = mat.setMaterialStyle;
    this.setBlendModeImpl = mat.setBlendMode;

    const sprites = new THREE.Sprite(this.material);
    (sprites as any).count = count;
    sprites.frustumCulled = false;
    this.object = sprites;

    // Seed structure + colour once.
    renderer.compute(this.kInit);
    renderer.compute(this.kColor);
  }

  /** Re-run the init pass: re-arrange structure & colour with a fresh seed. */
  regenerate() {
    this.uniforms.seed.value += 1;
    this.renderer.compute(this.kInit);
    this.renderer.compute(this.kColor);
  }

  /** Advance the simulation one frame (delta seconds). */
  update(delta: number) {
    const dt = Math.min(delta, 1 / 30) * this.speed; // clamp first, then scale
    this.simTime += dt;
    this.uniforms.delta.value = dt;
    this.uniforms.time.value = this.simTime;

    const motion = this.uniforms.motion.value;
    if (motion === SLIME_MODE) {
      // Physarum: deposit trail → diffuse/decay the field → sense & crawl.
      this.renderer.compute(this.kSlime.deposit);
      this.renderer.compute(this.kSlime.diffuse);
      this.renderer.compute(this.kSlime.move);
    } else if (motion >= FIRST_GPU_MODE) {
      // Flock modes: clear → populate → mode-specific force → integrate.
      this.renderer.compute(this.kFlock.gridClear);
      this.renderer.compute(this.kFlock.gridPopulate);
      this.renderer.compute(this.kFlock.force);
      this.renderer.compute(this.kFlock.integrate);
    } else {
      this.renderer.compute(this.kPerParticle);
    }
    this.renderer.compute(this.kColor);
  }

  /** Switch the active motion mode and recolour for it. */
  setMotionMode(mode: number) {
    this.uniforms.motion.value = mode;
    this.renderer.compute(this.kColor);
  }

  /** Recompute particle colours without changing positions or velocities. */
  recolor() {
    this.renderer.compute(this.kColor);
  }

  setBlendMode(mode: BlendMode) {
    this.setBlendModeImpl(mode);
  }

  setMaterialStyle(style: number) {
    this.setMaterialStyleImpl(style);
  }

  /** Global multiplier on simulation speed (0 = paused). */
  setSpeed(v: number) {
    this.speed = v;
  }

  /**
   * Upload per-particle morph targets (tightly-packed x,y,z triples, length =
   * count·3) into the GPU targets buffer. The morph force then springs particles
   * toward them in proportion to the morphAmount uniform.
   */
  setMorphTarget(data: Float32Array) {
    const attr = this.buffers.targets.value as any;
    attr.array.set(data.subarray(0, attr.array.length));
    attr.needsUpdate = true;
  }

  dispose() {
    this.material.dispose();
    disposeBuffers(this.buffers);
  }
}
