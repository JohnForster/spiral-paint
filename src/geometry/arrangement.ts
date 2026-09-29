import { orient2d } from "robust-predicates";
import { bboxOf, pointInRings, signedArea, type BBox, type Pt, type Ring } from "./polygon";

/**
 * Exact planar arrangement of polylines inside the canvas (PLAN.md §11).
 *
 * The model is the arrangement of the sampled polylines themselves. Whether two
 * segments cross is decided with exact orientation predicates, and the order of
 * edges around each node uses the parent segments' directions, so the topology
 * is exact even though crossing coordinates are floats.
 */

export interface Face {
  /** Outer ring first, then holes. */
  rings: Ring[];
  area: number;
  bbox: BBox;
}

export interface Arrangement {
  faces: Face[];
  /** Shared border length between neighbouring faces: adjacency[f].get(g). */
  adjacency: Map<number, number>[];
  stats: { segments: number; crossings: number; degenerate: number; nodes: number; edges: number };
}

/** Deterministic jitter (canvas px) that removes accidental exact degeneracies. */
const JITTER = 1e-7;

interface Piece {
  pts: Pt[];
  /** Perimeter coordinate where the piece starts/ends on the canvas border, if it does. */
  startBorder: number | null;
  endBorder: number | null;
}

interface Edge {
  from: number;
  to: number;
  pts: Pt[];
  /** Direction leaving `from` along the edge, and leaving `to` back along it. */
  dirFrom: Pt;
  dirTo: Pt;
  border: boolean;
}

