import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { FieldParams } from './config';

/**
 * Allocate every uniform the field's compute kernels and material read. Returned
 * as a plain record so callers can poke `.value` directly (the GUI does this).
 */
export function createUniforms(p: FieldParams, count: number) {
  return {
    delta: uniform(1 / 60),
    time: uniform(0),
    seed: uniform(0),
    particleCount: uniform(count),
    radius: uniform(p.radius),
    warpScale: uniform(p.warpScale),
    warpStrength: uniform(p.warpStrength),
    flowScale: uniform(p.flowScale),
    flowStrength: uniform(p.flowStrength),
    timeSpeed: uniform(p.timeSpeed),
    spring: uniform(p.spring),
    damping: uniform(p.damping),
    boidSep: uniform(p.boidSep),
    boidAli: uniform(p.boidAli),
    boidCoh: uniform(p.boidCoh),
    boidPerception: uniform(p.boidPerception),
    boidMaxSpeed: uniform(p.boidMaxSpeed),
    // Cell size for the spatial hash. Must be ≥ perception radius so the 3×3×3
    // neighbour search covers every particle within range. Tied to perception by
    // the GUI; left a touch larger to keep buckets from overflowing.
    cellSize: uniform(Math.max(p.boidPerception * 1.15, 2.5)),
    // Pointer well. pointer = cursor world position; pointerActive gates it to
    // when the mouse is over the canvas; pointerStrength is the (positive)
    // magnitude; pointerMode picks which action the well performs (0 = Off → no
    // branch matches, so the well is inert). Initialised inert — the UI turns it on.
    pointer: uniform(new THREE.Vector3()),
    pointerActive: uniform(0),
    pointerRadius: uniform(p.pointerRadius),
    pointerStrength: uniform(0),
    pointerMode: uniform(0),
    slimeSense: uniform(p.slimeSense),
    slimeWander: uniform(p.slimeWander),
    slimeDecay: uniform(p.slimeDecay),
    morphAmount: uniform(p.morphAmount),
    morphStrength: uniform(p.morphStrength),
    // Audio (Spectrogram Waterfall + reactivity). audioActive gates the waterfall
    // between an idle ripple (0) and live mic amplitude (1); audioHead is the ring
    // buffer's newest-row index; spectroHeight is the terrain's vertical scale.
    audioActive: uniform(0),
    audioHead: uniform(0),
    spectroHeight: uniform(p.spectroHeight),
    // Constellation lines (a viewing overlay, like the post effects — not part of
    // FieldParams, so off by default and not round-tripped in presets/share links).
    linkRadius: uniform(2.5),
    lineBrightness: uniform(2.5),
    // Global multiplier on this field's particle opacity (1 = normal). Used to
    // cross-fade two fields against each other in the A/B blend.
    fieldOpacity: uniform(1),
    size: uniform(p.size),
    exposure: uniform(p.exposure),
    softness: uniform(p.softness),
    coreGlow: uniform(p.coreGlow),
    streak: uniform(p.streak),
    fogDensity: uniform(p.fogDensity),
    fog: uniform(new THREE.Color(p.fogColor)),
    materialStyle: uniform(p.materialStyle),
    motion: uniform(p.motion),
    warm: uniform(new THREE.Color(p.warmColor)),
    cool: uniform(new THREE.Color(p.coolColor)),
  };
}

export type FieldUniforms = ReturnType<typeof createUniforms>;
