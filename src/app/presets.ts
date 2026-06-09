import type { SceneState } from './presetUrl';

/**
 * Named look presets, persisted to localStorage. Each preset is a {@link SceneState}
 * — the same snapshot the Share link round-trips — stored under one key as a
 * `name → state` map. All reads are defensive: a missing/corrupt store reads as
 * empty rather than throwing, so the UI never breaks on bad data.
 */
const KEY = 'meshy.presets.v1';

type PresetMap = Record<string, SceneState>;

function readAll(): PresetMap {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as PresetMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: PresetMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota or disabled storage — nothing useful to do; the in-memory UI list
    // still reflects the attempt for this session.
  }
}

/** Saved preset names, alphabetically. */
export function listPresetNames(): string[] {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

/** Save (or overwrite) a preset under `name`. */
export function savePreset(name: string, state: SceneState): void {
  const all = readAll();
  all[name] = state;
  writeAll(all);
}

/** Load a preset by name, or null if it no longer exists. */
export function getPreset(name: string): SceneState | null {
  return readAll()[name] ?? null;
}

/** Remove a preset by name (no-op if absent). */
export function deletePreset(name: string): void {
  const all = readAll();
  delete all[name];
  writeAll(all);
}