export function arrange(polylines: Pt[][], width: number, height: number): Arrangement {
  const pieces = polylines.flatMap((pl, c) => clipToCanvas(jitter(pl, c), width, height));

  // ---- segments and crossings --------------------------------------------
  const segPiece: number[] = [];
  const segIndex: number[] = [];
  const segA: Pt[] = [];
  const segB: Pt[] = [];
  pieces.forEach((p, pi) => {
    for (let k = 1; k < p.pts.length; k++) {
      segPiece.push(pi);
      segIndex.push(k - 1);
      segA.push(p.pts[k - 1]!);
      segB.push(p.pts[k]!);
    }
  });
  const nSeg = segA.length;
  /** Crossings on each segment: parameter t along the segment and the node id. */
  const crossings: { t: number; node: number }[][] = Array.from({ length: nSeg }, () => []);
  const nodePos: Pt[] = [];
  let degenerate = 0;

  forEachCandidatePair(segA, segB, width, height, (i, j) => {
    if (segPiece[i] === segPiece[j] && Math.abs(segIndex[i]! - segIndex[j]!) <= 1) return;
    const [ax, ay] = segA[i]!;
    const [bx, by] = segB[i]!;
    const [cx, cy] = segA[j]!;
    const [dx, dy] = segB[j]!;
    const o1 = orient2d(ax, ay, bx, by, cx, cy);
    const o2 = orient2d(ax, ay, bx, by, dx, dy);
    if ((o1 > 0 && o2 > 0) || (o1 < 0 && o2 < 0)) return;
    const o3 = orient2d(cx, cy, dx, dy, ax, ay);
    const o4 = orient2d(cx, cy, dx, dy, bx, by);
    if ((o3 > 0 && o4 > 0) || (o3 < 0 && o4 < 0)) return;
    if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
      degenerate++; // touching or collinear: not a proper crossing
      return;
    }
    const ti = o3 / (o3 - o4);
    const tj = o1 / (o1 - o2);
    const node = nodePos.length;
    nodePos.push([ax + ti * (bx - ax), ay + ti * (by - ay)]);
    crossings[i]!.push({ t: ti, node });
    crossings[j]!.push({ t: tj, node });
  });
  const nCrossings = nodePos.length;

  // ---- edges along pieces ----------------------------------------------------
  const edges: Edge[] = [];
  const borderNodes: { param: number; node: number }[] = [];
  const addNode = (p: Pt) => (nodePos.push(p), nodePos.length - 1);
  let s = 0;
  for (const piece of pieces) {
    const start = addNode(piece.pts[0]!);
    if (piece.startBorder !== null) borderNodes.push({ param: piece.startBorder, node: start });
    let from = start;
    let pts: Pt[] = [piece.pts[0]!];
    let dirFrom: Pt | null = null;
    for (let k = 1; k < piece.pts.length; k++, s++) {
      const a = piece.pts[k - 1]!;
      const b = piece.pts[k]!;
      const dir: Pt = [b[0] - a[0], b[1] - a[1]];
      dirFrom ??= dir;
      const list = crossings[s]!.sort((p, q) => p.t - q.t);
      for (const { node } of list) {
        pts.push(nodePos[node]!);
        edges.push({ from, to: node, pts, dirFrom, dirTo: [-dir[0], -dir[1]], border: false });
        from = node;
        pts = [nodePos[node]!];
        dirFrom = dir;
      }
      if (k === piece.pts.length - 1) {
        const end = addNode(b);
        if (piece.endBorder !== null) borderNodes.push({ param: piece.endBorder, node: end });
        pts.push(b);
        edges.push({ from, to: end, pts, dirFrom, dirTo: [-dir[0], -dir[1]], border: false });
      } else pts.push(b);
    }
  }

  // ---- canvas border -------------------------------------------------------------
  const perimeter = 2 * (width + height);
  const corners: [number, Pt][] = [[0, [0, 0]], [width, [width, 0]], [width + height, [width, height]], [2 * width + height, [0, height]]];
  for (const [param, p] of corners) borderNodes.push({ param, node: addNode(p) });
  borderNodes.sort((a, b) => a.param - b.param);
  const sideDir = (param: number): Pt =>
    param < width ? [1, 0] : param < width + height ? [0, 1] : param < 2 * width + height ? [-1, 0] : [0, -1];
  for (let k = 0; k < borderNodes.length; k++) {
    const a = borderNodes[k]!;
    const b = borderNodes[(k + 1) % borderNodes.length]!;
    const mid = (a.param + (k + 1 === borderNodes.length ? b.param + perimeter : b.param)) / 2;
    const d = sideDir(mid % perimeter);
    edges.push({ from: a.node, to: b.node, pts: [nodePos[a.node]!, nodePos[b.node]!], dirFrom: d, dirTo: [-d[0], -d[1]], border: true });
  }

  // ---- half-edges, rotation system, faces ----------------------------------------
  // Half-edge 2e runs from → to, 2e+1 runs to → from.
  const nNodes = nodePos.length;
  const out: number[][] = Array.from({ length: nNodes }, () => []);
  const angle = new Float64Array(edges.length * 2);
  edges.forEach((e, k) => {
    out[e.from]!.push(2 * k);
    out[e.to]!.push(2 * k + 1);
    angle[2 * k] = Math.atan2(e.dirFrom[1], e.dirFrom[0]);
    angle[2 * k + 1] = Math.atan2(e.dirTo[1], e.dirTo[0]);
  });
  const posInOut = new Int32Array(edges.length * 2);
  for (const list of out) {
    list.sort((p, q) => angle[p]! - angle[q]!);
    list.forEach((h, i) => (posInOut[h] = i));
  }
  const origin = (h: number) => (h & 1 ? edges[h >> 1]!.to : edges[h >> 1]!.from);
  const next = (h: number) => {
    const twin = h ^ 1;
    const list = out[origin(twin)]!;
    return list[(posInOut[twin]! - 1 + list.length) % list.length]!;
  };
  const halfPts = (h: number) => (h & 1 ? [...edges[h >> 1]!.pts].reverse() : edges[h >> 1]!.pts);

  const cycleOf = new Int32Array(edges.length * 2).fill(-1);
  const cycles: { ring: Ring; area: number; halfEdges: number[] }[] = [];
  for (let h0 = 0; h0 < edges.length * 2; h0++) {
    if (cycleOf[h0] !== -1) continue;
    const ring: Pt[] = [];
    const hs: number[] = [];
    let h = h0;
    do {
      cycleOf[h] = cycles.length;
      hs.push(h);
      const p = halfPts(h);
      for (let k = 0; k < p.length - 1; k++) ring.push(p[k]!);
      h = next(h);
    } while (h !== h0);
    cycles.push({ ring, area: signedArea(ring), halfEdges: hs });
  }

  // Connected components, to find floating pieces that become holes.
  const parent = Array.from({ length: nNodes }, (_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k]!)));
  for (const e of edges) parent[find(e.from)] = find(e.to);
  const borderComponent = find(borderNodes[0]!.node);

  // Positive cycles are faces. Negative ones are either the outside of the canvas
  // or the outer boundary of a floating component (a hole in some face).
  const faceOfCycle = new Int32Array(cycles.length).fill(-1);
  const faces: Face[] = [];
  const faceComponent: number[] = [];
  cycles.forEach((c, k) => {
    if (c.area > 0) {
      faceOfCycle[k] = faces.length;
      faces.push({ rings: [c.ring], area: c.area, bbox: bboxOf([c.ring]) });
      faceComponent.push(find(origin(c.halfEdges[0]!)));
    }
  });
  cycles.forEach((c, k) => {
    if (c.area > 0) return;
    const comp = find(origin(c.halfEdges[0]!));
    if (comp === borderComponent) return; // the outside of the canvas
    const [x, y] = nodePos[origin(c.halfEdges[0]!)]!;
    let best = -1;
    faces.forEach((f, fi) => {
      if (faceComponent[fi] === comp || (best >= 0 && f.area >= faces[best]!.area)) return;
      if (x >= f.bbox.minX && x <= f.bbox.maxX && y >= f.bbox.minY && y <= f.bbox.maxY && pointInRings([f.rings[0]!], x, y)) best = fi;
    });
    if (best < 0) return; // cannot happen for a component inside the canvas
    faceOfCycle[k] = best;
    faces[best]!.rings.push(c.ring);
    faces[best]!.area += c.area;
  });

  const adjacency: Map<number, number>[] = faces.map(() => new Map());
  edges.forEach((e, k) => {
    if (e.border) return;
    const f = faceOfCycle[cycleOf[2 * k]!]!;
    const g = faceOfCycle[cycleOf[2 * k + 1]!]!;
    if (f < 0 || g < 0 || f === g) return;
    let len = 0;
    for (let i = 1; i < e.pts.length; i++) len += Math.hypot(e.pts[i]![0] - e.pts[i - 1]![0], e.pts[i]![1] - e.pts[i - 1]![1]);
    adjacency[f]!.set(g, (adjacency[f]!.get(g) ?? 0) + len);
    adjacency[g]!.set(f, (adjacency[g]!.get(f) ?? 0) + len);
  });

  return {
    faces,
    adjacency,
    stats: { segments: nSeg, crossings: nCrossings, degenerate, nodes: nNodes, edges: edges.length },
  };
}

