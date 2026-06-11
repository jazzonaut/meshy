import * as THREE from 'three/webgpu';
import { instanceIndex } from 'three/tsl';
import { FIRST_EXPERIMENTAL_MODE, FIRST_GPU_MODE, SLIME_MODE, type FieldParams } from './config';
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
  private readonly ctx: ReturnType<typeof createContext>;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly setMaterialStyleImpl: (style: number) => void;
  private readonly setBlendModeImpl: (mode: BlendMode) => void;
  private readonly setDepthWriteImpl: (on: boolean) => void;

  // Init + colour kernels are cheap to build and needed for every seed/recolour,
  // so they're eager. The four heavy motion-kernel graphs (classic / experimental /
  // flock / slime) are built lazily on first use — at boot only the *active* mode's
  // graph is constructed and compiled, which keeps the cold-start path light. (A
  // mode the user switches to later compiles on its first dispatch, exactly as it
  // did before this was made lazy.)
  private readonly kInit: ReturnType<typeof createInitKernel>;
  private readonly kColor: ReturnType<typeof createColorKernel>;
  private _kPerParticle?: ReturnType<typeof createPerParticleKernel>;
  private _kExperimental?: ReturnType<typeof createPerParticleKernel>;
  private _kFlock?: ReturnType<typeof createFlockKernels>;
  private _kSlime?: ReturnType<typeof createSlimeKernels>;

  private speed: number;
  private simTime = 0;
  private seeded = false;

  constructor(renderer: THREE.WebGPURenderer, count: number, params: FieldParams) {
    this.renderer = renderer;
    this.count = count;
    this.speed = params.speed;

    this.uniforms = createUniforms(params, count);
    this.buffers = createBuffers(count);
    this.ctx = createContext(this.uniforms, this.buffers);

    this.kInit = createInitKernel(this.ctx, count);
    this.kColor = createColorKernel(this.ctx, count);

    const mat = createParticleMaterial(this.ctx, params.materialStyle);
    this.material = mat.material;
    this.setMaterialStyleImpl = mat.setMaterialStyle;
    this.setBlendModeImpl = mat.setBlendMode;
    this.setDepthWriteImpl = mat.setDepthWrite;

    const sprites = new THREE.Sprite(this.material);
    (sprites as any).count = count;
    sprites.frustumCulled = false;
    this.object = sprites;

    // No GPU work here: seeding is deferred to warmup()/seed() so the cold-start
    // shader compile happens off the constructor's synchronous critical path.
  }

  // Lazily-built motion kernels (see field declarations above).
  private get kPerParticle() {
    return (this._kPerParticle ??= createPerParticleKernel(this.ctx, this.count, 'classic'));
  }
  private get kExperimental() {
    return (this._kExperimental ??= createPerParticleKernel(this.ctx, this.count, 'experimental'));
  }
  private get kFlock() {
    return (this._kFlock ??= createFlockKernels(this.ctx, this.count));
  }
  private get kSlime() {
    return (this._kSlime ??= createSlimeKernels(this.ctx, this.count));
  }

  /**
   * Seed particle structure asynchronously. Uses {@link THREE.WebGPURenderer#computeAsync}
   * (the non-blocking pipeline-creation path) so the WGSL → pipeline compile happens
   * off the main thread, leaving the UI — and the loading spinner — responsive.
   */
  async warmupSeed() {
    await this.renderer.computeAsync(this.kInit);
    this.seeded = true;
  }

  /**
   * Async-compile the compute pipelines the first frame will dispatch for the
   * *current* motion mode (a shared link / preset may have set a non-default one).
   * Mirrors the branch selection in {@link update}; running each kernel once is what
   * triggers compilation. Only the active mode is compiled — other modes compile on
   * their first dispatch when the user switches to them.
   */
  async warmupMotion() {
    const c = this.renderer;
    const motion = this.uniforms.motion.value;
    if (motion === SLIME_MODE) {
      await c.computeAsync(this.kSlime.deposit);
      await c.computeAsync(this.kSlime.diffuse);
      await c.computeAsync(this.kSlime.move);
    } else if (motion >= FIRST_GPU_MODE) {
      await c.computeAsync(this.kFlock.gridClear);
      await c.computeAsync(this.kFlock.gridPopulate);
      await c.computeAsync(this.kFlock.force);
      await c.computeAsync(this.kFlock.integrate);
    } else if (motion >= FIRST_EXPERIMENTAL_MODE) {
      await c.computeAsync(this.kExperimental);
    } else {
      await c.computeAsync(this.kPerParticle);
    }
  }

  /** Async-compile + run the colour pass. */
  async warmupColor() {
    await this.renderer.computeAsync(this.kColor);
  }

  /**
   * Synchronously seed structure + colour. Used on the warm paths (rebuild after a
   * count change, regenerate) where the init/colour pipelines are already compiled,
   * so the compute is just a fast dispatch — no shader-compile stall.
   */
  seed() {
    this.renderer.compute(this.kInit);
    this.renderer.compute(this.kColor);
    this.seeded = true;
  }

  /** Seed if warmup never ran (e.g. it failed) so the first frame isn't all-origin. */
  ensureSeeded() {
    if (!this.seeded) this.seed();
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
    } else if (motion >= FIRST_EXPERIMENTAL_MODE) {
      this.renderer.compute(this.kExperimental);
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

  /** Force particles to write depth (so depth-of-field can read per-pixel viewZ). */
  setDepthWrite(on: boolean) {
    this.setDepthWriteImpl(on);
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
