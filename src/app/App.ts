import * as THREE from 'three/webgpu';
import { ParticleField, generateMorphTarget, DEFAULT_PARAMS, MOTION_PRESETS, MOTION_MODES, type FieldParams, type MorphShape } from '../field';
import { createRenderer } from './createRenderer';
import { Stage } from './Stage';
import { Controls } from './Controls';
import { PointerTracker } from './PointerTracker';
import { createPostprocessing, type Postprocessing } from './Postprocessing';
import { Capture } from './Capture';
import { StatsOverlay } from './StatsOverlay';
import { readHash, buildShareUrl, type SceneState } from './presetUrl';
import { isMobileLike } from './device';
import type { Controller, ViewState, PointerState, MorphState, DemoState } from './ui/types';

const COUNT_OPTIONS: Record<string, number> = {
  '100k': 100_000,
  '250k': 250_000,
  '500k': 500_000,
  '1M': 1_000_000,
};

export interface AppOptions {
  /**
   * Wrap a shared UI-state object so a reactive framework (Vue) can observe it.
   * Defaults to identity, which keeps the engine completely framework-agnostic —
   * the engine mutates these objects directly and, when wrapped in a reactive
   * proxy, the UI updates automatically (presets, demo-reel, shared URLs).
   */
  wrapState?: <T extends object>(state: T) => T;
}

/**
 * Top-level orchestrator: owns the renderer, the particle field (swapped on count
 * change), the camera/gizmo controls, pointer tracking, postprocessing, capture,
 * and drives the render loop. It exposes a {@link Controller} for the UI layer to
 * bind to, but knows nothing about how that UI is built. Construct via
 * {@link App.create}.
 */
export class App {
  /** The seam the UI binds to. */
  readonly controller: Controller;

  private readonly params: FieldParams;
  private readonly view: ViewState;
  private readonly pointerState: PointerState;
  private readonly morphState: MorphState;
  private readonly demo: DemoState;
  private demoElapsed = 0;
  // Lighter default on phone-class devices; a shared link / preset still overrides.
  private count = COUNT_OPTIONS[isMobileLike() ? '250k' : '500k'];

  private field: ParticleField;
  private readonly stage = new Stage();
  private readonly controls: Controls;
  private readonly pointer: PointerTracker;
  private readonly post: Postprocessing;
  private readonly capture: Capture;
  private readonly stats = new StatsOverlay();
  private readonly clock = new THREE.Clock();

  private constructor(
    private readonly renderer: THREE.WebGPURenderer,
    opts: AppOptions,
  ) {
    const wrap = opts.wrapState ?? (<T extends object>(s: T) => s);
    this.params = wrap<FieldParams>({ ...DEFAULT_PARAMS });
    this.view = wrap<ViewState>({ autoRotate: false, gizmo: false, axes: false, countLabel: isMobileLike() ? '250k' : '500k' });
    this.pointerState = wrap<PointerState>({ mode: 'Off' });
    this.morphState = wrap<MorphState>({ shape: 'None' });
    this.demo = wrap<DemoState>({ enabled: false, interval: 6, fps: false });

    this.loadFromHash(); // a shared URL overrides the defaults before we build

    this.field = new ParticleField(renderer, this.count, this.params);
    this.stage.scene.add(this.field.object);

    this.controls = new Controls(this.stage.camera, renderer.domElement, this.stage.scene, {
      getTarget: () => this.field.object,
      onGizmoToggle: (on) => (this.view.gizmo = on), // reactive proxy → UI follows
    });
    this.pointer = new PointerTracker(renderer.domElement, this.stage.camera, this.stage.scene, () => this.field);
    this.post = createPostprocessing(renderer, this.stage.scene, this.stage.camera);
    this.capture = new Capture(renderer.domElement as HTMLCanvasElement);
    this.applyPointerForce();
    // Gate morph at startup: morphAmount defaults to 1, but with no shape selected
    // the target buffer is empty, so without this the field collapses to the origin.
    // A shared link / preset may have restored a shape, so seed its target too.
    this.applyMorphTarget();
    this.applyMorphUniforms();

    this.controller = {
      params: this.params,
      view: this.view,
      pointerState: this.pointerState,
      morphState: this.morphState,
      demo: this.demo,
      countOptions: COUNT_OPTIONS,
      getField: () => this.field,
      renderer,
      post: this.post,
      capture: this.capture,
      controls: this.controls,
      stage: this.stage,
      onCountChange: (count) => {
        this.count = count;
        this.rebuild();
      },
      onMotionPreset: (idx) => this.applyMotionPreset(idx),
      onPointerForce: () => this.applyPointerForce(),
      onRegenerate: () => this.regenerate(),
      onShare: () => this.share(),
      onDemoToggle: (on) => {
        this.demo.enabled = on;
        this.demoElapsed = 0;
      },
      onStatsToggle: (on) => this.stats.setVisible(on),
      onMorphShape: (shape) => {
        this.morphState.shape = shape;
        this.applyMorphTarget();
        this.applyMorphUniforms();
      },
      onMorphParam: () => this.applyMorphUniforms(),
      snapshot: () => this.snapshot(),
      applyPreset: (state) => this.applyPreset(state),
    };

    // Reflect any hash-loaded state onto the engine bits that read it once.
    this.controls.autoRotate = this.view.autoRotate;
    this.stage.setAxesVisible(this.view.axes);

    window.addEventListener('resize', this.onResize);
  }

