import type { SpiralConfig } from "./config";
import { centreParams } from "./centreModel";
import type { Pt } from "./polygon";

/**
 * The spirals in log-polar coordinates (PLAN.md §3.1).
 *
 * With u = ln r and φ the unwrapped angle, clockwise spirals are the lines
 * s = u − bφ = const and counter-clockwise spirals are t = u + bφ = const.
 * Line positions repeat with period P = 2πb; `s(i)` / `t(j)` give the i-th /
 * j-th line in increasing order. Cell (i, j) is s_i < s < s_{i+1}, t_j < t < t_{j+1}.
 * Going once round the centre maps (i, j) to (i − nCw, j + nCcw).
 */
export class Lattice {
  readonly b: number;
  readonly period: number;
  readonly sBase: number[];
  readonly tBase: number[];
  readonly nCw: number;
  readonly nCcw: number;
  readonly cx: number;
  readonly cy: number;
  /** ln of the distance from the centre to the farthest canvas corner. */
  readonly uMax: number;
  readonly uInner: number;
  readonly lineStartU: number;
  /** Line value of each spiral k, in its own family (s for CW, t for CCW). */
  readonly spiralLines: { family: "s" | "t"; value: number }[];

  constructor(readonly config: SpiralConfig) {
    const { spiralCount: n, growthRate: b, width, height } = config;
    const uPhase = Math.log(config.startRadius);
    const TAU = Math.PI * 2;
    this.b = b;
    this.period = TAU * b;
    const s: number[] = [];
    const t: number[] = [];
    this.spiralLines = [];
    for (let k = 0; k < n; k++) {
      const offset = (TAU * k) / n;
      if (k % 2 === 0) {
        s.push(uPhase - b * offset);
        this.spiralLines.push({ family: "s", value: uPhase - b * offset });
      } else {
        t.push(uPhase + b * offset);
        this.spiralLines.push({ family: "t", value: uPhase + b * offset });
      }
    }
    const reduce = (x: number) => x - Math.floor(x / this.period) * this.period;
    this.sBase = s.map(reduce).sort((x, y) => x - y);
    this.tBase = t.map(reduce).sort((x, y) => x - y);
    this.nCw = this.sBase.length;
    this.nCcw = this.tBase.length;
    this.cx = width / 2;
    this.cy = height / 2;
    this.uMax = Math.log(Math.hypot(width / 2, height / 2));
    const { uInner, lineStartU } = centreParams(config, Math.min(this.minGap(this.sBase), this.minGap(this.tBase)));
    this.uInner = uInner;
    this.lineStartU = lineStartU;
  }

  private minGap(base: number[]): number {
    let gap = base[0]! + this.period - base[base.length - 1]!;
    for (let k = 1; k < base.length; k++) gap = Math.min(gap, base[k]! - base[k - 1]!);
    return gap;
  }

  s(i: number): number {
    const q = Math.floor(i / this.nCw);
    return this.sBase[i - q * this.nCw]! + q * this.period;
  }

  t(j: number): number {
    const q = Math.floor(j / this.nCcw);
    return this.tBase[j - q * this.nCcw]! + q * this.period;
  }

  /** Largest i with s(i) ≤ x. */
  sIndex(x: number): number {
    return this.indexIn(this.sBase, x);
  }

  /** Largest j with t(j) ≤ x. */
  tIndex(x: number): number {
    return this.indexIn(this.tBase, x);
  }

  private indexIn(base: number[], x: number): number {
    const q = Math.floor(x / this.period);
    const r = x - q * this.period;
    let lo = 0;
    let hi = base.length; // first index with base[idx] > r
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (base[mid]! <= r) lo = mid + 1;
      else hi = mid;
    }
    return q * base.length + lo - 1;
  }

  /** Canonical representative of cell (i, j): i in [0, nCw). */
  canon(i: number, j: number): [number, number] {
    const q = Math.floor(i / this.nCw);
    return [i - q * this.nCw, j + q * this.nCcw];
  }

  /** A cell is closed when its bottom vertex is at or above uInner (PLAN.md §3.2). */
  isClosed(i: number, j: number): boolean {
    return this.s(i) + this.t(j) >= 2 * this.uInner;
  }

  /** First closed j in column i. Non-increasing in i; jStar(i + nCw) = jStar(i) − nCcw. */
  jStar(i: number): number {
    const x = 2 * this.uInner - this.s(i);
    const j = this.tIndex(x);
    return this.t(j) < x ? j + 1 : j;
  }

  toXY(s: number, t: number): Pt {
    const u = (s + t) / 2;
    const phi = (t - s) / (2 * this.b);
    const r = Math.exp(u);
    return [this.cx + r * Math.cos(phi), this.cy + r * Math.sin(phi)];
  }

  /** (s, t) of a canvas point, using φ in (−π, π]. Returns null at the exact centre. */
  toST(x: number, y: number): [number, number] | null {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    if (r === 0) return null;
    const u = Math.log(r);
    const phi = Math.atan2(dy, dx);
    return [u - this.b * phi, u + this.b * phi];
  }

  /** Canvas position of lattice vertex (i, j), computed canonically so every cell sees identical numbers. */
  vertex(i: number, j: number): Pt {
    const [ci, cj] = this.canon(i, j);
    return this.toXY(this.s(ci), this.t(cj));
  }
}
