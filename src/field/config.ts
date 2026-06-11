import type * as THREE from 'three/webgpu';

/** Motion modes — index matches the `motion` uniform / GUI dropdown order. */
export const MOTION_MODES = [
  'Ambient Curl',
  'Galactic Vortex',
  'Convection (color)',
  'Dual Attractors (color)',
  'Pulse Waves',
  'Magnetic Field Lines',
  'Tornado Column',
  'Breathing Nebula',
  'Implosion / Supernova',
  'Orbital Shells',
  'Color Sorting',
  'Electric Arcs',
  'Black Hole Accretion',
  'Flocking Swarm',
  'Ash Fall',
  'Lorenz Drift',
  'Aizawa Orbit',
  'Cymatic Plate',
  'Kaleidoscope Fold',
  'Vortex Ring',
  'Interference Lattice',
  'Slipstream',
  'Phyllotaxis Sphere',
  'Möbius Band',
  'Harmonic Bloom',
  'Gravity Wells',
  'Spiral Staircase',
  'Tesseract',
  'Magnetosphere',
  'Thomas Tangle',
  'Boids Flock (GPU)',
  'Predator Scatter (GPU)',
  'Liquid Droplets (GPU)',
  'Crystallize (GPU)',
  'Slime Mold (GPU)',
  'Spectrogram Waterfall',
] as const;

export type MotionMode = (typeof MOTION_MODES)[number];

export interface MotionGroup {
  label: string;
  modes: readonly MotionMode[];
}

export const MOTION_GROUPS: readonly MotionGroup[] = [
  {
    label: 'Classic',
    modes: [
      'Ambient Curl',
      'Ash Fall',
      'Black Hole Accretion',
      'Breathing Nebula',
      'Color Sorting',
      'Convection (color)',
      'Dual Attractors (color)',
      'Electric Arcs',
      'Flocking Swarm',
      'Galactic Vortex',
      'Implosion / Supernova',
      'Magnetic Field Lines',
      'Orbital Shells',
      'Pulse Waves',
      'Tornado Column',
    ],
  },
  {
    label: 'Experimental',
    modes: [
      'Aizawa Orbit',
      'Cymatic Plate',
      'Gravity Wells',
      'Harmonic Bloom',
      'Interference Lattice',
      'Kaleidoscope Fold',
      'Lorenz Drift',
      'Magnetosphere',
      'Möbius Band',
      'Phyllotaxis Sphere',
      'Slipstream',
      'Spiral Staircase',
      'Tesseract',
      'Thomas Tangle',
      'Vortex Ring',
    ],
  },
  {
    label: 'Emergent GPU',
    modes: [
      'Boids Flock (GPU)',
      'Crystallize (GPU)',
      'Liquid Droplets (GPU)',
      'Predator Scatter (GPU)',
      'Slime Mold (GPU)',
    ],
  },
  {
    label: 'Audio',
    modes: ['Spectrogram Waterfall'],
  },
] as const;

/** Render material styles — index matches the `materialStyle` uniform. */
export const MATERIAL_STYLES = ['Nebula Glow', 'Pearl Dust', 'Metallic Sparks'] as const;

/** Morph targets the cloud can be pulled into. 'None' leaves the field free. */
export const MORPH_SHAPES = [
  'None',
  'Sphere',
  'Cube',
  'Pyramid',
  'Cylinder',
  'Capsule',
  'Icosahedron',
  'Torus',
  'Torus Knot',
  'Helix',
  'Heart',
  'MESHY',
] as const;
export type MorphShape = (typeof MORPH_SHAPES)[number];

// Indices of the multi-pass GPU modes. The flock modes (Boids…Crystallize) share
// one spatial-hash grid pipeline; Slime Mould has its own trail-field pipeline.
export const BOIDS_MODE = MOTION_MODES.indexOf('Boids Flock (GPU)');
export const PREDATOR_MODE = MOTION_MODES.indexOf('Predator Scatter (GPU)');
export const DROPLET_MODE = MOTION_MODES.indexOf('Liquid Droplets (GPU)');
export const CRYSTAL_MODE = MOTION_MODES.indexOf('Crystallize (GPU)');
export const SLIME_MODE = MOTION_MODES.indexOf('Slime Mold (GPU)');
/**
 * Spectrogram Waterfall — a microphone-driven 3D FFT terrain. Like Slime, it's
 * special-cased in the update routing (checked before the `>= FIRST_GPU_MODE`
 * flock range) since it has its own single-pass kernel and reads the audio buffer
 * rather than the hash grid.
 */
