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
    class="pointer-events-auto fixed left-3 right-3 top-3 flex flex-col gap-2 rounded-xl border border-white/10 bg-surface-900/70 p-2 shadow-2xl backdrop-blur-xl sm:right-auto sm:w-[clamp(20rem,40vw,32rem)]"
  >
    <ModePicker />

    <div class="flex flex-wrap items-center gap-2">
      <Select
        :model-value="c.view.countLabel"
        :options="countOpts"
        option-label="label"
        option-value="value"
        class="w-28"
        @update:model-value="setCount"
      />
      <SelectButton
        :model-value="c.pointerState.mode"
        :options="pointerOpts"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        @update:model-value="setPointer"
      />
      <div class="ml-auto flex gap-2">
        <Button label="🔗 Share" severity="secondary" @click="share" />
        <Button label="⚙ Studio" @click="studioOpen = true" />
      </div>
    </div>
  </div>

  <StudioDrawer v-model:visible="studioOpen" />
</template>
