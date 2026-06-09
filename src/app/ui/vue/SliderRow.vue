<script setup lang="ts">
import { computed } from 'vue';
import Slider from 'primevue/slider';

const props = defineProps<{
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}>();

// Two-way value binding; parent uses v-model. `input` fires the side effect
// (pushing the number to a live uniform) without clobbering the v-model channel.
const model = defineModel<number>({ required: true });
const emit = defineEmits<{ input: [number] }>();

const digits = computed(() => (props.step < 0.01 ? 3 : props.step < 1 ? 2 : 0));

function onUpdate(value: number | number[]) {
  const n = Array.isArray(value) ? value[0] : value;
  model.value = n;
  emit('input', n);
}
</script>

<template>
  <div class="flex flex-col gap-2.5 py-2.5">
    <div class="flex items-center justify-between text-xs">
      <span class="text-surface-300">{{ label }}</span>
      <span class="tabular-nums text-surface-400">{{ model.toFixed(digits) }}</span>
    </div>
    <Slider :model-value="model" :min="min" :max="max" :step="step" @update:model-value="onUpdate" />
    <p v-if="hint" class="text-[11px] leading-snug text-surface-500">{{ hint }}</p>
  </div>
</template>
