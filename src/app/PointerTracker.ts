import * as THREE from 'three/webgpu';
import type { ParticleField } from '../field';

/**
 * Projects the cursor onto a camera-facing plane through the origin, giving an
 * intuitive world-space point at the scene's depth regardless of orbit angle, and
 * writes it into the active field's `pointer` uniform each frame. `pointerActive`
 * gates the force well to when the mouse is over the canvas. No click binding —
 * left-drag stays OrbitControls.
 */
export class PointerTracker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private over = false;

  constructor(
    dom: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly scene: THREE.Scene,
    private readonly getField: () => ParticleField,
  ) {
    const activateAt = (e: PointerEvent) => {
      this.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.over = true;
      this.getField().uniforms.pointerActive.value = 1;
    };
    const deactivate = () => {
      this.over = false;
      this.getField().uniforms.pointerActive.value = 0;
    };

    dom.addEventListener('pointermove', activateAt);
    // Touch has no hover, so first contact is what activates the well.
    dom.addEventListener('pointerdown', activateAt);
    dom.addEventListener('pointerleave', deactivate);
    // ...and a lifted/cancelled finger must explicitly clear it, or it stays stuck
    // active at the last touch point (pointerleave is unreliable for touch). Mouse
    // is left to pointerleave so a click doesn't disable the well.
    dom.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') deactivate();
    });
    dom.addEventListener('pointercancel', deactivate);
  }

  update() {
    if (!this.over) return;
    this.camera.getWorldDirection(this.camDir);
    this.plane.setFromNormalAndCoplanarPoint(this.camDir, this.scene.position);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.hit);
    this.getField().uniforms.pointer.value.copy(this.hit);
  }
}