export const SPECTRO_MODE = MOTION_MODES.indexOf('Spectrogram Waterfall');
export const FIRST_EXPERIMENTAL_MODE = MOTION_MODES.indexOf('Lorenz Drift');
export const LAST_EXPERIMENTAL_MODE = MOTION_MODES.indexOf('Thomas Tangle');
/** Modes at or beyond this index use a GPU multi-pass pipeline. */
export const FIRST_GPU_MODE = BOIDS_MODE;

/**
 * GPU spatial-hash grid sizing for the flock modes. Particles are bucketed into a
 * GRID_RES³ uniform grid (cell size is a uniform, so the grid scales with the
 * perception radius); each cell holds up to BUCKET_CAP particle indices. The cap
 * bounds the per-frame neighbour work so the cost stays predictable even when the
 * flock clumps — the GPU modes are smoothest at ≤250k particles.
 */
export const GRID_RES = 48;
export const BUCKET_CAP = 32;
export const NUM_CELLS = GRID_RES * GRID_RES * GRID_RES;

// Resolution of the Physarum (slime mould) 3D trail field — finer than the
// neighbour grid so the self-organised veins read as crisp filaments.
export const TRAIL_RES = 96;
export const TRAIL_CELLS = TRAIL_RES * TRAIL_RES * TRAIL_RES;
// Fixed-point scale: trail is deposited into an atomic uint buffer (WGSL atomics
// are integer-only), then read back as float / TRAIL_FIXED.
export const TRAIL_FIXED = 256.0;

/**
 * Spectrogram Waterfall grid. SPECTRO_W frequency columns × SPECTRO_D time rows of
 * amplitude history live in one storage buffer (a ring, newest row at the head);
 * the mode maps every particle to a cell (many particles per cell when the count
 * exceeds the grid) so the terrain reads dense. The CPU mirrors this buffer and
 * uploads one fresh FFT row per frame — the same cheap upload path morph targets use.
 */
export const SPECTRO_W = 128;
export const SPECTRO_D = 96;
export const SPECTRO_CELLS = SPECTRO_W * SPECTRO_D;

/**
 * Constellation lines. The first LINK_NODES particles each emit up to MAX_LINKS
 * segments to nearby higher-indexed particles (found via the shared spatial-hash
 * grid). Segments are stored as particle-index pairs in a uint buffer (LINK_VERTS =
 * 2 verts per segment) and rendered as GL line segments whose vertex positions are
 * pulled live from the position buffer — so the web flexes with the motion for
 * free, and only the topology is recomputed per frame. Kept to a sparse subset so
 * the result reads as a constellation overlay rather than a solid mesh.
 */
export const LINK_NODES = 6000; // particles that emit links (a sparse subset)
export const MAX_LINKS = 2; // links per node
export const DOTS_PER = 12; // glowing dots interpolated along each link
export const LINK_DOTS = LINK_NODES * MAX_LINKS * DOTS_PER;

/**
 * Tunable parameters for the field. Anything used inside the init pass (structure
 * / colour) takes effect after calling `regenerate()`. Anything used inside the
 * update passes (motion) takes effect immediately on the next frame.
 */
export interface FieldParams {
  // Structure (needs regenerate)
  radius: number;
  warpScale: number;
  warpStrength: number;
  // Motion (live)
  speed: number; // global multiplier on the whole simulation timestep
  flowScale: number;
  flowStrength: number;
  timeSpeed: number;
  spring: number;
  damping: number;
  // Boids — GPU flocking (live; only active in the GPU flock modes)
  boidSep: number; // separation steer weight
  boidAli: number; // alignment steer weight
  boidCoh: number; // cohesion steer weight
  boidPerception: number; // neighbour radius (kept ≤ cell size by the GUI)
  boidMaxSpeed: number; // velocity clamp so the flock stays coherent
  // Pointer interaction (live) — cursor force well, applied in every mode
  pointerRadius: number; // world-space reach of the well
  pointerStrength: number; // magnitude; the GUI mode picks push (+) or pull (−)
  // Slime mould (live; only active in the Slime Mold mode)
  slimeSense: number; // how hard agents steer up the trail gradient
  slimeWander: number; // curl-noise exploration that seeds branching
  slimeDecay: number; // trail field persistence per frame (0..1)
  // Morph (live) — pull particles toward a sampled shape / text in any mode
  morphAmount: number; // 0 = free nebula, 1 = fully formed shape
  morphStrength: number; // spring stiffness toward the target point
  // Audio (live) — microphone reactivity. audioReactivity modulates any preset's
  // look; audioGain scales the mic input; spectroHeight is the Spectrogram
  // Waterfall mode's vertical amplitude. The mic is enabled separately (a runtime
  // permission), so these are pure tuning values safe to round-trip in presets.
  audioReactivity: number; // 0 = off, 1 = strong modulation of size/flow/exposure
  audioGain: number; // input sensitivity multiplier on the mic level
  spectroHeight: number; // waterfall vertical scale (Spectrogram Waterfall mode)
  // Look (live)
  size: number;
  exposure: number;
  softness: number; // sprite falloff: low = broad haze, high = tight mote
  coreGlow: number; // 0 = flat tint, 1 = white-hot center that blows out under bloom
  streak: number; // velocity stretch: 0 = round, higher = comet streaks along motion
  fogDensity: number; // depth fade: 0 = off, higher = far particles recede into the void
  fogColor: THREE.ColorRepresentation; // colour distant particles fade toward
  warmColor: THREE.ColorRepresentation;
  coolColor: THREE.ColorRepresentation;
  materialStyle: number;
  // Motion mode index (live)
  motion: number;
}