/** Moves every vertex of polyline number `curve` by a deterministic ~1e-7 px (exported for tests). */
export function jitter(pl: Pt[], curve: number): Pt[] {
  return pl.map(([x, y], k) => [x + JITTER * hashUnit(curve, k, 0), y + JITTER * hashUnit(curve, k, 1)]);
}

/** Deterministic value in [−1, 1). */
function hashUnit(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 2 ** 31 - 1;
}

/**
 * Splits a polyline into the pieces inside [0,W]×[0,H]. Where a piece meets the
 * border its endpoint is snapped exactly onto the border and tagged with its
 * perimeter coordinate (clockwise on screen from the top-left corner).
 */
export function clipToCanvas(pl: Pt[], W: number, H: number): Piece[] {
  const pieces: Piece[] = [];
  let cur: Piece | null = null;
  const perim = (side: number, [x, y]: Pt) =>
    side === 0 ? x : side === 1 ? W + y : side === 2 ? W + H + (W - x) : 2 * W + H + (H - y);
  const snap = (side: number, [x, y]: Pt): Pt => {
    const cx = Math.min(W, Math.max(0, x));
    const cy = Math.min(H, Math.max(0, y));
    return side === 0 ? [cx, 0] : side === 1 ? [W, cy] : side === 2 ? [cx, H] : [0, cy];
  };
  for (let k = 1; k < pl.length; k++) {
    const a = pl[k - 1]!;
    const b = pl[k]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let f0 = 0;
    let f1 = 1;
    let side0 = -1;
    let side1 = -1;
    let inside = true;
    // [p, q, side]: x ≥ 0 (left, 3), x ≤ W (right, 1), y ≥ 0 (top, 0), y ≤ H (bottom, 2)
    for (const [p, q, side] of [[-dx, a[0], 3], [dx, W - a[0], 1], [-dy, a[1], 0], [dy, H - a[1], 2]] as const) {
      if (p === 0) {
        if (q < 0) inside = false;
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > f0) (f0 = r), (side0 = side);
      } else if (r < f1) (f1 = r), (side1 = side);
    }
    if (!inside || f0 >= f1) continue;
    const at = (f: number): Pt => [a[0] + f * dx, a[1] + f * dy];
    if (side0 >= 0) {
      const p = snap(side0, at(f0));
      if (cur) pieces.push(cur);
      cur = { pts: [p], startBorder: perim(side0, p), endBorder: null };
    } else if (!cur) cur = { pts: [a], startBorder: null, endBorder: null };
    if (side1 >= 0) {
      const p = snap(side1, at(f1));
      cur.pts.push(p);
      cur.endBorder = perim(side1, p);
      pieces.push(cur);
      cur = null;
    } else cur.pts.push(b);
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.pts.length >= 2);
}

