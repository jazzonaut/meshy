import * as THREE from 'three/webgpu';
import { isMobileLike } from './device';

/**
 * Build and initialise the WebGPU renderer. Tone mapping compresses the
 * HDR-accumulated bloom result so dense additive cores roll off into colour
 * instead of clipping to flat white; it is applied at the postprocessing output.
 */
export async function createRenderer(container: HTMLElement): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  // The full-screen bloom + afterImage passes scale with pixel count, so cap the
  // ratio harder on phones (where dpr is often 3) to keep the fill cost sane.
  const maxRatio = isMobileLike() ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  await renderer.init();
  return renderer;
}
