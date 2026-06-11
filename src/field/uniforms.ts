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
    size: uniform(p.size),
    exposure: uniform(p.exposure),
    materialStyle: uniform(p.materialStyle),
    motion: uniform(p.motion),
    warm: uniform(new THREE.Color(p.warmColor)),
    cool: uniform(new THREE.Color(p.coolColor)),
  };
}

export type FieldUniforms = ReturnType<typeof createUniforms>;