export type MotionPreset = Pick<
  FieldParams,
  'speed' | 'flowScale' | 'flowStrength' | 'timeSpeed' | 'spring' | 'damping'
>;

export const DEFAULT_PARAMS: FieldParams = {
  speed: 5.0,
  radius: 25,
  warpScale: 0.06,
  warpStrength: 14,
  flowScale: 0.12,
  flowStrength: 1.4,
  timeSpeed: 0.06,
  spring: 0.7,
  damping: 0.93,
  boidSep: 3.0,
  boidAli: 2.2,
  boidCoh: 0.9,
  boidPerception: 2.6,
  boidMaxSpeed: 12.0,
  pointerRadius: 12,
  pointerStrength: 8,
  slimeSense: 6.0,
  slimeWander: 1.4,
  slimeDecay: 0.9,
  morphAmount: 1,
  morphStrength: 12,
  audioReactivity: 0.6,
  audioGain: 1.0,
  spectroHeight: 0.9,
  size: 0.06,
  exposure: 1,
  softness: 1.4,
  coreGlow: 0,
  streak: 0,
  fogDensity: 0,
  fogColor: '#060912',
  warmColor: '#e8581f',
  coolColor: '#6fa8ff',
  materialStyle: 0,
  motion: 0,
};

export const MOTION_PRESETS: MotionPreset[] = [
  { speed: 5.0, flowStrength: 1.4, flowScale: 0.12, timeSpeed: 0.06, spring: 0.7, damping: 0.93 },
  { speed: 5.0, flowStrength: 1.6, flowScale: 0.1, timeSpeed: 0.07, spring: 0.55, damping: 0.94 },
  { speed: 4.0, flowStrength: 1.3, flowScale: 0.11, timeSpeed: 0.07, spring: 0.5, damping: 0.94 },
  { speed: 4.5, flowStrength: 1.2, flowScale: 0.1, timeSpeed: 0.06, spring: 0.55, damping: 0.945 },
  { speed: 4.0, flowStrength: 1.8, flowScale: 0.08, timeSpeed: 0.08, spring: 1.2, damping: 0.92 },
  { speed: 5.0, flowStrength: 1.5, flowScale: 0.1, timeSpeed: 0.08, spring: 0.6, damping: 0.94 },
  { speed: 4.0, flowStrength: 1.5, flowScale: 0.12, timeSpeed: 0.08, spring: 0.4, damping: 0.93 },
  { speed: 3.0, flowStrength: 1.1, flowScale: 0.09, timeSpeed: 0.08, spring: 1.4, damping: 0.94 },
  { speed: 3.5, flowStrength: 1.2, flowScale: 0.09, timeSpeed: 0.11, spring: 0.45, damping: 0.91 },
  { speed: 5.0, flowStrength: 1.3, flowScale: 0.08, timeSpeed: 0.05, spring: 1.0, damping: 0.95 },
  { speed: 4.0, flowStrength: 1.2, flowScale: 0.1, timeSpeed: 0.06, spring: 0.8, damping: 0.94 },
  { speed: 5.0, flowStrength: 1.6, flowScale: 0.17, timeSpeed: 0.13, spring: 0.35, damping: 0.9 },
  { speed: 4.5, flowStrength: 1.4, flowScale: 0.08, timeSpeed: 0.07, spring: 0.25, damping: 0.94 },
  { speed: 5.0, flowStrength: 1.3, flowScale: 0.09, timeSpeed: 0.1, spring: 0.45, damping: 0.94 },
  { speed: 3.5, flowStrength: 1.0, flowScale: 0.13, timeSpeed: 0.05, spring: 0.6, damping: 0.96 },
  // Experimental single-pass modes (15–29).
  { speed: 3.0, flowStrength: 2.0, flowScale: 0.06, timeSpeed: 0.08, spring: 0.6, damping: 0.90 }, // 15 Lorenz Drift
  { speed: 3.0, flowStrength: 1.8, flowScale: 0.06, timeSpeed: 0.07, spring: 0.6, damping: 0.90 }, // 16 Aizawa Orbit
  { speed: 2.5, flowStrength: 1.5, flowScale: 0.06, timeSpeed: 0.05, spring: 1.0, damping: 0.85 }, // 17 Cymatic Plate
  { speed: 2.8, flowStrength: 1.9, flowScale: 0.06, timeSpeed: 0.07, spring: 1.35, damping: 0.92 }, // 18 Kaleidoscope Fold
  { speed: 2.8, flowStrength: 1.6, flowScale: 0.06, timeSpeed: 0.08, spring: 1.0, damping: 0.90 }, // 19 Vortex Ring
  { speed: 2.5, flowStrength: 1.8, flowScale: 0.06, timeSpeed: 0.06, spring: 0.8, damping: 0.88 }, // 20 Interference Lattice
  { speed: 4.0, flowStrength: 2.4, flowScale: 0.09, timeSpeed: 0.10, spring: 0.8, damping: 0.94 }, // 21 Slipstream
  { speed: 2.5, flowStrength: 1.0, flowScale: 0.06, timeSpeed: 0.08, spring: 1.2, damping: 0.90 }, // 22 Phyllotaxis Sphere
  { speed: 2.8, flowStrength: 1.4, flowScale: 0.06, timeSpeed: 0.07, spring: 1.1, damping: 0.90 }, // 23 Möbius Band
  { speed: 2.5, flowStrength: 1.0, flowScale: 0.06, timeSpeed: 0.07, spring: 1.2, damping: 0.90 }, // 24 Harmonic Bloom
  { speed: 3.0, flowStrength: 1.6, flowScale: 0.06, timeSpeed: 0.10, spring: 0.7, damping: 0.92 }, // 25 Gravity Wells
  { speed: 3.3, flowStrength: 2.2, flowScale: 0.07, timeSpeed: 0.09, spring: 1.10, damping: 0.90 }, // 26 Spiral Staircase
  { speed: 2.6, flowStrength: 1.0, flowScale: 0.06, timeSpeed: 0.09, spring: 1.2, damping: 0.90 }, // 27 Tesseract
  { speed: 2.8, flowStrength: 1.8, flowScale: 0.06, timeSpeed: 0.07, spring: 0.8, damping: 0.91 }, // 28 Magnetosphere
  { speed: 3.0, flowStrength: 1.9, flowScale: 0.06, timeSpeed: 0.07, spring: 0.6, damping: 0.90 }, // 29 Thomas Tangle
  // Boids: flowStrength/flowScale/timeSpeed drive the shared "wind" curl field;
  // spring is the boundary-containment stiffness; damping is drag.
  { speed: 2.2, flowStrength: 2.2, flowScale: 0.07, timeSpeed: 0.06, spring: 1.3, damping: 0.95 },
  // Predator Scatter: livelier wind + faster predator orbit (timeSpeed).
  { speed: 2.4, flowStrength: 2.0, flowScale: 0.07, timeSpeed: 0.08, spring: 1.3, damping: 0.95 },
  // Liquid Droplets: gentle wind, more drag so beads condense and hold.
  { speed: 1.6, flowStrength: 0.8, flowScale: 0.09, timeSpeed: 0.05, spring: 1.3, damping: 0.93 },
  // Crystallize: NO wind (flowStrength 0) and heavy drag so it settles into a lattice.
  { speed: 1.5, flowStrength: 0.0, flowScale: 0.05, timeSpeed: 0.02, spring: 1.4, damping: 0.88 },
  // Slime Mold: moderate speed; flowScale/timeSpeed drive the wander curl; spring
  // is boundary containment; damping is drag. flowStrength unused (slimeWander instead).
  { speed: 1.6, flowStrength: 0.0, flowScale: 0.06, timeSpeed: 0.05, spring: 1.2, damping: 0.9 },
  // Spectrogram Waterfall: speed scales how fast particles ease onto the terrain;
  // timeSpeed drives the gentle idle ripple shown before the mic is enabled.
  // flow/spring/damping are unused by this mode but kept finite for the seam test.
  { speed: 4.0, flowStrength: 0.0, flowScale: 0.06, timeSpeed: 0.08, spring: 0.0, damping: 0.9 },
];
