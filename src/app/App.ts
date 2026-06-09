import * as THREE from 'three/webgpu';
import { ParticleField, generateMorphTarget, DEFAULT_PARAMS, MOTION_PRESETS, MOTION_MODES, type FieldParams, type MorphShape } from '../field';
import { createRenderer } from './createRenderer';
import { Stage } from './Stage';
import { Controls } from './Controls';
import { PointerTracker } from './PointerTracker';
import { createPostprocessing, type Postprocessing } from './Postprocessing';
import { Capture } from './Capture';
import { StatsOverlay } from './StatsOverlay';
import { readHash, buildShareUrl } from './presetUrl';
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
  private count = COUNT_OPTIONS['500k'];

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
    this.view = wrap<ViewState>({ autoRotate: false, gizmo: false, axes: false, countLabel: '500k' });
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
    this.field.update(delta);
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
    if (typeof state.count === 'number') {
      this.count = state.count;
      const label = Object.keys(COUNT_OPTIONS).find((k) => COUNT_OPTIONS[k] === state.count);
      if (label) this.view.countLabel = label;
    }
  }

  /** Write the current look to the URL hash and copy a shareable link. */
  private share() {
    const url = buildShareUrl({ params: this.params, count: this.count, pointerMode: this.pointerState.mode });
    location.hash = url.split('#')[1] ?? '';
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  private onResize = () => {
    this.stage.resize(window.innerWidth, window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
