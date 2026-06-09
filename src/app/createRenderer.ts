import * as THREE from 'three/webgpu';

/**
 * Build and initialise the WebGPU renderer. Tone mapping compresses the
 * HDR-accumulated bloom result so dense additive cores roll off into colour
 * instead of clipping to flat white; it is applied at the postprocessing output.
 */
export async function createRenderer(container: HTMLElement): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  await renderer.init();
  return renderer;
}