  /** Create the renderer (async WebGPU init) then the app. */
  static async create(container: HTMLElement, opts: AppOptions = {}): Promise<App> {
    const renderer = await createRenderer(container);
    return new App(renderer, opts);
  }

  start() {
    this.renderer.setAnimationLoop(this.frame);
  }

  // --- per-frame -------------------------------------------------------------
  private frame = () => {
    const delta = this.clock.getDelta();
    this.stepDemo(delta);
    this.pointer.update();
    // Paused (speed 0) freezes the sim: every motion/colour kernel would produce
    // identical buffers, so skip the GPU compute entirely and just re-present.
    // Interactive edits (colour, material, mode) recolour via their own paths, and
    // the camera can still orbit because render/controls run regardless.
    if (this.params.speed > 0) this.field.update(delta);
    this.controls.update();
    this.post.render();
    this.capture.afterRender();
    this.stats.update(delta);
  };

  /** Auto demo-reel: advance to the next motion mode every `interval` seconds. */
  private stepDemo(delta: number) {
    if (!this.demo.enabled) return;
    this.demoElapsed += delta;
    if (this.demoElapsed >= this.demo.interval) {
      this.demoElapsed = 0;
      this.applyMotionPreset((this.field.uniforms.motion.value + 1) % MOTION_MODES.length);
    }
  }

  // --- actions ---------------------------------------------------------------
  private rebuild() {
    const wasOn = this.controls.gizmoEnabled;
    this.controls.setGizmo(false); // detach before disposing
    this.stage.scene.remove(this.field.object);
    this.field.dispose();
    this.field = new ParticleField(this.renderer, this.count, this.params);
    this.field.setMaterialStyle(this.params.materialStyle);
    this.stage.scene.add(this.field.object);
    this.controls.setGizmo(wasOn); // re-attach to the freshly built object
    this.applyPointerForce(); // re-apply onto the new field's uniforms
    this.applyMorphTarget(); // the new field's targets buffer starts empty
    this.applyMorphUniforms();
  }

  /** Re-sample the active shape into the field's morph-target buffer. */
  private applyMorphTarget() {
    if (this.morphState.shape === 'None') return;
    const data = generateMorphTarget(this.morphState.shape, this.count, this.params.radius);
    if (data) this.field.setMorphTarget(data);
  }

  private applyMorphUniforms() {
    const { uniforms } = this.field;
    uniforms.morphStrength.value = this.params.morphStrength;
    // With no shape selected the target buffer is meaningless, so keep the pull off.
    uniforms.morphAmount.value = this.morphState.shape === 'None' ? 0 : this.params.morphAmount;
  }

  private applyMotionPreset(idx: number) {
    Object.assign(this.params, MOTION_PRESETS[idx], { motion: idx });
    this.field.setMotionMode(idx);
    this.syncMotionUniforms();
  }

  private syncMotionUniforms() {
    const { uniforms } = this.field;
    this.field.setSpeed(this.params.speed);
    uniforms.flowStrength.value = this.params.flowStrength;
    uniforms.flowScale.value = this.params.flowScale;
    uniforms.timeSpeed.value = this.params.timeSpeed;
    uniforms.spring.value = this.params.spring;
    uniforms.damping.value = this.params.damping;
  }

  private applyPointerForce() {
    const sign = this.pointerState.mode === 'Push' ? 1 : this.pointerState.mode === 'Pull' ? -1 : 0;
    this.field.uniforms.pointerStrength.value = sign * this.params.pointerStrength;
    this.field.uniforms.pointerRadius.value = this.params.pointerRadius;
  }

