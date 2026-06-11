<script setup lang="ts">
import { ref } from 'vue';
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

const pointerOpts = POINTER_MODES.map((m) => ({ label: m, value: m }));

function setPointer(mode: PointerMode | null) {
  if (mode == null) return;
  c.pointerState.mode = mode;
  c.onPointerForce();
}
async function share() {
  const ok = await c.onShare();
  if (ok) {
    toast.add({ severity: 'success', summary: 'Link copied', detail: 'Shareable URL is on your clipboard.', life: 1800 });
  } else {
    toast.add({ severity: 'warn', summary: 'Copy failed', detail: 'Could not access the clipboard.', life: 2500 });
  }
}
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
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <PresetBar />
      <Button label="Share" size="small" severity="secondary" text @click="share" />
      <Button label="Studio" size="small" severity="secondary" @click="studioOpen = true" />
    </div>
  </div>

  <StudioDrawer v-model:visible="studioOpen" />
</template>
