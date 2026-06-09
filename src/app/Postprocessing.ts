import * as THREE from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';

/**
 * The HDR postprocessing graph. pass() renders the scene into a HalfFloat (HDR)
 * target so additive particles accumulate beyond 1.0; afterImage adds long-exposure
 * trails (damp 0 = off); bloom runs on the trailed image so the streaks glow; the
 * renderer's tone mapping then compresses the sum at output.
 */
export function createPostprocessing(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode('output');
  const trailDamp = uniform(0.0);
  const trailed = afterImage(scenePassColor, trailDamp);
  const bloomPass = bloom(trailed, 0.5, 1.0, 0.0); // strength, radius, threshold
  postProcessing.outputNode = (trailed as any).add(bloomPass);

  return {
    bloomPass,
    trailDamp,
    render: () => postProcessing.render(),
    /** Switch tone mapping and rebuild the output transform. */
    setTone: (toneMapping: THREE.ToneMapping) => {
      renderer.toneMapping = toneMapping;
      postProcessing.needsUpdate = true;
    },
  };
}

export type Postprocessing = ReturnType<typeof createPostprocessing>;
