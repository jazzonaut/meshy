<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Select from 'primevue/select';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import ModePicker from './ModePicker.vue';
import PresetBar from './PresetBar.vue';
import StudioDrawer from './StudioDrawer.vue';
import { useController } from './useController';
import { POINTER_MODES, type PointerMode } from '../types';

const c = useController();
const toast = useToast();
const studioOpen = ref(false);
const fullscreen = ref(Boolean(document.fullscreenElement));

const pointerOpts = POINTER_MODES
  .map((m) => ({ label: m, value: m }))
  .sort((a, b) => a.label.localeCompare(b.label));

function setPointer(mode: PointerMode | null) {
  if (mode == null) return;
  c.pointerState.mode = mode;
  c.onPointerForce();
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.fullscreenEnabled) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    toast.add({ severity: 'warn', summary: 'Full screen unavailable', detail: 'The browser blocked the request.', life: 2200 });
  }
}
function syncFullscreen() {
  fullscreen.value = Boolean(document.fullscreenElement);
}
async function share() {
  const ok = await c.onShare();
  if (ok) {
    toast.add({ severity: 'success', summary: 'Link copied', detail: 'Shareable URL is on your clipboard.', life: 1800 });
  } else {
    toast.add({ severity: 'warn', summary: 'Copy failed', detail: 'Could not access the clipboard.', life: 2500 });
  }
}
async function toggleMic() {
  const turningOn = !c.audioState.enabled;
  const ok = await c.onAudioToggle(turningOn);
  if (turningOn && !ok) {
    toast.add({ severity: 'warn', summary: 'Microphone blocked', detail: 'Allow mic access to react to sound.', life: 2800 });
  } else if (turningOn && ok) {
    toast.add({ severity: 'success', summary: 'Mic live', detail: 'The field now reacts to sound. Try the Spectrogram Waterfall mode.', life: 2600 });
  }
}

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen));
onUnmounted(() => document.removeEventListener('fullscreenchange', syncFullscreen));
</script>

<template>
  <Toast
    position="bottom-center"
    :breakpoints="{
      '640px': {
        width: 'calc(100% - 1rem)',
        left: '0.5rem',
        right: 'auto',
        transform: 'none',
        bottom: 'calc(env(safe-area-inset-bottom) + 5rem)',
      },
    }"
  />

  <div
    class="pointer-events-auto fixed left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] flex flex-col gap-1.5 rounded-lg border border-white/8 bg-surface-950/55 p-1.5 shadow-lg backdrop-blur-md sm:right-auto sm:w-[clamp(17rem,30vw,23rem)]"
  >
    <div class="flex items-center gap-1.5">
      <div class="min-w-0 flex-1">
        <ModePicker />
      </div>
      <Select
        :model-value="c.pointerState.mode"
        :options="pointerOpts"
        option-label="label"
        option-value="value"
        size="small"
        class="w-32 shrink-0"
        @update:model-value="setPointer"
      />
      <Button
        size="small"
        :severity="c.audioState.enabled ? 'success' : 'secondary'"
        :text="!c.audioState.enabled"
        class="h-8 w-8 shrink-0 !p-0 text-base"
        :aria-label="c.audioState.enabled ? 'Microphone live — tap to stop' : 'React to sound from the microphone'"
        :title="c.audioState.enabled ? 'Microphone live — tap to stop' : 'React to sound from the microphone'"
        @click="toggleMic"
      >
        <span aria-hidden="true">🎤</span>
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <PresetBar />
      <Button label="Share" size="small" severity="secondary" text @click="share" />
      <Button label="Studio" size="small" severity="secondary" @click="studioOpen = true" />
    </div>
  </div>

  <Button
    severity="secondary"
    text
    class="pointer-events-auto fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] h-9 w-9 !p-0 text-base shadow-lg backdrop-blur-md"
    :aria-label="fullscreen ? 'Exit full screen' : 'Enter full screen'"
    :title="fullscreen ? 'Exit full screen' : 'Enter full screen'"
    @click="toggleFullscreen"
  >
    <span aria-hidden="true">{{ fullscreen ? '×' : '⛶' }}</span>
  </Button>

  <StudioDrawer v-model:visible="studioOpen" />
</template>
