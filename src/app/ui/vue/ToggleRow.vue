<script setup lang="ts">
import ToggleSwitch from 'primevue/toggleswitch';

defineProps<{ label: string; hint?: string }>();
const model = defineModel<boolean>({ required: true });
const emit = defineEmits<{ change: [boolean] }>();

function onUpdate(v: boolean) {
  model.value = v;
  emit('change', v);
}
</script>

<template>
  <div class="flex items-center justify-between gap-3 py-2">
    <div class="flex flex-col">
      <span class="text-xs text-surface-200">{{ label }}</span>
      <span v-if="hint" class="text-[11px] leading-snug text-surface-500">{{ hint }}</span>
    </div>
    <ToggleSwitch :model-value="model" @update:model-value="onUpdate" />
  </div>
</template>
