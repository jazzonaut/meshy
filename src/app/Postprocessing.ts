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
  const bloomPass = bloom(scenePassColor, 0.5, 1.0, 0.0); // strength, radius, threshold

  // Two output graphs. afterImage keeps a feedback buffer that leaks faint
  // comet-trails on some mobile GPUs even at damp 0 (uninitialised feedback
  // texture), so it's an opt-in layer: kept entirely out of the graph until the
  // user dials trails in. Trails default off, so mobile gets the clean path.
  const passthrough = (scenePassColor as any).add(bloomPass);
  const withTrails = (trailed as any).add(bloomPass);
  let trailsOn = false;
  postProcessing.outputNode = passthrough;

  return {
    bloomPass,
    trailDamp,
    /** Set the long-exposure trail amount; swaps the afterImage layer in/out at 0. */
    setTrails: (damp: number) => {
      trailDamp.value = damp;
      const want = damp > 0.0001;
      if (want !== trailsOn) {
        trailsOn = want;
        postProcessing.outputNode = want ? withTrails : passthrough;
        postProcessing.needsUpdate = true;
      }
    },
    render: () => postProcessing.render(),
    /** Switch tone mapping and rebuild the output transform. */
    setTone: (toneMapping: THREE.ToneMapping) => {
      renderer.toneMapping = toneMapping;
      postProcessing.needsUpdate = true;
    },
  };
}

export type Postprocessing = ReturnType<typeof createPostprocessing>;
