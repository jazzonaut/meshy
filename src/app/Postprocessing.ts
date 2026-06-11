import * as THREE from 'three/webgpu';
import { pass, uniform, float, dot, hash, screenUV, screenCoordinate } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

/**
 * The HDR postprocessing graph. pass() renders the scene into a HalfFloat (HDR)
 * target so additive particles accumulate beyond 1.0. The output graph is built in
 * layers, innermost first:
 *
 *   scene → [afterImage trails] → + bloom → [depth-of-field] → [chromatic
 *   aberration] → vignette × + dither → tone map (at output)
 *
 * Bracketed layers are opt-in: trails / DoF / CA stay entirely out of the node
 * graph until dialled in (DoF and CA are costly; afterImage's feedback buffer can
 * leak faint comet-trails at damp 0 on some mobile GPUs). Vignette + dither are
 * always on — both are cheap and frame/clean the image (dither kills HDR banding
 * in the dark gradients). The graph is rebuilt only when a layer crosses its
 * on/off threshold; live slider tweaks just poke the persistent uniforms.
 */
export function createPostprocessing(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassViewZ = scenePass.getViewZNode(); // per-pixel depth for DoF

  const trailDamp = uniform(0.0);
  const trailed = afterImage(scenePassColor, trailDamp);
  const bloomPass = bloom(scenePassColor, 0.5, 1.0, 0.0); // strength, radius, threshold

  // Lens / grade uniforms (kept off FieldParams — like bloom, these are viewing
  // settings rather than scene state, so they don't ride share links / presets).
  const dofFocus = uniform(55.0); // focal plane distance (world units from camera)
  const dofRange = uniform(28.0); // how fast things fall out of focus
  const dofBokeh = uniform(0.0); // 0 = DoF off
  const caStrength = uniform(0.0); // 0 = chromatic aberration off
  const vignette = uniform(0.35); // edge darkening amount
  const ditherAmt = uniform(1.0); // ~1 LSB of dither to break 8-bit banding

  let trailsOn = false;
  let dofOn = false;
  let caOn = false;

  /** Fired when DoF crosses on/off — App uses it to flip particle depth-write. */
  const api = {
    bloomPass,
    trailDamp,
    dofFocus,
    dofRange,
    dofBokeh,
    caStrength,
    vignette,
    ditherAmt,
    onDofActiveChange: undefined as ((active: boolean) => void) | undefined,
    render: () => postProcessing.render(),
    setTrails,
    setCa,
    setDofBokeh,
    setTone,
  };

  function rebuild() {
    const base = trailsOn ? trailed : scenePassColor;
    let img: any = (base as any).add(bloomPass);
    if (dofOn) img = dof(img, scenePassViewZ, dofFocus, dofRange, dofBokeh) as any;
    if (caOn) img = chromaticAberration(img, caStrength, null as any, float(1.1)) as any;

    // Grade: radial vignette (multiplicative) + a sliver of hash dither (additive)
    // to dissolve banding in the smooth HDR falloffs.
    const d = screenUV.sub(0.5);
    const vig = float(1.0).sub(dot(d, d).mul(vignette));
    const noise = hash(screenCoordinate.x.mul(1.13).add(screenCoordinate.y.mul(7.31)));
    const grain = noise.sub(0.5).mul(ditherAmt.div(255.0));

    postProcessing.outputNode = img.mul(vig).add(grain);
    postProcessing.needsUpdate = true;
  }

  /** Set the long-exposure trail amount; swaps the afterImage layer in/out at 0. */
  function setTrails(damp: number) {
    trailDamp.value = damp;
    const want = damp > 0.0001;
    if (want !== trailsOn) {
      trailsOn = want;
      rebuild();
    }
  }

  /** Set chromatic-aberration strength; swaps the layer in/out at 0. */
  function setCa(strength: number) {
    caStrength.value = strength;
    const want = strength > 0.0001;
    if (want !== caOn) {
      caOn = want;
      rebuild();
    }
  }

  /**
   * Set the bokeh size; swaps the DoF layer in/out at 0. Crossing the threshold
   * fires onDofActiveChange so the field can enable depth-write (DoF needs depth).
   */
  function setDofBokeh(bokeh: number) {
    dofBokeh.value = bokeh;
    const want = bokeh > 0.0001;
    if (want !== dofOn) {
      dofOn = want;
      api.onDofActiveChange?.(want);
      rebuild();
    }
  }

  /** Switch tone mapping and rebuild the output transform. */
  function setTone(toneMapping: THREE.ToneMapping) {
    renderer.toneMapping = toneMapping;
    postProcessing.needsUpdate = true;
  }

  rebuild(); // establish the always-on grade graph
  return api;
}

export type Postprocessing = ReturnType<typeof createPostprocessing>;
