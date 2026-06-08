import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import GUI from 'lil-gui';
import {
  createParticleField,
  DEFAULT_PARAMS,
  MOTION_MODES,
  type ParticleField,
  type FieldParams,
} from './particles';

const COUNT_OPTIONS = {
  '100k': 100_000,
  '250k': 250_000,
  '500k': 500_000,
  '1M': 1_000_000,
};

async function main() {
  if (!navigator.gpu) {
    document.getElementById('unsupported')?.classList.add('show');
    return;
  }

  const app = document.getElementById('app')!;

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  // Tone mapping compresses the HDR-accumulated bloom result so dense additive
  // cores roll off into colour instead of clipping to flat white. AgX/Neutral
  // preserve hue best; applied at the postprocessing output stage below.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  app.appendChild(renderer.domElement);

  await renderer.init();

  const scene = new THREE.Scene();

  // Render sanity reference: standard-material axes that must always be visible.
  // If you can see these but no particles, the camera/render path is fine and
  // the issue is the particle pass specifically. Toggle off in the View folder.
  const axes = new THREE.AxesHelper(20);
  scene.add(axes);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );
  camera.position.set(0, 8, 60);

  // --- Camera + object controls ---------------------------------------------
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;
  orbit.autoRotateSpeed = 0.4;

  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSpace('local');
  // newer three exposes the visual via getHelper(); fall back to the control.
  const gizmoHelper = (gizmo as any).getHelper ? (gizmo as any).getHelper() : gizmo;
  scene.add(gizmoHelper);
  gizmo.addEventListener('dragging-changed', (e: any) => {
    orbit.enabled = !e.value;
  });
  gizmoHelper.visible = false;
  gizmo.enabled = false;

  // --- Particle field --------------------------------------------------------
  const params: FieldParams = { ...DEFAULT_PARAMS };
  let count = COUNT_OPTIONS['500k'];
  let field: ParticleField = createParticleField(renderer, count, params);
  scene.add(field.object);

  // Apply the current gizmo on/off state (attach() can re-show the helper, so
  // this must run *after* attach).
  function applyGizmoState(on: boolean) {
    if (on) gizmo.attach(field.object);
    else gizmo.detach();
    gizmo.enabled = on;
    gizmoHelper.visible = on;
  }
  applyGizmoState(false);

  function rebuild() {
    const wasOn = gizmo.enabled;
    gizmo.detach();
    scene.remove(field.object);
    field.dispose();
    field = createParticleField(renderer, count, params);
    field.setBlendMode(look.blend);
    scene.add(field.object);
    applyGizmoState(wasOn);
  }

  // --- HDR bloom postprocessing ----------------------------------------------
  // pass() renders the scene into a HalfFloat (HDR) target, so additive
  // particles accumulate beyond 1.0; bloom adds the glow halo; the renderer's
  // tone mapping (applied at output) then compresses the sum.
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode('output');
  const bloomPass = bloom(scenePassColor, 0.55, 0.85, 0.0); // strength, radius, threshold
  postProcessing.outputNode = scenePassColor.add(bloomPass);

  // --- GUI -------------------------------------------------------------------
  const gui = new GUI({ title: 'Particle Field' });

  const view = { autoRotate: false, gizmo: false, axes: true, countLabel: '500k' };
  const fView = gui.addFolder('View');
  fView.add(view, 'autoRotate').onChange((v: boolean) => (orbit.autoRotate = v));
  fView.add(view, 'axes').name('axis reference').onChange((v: boolean) => (axes.visible = v));
  fView.add(view, 'gizmo').name('transform gizmo').onChange((v: boolean) => applyGizmoState(v));
  fView
    .add(view, 'countLabel', Object.keys(COUNT_OPTIONS))
    .name('particles')
    .onChange((label: string) => {
      count = (COUNT_OPTIONS as Record<string, number>)[label];
      rebuild();
    });

  const fMotion = gui.addFolder('Motion');
  const motion = { type: MOTION_MODES[params.motion] };
  fMotion
    .add(motion, 'type', [...MOTION_MODES])
    .name('mode')
    .onChange((label: string) => {
      const idx = MOTION_MODES.indexOf(label as (typeof MOTION_MODES)[number]);
      params.motion = idx;
      field.uniforms.motion.value = idx;
    });
  fMotion.add(params, 'speed', 0, 8, 0.05).name('speed (0 = pause)').onChange((v: number) => field.setSpeed(v));
  fMotion.add(params, 'flowStrength', 0, 6, 0.01).onChange((v: number) => (field.uniforms.flowStrength.value = v));
  fMotion.add(params, 'flowScale', 0.01, 0.5, 0.001).onChange((v: number) => (field.uniforms.flowScale.value = v));
  fMotion.add(params, 'timeSpeed', 0, 0.5, 0.001).onChange((v: number) => (field.uniforms.timeSpeed.value = v));
  fMotion.add(params, 'spring', 0, 3, 0.01).onChange((v: number) => (field.uniforms.spring.value = v));
  fMotion.add(params, 'damping', 0.8, 0.999, 0.001).onChange((v: number) => (field.uniforms.damping.value = v));

  const fLook = gui.addFolder('Look');
  const look = { blend: 'additive' as 'additive' | 'normal' };
  fLook
    .add(look, 'blend', ['additive', 'normal'])
    .name('blend (→ normal if black)')
    .onChange((m: 'additive' | 'normal') => field.setBlendMode(m));
  fLook.add(params, 'size', 0.01, 1.5, 0.005).onChange((v: number) => (field.uniforms.size.value = v));
  fLook.add(params, 'exposure', 0.02, 2.0, 0.01).onChange((v: number) => (field.uniforms.exposure.value = v));
  fLook.addColor(params, 'warmColor').name('warm').onChange((v: string) => field.uniforms.warm.value.set(v));
  fLook.addColor(params, 'coolColor').name('cool').onChange((v: string) => field.uniforms.cool.value.set(v));

  const fPost = gui.addFolder('Bloom / Tone');
  const TONE = {
    AgX: THREE.AgXToneMapping,
    Neutral: THREE.NeutralToneMapping,
    ACES: THREE.ACESFilmicToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    None: THREE.NoToneMapping,
  };
  const post = { tone: 'AgX' as keyof typeof TONE };
  fPost
    .add(post, 'tone', Object.keys(TONE))
    .name('tone map')
    .onChange((k: keyof typeof TONE) => {
      renderer.toneMapping = TONE[k];
      postProcessing.needsUpdate = true; // rebuild output transform
    });
  fPost
    .add(renderer, 'toneMappingExposure', 0, 3, 0.01)
    .name('tone exposure');
  fPost.add(bloomPass.strength, 'value', 0, 3, 0.01).name('bloom strength');
  fPost.add(bloomPass.radius, 'value', 0, 1, 0.01).name('bloom radius');
  fPost.add(bloomPass.threshold, 'value', 0, 1, 0.01).name('bloom threshold');

  const fStructure = gui.addFolder('Structure (regenerates)');
  fStructure.add(params, 'radius', 4, 60, 0.5);
  fStructure.add(params, 'warpScale', 0.01, 0.3, 0.001);
  fStructure.add(params, 'warpStrength', 0, 40, 0.5);
  fStructure
    .add(
      {
        regenerate: () => {
          field.uniforms.radius.value = params.radius;
          field.uniforms.warpScale.value = params.warpScale;
          field.uniforms.warpStrength.value = params.warpStrength;
          field.regenerate();
        },
      },
      'regenerate',
    )
    .name('↻ regenerate / reseed');

  // --- Keyboard shortcuts for the gizmo --------------------------------------
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': gizmo.setMode('translate'); break;
      case 'e': gizmo.setMode('rotate'); break;
      case 'r': gizmo.setMode('scale'); break;
      case 'g':
        view.gizmo = !view.gizmo;
        applyGizmoState(view.gizmo);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        break;
    }
  });

  // --- Resize ----------------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    field.update(delta);
    orbit.update();
    postProcessing.render();
  });
}

main();