  private regenerate() {
    const { uniforms } = this.field;
    uniforms.radius.value = this.params.radius;
    uniforms.warpScale.value = this.params.warpScale;
    uniforms.warpStrength.value = this.params.warpStrength;
    this.field.regenerate();
    this.applyMorphTarget(); // re-size targets to the new radius
  }

  /** Merge a shared URL hash over the defaults before the field is built. */
  private loadFromHash() {
    const state = readHash();
    if (!state) return;
    if (state.params) Object.assign(this.params, state.params);
    if (state.pointerMode) this.pointerState.mode = state.pointerMode;
    if (state.morphShape) this.morphState.shape = state.morphShape;
    if (typeof state.count === 'number') {
      this.count = state.count;
      const label = Object.keys(COUNT_OPTIONS).find((k) => COUNT_OPTIONS[k] === state.count);
      if (label) this.view.countLabel = label;
    }
  }

  /** A portable snapshot of the current look — shared by Share links and presets. */
  private snapshot(): SceneState {
    return {
      params: { ...this.params },
      count: this.count,
      pointerMode: this.pointerState.mode,
      morphShape: this.morphState.shape,
    };
  }

  /**
   * Apply a saved/shared scene state. The expensive full rebuild (buffer realloc +
   * shader recompile) is reserved for a particle-count change — count drives buffer
   * size. For the common case (same count) everything is pushed onto the existing
   * field's uniforms live, so it's instant. Particle positions are only re-seeded if
   * a structural param (radius/warp) actually changed.
   */
  private applyPreset(state: SceneState) {
    const prev = {
      radius: this.params.radius,
      warpScale: this.params.warpScale,
      warpStrength: this.params.warpStrength,
      shape: this.morphState.shape,
    };

    if (state.params) Object.assign(this.params, state.params);
    this.pointerState.mode = state.pointerMode;
    this.morphState.shape = state.morphShape ?? 'None';

    const countChanged = typeof state.count === 'number' && state.count !== this.count;
    if (typeof state.count === 'number') this.count = state.count;
    const label = Object.keys(COUNT_OPTIONS).find((k) => COUNT_OPTIONS[k] === this.count);
    if (label) this.view.countLabel = label;

    if (countChanged) {
      this.rebuild(); // only path that needs new buffers — createUniforms re-seeds all
      return;
    }

    // Live apply onto the current field: no realloc, no recompile.
    this.field.setMotionMode(this.params.motion);
    this.field.setMaterialStyle(this.params.materialStyle);
    this.syncLiveUniforms();
    this.applyPointerForce();
    const structureChanged =
      this.params.radius !== prev.radius ||
      this.params.warpScale !== prev.warpScale ||
      this.params.warpStrength !== prev.warpStrength;
    if (structureChanged) {
      this.regenerate(); // re-seeds structure and re-fits the morph target to the radius
    } else if (this.morphState.shape !== prev.shape) {
      this.applyMorphTarget(); // shape changed but radius didn't — just re-sample it
    }
    this.applyMorphUniforms();
    this.field.recolor(); // reflect the new colours (warm/cool set above)
  }

  /** Push every live (non-init-pass) param onto the current field's uniforms. */
  private syncLiveUniforms() {
    const u = this.field.uniforms;
    this.field.setSpeed(this.params.speed);
    u.flowScale.value = this.params.flowScale;
    u.flowStrength.value = this.params.flowStrength;
    u.timeSpeed.value = this.params.timeSpeed;
    u.spring.value = this.params.spring;
    u.damping.value = this.params.damping;
    u.boidSep.value = this.params.boidSep;
    u.boidAli.value = this.params.boidAli;
    u.boidCoh.value = this.params.boidCoh;
    u.boidPerception.value = this.params.boidPerception;
    // Keep the hash cell ≥ perception so the 3×3×3 neighbour search stays complete.
    u.cellSize.value = Math.max(this.params.boidPerception * 1.15, 2.5);
    u.boidMaxSpeed.value = this.params.boidMaxSpeed;
    u.slimeSense.value = this.params.slimeSense;
    u.slimeWander.value = this.params.slimeWander;
    u.slimeDecay.value = this.params.slimeDecay;
    u.size.value = this.params.size;
    u.exposure.value = this.params.exposure;
    u.warm.value.set(this.params.warmColor);
    u.cool.value.set(this.params.coolColor);
    // radius / warp* are init-pass inputs — applied via regenerate() when they change.
  }

  /** Write the current look to the URL hash and copy a shareable link. */
  private share() {
    const url = buildShareUrl(this.snapshot());
    location.hash = url.split('#')[1] ?? '';
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  private onResize = () => {
    this.stage.resize(window.innerWidth, window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
