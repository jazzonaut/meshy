# Meshy — WebGPU Particle Field

An interactive, GPU-driven particle field that renders dense, glowing point clouds
arranged into filament/nebula structures, with 35 motion modes ranging from
procedural force fields and geometric path studies to genuinely emergent GPU
simulations (boids, predator/prey, liquid surface tension, crystallisation, and a
Physarum slime mould). Particles can
also morph into sampled shapes and 3D text.

Everything runs on the GPU via Three.js TSL compute shaders — there is **no WebGL
fallback by design**.

## Requirements

- A **WebGPU-capable browser** (recent Chrome/Edge, or Firefox/Safari with WebGPU
  enabled). If `navigator.gpu` is missing the app shows an unsupported notice.
- Node 18+ and `pnpm`.

## Running

```bash
pnpm install
pnpm dev        # Vite dev server
pnpm build      # production build
pnpm preview    # serve the production build
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest (config/seam smoke tests)
```

## Architecture

The code is split into two domains: `field/` (the simulation) and `app/` (the
harness around it). Nothing is a "god" module — each file has one responsibility.

```
src/
  main.ts                  entry point — boots App
  field/                   the particle-system domain
    config.ts              modes, material styles, morph shapes, mode-index
                           constants, grid/trail sizes, FieldParams, presets
    uniforms.ts            createUniforms → FieldUniforms
    buffers.ts             GPU storage buffers (+ dispose)
    context.ts             FieldContext = { u, buffers, grid, trail, forces }
    material.ts            sprite material + blend/style controls
    ParticleField.ts       the class: owns buffers/uniforms/kernels/material and
                           dispatches the right pipeline each frame
    morphTargets.ts        CPU surface-sampling of shapes / "MESHY" text
    index.ts               public barrel — import field code from '../field'
    tsl/                   reusable TSL node helpers
      curlNoise.ts         divergence-free curl noise
      grid.ts              spatial-hash cell coords
      trail.ts             slime trail-field coords + sampling
      forces.ts            shared force terms: pointer / containment / wind / morph
    kernels/               one module per compute-pass group
      init.ts              structure + per-particle attributes
      color.ts             per-mode palette
      perParticle.ts       modes 0–14 (force fields)
      flock.ts             modes 15–18 (spatial-hash grid pipeline)
      slime.ts             mode 19 (Physarum: deposit → diffuse → sense/move)
  app/                     the harness
    createRenderer.ts      WebGPU renderer setup
    Stage.ts               scene / camera / axes
    Controls.ts            orbit + transform gizmo + keyboard
    PointerTracker.ts      cursor → world-space force well
    Postprocessing.ts      HDR bloom + afterImage trails
    Capture.ts             PNG screenshot + webm video
    StatsOverlay.ts        FPS read-out
    presetUrl.ts           share-link encode/decode
    App.ts                 orchestrator: owns the field, rebuild/preset/morph, loop;
                           exposes a Controller seam for the UI
    ui/                    the control layer (Vue + PrimeVue + Tailwind)
      types.ts             Controller — the engine↔UI seam (state + callbacks)
      vue/
        mountUi.ts         mounts the Vue app, registers PrimeVue (Aura preset)
        useController.ts   provide/inject of the Controller
        AppUi.vue          root: top-left control cluster + Studio drawer
        ModePicker.vue     persistent mode dropdown (Listbox + search)
        StudioDrawer.vue   PrimeVue Drawer + Accordion of tuning panels
        SliderRow.vue / ColorRow.vue / ToggleRow.vue   reusable control rows
```

The engine (`App`, `ParticleField`, everything in `field/`, the renderer/stage/
controls/postprocessing) is **framework-agnostic** — it never imports Vue. `App`
exposes a `Controller` (plain state objects + action callbacks); `main.ts` injects
Vue's `reactive` as the state wrapper so the UI tracks engine-side changes
(presets, demo-reel, shared URLs) automatically.

### How a frame runs

`ParticleField.update()` picks a pipeline from the active motion mode:

- **Force-field / path modes** — one `perParticle` compute pass (force field) + colour.
- **Flock modes (Boids / Predator / Droplets / Crystallize)** — the flock pipeline:
  clear → populate the spatial-hash grid → per-mode neighbour force → integrate, +
  colour. Positions are read-only until the integrate pass, so the 3×3×3 neighbour
  gather sees a consistent snapshot.
- **Slime Mold** — the slime pipeline: deposit trail → diffuse/decay the 3D field →
  sense the gradient & crawl, + colour.
