<script setup lang="ts">
import { ref, computed } from 'vue';
import * as THREE from 'three/webgpu';
import Drawer from 'primevue/drawer';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Button from 'primevue/button';
import SliderRow from './SliderRow.vue';
import ColorRow from './ColorRow.vue';
import ToggleRow from './ToggleRow.vue';
import { MATERIAL_STYLES, MORPH_SHAPES, FIRST_GPU_MODE, CRYSTAL_MODE, SLIME_MODE } from '../../../field';
import { useController } from './useController';

const visible = defineModel<boolean>('visible', { required: true });

const c = useController();
const p = c.params;
const f = () => c.getField();

// Contextual disclosure: the flock/slime tuning only does anything in those modes.
const showFlock = computed(() => p.motion >= FIRST_GPU_MODE && p.motion <= CRYSTAL_MODE);
const showSlime = computed(() => p.motion === SLIME_MODE);

const materialOpts = MATERIAL_STYLES.map((label, value) => ({ label, value }));
const shapeOpts = MORPH_SHAPES.map((s) => ({ label: s, value: s }));

const TONE: Record<string, THREE.ToneMapping> = {
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  None: THREE.NoToneMapping,
};
const toneOpts = Object.keys(TONE).map((k) => ({ label: k, value: k }));
const tone = ref('ACES');
const recording = ref(false);

function setMaterial(v: number | null) {
  if (v == null) return;
  p.materialStyle = v;
  f().setMaterialStyle(v);
}
function setWarm(v: string) {
  p.warmColor = v;
  f().uniforms.warm.value.set(v);
  f().recolor();
}
function setCool(v: string) {
  p.coolColor = v;
  f().uniforms.cool.value.set(v);
  f().recolor();
}
function setPerception(v: number) {
  const u = f().uniforms;
  u.boidPerception.value = v;
  // Keep the hash cell ≥ perception so the 3×3×3 neighbour search stays complete.
  u.cellSize.value = Math.max(v * 1.15, 2.5);
}
</script>

