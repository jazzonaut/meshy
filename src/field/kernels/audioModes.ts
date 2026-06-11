import { Fn, If, instanceIndex, float, uint, floor, hash, mix, vec3 } from 'three/tsl';
import type { FieldContext } from '../context';
import { SPECTRO_W, RINGS_MODE, BLOOM_MODE, BARS_MODE } from '../config';

/**
 * The microphone "instrument" modes (Frequency Rings / Bass Bloom / Spectrum Bars).
 * Like the Spectrogram Waterfall they are positional: each frame they ease every
 * particle onto a target laid out from the live audio, rather than integrating a
 * velocity force. Two of them read the spectrum buffer (`buffers.audioField`, the
 * same ring the waterfall uses — the CPU pushes the newest FFT row each frame and
 * points `u.audioHead` at it); Bass Bloom reads the aggregate bands. `u.audioActive`
 * blends each target between an idle animation (mic off — so the mode never looks
 * broken) and the live signal.
 *
 * All cell-index maths stays in float and is cast to uint only to index the buffer,
 * matching the spectrogram kernel — large-magnitude uint/float mixing silently
 * invalidates WGSL on some mobile GPUs.
 */
export function createAudioModesKernel({ u, buffers }: FieldContext, count: number) {
  const W = SPECTRO_W;
  return Fn(() => {
    const pos = buffers.positions.element(instanceIndex);
    const home = buffers.homes.element(instanceIndex);
    const pr = buffers.props.element(instanceIndex);
    const phase = pr.y;
    const fi = float(instanceIndex);

    // Newest spectrum row for a given (float) frequency bin, normalised 0..1.
    const sampleSpec = (bin: any) => {
      const physRow = floor(u.audioHead);
      const idx = physRow.mul(float(W)).add(bin.mod(float(W)));
      return buffers.audioField.element(uint(idx));
    };

    const span = u.radius.mul(1.4);
    // Ease factor — clamped so it never overshoots at high framerates; u.delta folds
    // in the speed multiplier, so the speed slider scales how snappily it tracks.
    const k = u.delta.mul(6.0).min(1.0);

    // 35 — Frequency Rings: a radial spectrum analyser. Each particle belongs to a
    // frequency ring (bass at the centre, treble at the rim); the ring lifts in Y
    // with that band's amplitude, so the whole disc undulates like a polar EQ.
    If(u.motion.equal(RINGS_MODE), () => {
      const bin = fi.mod(float(W));
      const live = sampleSpec(bin);
      const idle = bin.mul(0.25).add(u.time.mul(u.timeSpeed.mul(5.0))).sin().mul(0.2).add(0.2);
      const amp = mix(idle, live, u.audioActive);
      const ringR = bin.div(float(W - 1)).mul(span.mul(0.5)).add(span.mul(0.06));
      // Spread the many particles sharing a ring around its circumference, drifting.
      const theta = hash(fi.mul(1.7).add(3.1)).mul(6.2831853).add(u.time.mul(u.timeSpeed.mul(2.0)));
      const r = ringR.add(amp.mul(u.radius.mul(0.08)));
      const y = amp.mul(u.spectroHeight.mul(u.radius)).sub(u.radius.mul(0.2));
      const target = vec3(theta.cos().mul(r), y, theta.sin().mul(r));
      pos.assign(mix(pos, target, k));
    });

    // 36 — Bass Bloom: a breathing sphere. Bass swells the radius (the kick), mids
    // fatten the equator, treble ripples the surface; a slow spin keeps it alive.
    If(u.motion.equal(BLOOM_MODE), () => {
      const dir = home.div(home.length().add(0.001)); // stable per-particle direction
      const idleBreath = u.time.mul(u.timeSpeed.mul(3.0)).sin().mul(0.5).add(0.5).mul(0.15);
      const bass = mix(idleBreath, u.audioBass.mul(1.6), u.audioActive);
      const lat = dir.y; // −1..1
      const bulge = float(1).add(u.audioMid.mul(u.audioActive).mul(float(1).sub(lat.mul(lat))).mul(0.7));
      const shimmer = phase
        .add(u.time.mul(u.timeSpeed.mul(8.0)))
        .sin()
        .mul(u.audioTreble.mul(u.audioActive))
        .mul(u.radius.mul(0.16));
      const r = u.radius.mul(0.45).mul(float(1).add(bass.mul(0.9))).mul(bulge).add(shimmer);
      const ang = u.time.mul(u.timeSpeed.mul(1.5)); // steady spin (no live factor → no jumps)
      const rx = dir.x.mul(ang.cos()).sub(dir.z.mul(ang.sin()));
      const rz = dir.x.mul(ang.sin()).add(dir.z.mul(ang.cos()));
      const target = vec3(rx, dir.y, rz).mul(r);
      pos.assign(mix(pos, target, k));
    });

    // 37 — Spectrum Bars: a linear equaliser wall. Frequency runs across X; each
    // particle sits at a fixed fraction up its column, scaled by that band's
    // amplitude, so the bars grow and collapse with the music.
    If(u.motion.equal(BARS_MODE), () => {
      const bin = fi.mod(float(W));
      const live = sampleSpec(bin);
      const idle = bin.mul(0.2).add(u.time.mul(u.timeSpeed.mul(5.0))).sin().mul(0.18).add(0.18);
      const amp = mix(idle, live, u.audioActive);
      const x = bin.div(float(W - 1)).sub(0.5).mul(span);
      const frac = hash(fi.mul(0.37).add(2.0)); // this particle's slot up the bar
      const y = frac.mul(amp).mul(u.spectroHeight.mul(u.radius)).sub(u.radius.mul(0.4));
      const z = hash(fi.mul(0.91).add(7.3)).sub(0.5).mul(span.div(float(W)).mul(6.0));
      const xj = hash(fi.mul(0.53).add(4.7)).sub(0.5).mul(span.div(float(W)));
      const target = vec3(x.add(xj), y, z);
      pos.assign(mix(pos, target, k));
    });
  })().compute(count);
}
