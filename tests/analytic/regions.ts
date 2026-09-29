import type { SpiralConfig } from "./config";
import { Lattice } from "./lattice";
import { sampleLine, spiralPolylines } from "./sample";
import { clipToRect } from "./clip";
import { buildAdjacency } from "./adjacency";
import {
  bboxContains,
  bboxOf,
  distanceSqToRings,
  pointInRings,
  polygonArea,
  type BBox,
  type Pt,
  type Ring,
} from "../../src/geometry/polygon";

export const CENTRE_ID = "c";

/** Pieces smaller than this (px²) are treated as clipping noise and dropped. */
const MIN_PIECE_AREA = 1e-6;

export interface Region {
  id: string;
  /** Outer ring first, then holes (even-odd). */
  rings: Ring[];
  area: number;
  bbox: BBox;
  /** Canonical lattice cell, or null for the centre region. */
  cell: [number, number] | null;
}

/**
 * One lattice edge: a piece of a single spiral between two crossings.
 * `family` "s" means the edge lies on the CW line s = s(line) between t(from)
 * and t(from + 1); "t" means it lies on t = t(line) between s(from) and s(from + 1).
 */
export interface Edge {
  family: "s" | "t";
  line: number;
  from: number;
  /** Line value (s for family "s", t for family "t"). */
  value: number;
  us: number[];
  points: Pt[];
}

export class RegionSet {
  readonly lattice: Lattice;
  readonly regions: Region[] = [];
  readonly byId = new Map<string, Region>();
  /** Canvas pieces of each closed cell, keyed "i,j" (canonical). */
  private readonly cellPieces = new Map<string, Region[]>();
  private readonly edges = new Map<string, Edge>();
  private adjacency: Map<string, Set<string>> | null = null;

  constructor(readonly config: SpiralConfig) {
    this.lattice = new Lattice(config);
    this.buildCentre();
    this.buildCells();
  }

  get width(): number {
    return this.config.width;
  }

  get height(): number {
    return this.config.height;
  }

  /** The region containing a canvas point, or null outside the canvas (PLAN.md §3.7). */
  locate(x: number, y: number): Region | null {
    if (!(x >= 0 && y >= 0 && x <= this.width && y <= this.height)) return null;
    const st = this.lattice.toST(x, y);
    if (!st) return this.byId.get(CENTRE_ID) ?? null;
    return this.locateST(st[0], st[1], x, y);
  }

