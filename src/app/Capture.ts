/** Timestamped, filesystem-safe filename suffix. */
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Screenshot (PNG) and video (webm) capture of the renderer canvas. Screenshots
 * are grabbed in the render loop right after a frame is drawn so the buffer is
 * valid; video uses MediaRecorder over the canvas capture stream.
 */
export class Capture {
  private screenshotRequested = false;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Queue a screenshot; the actual grab happens in {@link afterRender}. */
  requestScreenshot() {
    this.screenshotRequested = true;
  }

  toggleRecording(on: boolean) {
    if (on && !this.recorder) {
      const stream = this.canvas.captureStream(60);
      this.recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      this.chunks = [];
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.onstop = () =>
        downloadBlob(new Blob(this.chunks, { type: 'video/webm' }), `meshy-${stamp()}.webm`);
      this.recorder.start();
    } else if (!on && this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
  }

  /** Call once per frame, after the frame has been rendered to the canvas. */
  afterRender() {
    if (!this.screenshotRequested) return;
    this.screenshotRequested = false;
    this.canvas.toBlob((b) => {
      if (b) downloadBlob(b, `meshy-${stamp()}.png`);
    }, 'image/png');
  }
}
