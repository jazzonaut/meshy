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
  'Push', // repel particles outward from the cursor
  'Pull', // draw particles inward to the cursor
  'Swirl', // orbit particles tangentially around the cursor
  'Black Hole', // pull + swirl: spiral particles inward
  'Stir', // inject local curl turbulence around the cursor
  'Freeze', // drain velocity to stasis wherever the cursor passes
  'Shell', // settle particles onto a sphere shell around the cursor (magnet)
  'Tornado', // swirl + inward pull + upward lift: wind particles up a funnel
] as const;

export type PointerMode = (typeof POINTER_MODES)[number];

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
  onMorphShape: (shape: MorphShape) => void;
  onMorphParam: () => void;
  /** Capture the current look as a portable scene state (for saving a preset). */
  snapshot: () => SceneState;
  /** Apply a saved scene state, rebuilding the field so every param takes effect. */
  applyPreset: (state: SceneState) => void;
}
