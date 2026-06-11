import { SPECTRO_W } from '../field';

export interface AudioBands {
  bass: number; // ~0–250 Hz energy, normalised 0..1
  mid: number; // ~250 Hz–4 kHz
  treble: number; // ~4 kHz+
  level: number; // overall loudness
}

/**
 * Microphone audio source for the visualiser. Wraps getUserMedia + a Web Audio
 * AnalyserNode and exposes, per frame, a downsampled `spectrum` (SPECTRO_W bins,
 * normalised 0..1 — fed to the Spectrogram Waterfall mode) and aggregate `bands`
 * (bass/mid/treble/level — used for the global audio-reactive modulation that works
 * on any preset).
 *
 * Enabling is an explicit, gesture-driven action: it prompts for mic permission and
 * resumes the AudioContext (required on iOS Safari, which starts contexts
 * suspended). HTTPS is required for getUserMedia — satisfied by the GitHub Pages
 * deploy. The mic hears ambient sound (voice, music played out loud), not the
 * device's own audio playback.
 */
export class AudioInput {
  enabled = false;
  readonly spectrum: Float32Array;
  bands: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0 };

  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private stream?: MediaStream;
  private freq?: Uint8Array<ArrayBuffer>;
  private gain = 1;

  constructor(private readonly bins = SPECTRO_W) {
    this.spectrum = new Float32Array(this.bins);
  }

  /** Multiplier applied to the mic signal (UI "input gain"). */
  setGain(g: number) {
    this.gain = g;
  }

  /** Request the mic and start analysing. Returns false if denied/unavailable. */
  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Disable processing so the raw spectrum is faithful to what's heard.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      await this.ctx.resume(); // iOS: contexts start suspended until a gesture resumes them
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024; // 512 frequency bins
      this.analyser.smoothingTimeConstant = 0.75; // temporal smoothing on the FFT
      source.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.enabled = true;
      return true;
    } catch {
      this.disable();
      return false;
    }
  }

  /** Pull the latest FFT frame into `spectrum` + `bands`. Call once per frame. */
  update() {
    if (!this.enabled || !this.analyser || !this.freq) return;
    this.analyser.getByteFrequencyData(this.freq);
    const freq = this.freq;
    const nBins = freq.length;
    const W = this.spectrum.length;

    // Downsample the FFT bins to the SPECTRO_W spectrum columns (block average).
    for (let x = 0; x < W; x++) {
      const start = Math.floor((x * nBins) / W);
      const end = Math.max(start + 1, Math.floor(((x + 1) * nBins) / W));
      let sum = 0;
      for (let k = start; k < end; k++) sum += freq[k];
      this.spectrum[x] = Math.min(1, (sum / (end - start) / 255) * this.gain);
    }

    // Aggregate bands over fractional spans of the spectrum.
    const band = (lo: number, hi: number) => {
      const a = Math.floor(lo * nBins);
      const b = Math.max(a + 1, Math.floor(hi * nBins));
      let sum = 0;
      for (let k = a; k < b; k++) sum += freq[k];
      return Math.min(1, (sum / (b - a) / 255) * this.gain);
    };
    let total = 0;
    for (let k = 0; k < nBins; k++) total += freq[k];
    this.bands = {
      bass: band(0, 0.08),
      mid: band(0.08, 0.35),
      treble: band(0.35, 1),
      level: Math.min(1, (total / nBins / 255) * this.gain),
    };
  }

  /** Stop the mic and release everything. */
  disable() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = undefined;
    this.ctx = undefined;
    this.analyser = undefined;
    this.freq = undefined;
    this.enabled = false;
    this.spectrum.fill(0);
    this.bands = { bass: 0, mid: 0, treble: 0, level: 0 };
  }
}
