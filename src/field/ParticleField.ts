import * as THREE from 'three/webgpu';
import { FIRST_EXPERIMENTAL_MODE, FIRST_GPU_MODE, FIRST_AUDIO_MODE, SLIME_MODE, SPECTRO_MODE, SPECTRO_W, SPECTRO_D, SPECTRO_CELLS, colorIsDynamic, type FieldParams } from './config';
import { createUniforms, type FieldUniforms } from './uniforms';
import { createBuffers, disposeBuffers, type FieldBuffers } from './buffers';
import { createContext } from './context';
import { createInitKernel } from './kernels/init';
import { createColorKernel } from './kernels/color';
import { createPerParticleKernel } from './kernels/perParticle';
import { createFlockKernels } from './kernels/flock';
import { createSlimeKernels } from './kernels/slime';
import { createSpectrogramKernel } from './kernels/spectrogram';
import { createAudioModesKernel } from './kernels/audioModes';
import { createConstellationKernel } from './kernels/constellation';
import { createConstellationDots } from './lines';
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

  // Constellation overlay (off by default): an instanced sprite of link dots.
  private readonly linkObject: THREE.Sprite;
  private readonly linkMaterial: THREE.SpriteNodeMaterial;
  private linksOn = false;

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
  private _kSpectro?: ReturnType<typeof createSpectrogramKernel>;
  private _kAudio?: ReturnType<typeof createAudioModesKernel>;
  private _kConstellation?: ReturnType<typeof createConstellationKernel>;

  private speed: number;
  private simTime = 0;
  private seeded = false;
  // CPU mirror of the audio ring buffer + its newest-row pointer (Spectrogram mode).
  private readonly audioHistory = new Float32Array(SPECTRO_CELLS);
  private audioHead = 0;

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

    // The particle sprites and the (optional) constellation dots share one parent
    // so the gizmo/controls transform them together; both read the same buffers.
    const dots = createConstellationDots(this.ctx);
    this.linkObject = dots.object;
    this.linkMaterial = dots.material;

    const group = new THREE.Group();
    group.add(sprites);
    group.add(this.linkObject);
    this.object = group;

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
  private get kSpectro() {
    return (this._kSpectro ??= createSpectrogramKernel(this.ctx, this.count));
  }
  private get kAudio() {
    return (this._kAudio ??= createAudioModesKernel(this.ctx, this.count));
  }
  private get kConstellation() {
    return (this._kConstellation ??= createConstellationKernel(this.ctx));
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
    if (motion >= FIRST_AUDIO_MODE) {
      await c.computeAsync(motion === SPECTRO_MODE ? this.kSpectro : this.kAudio);
    } else if (motion === SLIME_MODE) {
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
    if (motion >= FIRST_AUDIO_MODE) {
      // Audio instrument modes: ease particles onto the live mic-driven layout.
      // Spectrogram keeps its own ring-buffer terrain kernel; the rest share one.
      this.renderer.compute(motion === SPECTRO_MODE ? this.kSpectro : this.kAudio);
    } else if (motion === SLIME_MODE) {
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
    // Skip the full-count colour dispatch for modes whose palette can't change
    // frame to frame (it reads only static per-particle attrs + home). Mode switch,
    // recolour and regenerate still run it, so the colour stays correct.
    if (colorIsDynamic(motion)) this.renderer.compute(this.kColor);
    if (this.linksOn) this.buildLinks();
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

  /** Fade the whole field's particles (0 = invisible). For A/B cross-fading. */
  setOpacity(o: number) {
    this.uniforms.fieldOpacity.value = o;
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

  /**
   * Push one fresh FFT row (length ≥ SPECTRO_W, normalised 0..1) into the audio
   * ring buffer for the Spectrogram Waterfall mode, advance the ring head, and
   * re-upload. Marks audio active so the waterfall shows live amplitude instead of
   * the idle ripple. Same cheap upload path as {@link setMorphTarget}.
   */
  pushAudioRow(spectrum: Float32Array) {
    const row = this.audioHead;
    this.audioHistory.set(spectrum.subarray(0, SPECTRO_W), row * SPECTRO_W);
    this.uniforms.audioHead.value = row;
    this.uniforms.audioActive.value = 1;
    const attr = this.buffers.audioField.value as any;
    attr.array.set(this.audioHistory);
    attr.needsUpdate = true;
    this.audioHead = (row + 1) % SPECTRO_D;
  }

  /** Gate the waterfall between live mic amplitude (true) and the idle ripple. */
  setAudioActive(on: boolean) {
    this.uniforms.audioActive.value = on ? 1 : 0;
  }

  /** Show/hide the constellation overlay. Builds the topology once on enable so it
   *  appears immediately (even while paused) and warms the kernel. */
  setConstellation(on: boolean) {
    this.linksOn = on;
    this.linkObject.visible = on;
    if (on) this.buildLinks();
  }

  /** Link search radius (clamped to the grid cell in-shader) + line brightness. */
  setLinkParams(radius: number, brightness: number) {
    this.uniforms.linkRadius.value = radius;
    this.uniforms.lineBrightness.value = brightness;
  }

  /**
   * Recompute the constellation topology. Ensures the spatial-hash grid is populated:
   * the flock modes already rebuild it each frame, so reuse it then; otherwise run a
   * clear + populate first (the grid is otherwise idle in those modes).
   */
  private buildLinks() {
    const motion = this.uniforms.motion.value;
    // Only the flock force modes (Boids…Crystallize) rebuild the grid each frame;
    // Slime, the audio modes and Spectrogram leave it idle, so populate it first.
    const flockGridReady = motion >= FIRST_GPU_MODE && motion < SLIME_MODE;
    if (!flockGridReady) {
      this.renderer.compute(this.kFlock.gridClear);
      this.renderer.compute(this.kFlock.gridPopulate);
    }
    this.renderer.compute(this.kConstellation);
  }

  dispose() {
    this.material.dispose();
    this.linkMaterial.dispose();
    disposeBuffers(this.buffers);
  }
}