  /** Like locate, for a point whose (s, t) is already known exactly. */
  locateST(s: number, t: number, x: number, y: number): Region | null {
    const L = this.lattice;
    const i = L.sIndex(s);
    const j = L.tIndex(t);
    if (!L.isClosed(i, j)) return this.byId.get(CENTRE_ID) ?? null;
    const [ci, cj] = L.canon(i, j);
    const pieces = this.cellPieces.get(`${ci},${cj}`);
    if (!pieces || pieces.length === 0) return null;
    if (pieces.length === 1) return pieces[0]!;
    // Several pieces: pick the one containing the point; a point in the ≤ε gap
    // between a true curve and its chord falls back to the nearest piece.
    let best = pieces[0]!;
    let bestDist = Infinity;
    for (const p of pieces) {
      if (bboxContains(p.bbox, x, y) && pointInRings(p.rings, x, y)) return p;
      const d = distanceSqToRings(p.rings, x, y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  /** Ids of regions sharing a boundary of positive length with `id` (PLAN.md §3.8). */
  neighbours(id: string): ReadonlySet<string> {
    this.adjacency ??= buildAdjacency(this, this.edges.values());
    return this.adjacency.get(id) ?? new Set();
  }

  spiralPolylines(): Pt[][] {
    return spiralPolylines(this.lattice);
  }

  get curves(): Pt[][] {
    return this.spiralPolylines();
  }

  /** Cached, canonically keyed edge on CW line s(i) between t(j) and t(j + 1). */
  sEdge(i: number, j: number): Edge {
    const L = this.lattice;
    const [ci, cj] = L.canon(i, j);
    return this.edge(`s${ci}:${cj}`, () => {
      const value = L.s(ci);
      const s = sampleLine(L, "s", value, (value + L.t(cj)) / 2, (value + L.t(cj + 1)) / 2, L.vertex(ci, cj), L.vertex(ci, cj + 1));
      return { family: "s", line: ci, from: cj, value, ...s };
    });
  }

  /** Cached, canonically keyed edge on CCW line t(j) between s(i) and s(i + 1). */
  tEdge(i: number, j: number): Edge {
    const L = this.lattice;
    const q = Math.floor(j / L.nCcw);
    const ci = i + q * L.nCw;
    const cj = j - q * L.nCcw;
    return this.edge(`t${cj}:${ci}`, () => {
      const value = L.t(cj);
      const s = sampleLine(L, "t", value, (L.s(ci) + value) / 2, (L.s(ci + 1) + value) / 2, L.vertex(ci, cj), L.vertex(ci + 1, cj));
      return { family: "t", line: cj, from: ci, value, ...s };
    });
  }

  private edge(key: string, make: () => Edge): Edge {
    let e = this.edges.get(key);
    if (!e) {
      e = make();
      this.edges.set(key, e);
    }
    return e;
  }

  /** Outline of closed cell (i, j): bottom → right → top → left vertex. */
  cellRing(i: number, j: number): Ring {
    const e1 = this.tEdge(i, j).points;
    const e2 = this.sEdge(i + 1, j).points;
    const e3 = [...this.tEdge(i, j + 1).points].reverse();
    const e4 = [...this.sEdge(i, j).points].reverse();
    return [...e1, ...e2.slice(1), ...e3.slice(1), ...e4.slice(1, -1)];
  }

  /** Outline of the centre region: the staircase of lower edges of the first closed cells (PLAN.md §3.3). */
  centreRing(): Ring {
    const L = this.lattice;
    const ring: Pt[] = [];
    const append = (pts: Pt[]) => {
      for (const p of ring.length ? pts.slice(1) : pts) ring.push(p);
    };
    for (let i = 0; i < L.nCw; i++) {
      const jPrev = L.jStar(i - 1);
      const jCur = L.jStar(i);
      for (let j = jPrev - 1; j >= jCur; j--) append([...this.sEdge(i, j).points].reverse());
      append(this.tEdge(i, jCur).points);
    }
    ring.pop(); // the walk ends where it started
    return ring;
  }

  private buildCentre(): void {
    const pieces = this.pieces(this.centreRing());
    const rings = pieces.flat();
    if (rings.length === 0) return;
    this.addRegion({ id: CENTRE_ID, rings, area: pieces.reduce((a, p) => a + polygonArea(p), 0), bbox: bboxOf(rings), cell: null });
  }

  private buildCells(): void {
    const L = this.lattice;
    for (let i = 0; i < L.nCw; i++) {
      for (let j = L.jStar(i); (L.s(i) + L.t(j)) / 2 < L.uMax; j++) {
        const pieces = this.pieces(this.cellRing(i, j))
          .map((rings) => ({ rings, area: polygonArea(rings), bbox: bboxOf(rings) }))
          .sort((a, b) => a.bbox.minX - b.bbox.minX || a.bbox.minY - b.bbox.minY);
        const regions = pieces.map((p, k) => ({ id: `${i},${j}:${k}`, cell: [i, j] as [number, number], ...p }));
        this.cellPieces.set(`${i},${j}`, regions);
        for (const r of regions) this.addRegion(r);
      }
    }
  }

  /** Canvas pieces of a ring: kept whole when inside, dropped when outside, clipped otherwise. */
  private pieces(ring: Ring): Ring[][] {
    const b = bboxOf([ring]);
    const { width: W, height: H } = this;
    if (b.maxX <= 0 || b.maxY <= 0 || b.minX >= W || b.minY >= H) return [];
    if (b.minX >= 0 && b.minY >= 0 && b.maxX <= W && b.maxY <= H) return [[ring]];
    return clipToRect(ring, W, H).filter((p) => polygonArea(p) > MIN_PIECE_AREA);
  }

  private addRegion(r: Region): void {
    this.regions.push(r);
    this.byId.set(r.id, r);
  }
}
