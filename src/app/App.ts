import * as THREE from 'three/webgpu';
import { ParticleField, generateMorphTarget, DEFAULT_PARAMS, MOTION_PRESETS, MOTION_MODES, AUDIO_RESPONSE, FIRST_AUDIO_MODE, type FieldParams, type MorphShape } from '../field';
import { createRenderer } from './createRenderer';
import { Stage } from './Stage';
import { Controls } from './Controls';
import { PointerTracker } from './PointerTracker';
import { createPostprocessing, type Postprocessing } from './Postprocessing';
import { Capture } from './Capture';
import { StatsOverlay } from './StatsOverlay';
import { AudioInput } from './AudioInput';
import { readHash, buildShareUrl, type SceneState, type PostState } from './presetUrl';
import { isMobileLike } from './device';
import { POINTER_ACTIONS, type Controller, type ViewState, type PointerState, type MorphState, type DemoState, type AudioState, type ConstellationState } from './ui/types';

const COUNT_OPTIONS: Record<string, number> = {
  '100k': 100_000,
  '250k': 250_000,
  '500k': 500_000,
  '1M': 1_000_000,
};

// An A/B cross-fade runs two fields at once, so cap the overlay (B) field's count
// to keep the doubled per-frame simulation + build cost bounded even when the main
// field is at 1M. The main field (A) keeps its own count.
const BLEND_MAX_COUNT = 250_000;

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
  private readonly audioState: AudioState;
  private readonly constellationState: ConstellationState;
  private readonly audio = new AudioInput();
  private demoElapsed = 0;
  // Lighter default on phone-class devices; a shared link / preset still overrides.
  private count = COUNT_OPTIONS[isMobileLike() ? '250k' : '500k'];

  private field: ParticleField;
  // Second field for the A/B cross-fade overlay (created on demand).
  private fieldB?: ParticleField;
  private blendActive = false;
  private blendKeyA?: string;
  private blendKeyB?: string;
  // Bumped on every B rebuild so an async warmup that finishes after a newer change
  // (or after the blend was cleared) can detect it's stale and discard itself.
  private blendBuildToken = 0;
  private lastBlendT = 0; // current fade position, re-applied when B swaps in
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
    this.audioState = wrap<AudioState>({ enabled: false });
    this.constellationState = wrap<ConstellationState>({ enabled: false, radius: 2.5, brightness: 2.5 });

    this.loadFromHash(); // a shared URL overrides the defaults before we build

    this.field = new ParticleField(renderer, this.count, this.params);
    this.stage.scene.add(this.field.object);

    this.controls = new Controls(this.stage.camera, renderer.domElement, this.stage.scene, {
      getTarget: () => this.field.object,
      onGizmoToggle: (on) => (this.view.gizmo = on), // reactive proxy → UI follows
    });
    this.pointer = new PointerTracker(renderer.domElement, this.stage.camera, this.stage.scene, () => this.field);
    this.post = createPostprocessing(renderer, this.stage.scene, this.stage.camera);
    // Depth-of-field reads the depth buffer, which additive particles don't write
    // by default — flip depth-write on the current field whenever DoF is active.
    this.post.onDofActiveChange = (active) => this.field.setDepthWrite(active);
    this.capture = new Capture(renderer.domElement as HTMLCanvasElement);
    this.applyPointerForce();
    // Gate morph at startup: morphAmount defaults to 1, but with no shape selected
    // the target buffer is empty, so without this the field collapses to the origin.
    // A shared link / preset may have restored a shape, so seed its target too.
    this.applyMorphTarget();
    this.applyMorphUniforms();
    this.applyConstellation();

    this.controller = {
      params: this.params,
      view: this.view,
      pointerState: this.pointerState,
      morphState: this.morphState,
      demo: this.demo,
      audioState: this.audioState,
      constellationState: this.constellationState,
      countOptions: COUNT_OPTIONS,
      getField: () => this.field,
      renderer,
      post: this.post,
      capture: this.capture,
      controls: this.controls,
      stage: this.stage,
      onCountChange: (count) => {
        this.clearBlend();
        this.count = count;
        this.rebuild();
      },
      onMotionPreset: (idx) => {
        this.clearBlend();
        this.applyMotionPreset(idx);
      },
      onPointerForce: () => this.applyPointerForce(),
      onRegenerate: () => {
        this.clearBlend();
        this.regenerate();
      },
      onShare: () => this.share(),
      onDemoToggle: (on) => {
        this.demo.enabled = on;
        this.demoElapsed = 0;
      },
      onStatsToggle: (on) => this.stats.setVisible(on),
      onAudioToggle: (on) => this.toggleAudio(on),
      onConstellation: () => this.applyConstellation(),
      onMorphShape: (shape) => {
        this.morphState.shape = shape;
        this.applyMorphTarget();
        this.applyMorphUniforms();
      },
      onMorphParam: () => this.applyMorphUniforms(),
      snapshot: () => this.snapshot(),
      applyPreset: (state) => {
        this.clearBlend();
        this.applyPreset(state);
      },
      onBlendFields: (a, b, t) => void this.setBlend(a, b, t),
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
    this.field.ensureSeeded(); // guard the first frame if warmup was skipped/failed
    this.renderer.setAnimationLoop(this.frame);
  }

  /**
   * Compile the GPU pipelines the first frame will need — the active mode's compute
   * kernels (via the field), the sprite material, and the bloom/afterImage post
   * passes — so the shader-compile cost is paid behind the loading screen instead
   * of as a visible first-frame stall.
   *
   * The work is split into discrete steps run through the async (non-blocking)
   * pipeline-creation path, with a frame yielded between each. That keeps the main
   * thread responsive — the loading spinner keeps spinning and the progress bar
   * repaints — instead of freezing the browser through one long synchronous compile.
   * Best-effort: the render loop would compile these lazily anyway, so a failure is
   * non-fatal. `onProgress` reports `(fraction 0..1, label)` for the loading UI.
   */
  async warmup(onProgress?: (fraction: number, label: string) => void) {
    const report = onProgress ?? (() => {});
    const yieldFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const steps: { label: string; run: () => Promise<void> }[] = [
      { label: 'Seeding the particle field…', run: () => this.field.warmupSeed() },
      { label: 'Compiling motion shaders…', run: () => this.field.warmupMotion() },
      { label: 'Compiling colour pass…', run: () => this.field.warmupColor() },
      // Async-compile the render pipeline (sprite material) without a blocking render.
      { label: 'Compiling renderer…', run: () => this.renderer.compileAsync(this.stage.scene, this.stage.camera) },
    ];

    for (let i = 0; i < steps.length; i++) {
      report(i / (steps.length + 1), steps[i].label);
      await yieldFrame(); // let the spinner + label/bar paint before the heavy step
      await steps[i].run();
    }

    // Final, comparatively small compile: the postprocessing quad chain (bloom +
    // grade). One hidden render triggers it; the canvas is still behind the loader.
    report(steps.length / (steps.length + 1), 'Compiling bloom & grade…');
    await yieldFrame();
    this.post.render();
    report(1, 'Ready');
  }

  // --- per-frame -------------------------------------------------------------
  private frame = () => {
    const delta = this.clock.getDelta();
    this.stepDemo(delta);
    this.updateAudio();
    this.pointer.update();
    // Paused (speed 0) freezes the sim: every motion/colour kernel would produce
    // identical buffers, so skip the GPU compute entirely and just re-present.
    // Interactive edits (colour, material, mode) recolour via their own paths, and
    // the camera can still orbit because render/controls run regardless.
    if (this.params.speed > 0) {
      this.field.update(delta);
      this.fieldB?.update(delta); // A/B overlay advances with its own baked speed
    }
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

  /**
   * Per-frame audio pump. Feeds the audio modes their newest FFT row (only when one
   * is active, to skip the upload otherwise) and modulates look + motion uniforms by
   * the live bands so ANY preset reacts to sound. The modulation recomputes from
   * `params` each frame, so it's non-destructive — toggling the mic off restores the
   * slider values (see {@link restoreAudioUniforms}).
   */
  private updateAudio() {
    if (!this.audio.enabled) return;
    this.audio.setGain(this.params.audioGain);
    this.audio.update();
    // Any audio mode needs the live FFT: push the newest row (which also flags the
    // mic active, so the audio modes show the live signal instead of their idle
    // animation). Spectrogram reads the scrolling history; Rings/Bars read the newest
    // row; Bass Bloom only needs the active flag + the bands set below.
    if (this.field.uniforms.motion.value >= FIRST_AUDIO_MODE) {
      this.field.pushAudioRow(this.audio.spectrum);
    }
    const { bass, mid, treble, level } = this.audio.bands;
    const amt = this.params.audioReactivity;
    const u = this.field.uniforms;
    // Look modulation (brightness/size/flow), as before.
    u.size.value = this.params.size * (1 + bass * amt * 1.6);
    u.exposure.value = this.params.exposure * (1 + level * amt * 0.9);
    u.flowStrength.value = this.params.flowStrength * (1 + treble * amt * 1.3);
    u.coreGlow.value = Math.min(1, this.params.coreGlow + bass * amt * 0.6);
    // Motion modulation: push the reactivity-scaled bands + the current mode's
    // response weights so the shared `applyAudio` force moves the field too. Each
    // mode reacts in its own character via AUDIO_RESPONSE.
    u.audioBass.value = bass * amt;
    u.audioMid.value = mid * amt;
    u.audioTreble.value = treble * amt;
    u.audioLevel.value = level * amt;
    const r = AUDIO_RESPONSE[u.motion.value] ?? AUDIO_RESPONSE[0];
    u.audioPulse.value = r.pulse;
    u.audioSwirl.value = r.swirl;
    u.audioJitter.value = r.jitter;
    u.audioLift.value = r.lift;
  }

  /** Reset the audio-modulated uniforms back to their (unmodulated) param values. */
  private restoreAudioUniforms() {
    const u = this.field.uniforms;
    u.size.value = this.params.size;
    u.exposure.value = this.params.exposure;
    u.flowStrength.value = this.params.flowStrength;
    u.coreGlow.value = this.params.coreGlow;
    // Zero the audio-motion drive so the shared force vanishes (mic off → no motion).
    u.audioBass.value = 0;
    u.audioMid.value = 0;
    u.audioTreble.value = 0;
    u.audioLevel.value = 0;
  }

  /** Push the constellation overlay state onto the field (params before toggle so
   *  the on-enable build uses the right radius). */
  private applyConstellation() {
    const s = this.constellationState;
    this.field.setLinkParams(s.radius, s.brightness);
    this.field.setConstellation(s.enabled);
  }

  /**
   * A/B cross-fade. Configures the main field as preset A and a second field
   * (created on demand) as preset B, then fades between them by `t` (0 = all A,
   * 1 = all B) via per-field opacity. Re-configures a side only when that preset
   * actually changes, so dragging the slider is just two opacity writes.
   */
  private async setBlend(a: SceneState, b: SceneState, t: number) {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    const tt = Math.max(0, Math.min(1, t));
    this.lastBlendT = tt;
    this.blendActive = true;

    // Side A changed → reconfigure the (live) main field. Cheap on the common
    // same-count path; only a count change rebuilds it (existing applyPreset logic).
    if (ka !== this.blendKeyA) {
      this.blendKeyA = ka;
      this.applyPreset(a);
    }
    this.field.setOpacity(1 - tt);

    // Slider-drag fast path: B unchanged (already built or still warming), so this
    // is just opacity writes — lastBlendT above carries the position to the build if
    // it's still in flight. Keyed on blendKeyB alone so dragging during the initial
    // compile doesn't kick off redundant rebuilds.
    if (kb === this.blendKeyB) {
      this.fieldB?.setOpacity(tt);
      return;
    }
    // Side B changed → build a fresh overlay field, warming its pipelines off the
    // critical path so the dropdown change doesn't freeze the tab (see rebuildFieldB).
    this.blendKeyB = kb;
    await this.rebuildFieldB(b);
  }

  /**
   * Build (or rebuild) the overlay field for preset B. The new field's compute
   * pipelines (init / colour / motion) are warmed via the async, non-blocking
   * path BEFORE it is swapped into the scene — a freshly constructed field shares
   * none of the main field's pre-compiled pipelines, so seeding it synchronously
   * would compile WGSL on the main thread and freeze the tab. The previous overlay
   * keeps rendering until the replacement is ready, and a build superseded while it
   * compiles (newer change, or the blend was cleared) is discarded.
   */
  private async rebuildFieldB(state: SceneState) {
    const token = ++this.blendBuildToken;
    const params = { ...DEFAULT_PARAMS, ...state.params };
    const count = Math.min(typeof state.count === 'number' ? state.count : this.count, BLEND_MAX_COUNT);
    const fb = new ParticleField(this.renderer, count, params);
    fb.setMaterialStyle(params.materialStyle);

    try {
      await fb.warmupSeed();
      await fb.warmupColor();
      await fb.warmupMotion();
    } catch {
      /* best-effort: fall back to lazy first-frame compilation if warmup fails */
    }
    fb.ensureSeeded(); // guarantee structure + colour even if warmup was interrupted

    if (state.morphShape && state.morphShape !== 'None') {
      const data = generateMorphTarget(state.morphShape, count, params.radius);
      if (data) fb.setMorphTarget(data);
      fb.uniforms.morphAmount.value = params.morphAmount;
    } else {
      fb.uniforms.morphAmount.value = 0;
    }

    // A newer rebuild superseded us, or the blend was cleared, while we compiled —
    // throw this field away rather than swapping in a stale overlay.
    if (token !== this.blendBuildToken || !this.blendActive) {
      fb.dispose();
      return;
    }

    if (this.fieldB) {
      this.stage.scene.remove(this.fieldB.object);
      this.fieldB.dispose();
    }
    fb.setOpacity(this.lastBlendT);
    this.stage.scene.add(fb.object);
    this.fieldB = fb;
  }

  /** Tear down the A/B overlay and restore the main field to full opacity. */
  private clearBlend() {
    if (!this.blendActive) return;
    this.blendActive = false;
    this.blendBuildToken++; // invalidate any overlay build still warming up
    this.blendKeyA = undefined;
    this.blendKeyB = undefined;
    this.field.setOpacity(1);
    if (this.fieldB) {
      this.stage.scene.remove(this.fieldB.object);
      this.fieldB.dispose();
      this.fieldB = undefined;
    }
  }

  /** Enable/disable the mic. Returns whether audio is live afterward. */
  private async toggleAudio(on: boolean): Promise<boolean> {
    if (on) {
      const ok = await this.audio.enable();
      this.audioState.enabled = ok;
      if (!ok) this.field.setAudioActive(false);
      return ok;
    }
    this.audio.disable();
    this.audioState.enabled = false;
    this.field.setAudioActive(false);
    this.restoreAudioUniforms();
    return true;
  }

  // --- actions ---------------------------------------------------------------
  private rebuild() {
    const wasOn = this.controls.gizmoEnabled;
    this.controls.setGizmo(false); // detach before disposing
    this.stage.scene.remove(this.field.object);
    this.field.dispose();
    this.field = new ParticleField(this.renderer, this.count, this.params);
    this.field.setMaterialStyle(this.params.materialStyle);
    this.field.seed(); // constructor no longer self-seeds; pipelines are already warm here
    this.stage.scene.add(this.field.object);
    this.controls.setGizmo(wasOn); // re-attach to the freshly built object
    this.applyPointerForce(); // re-apply onto the new field's uniforms
    this.applyMorphTarget(); // the new field's targets buffer starts empty
    this.applyMorphUniforms();
    this.applyConstellation(); // re-apply onto the freshly built field
    if (this.post.dofBokeh.value > 0) this.field.setDepthWrite(true); // DoF still on
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
    const action = POINTER_ACTIONS[this.pointerState.mode] ?? POINTER_ACTIONS.Off;
    if (action.clearStrokes) {
      this.pointer.clearStrokes();
      this.pointerState.mode = 'Off';
    }
    const activeAction = POINTER_ACTIONS[this.pointerState.mode] ?? POINTER_ACTIONS.Off;
    this.field.uniforms.pointerMode.value = activeAction.shaderMode;
    this.field.uniforms.pointerStrength.value = this.params.pointerStrength;
    this.field.uniforms.pointerRadius.value = this.params.pointerRadius;
    this.pointer.setAction(activeAction.shaderMode, Boolean(activeAction.drawOnly));
    // Draw actions take over dragging so strokes drive the well rather than the
    // camera. On touch devices, hover actions also claim one-finger drags.
    this.controls.setPointerClaimsOrbit(
      Boolean(activeAction.drawOnly) || (isMobileLike() && this.pointerState.mode !== 'Off'),
    );
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
      post: this.capturePost(),
    };
  }

  /** Capture the postprocessing look (bloom/lens/tone) for a snapshot. */
  private capturePost(): PostState {
    const p = this.post;
    return {
      bloomStrength: p.bloomPass.strength.value,
      bloomRadius: p.bloomPass.radius.value,
      bloomThreshold: p.bloomPass.threshold.value,
      trails: p.trailDamp.value,
      dofBokeh: p.dofBokeh.value,
      dofFocus: p.dofFocus.value,
      dofRange: p.dofRange.value,
      ca: p.caStrength.value,
      vignette: p.vignette.value,
      dither: p.ditherAmt.value,
      toneExposure: this.renderer.toneMappingExposure,
    };
  }

  /** Apply a postprocessing snapshot. The layer toggles (trails/DoF/CA) only rebuild
   *  the graph when they cross their on/off threshold, so this is cheap mid-blend. */
  private applyPost(s: PostState) {
    const p = this.post;
    p.bloomPass.strength.value = s.bloomStrength;
    p.bloomPass.radius.value = s.bloomRadius;
    p.bloomPass.threshold.value = s.bloomThreshold;
    p.dofFocus.value = s.dofFocus;
    p.dofRange.value = s.dofRange;
    p.vignette.value = s.vignette;
    p.ditherAmt.value = s.dither;
    this.renderer.toneMappingExposure = s.toneExposure;
    p.setTrails(s.trails);
    p.setDofBokeh(s.dofBokeh);
    p.setCa(s.ca);
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
    if (state.post) this.applyPost(state.post); // bloom/lens/tone — independent of the field

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
    u.softness.value = this.params.softness;
    u.coreGlow.value = this.params.coreGlow;
    u.streak.value = this.params.streak;
    u.spectroHeight.value = this.params.spectroHeight;
    u.fogDensity.value = this.params.fogDensity;
    u.fog.value.set(this.params.fogColor);
    u.warm.value.set(this.params.warmColor);
    u.cool.value.set(this.params.coolColor);
    // radius / warp* are init-pass inputs — applied via regenerate() when they change.
  }

  /** Copy a shareable link to the clipboard. Does not touch the current URL —
   *  the caller toasts success/failure off the returned flag. */
  private async share(): Promise<boolean> {
    const url = buildShareUrl(this.snapshot());
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  private onResize = () => {
    this.stage.resize(window.innerWidth, window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