- **Spectrogram Waterfall** — a single pass that eases every particle onto a 3D FFT
  terrain read from the microphone's amplitude-history ring buffer, + colour.

Postprocessing then renders the scene into an HDR target, applies trails and bloom,
and tone-maps the result.

## Modes

**Force fields (0–14):** Ambient Curl, Galactic Vortex, Convection, Dual Attractors,
Pulse Waves, Magnetic Field Lines, Tornado Column, Breathing Nebula, Implosion /
Supernova, Orbital Shells, Color Sorting, Electric Arcs, Black Hole Accretion,
Flocking Swarm, Ash Fall.

**Experimental path modes (15–29):** Prism Lattice, Rose Knot, Lissajous Ribbons,
Kaleidoscope Fold, Magnetic Trefoil, Signal Weave, Neon Raceway, Origami Bloom,
Helix Conveyor, Torus Flux, Polyhedral Orbit, Spiral Staircase, Faultline Mandala,
Time Loom, Storm Glyphs.

**Emergent GPU modes (30–34):**

- **Boids Flock** — real separation/alignment/cohesion via a spatial-hash grid.
- **Predator Scatter** — flocking while fleeing a predator that follows your cursor.
- **Liquid Droplets** — surface tension beads the field into merging droplets.
- **Crystallize** — even-spacing repulsion settles into a shimmering lattice.
- **Slime Mold** — Physarum agents self-organise into branching transport networks.

The GPU modes are smoothest at **≤250k particles** (switch the count in the View
folder if it stutters); the slime diffuse pass is fixed-cost regardless of count.

**Audio:**

- **Spectrogram Waterfall** — a microphone-driven 3D FFT terrain: frequency runs
  across one axis, time scrolls away from the camera, and amplitude is the height.
  Enable the mic (🎤 button) to drive it; until then it shows a gentle idle ripple.

Beyond the dedicated mode, the **🎤 Mic** toggle turns on an audio-reactive overlay
that modulates **any** preset/mode — sound pumps particle size, exposure, flow and
core glow. The mic captures ambient sound (your voice, music played out loud), needs
permission, and on mobile must be started with a tap. It does not tap the device's
own audio playback.

## Controls

The UI is split across two tiers so it isn't a wall of sliders:

- **Control cluster** (top-left) — the handful of things you reach for constantly:
  a **mode dropdown** (a searchable list that stays open until you collapse it —
  on mobile it closes after a pick), the cursor **action** dropdown, the preset bar,
  a **🎤 Mic** toggle (audio reactivity), a **Share** button, and the **Studio** toggle.
- **Studio drawer** — a PrimeVue `Drawer` (right on desktop, near-full-width on
  mobile) holding an `Accordion` of tuning panels: **View** (auto-rotate, axes,
  gizmo), **Motion** (force tuning), **GPU flock params**, **Pointer**
  (strength/radius), **Slime Mold**, **Audio / Mic** (reactivity, input gain,
  waterfall height), **Constellation lines** (glowing links between nearby
  particles, any mode), **A/B Blend** (slide live between two saved presets),
  **Morph** (shape + amount), **Look**
  (material, size, colours), **Bloom / Tone** (incl. trails), **Capture**
  (PNG/webm), **Demo reel** (auto demo-reel, FPS), **Structure** (regenerate).
  Panels are an accordion (one open at a time) and the GPU-flock / Slime tuning
  only appears when that mode is active — progressive disclosure so you only see
  the knobs that do something right now.

- **Mouse** — drag to orbit; move over the canvas to drive the pointer force well
  (and the predator in Predator Scatter).
- **Keyboard** — `w`/`e`/`r` set the gizmo to move/rotate/scale; `g` toggles it.
- **Share** — "copy share link" encodes the full look into the URL hash; opening
  that URL restores it.

## Caveats

- **WebGPU only.** No fallback; the app no-ops with a notice if WebGPU is absent.
- **Verification.** Logic and types are covered by typecheck + build + config smoke
  tests, but the GPU/visual behaviour can only be confirmed by running it in a
  browser — invalid generated WGSL fails *silently* (a pass becomes a no-op), so
  always sanity-check new kernels live.
- **Morph share limitation.** Share links carry the morph amount/strength but not
  the selected shape (the shape is a re-sampled target, not a stored value).
- **Performance.** Use the FPS overlay (Share & Demo → show FPS) to judge cost;
  prefer lower particle counts for the GPU modes and the slime mould.

## Stack

Three.js r184 `WebGPURenderer` + TSL compute shaders, TypeScript, Vite. UI is
Vue 3 + PrimeVue 4 (Aura preset) + Tailwind v4. Tested with Vitest.
