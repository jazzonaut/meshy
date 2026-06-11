import { instancedArray } from 'three/tsl';
import { BUCKET_CAP, NUM_CELLS, TRAIL_CELLS, SPECTRO_CELLS } from './config';

/**
 * All GPU storage buffers backing the simulation. Allocated once per field and
 * never touched by the CPU after creation.
 */
export function createBuffers(count: number) {
  return {
    positions: instancedArray(count, 'vec3'),
    homes: instancedArray(count, 'vec3'), // anchor each particle drifts around
    velocities: instancedArray(count, 'vec3'),
    colors: instancedArray(count, 'vec3'),
    // Per-particle attributes the motion logic reads:
    // x = mass (inertia / force response), y = phase (wave offset),
    // z = species (0 = cool, 1 = warm — tied to colour), w = size factor.
    props: instancedArray(count, 'vec4'),
    // Per-particle morph target (a point sampled on the active shape/text). Filled
    // from the CPU via ParticleField.setMorphTarget; read by the morph force.
    targets: instancedArray(count, 'vec3'),

    // Spatial-hash grid (flock modes). cellCount is atomic so many threads can
    // append into the same cell race-free; cellTable holds the resulting per-cell
    // index lists (BUCKET_CAP wide).
    cellCount: instancedArray(NUM_CELLS, 'uint').toAtomic(),
    cellTable: instancedArray(NUM_CELLS * BUCKET_CAP, 'uint'),

    // Physarum trail field (slime mode). trailDeposit is atomic for race-free
    // accumulation (integer fixed-point); trailField is the smoothed/decaying
    // chemoattractant agents sense and steer up.
    trailDeposit: instancedArray(TRAIL_CELLS, 'uint').toAtomic(),
    trailField: instancedArray(TRAIL_CELLS, 'float'),

    // Spectrogram amplitude history (Spectrogram Waterfall mode). A ring of
    // SPECTRO_D rows × SPECTRO_W columns, written one fresh FFT row per frame from
    // the CPU (mirrors the morph-target upload path); the mode reads it as a
    // scrolling 3D terrain.
    audioField: instancedArray(SPECTRO_CELLS, 'float'),
  };
}

export type FieldBuffers = ReturnType<typeof createBuffers>;

/** Release every buffer's GPU resources. */
export function disposeBuffers(b: FieldBuffers) {
  b.positions.dispose?.();
  b.homes.dispose?.();
  b.velocities.dispose?.();
  b.colors.dispose?.();
  b.props.dispose?.();
  b.targets.dispose?.();
  b.cellCount.dispose?.();
  b.cellTable.dispose?.();
  b.trailDeposit.dispose?.();
  b.trailField.dispose?.();
  b.audioField.dispose?.();
}