/** Calls fn(i, j) once for every pair of segments whose bounding boxes overlap (uniform grid). */
function forEachCandidatePair(a: Pt[], b: Pt[], W: number, H: number, fn: (i: number, j: number) => void): void {
  const n = a.length;
  if (n < 2) return;
  const cell = Math.max(0.5, Math.sqrt((W * H) / n) * 1.5);
  const gw = Math.ceil(W / cell) + 1;
  const gh = Math.ceil(H / cell) + 1;
  const cells = new Map<number, number[]>();
  const lo = new Float64Array(n * 2);
  const hi = new Float64Array(n * 2);
  const cellOf = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(v / cell)));
  for (let i = 0; i < n; i++) {
    const [ax, ay] = a[i]!;
    const [bx, by] = b[i]!;
    lo[2 * i] = Math.min(ax, bx);
    lo[2 * i + 1] = Math.min(ay, by);
    hi[2 * i] = Math.max(ax, bx);
    hi[2 * i + 1] = Math.max(ay, by);
    for (let gx = cellOf(lo[2 * i]!, gw); gx <= cellOf(hi[2 * i]!, gw); gx++)
      for (let gy = cellOf(lo[2 * i + 1]!, gh); gy <= cellOf(hi[2 * i + 1]!, gh); gy++) {
        const key = gy * gw + gx;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(i);
      }
  }
  for (const [key, list] of cells) {
    const gx = key % gw;
    const gy = (key - gx) / gw;
    for (let p = 0; p < list.length; p++) {
      const i = list[p]!;
      for (let q = p + 1; q < list.length; q++) {
        const j = list[q]!;
        const minX = Math.max(lo[2 * i]!, lo[2 * j]!);
        const minY = Math.max(lo[2 * i + 1]!, lo[2 * j + 1]!);
        if (minX > Math.min(hi[2 * i]!, hi[2 * j]!) || minY > Math.min(hi[2 * i + 1]!, hi[2 * j + 1]!)) continue;
        // Test each pair only in the cell holding the corner of their bbox overlap.
        if (cellOf(minX, gw) !== gx || cellOf(minY, gh) !== gy) continue;
        fn(i, j);
      }
    }
  }
}
