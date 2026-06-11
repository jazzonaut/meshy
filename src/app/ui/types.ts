import type * as THREE from 'three/webgpu';
import type { FieldParams, MorphShape, ParticleField } from '../../field';
import type { Postprocessing } from '../Postprocessing';
import type { Capture } from '../Capture';
import type { Controls } from '../Controls';
import type { Stage } from '../Stage';
import type { SceneState } from '../presetUrl';

/**
 * Cursor "action" the pointer well performs. Index in this array is what the
 * shader branches on (`pointerMode` uniform); 'Off' is 0 so it matches no branch
 * and the well stays inert. Each action reuses the same cursor world-position and
 * the strength/radius tuned in Studio.
 */
export const POINTER_MODES = [
  'Off',
  'Black Hole', // pull + swirl: spiral particles inward
  'Clear Strokes', // clear recorded draw gestures, then return to Off
  'Draw Pull', // press/drag to draw a decaying pull stroke
  'Draw Push', // press/drag to draw a decaying push stroke
  'Draw Swirl', // press/drag to draw a decaying swirl stroke
  'Freeze', // drain velocity to stasis wherever the cursor passes
  'Pull', // draw particles inward to the cursor
  'Push', // repel particles outward from the cursor
  'Shell', // settle particles onto a sphere shell around the cursor (magnet)
  'Stir', // inject local curl turbulence around the cursor
  'Swirl', // orbit particles tangentially around the cursor
  'Tornado', // swirl + inward pull + upward lift: wind particles up a funnel
] as const;

export type PointerMode = (typeof POINTER_MODES)[number];

export interface PointerAction {
  shaderMode: number;
  drawOnly?: boolean;
  clearStrokes?: boolean;
}

/**
 * UI actions are sorted independently from shader branch ids. Keep these ids in
 * sync with the branches in field/tsl/forces.ts.
 */
export const POINTER_ACTIONS: Record<PointerMode, PointerAction> = {
  Off: { shaderMode: 0 },
  'Black Hole': { shaderMode: 4 },
  'Clear Strokes': { shaderMode: 0, clearStrokes: true },
  'Draw Pull': { shaderMode: 2, drawOnly: true },
  'Draw Push': { shaderMode: 1, drawOnly: true },
  'Draw Swirl': { shaderMode: 3, drawOnly: true },
  Freeze: { shaderMode: 6 },
  Pull: { shaderMode: 2 },
  Push: { shaderMode: 1 },
  Shell: { shaderMode: 7 },
  Stir: { shaderMode: 5 },
  Swirl: { shaderMode: 3 },
  Tornado: { shaderMode: 8 },
};

export interface ViewState {
  autoRotate: boolean;
  gizmo: boolean;
  axes: boolean;
  countLabel: string;
}
export interface PointerState {
  mode: PointerMode;
}
export interface MorphState {
  shape: MorphShape;
}
export interface DemoState {
  enabled: boolean;
  interval: number;
  fps: boolean;
}
export interface AudioState {
  /** Whether the mic is live (permission granted and analysing). */
  enabled: boolean;
}
export interface ConstellationState {
  enabled: boolean;
  radius: number; // link search radius
  brightness: number; // line glow brightness
}

/**
 * The seam between the vanilla engine and the Vue UI. {@link App} builds this and
 * hands it to the UI layer: plain state objects the UI binds to reactively, the
 * live engine handles the panels poke directly, and the cross-cutting actions
 * (rebuild, preset, regenerate, share…) as callbacks. The UI never imports the
 * engine internals — it only ever touches this object.
 */
export interface Controller {
  params: FieldParams;
  view: ViewState;
  pointerState: PointerState;
  morphState: MorphState;
  demo: DemoState;
  audioState: AudioState;
  constellationState: ConstellationState;
  countOptions: Record<string, number>;
  getField: () => ParticleField;
  renderer: THREE.WebGPURenderer;
  post: Postprocessing;
  capture: Capture;
  controls: Controls;
  stage: Stage;
  onCountChange: (count: number) => void;
  onMotionPreset: (index: number) => void;
  onPointerForce: () => void;
  onRegenerate: () => void;
  /** Copy a shareable link to the clipboard; resolves true on success. */
  onShare: () => Promise<boolean>;
  onDemoToggle: (on: boolean) => void;
  onStatsToggle: (on: boolean) => void;
  /** Enable/disable the microphone. Resolves true if audio is live afterward
   *  (turning on can fail if the user denies the permission). */
  onAudioToggle: (on: boolean) => Promise<boolean>;
  /** Re-apply the constellation overlay state (toggle + radius/brightness). */
  onConstellation: () => void;
  onMorphShape: (shape: MorphShape) => void;
  onMorphParam: () => void;
  /** Capture the current look as a portable scene state (for saving a preset). */
  snapshot: () => SceneState;
  /** Apply a saved scene state, rebuilding the field so every param takes effect. */
  applyPreset: (state: SceneState) => void;
  /**
   * A/B cross-fade: show presets `a` and `b` as two overlapping particle fields,
   * fading from a (t=0) to b (t=1). Unlike a param lerp, this blends EVERYTHING —
   * motion mode, colours, structure — because both presets run live at once.
   */
  onBlendFields: (a: SceneState, b: SceneState, t: number) => void;
}