<template>
  <Drawer
    v-model:visible="visible"
    position="right"
    header="Studio"
    class="!w-[380px] !max-w-[92vw]"
  >
    <Accordion>
      <!-- View ------------------------------------------------------------- -->
      <AccordionPanel value="view">
        <AccordionHeader>View</AccordionHeader>
        <AccordionContent>
          <ToggleRow label="auto-rotate" v-model="c.view.autoRotate" @change="(v) => (c.controls.autoRotate = v)" />
          <ToggleRow label="axis reference" v-model="c.view.axes" @change="(v) => c.stage.setAxesVisible(v)" />
          <ToggleRow label="transform gizmo" v-model="c.view.gizmo" @change="(v) => c.controls.setGizmo(v)" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Motion ----------------------------------------------------------- -->
      <AccordionPanel value="motion">
        <AccordionHeader>Motion</AccordionHeader>
        <AccordionContent>
          <SliderRow label="speed (0 = pause)" :min="0" :max="8" :step="0.05" v-model="p.speed" @input="(v) => f().setSpeed(v)" />
          <SliderRow label="flow strength" :min="0" :max="6" :step="0.01" v-model="p.flowStrength" @input="(v) => (f().uniforms.flowStrength.value = v)" />
          <SliderRow label="flow scale" :min="0.01" :max="0.5" :step="0.001" v-model="p.flowScale" @input="(v) => (f().uniforms.flowScale.value = v)" />
          <SliderRow label="time speed" :min="0" :max="0.5" :step="0.001" v-model="p.timeSpeed" @input="(v) => (f().uniforms.timeSpeed.value = v)" />
          <SliderRow label="spring" :min="0" :max="3" :step="0.01" v-model="p.spring" @input="(v) => (f().uniforms.spring.value = v)" />
          <SliderRow label="damping" :min="0.8" :max="0.999" :step="0.001" v-model="p.damping" @input="(v) => (f().uniforms.damping.value = v)" />
        </AccordionContent>
      </AccordionPanel>

      <!-- GPU flock (contextual) ------------------------------------------- -->
      <AccordionPanel v-if="showFlock" value="flock">
        <AccordionHeader>GPU flock params</AccordionHeader>
        <AccordionContent>
          <p class="pb-1 text-[11px] leading-snug text-surface-500">
            Shared by Boids / Predator / Droplets / Crystallize. Smoothest at ≤250k particles.
          </p>
          <SliderRow label="separation" :min="0" :max="6" :step="0.05" v-model="p.boidSep" @input="(v) => (f().uniforms.boidSep.value = v)" />
          <SliderRow label="alignment" :min="0" :max="4" :step="0.05" v-model="p.boidAli" @input="(v) => (f().uniforms.boidAli.value = v)" />
          <SliderRow label="cohesion" :min="0" :max="4" :step="0.05" v-model="p.boidCoh" @input="(v) => (f().uniforms.boidCoh.value = v)" />
          <SliderRow label="perception" :min="0.5" :max="4" :step="0.05" v-model="p.boidPerception" @input="setPerception" />
          <SliderRow label="max speed" :min="1" :max="20" :step="0.5" v-model="p.boidMaxSpeed" @input="(v) => (f().uniforms.boidMaxSpeed.value = v)" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Pointer ---------------------------------------------------------- -->
      <AccordionPanel value="pointer">
        <AccordionHeader>Pointer</AccordionHeader>
        <AccordionContent>
          <p class="pb-1 text-[11px] leading-snug text-surface-500">
            The off/push/pull toggle is up top; these tune the force well it drives.
          </p>
          <SliderRow label="strength" :min="0" :max="30" :step="0.5" v-model="p.pointerStrength" @input="() => c.onPointerForce()" />
          <SliderRow label="radius" :min="2" :max="40" :step="0.5" v-model="p.pointerRadius" @input="() => c.onPointerForce()" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Slime (contextual) ----------------------------------------------- -->
      <AccordionPanel v-if="showSlime" value="slime">
        <AccordionHeader>Slime Mold</AccordionHeader>
        <AccordionContent>
          <SliderRow label="sense (follow)" :min="0" :max="20" :step="0.1" v-model="p.slimeSense" @input="(v) => (f().uniforms.slimeSense.value = v)" />
          <SliderRow label="wander (branch)" :min="0" :max="5" :step="0.05" v-model="p.slimeWander" @input="(v) => (f().uniforms.slimeWander.value = v)" />
          <SliderRow label="trail decay" :min="0.5" :max="0.99" :step="0.005" v-model="p.slimeDecay" @input="(v) => (f().uniforms.slimeDecay.value = v)" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Morph ------------------------------------------------------------ -->
      <AccordionPanel value="morph">
        <AccordionHeader>Morph</AccordionHeader>
        <AccordionContent>
          <div class="flex items-center justify-between gap-3 py-2">
            <span class="text-xs text-surface-200">shape</span>
            <Select
              :model-value="c.morphState.shape"
              :options="shapeOpts"
              option-label="label"
              option-value="value"
              class="w-44"
              @update:model-value="(s) => c.onMorphShape(s)"
            />
          </div>
          <SliderRow label="amount" :min="0" :max="1" :step="0.01" v-model="p.morphAmount" @input="() => c.onMorphParam()" />
          <SliderRow label="pull strength" :min="0" :max="12" :step="0.1" v-model="p.morphStrength" @input="() => c.onMorphParam()" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Look ------------------------------------------------------------- -->
      <AccordionPanel value="look">
        <AccordionHeader>Look</AccordionHeader>
        <AccordionContent>
          <div class="flex flex-col gap-2 py-2">
            <span class="text-xs text-surface-200">material</span>
            <SelectButton
              :model-value="p.materialStyle"
              :options="materialOpts"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              @update:model-value="setMaterial"
            />
          </div>
          <SliderRow label="size" :min="0.01" :max="1.5" :step="0.005" v-model="p.size" @input="(v) => (f().uniforms.size.value = v)" />
          <SliderRow label="exposure" :min="0.02" :max="2" :step="0.01" v-model="p.exposure" @input="(v) => (f().uniforms.exposure.value = v)" />
          <ColorRow label="warm" :model-value="(p.warmColor as string)" @update:model-value="setWarm" />
          <ColorRow label="cool" :model-value="(p.coolColor as string)" @update:model-value="setCool" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Bloom / Tone ----------------------------------------------------- -->
      <AccordionPanel value="bloom">
        <AccordionHeader>Bloom / Tone</AccordionHeader>
        <AccordionContent>
          <div class="flex items-center justify-between gap-3 py-2">
            <span class="text-xs text-surface-200">tone map</span>
            <Select
              v-model="tone"
              :options="toneOpts"
              option-label="label"
              option-value="value"
              class="w-44"
              @update:model-value="(k) => c.post.setTone(TONE[k])"
            />
          </div>
          <SliderRow label="tone exposure" :min="0" :max="3" :step="0.01" v-model="c.renderer.toneMappingExposure" />
          <SliderRow label="bloom strength" :min="0" :max="3" :step="0.01" v-model="c.post.bloomPass.strength.value" />
          <SliderRow label="bloom radius" :min="0" :max="1" :step="0.01" v-model="c.post.bloomPass.radius.value" />
          <SliderRow label="bloom threshold" :min="0" :max="1" :step="0.01" v-model="c.post.bloomPass.threshold.value" />
          <SliderRow label="trails (long exposure)" :min="0" :max="0.96" :step="0.01" v-model="c.post.trailDamp.value" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Capture ---------------------------------------------------------- -->
      <AccordionPanel value="capture">
        <AccordionHeader>Capture</AccordionHeader>
        <AccordionContent>
          <div class="flex flex-col gap-3 py-2">
            <Button label="📷 screenshot (PNG)" severity="secondary" @click="c.capture.requestScreenshot()" />
            <ToggleRow label="● record (webm)" v-model="recording" @change="(v) => c.capture.toggleRecording(v)" />
          </div>
        </AccordionContent>
      </AccordionPanel>

      <!-- Demo ------------------------------------------------------------- -->
      <AccordionPanel value="demo">
        <AccordionHeader>Demo reel</AccordionHeader>
        <AccordionContent>
          <ToggleRow label="▶ auto demo-reel" v-model="c.demo.enabled" @change="(v) => c.onDemoToggle(v)" />
          <SliderRow label="reel interval (s)" :min="2" :max="20" :step="0.5" v-model="c.demo.interval" />
          <ToggleRow label="show FPS" v-model="c.demo.fps" @change="(v) => c.onStatsToggle(v)" />
        </AccordionContent>
      </AccordionPanel>

      <!-- Structure -------------------------------------------------------- -->
      <AccordionPanel value="structure">
        <AccordionHeader>Structure</AccordionHeader>
        <AccordionContent>
          <p class="pb-1 text-[11px] leading-snug text-surface-500">Changes apply on regenerate.</p>
          <SliderRow label="radius" :min="4" :max="60" :step="0.5" v-model="p.radius" />
          <SliderRow label="warp scale" :min="0.01" :max="0.3" :step="0.001" v-model="p.warpScale" />
          <SliderRow label="warp strength" :min="0" :max="40" :step="0.5" v-model="p.warpStrength" />
          <Button class="mt-2 w-full" label="↻ regenerate / reseed" severity="secondary" @click="c.onRegenerate()" />
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </Drawer>
</template>
