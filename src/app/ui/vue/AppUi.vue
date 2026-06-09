<script setup lang="ts">
import { ref } from 'vue';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Button from 'primevue/button';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import ModePicker from './ModePicker.vue';
import StudioDrawer from './StudioDrawer.vue';
import { useController } from './useController';
import type { PointerMode } from '../types';

const c = useController();
const toast = useToast();
const studioOpen = ref(false);

const countOpts = Object.keys(c.countOptions).map((label) => ({ label, value: label }));
const pointerOpts: { label: string; value: PointerMode }[] = [
  { label: 'Off', value: 'Off' },
  { label: 'Push', value: 'Push' },
  { label: 'Pull', value: 'Pull' },
];

function setCount(label: string) {
  c.view.countLabel = label;
  c.onCountChange(c.countOptions[label]);
}
function setPointer(mode: PointerMode | null) {
  if (mode == null) return;
  c.pointerState.mode = mode;
  c.onPointerForce();
}
function share() {
  c.onShare();
  toast.add({ severity: 'success', summary: 'Link copied', detail: 'Shareable URL is on your clipboard.', life: 1800 });
}
</script>

<template>
  <Toast position="bottom-center" />

  <div
    class="pointer-events-auto fixed left-2 right-2 top-2 flex flex-col gap-1.5 rounded-lg border border-white/8 bg-surface-950/55 p-1.5 shadow-lg backdrop-blur-md sm:right-auto sm:w-[clamp(17rem,30vw,23rem)]"
  >
    <ModePicker />

    <div class="flex flex-wrap items-center gap-1.5">
      <Select
        :model-value="c.view.countLabel"
        :options="countOpts"
        option-label="label"
        option-value="value"
        size="small"
        class="w-28"
        @update:model-value="setCount"
      />
      <SelectButton
        :model-value="c.pointerState.mode"
        :options="pointerOpts"
        option-label="label"
        option-value="value"
        size="small"
        :allow-empty="false"
        @update:model-value="setPointer"
      />
      <div class="ml-auto flex gap-1.5">
        <Button label="Share" size="small" severity="secondary" text @click="share" />
        <Button label="Studio" size="small" severity="secondary" @click="studioOpen = true" />
      </div>
    </div>
  </div>

  <StudioDrawer v-model:visible="studioOpen" />
</template>
