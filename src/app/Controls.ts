import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export interface ControlsOptions {
  /** The object the transform gizmo attaches to (re-read after a rebuild). */
  getTarget: () => THREE.Object3D;
  /** Notified when the `g` shortcut toggles the gizmo, so the GUI can sync. */
  onGizmoToggle?: (on: boolean) => void;
}

/**
 * Camera orbiting plus the move/rotate/scale transform gizmo, and their keyboard
 * shortcuts (w/e/r set the gizmo mode; g toggles it). Left-drag orbits; dragging
 * the gizmo temporarily disables orbiting.
 */
export class Controls {
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  readonly gizmoHelper: THREE.Object3D;
  private gizmoOn = false;

  constructor(
    camera: THREE.Camera,
    dom: HTMLElement,
    scene: THREE.Scene,
    private readonly opts: ControlsOptions,
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.05;
    this.orbit.autoRotateSpeed = 0.4;

    this.gizmo = new TransformControls(camera, dom);
    this.gizmo.setSpace('local');
    // newer three exposes the visual via getHelper(); fall back to the control.
    this.gizmoHelper = (this.gizmo as any).getHelper ? (this.gizmo as any).getHelper() : this.gizmo;
    scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e: any) => {
      this.orbit.enabled = !e.value;
    });
    this.setGizmo(false);

    window.addEventListener('keydown', this.onKey);
  }

  get gizmoEnabled() {
    return this.gizmoOn;
  }

  set autoRotate(v: boolean) {
    this.orbit.autoRotate = v;
  }

  /**
   * When a pointer-well action claims touch input (mobile), stop one-finger drags
   * from orbiting/panning so they drive the well instead — the PointerTracker then
   * receives the move. Two-finger pinch-zoom stays live. No-op feel on desktop,
   * where a hovering mouse already moves the well without consuming the drag.
   */
  setTouchClaimsPointer(on: boolean) {
    this.orbit.enableRotate = !on;
    this.orbit.enablePan = !on;
  }

  /** Attach/detach the gizmo to the current target. attach() can re-show the
   *  helper, so visibility is set after. */
  setGizmo(on: boolean) {
    if (on) this.gizmo.attach(this.opts.getTarget());
    else this.gizmo.detach();
    this.gizmo.enabled = on;
    this.gizmoHelper.visible = on;
    this.gizmoOn = on;
  }

  update() {
    this.orbit.update();
  }

  private onKey = (e: KeyboardEvent) => {
    switch (e.key.toLowerCase()) {
      case 'w': this.gizmo.setMode('translate'); break;
      case 'e': this.gizmo.setMode('rotate'); break;
      case 'r': this.gizmo.setMode('scale'); break;
      case 'g':
        this.setGizmo(!this.gizmoOn);
        this.opts.onGizmoToggle?.(this.gizmoOn);
        break;
    }
  };
}
