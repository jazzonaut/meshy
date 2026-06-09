/**
 * Minimal FPS read-out in the top-left corner. No dependency — just a styled div
 * updated twice a second from the frame delta. Hidden until toggled on.
 */
export class StatsOverlay {
  private readonly el = document.createElement('div');
  private frames = 0;
  private acc = 0;
  private visible = false;

  constructor() {
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      padding: '4px 8px',
      font: '12px monospace',
      color: '#9fe',
      background: 'rgba(0,0,0,0.5)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '1000',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.textContent = '— fps';
    document.body.appendChild(this.el);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.el.style.display = visible ? 'block' : 'none';
  }

  /** Accumulate frame timing; refresh the read-out every ~0.5s. */
  update(delta: number) {
    if (!this.visible) return;
    this.frames += 1;
    this.acc += delta;
    if (this.acc >= 0.5) {
      this.el.textContent = `${Math.round(this.frames / this.acc)} fps`;
      this.frames = 0;
      this.acc = 0;
    }
  }
}
