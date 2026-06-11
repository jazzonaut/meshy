<script setup lang="ts">
import { ref } from 'vue';
import Select from 'primevue/select';
import Button from 'primevue/button';
import ConfirmPopup from 'primevue/confirmpopup';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { listPresetNames, savePreset, getPreset, deletePreset } from '../../presets';
import { useController } from './useController';

const c = useController();
const toast = useToast();
const confirm = useConfirm();

// Presets persisted to localStorage. A snapshot captures the same state as a
// Share link (motion, tuning, colours, count, morph, pointer action). Kept
// compact so it sits inline with the Share / Studio buttons; the name is asked
// for on save rather than via a dedicated input row.
const presetNames = ref<string[]>(listPresetNames());
const selected = ref<string | null>(null);

function loadPreset(name: string | null) {
  if (!name) return;
  const state = getPreset(name);
  if (!state) {
    presetNames.value = listPresetNames(); // vanished from another tab — resync
    toast.add({ severity: 'warn', summary: 'Preset not found', detail: name, life: 2000 });
    return;
  }
  c.applyPreset(state);
  toast.add({ severity: 'success', summary: 'Preset loaded', detail: name, life: 1600 });
}
function saveClicked() {
  const name = window.prompt('Save current look as preset:')?.trim();
  if (!name) return;
  const overwrote = presetNames.value.includes(name);
  savePreset(name, c.snapshot());
  presetNames.value = listPresetNames();
  selected.value = name;
  toast.add({ severity: 'success', summary: overwrote ? 'Preset updated' : 'Preset saved', detail: name, life: 1600 });
}
function deleteClicked(event: Event) {
  const name = selected.value;
  if (!name) return;
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Delete preset "${name}"?`,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', size: 'small', text: true },
    acceptProps: { label: 'Delete', severity: 'danger', size: 'small' },
    accept: () => {
      deletePreset(name);
      selected.value = null;
      presetNames.value = listPresetNames();
      toast.add({ severity: 'info', summary: 'Preset deleted', detail: name, life: 1600 });
    },
  });
}
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <Select
      v-model="selected"
      :options="presetNames"
      placeholder="presets"
      size="small"
      class="min-w-0 flex-1"
      :disabled="!presetNames.length"
      @update:model-value="loadPreset"
    />
    <Button label="Save" size="small" severity="secondary" text @click="saveClicked" />
    <Button
      v-if="selected"
      label="✕"
      size="small"
      severity="danger"
      text
      @click="deleteClicked"
    />
    <ConfirmPopup />
  </div>
</template>
