import type { Pt } from "../geometry/polygon";

export const MIN_ZOOM = 0.05;
/** Matches the sampling tolerance in geometry/sample.ts (chord error ≤ 0.64 screen px). */
export const MAX_ZOOM = 32;

/**
 * Maps canvas coordinates to the screen by rewriting the SVG viewBox:
 * screen = canvas · scale + offset (relative to the SVG element's box).
 */
export class Viewport {
  scale = 1;
  private tx = 0;
  private ty = 0;
  private readonly listeners = new Set<() => void>();
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly svg: SVGSVGElement,
    private canvasW: number,
    private canvasH: number,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.apply());
    this.resizeObserver.observe(svg);
  }

  setCanvasSize(w: number, h: number): void {
    this.canvasW = w;
    this.canvasH = h;
    this.fit();
  }

  fit(): void {
    const { width, height } = this.box();
    const s = Math.min(width / this.canvasW, height / this.canvasH) * 0.94;
    this.scale = clamp(s, MIN_ZOOM, MAX_ZOOM);
    this.tx = (width - this.canvasW * this.scale) / 2;
    this.ty = (height - this.canvasH * this.scale) / 2;
    this.apply();
  }

  /** Zooms by `factor`, keeping the canvas point under the given client position fixed. */
  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    const b = this.svg.getBoundingClientRect();
    const sx = clientX === undefined ? b.width / 2 : clientX - b.left;
    const sy = clientY === undefined ? b.height / 2 : clientY - b.top;
    const next = clamp(this.scale * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = (sx - this.tx) / this.scale;
    const cy = (sy - this.ty) / this.scale;
    this.scale = next;
    this.tx = sx - cx * next;
    this.ty = sy - cy * next;
    this.apply();
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.apply();
  }

  toCanvas(clientX: number, clientY: number): Pt {
    const b = this.svg.getBoundingClientRect();
    return [(clientX - b.left - this.tx) / this.scale, (clientY - b.top - this.ty) / this.scale];
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private box(): { width: number; height: number } {
    const b = this.svg.getBoundingClientRect();
    return { width: Math.max(1, b.width), height: Math.max(1, b.height) };
  }

  private apply(): void {
    const { width, height } = this.box();
    const s = this.scale;
    this.svg.setAttribute("viewBox", `${-this.tx / s} ${-this.ty / s} ${width / s} ${height / s}`);
    for (const l of this.listeners) l();
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
