import * as THREE from 'three/webgpu';

/**
 * The scene graph: an empty scene, a perspective camera, and an axes helper used
 * as a render sanity reference (if axes show but particles don't, the camera/render
 * path is fine and the issue is the particle pass).
 */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly axes = new THREE.AxesHelper(20);

  constructor() {
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 8, 60);
    this.axes.visible = false;
    this.scene.add(this.axes);
  }

  setAxesVisible(visible: boolean) {
    this.axes.visible = visible;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
