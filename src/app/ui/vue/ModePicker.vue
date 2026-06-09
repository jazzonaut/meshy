<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Button from 'primevue/button';
import Listbox from 'primevue/listbox';
import { MOTION_MODES } from '../../../field';
import { useController } from './useController';

const c = useController();
const open = ref(false);
const isMobile = window.matchMedia('(max-width: 640px)');

const options = MOTION_MODES.map((label, value) => ({ label, value }));
const currentLabel = computed(() => MOTION_MODES[c.params.motion]);

function onChange(e: { value: number | null }) {
  if (e.value == null) return; // ignore deselect
  c.onMotionPreset(e.value);
  if (isMobile.matches) open.value = false; // mobile: collapse after a pick
}

// Stays expanded until manually collapsed (trigger or Escape) — only auto-closes
// on mobile after a selection, per the requested behaviour.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="relative">
    <Button
      severity="secondary"
      class="w-full !justify-between"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="truncate">{{ currentLabel }}</span>
      <span class="ml-2 text-xs transition-transform" :class="{ 'rotate-180': open }">▾</span>
    </Button>

    <div v-if="open" class="absolute left-0 top-[calc(100%+0.4rem)] z-30 w-72 max-w-[80vw]">
      <Listbox
        :model-value="c.params.motion"
        :options="options"
        option-label="label"
        option-value="value"
        filter
        filter-placeholder="Search modes…"
        scroll-height="55vh"
        class="w-full"
        @change="onChange"
      />
    </div>
  </div>
</template>
