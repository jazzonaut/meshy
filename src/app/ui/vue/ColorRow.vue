<script setup lang="ts">
import { computed } from 'vue';
import ColorPicker from 'primevue/colorpicker';

const props = defineProps<{ label: string; modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

// PrimeVue's ColorPicker speaks bare hex ("e8581f"); the field params keep a
// leading "#". Bridge the two here so callers stay clean.
const hex = computed({
  get: () => props.modelValue.replace('#', ''),
  set: (v: string) => emit('update:modelValue', '#' + v.replace('#', '')),
});
</script>

<template>
  <div class="flex items-center justify-between py-2.5 text-xs">
    <span class="text-surface-200">{{ label }}</span>
    <ColorPicker v-model="hex" format="hex" />
  </div>
</template>
