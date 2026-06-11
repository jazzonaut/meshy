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
  private readonly strokes: StrokePoint[] = [];
  private over = false;
  private down = false;
  private shaderMode = 0;
  private drawOnly = false;
  private replayCursor = 0;
  private lastUpdate = performance.now();

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
    };
    const deactivate = () => {
      this.over = false;
      this.down = false;
    };

    dom.addEventListener('pointermove', activateAt);
    // Touch has no hover, so first contact is what activates the well.
    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      this.down = true;
      activateAt(e);
    });
    dom.addEventListener('pointerleave', deactivate);
    // ...and a lifted/cancelled finger must explicitly clear it, or it stays stuck
    // active at the last touch point (pointerleave is unreliable for touch). Mouse
    // is left to pointerleave so a click doesn't disable the well.
    dom.addEventListener('pointerup', (e: PointerEvent) => {
      this.down = false;
      if (e.pointerType !== 'mouse') deactivate();
    });
    dom.addEventListener('pointercancel', deactivate);
  }

  setAction(shaderMode: number, drawOnly: boolean) {
    this.shaderMode = shaderMode;
    this.drawOnly = drawOnly;
    this.getField().uniforms.pointerMode.value = shaderMode;
    this.getField().uniforms.pointerActive.value = 0;
  }

  clearStrokes() {
    this.strokes.length = 0;
    this.replayCursor = 0;
    this.getField().uniforms.pointerActive.value = 0;
  }

  update() {
    const now = performance.now();
    const dt = Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;
    this.decayStrokes(dt);

    if (!this.over) {
      this.replayStroke();
      return;
    }

    this.camera.getWorldDirection(this.camDir);
    this.plane.setFromNormalAndCoplanarPoint(this.camDir, this.scene.position);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.plane, this.hit);

    const live = this.shaderMode !== 0 && (!this.drawOnly || this.down);
    if (live) {
      const uniforms = this.getField().uniforms;
      uniforms.pointer.value.copy(this.hit);
      uniforms.pointerMode.value = this.shaderMode;
      uniforms.pointerActive.value = 1;
      if (this.drawOnly) this.recordStroke();
      return;
    }

    this.replayStroke();
  }

  private recordStroke() {
    const prev = this.strokes[this.strokes.length - 1];
    if (prev && prev.point.distanceToSquared(this.hit) < 0.45) return;
    this.strokes.push({ point: this.hit.clone(), mode: this.shaderMode, age: 0, life: 2.2 });
    if (this.strokes.length > 96) this.strokes.shift();
  }

  private decayStrokes(dt: number) {
    for (const stroke of this.strokes) stroke.age += dt;
    let expired = 0;
    while (expired < this.strokes.length && this.strokes[expired].age >= this.strokes[expired].life) expired++;
    if (expired > 0) {
      this.strokes.splice(0, expired);
      this.replayCursor = Math.max(0, this.replayCursor - expired);
    }
  }

  private replayStroke() {
    if (this.shaderMode === 0 || this.strokes.length === 0) {
      this.getField().uniforms.pointerActive.value = 0;
      return;
    }

    this.replayCursor %= this.strokes.length;
    const stroke = this.strokes[this.replayCursor];
    this.replayCursor += 1;

    const fade = Math.max(0, 1 - stroke.age / stroke.life);
    const uniforms = this.getField().uniforms;
    uniforms.pointer.value.copy(stroke.point);
    uniforms.pointerMode.value = stroke.mode;
    uniforms.pointerActive.value = fade * 0.7;
  }
}

interface StrokePoint {
  point: THREE.Vector3;
  mode: number;
  age: number;
  life: number;
}
