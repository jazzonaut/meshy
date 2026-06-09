import type * as THREE from 'three/webgpu';
import type { FieldParams, MorphShape, ParticleField } from '../../field';
import type { Postprocessing } from '../Postprocessing';
import type { Capture } from '../Capture';
import type { Controls } from '../Controls';
import type { Stage } from '../Stage';
import type { SceneState } from '../presetUrl';

export type PointerMode = 'Off' | 'Push' | 'Pull';

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
  onShare: () => void;
  onDemoToggle: (on: boolean) => void;
  onStatsToggle: (on: boolean) => void;
  onMorphShape: (shape: MorphShape) => void;
  onMorphParam: () => void;
  /** Capture the current look as a portable scene state (for saving a preset). */
  snapshot: () => SceneState;
  /** Apply a saved scene state, rebuilding the field so every param takes effect. */
  applyPreset: (state: SceneState) => void;
}
