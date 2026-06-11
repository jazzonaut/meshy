<script setup lang="ts">
import { ref, computed } from 'vue';
import Select from 'primevue/select';
import SliderRow from './SliderRow.vue';
import { listPresetNames, getPreset } from '../../presets';
import { useController } from './useController';

const c = useController();
const names = ref<string[]>(listPresetNames());
const a = ref<string | null>(null);
const b = ref<string | null>(null);
const t = ref(0);

const options = computed(() => names.value.map((n) => ({ label: n, value: n })));

// Re-read on open so presets saved this session show up without a reload.
function refresh() {
  names.value = listPresetNames();
}

function selectA(v: string | null) {
  a.value = v;
  apply();
}
function selectB(v: string | null) {
  b.value = v;
  apply();
}

/** Cross-fade between the two chosen presets as overlapping live fields. */
function apply(tv: number = t.value) {
  if (!a.value || !b.value) return;
  const sa = getPreset(a.value);
  const sb = getPreset(b.value);
  if (!sa || !sb) return;
  c.onBlendFields(sa, sb, tv);
}
</script>

<template>
  <p class="pb-1 text-[11px] leading-snug text-surface-500">
    Cross-fade between two saved presets as overlapping live fields — blends
    everything (motion, colour, structure). Runs both at once, so it's heavier;
    lower particle counts help.
  </p>
  <div class="flex items-center justify-between gap-3 py-1.5">
    <span class="w-6 text-xs text-surface-200">A</span>
    <Select
      :model-value="a"
      :options="options"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="preset A"
      class="w-full"
      @show="refresh"
      @update:model-value="selectA"
    />
  </div>
  <div class="flex items-center justify-between gap-3 py-1.5">
    <span class="w-6 text-xs text-surface-200">B</span>
    <Select
      :model-value="b"
      :options="options"
      option-label="label"
      option-value="value"
      size="small"
      placeholder="preset B"
      class="w-full"
      @show="refresh"
      @update:model-value="selectB"
    />
  </div>
  <SliderRow label="A ↔ B blend" :min="0" :max="1" :step="0.005" v-model="t" @input="(v) => apply(v)" />
</template>
