import { describe, expect, test } from "bun:test";
import { arrange, clipToCanvas, jitter } from "../src/geometry/arrangement";
import { distanceSqToRings, pointInRings } from "../src/geometry/polygon";
import { MIN_REGION_AREA, RegionSet } from "../src/geometry/regions";
import { line, PRESETS, spiralGroup, type Scene, type SceneElement } from "../src/geometry/scene";
import { RegionSet as AnalyticRegionSet } from "./analytic/regions";
import { rasterOracle } from "./oracle";

const W = 300;
const H = 200;
const g = (x: number, y: number, over: Parameters<typeof spiralGroup>[2] = {}) =>
  spiralGroup(x, y, { count: 6, growth: 0.35, ...over });
const scene = (...elements: SceneElement[]): Scene => ({ width: W, height: H, elements });

// Small canvases so the raster oracle stays fast. Includes the degenerate cases
// the jitter is there to absorb.
const MATRIX: [string, Scene][] = [
  ["single centre", scene(g(150, 100))],
  ["2×2 square", scene(g(100, 70), g(200, 70), g(100, 130), g(200, 130))],
  ["row of 3, mixed directions", scene(g(60, 100, { direction: "cw" }), g(150, 100), g(240, 100, { direction: "ccw", count: 5 }))],
  ["centre with lines and a segment", scene(g(150, 100), line(0, 100, 300, 100), line(20, 20, 280, 170, "segment"))],
  ["lines only, with a floating segment", scene(line(150, 0, 150, 200), line(0, 100, 300, 100), line(30, 30, 60, 40, "segment"))],
  ["centre off the canvas", scene(g(-80, 100), g(150, 100, { rotation: 30 }))],
  ["centre on a corner", scene(g(0, 0, { count: 8 }), g(300, 200, { count: 4 }))],
  ["duplicate groups", scene(g(150, 100), g(150, 100))],
  ["same centre, rotated", scene(g(150, 100), g(150, 100, { rotation: 15 }))],
  ["line along the canvas edge", scene(g(150, 100), line(0, 0, 300, 0), line(300, 0, 300, 200))],
  ["line through a centre", scene(g(150, 100), line(150, 100, 250, 150))],
  ["near-parallel lines", scene(line(0, 50, 300, 150), line(0, 50.4, 300, 150.4), g(100, 150))],
  ["single arm and all-clockwise group", scene(g(100, 100, { count: 1 }), g(200, 100, { direction: "cw" }))],
];

/**
 * Independent crossing count over the same jittered input: clip to the canvas,
 * then an x-sorted sweep over all segment pairs with plain floating-point
 * orientation tests (no grid, no robust predicates).
 */
function sweepCrossings(curves: [number, number][][], w: number, h: number): number {
  type Seg = { ax: number; ay: number; bx: number; by: number; piece: number; k: number; minX: number; maxX: number };
  const segs: Seg[] = [];
  curves.flatMap((c, k) => clipToCanvas(jitter(c, k), w, h)).forEach((p, piece) => {
    for (let k = 1; k < p.pts.length; k++) {
      const [ax, ay] = p.pts[k - 1]!;
      const [bx, by] = p.pts[k]!;
      segs.push({ ax, ay, bx, by, piece, k, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
    }
  });
  segs.sort((a, b) => a.minX - b.minX);
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    for (let j = i + 1; j < segs.length && segs[j]!.minX <= s.maxX; j++) {
      const t = segs[j]!;
      if (s.piece === t.piece && Math.abs(s.k - t.k) <= 1) continue;
      const o1 = orient(s.ax, s.ay, s.bx, s.by, t.ax, t.ay);
      const o2 = orient(s.ax, s.ay, s.bx, s.by, t.bx, t.by);
      const o3 = orient(t.ax, t.ay, t.bx, t.by, s.ax, s.ay);
      const o4 = orient(t.ax, t.ay, t.bx, t.by, s.bx, s.by);
      if (o1 * o2 < 0 && o3 * o4 < 0) count++;
    }
  }
  return count;
}

/** Narrowest point of a ring: closest approach of boundary parts more than 2 px apart along the ring. */
function neckWidth(ring: [number, number][]): number {
  const n = ring.length;
  const along = [0];
  for (let k = 1; k <= n; k++) along.push(along[k - 1]! + Math.hypot(ring[k % n]![0] - ring[k - 1]![0], ring[k % n]![1] - ring[k - 1]![1]));
  const total = along[n]!;
  let best = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const gap = Math.abs(along[i]! - along[j]!);
      if (Math.min(gap, total - gap) < 2 || Math.min(Math.abs(along[i]! - along[j + 1]!), total - Math.abs(along[i]! - along[j + 1]!)) < 2) continue;
      best = Math.min(best, Math.sqrt(distanceSqToRings([[ring[j]!, ring[(j + 1) % n]!]], ...ring[i]!)));
    }
  return best;
}

/** Distance from a region's interior point to its boundary. */
const inradius = (set: RegionSet, id: string) => {
  const [x, y] = set.interiorPoint(id);
  return Math.sqrt(Math.min(...set.byId.get(id)!.polygons.map((p) => distanceSqToRings(p, x, y))));
};

const built = new Map(MATRIX.map(([name, s]) => [name, new RegionSet(s)]));

describe.each(MATRIX)("arrangement: %s", (name, s) => {
  const set = built.get(name)!;

  test("faces and regions partition the canvas", () => {
    const faces = set.arrangement.faces.reduce((a, f) => a + f.area, 0);
    const regions = set.regions.reduce((a, r) => a + r.area, 0);
    expect(Math.abs(faces / (W * H) - 1)).toBeLessThan(1e-9);
    expect(Math.abs(regions / (W * H) - 1)).toBeLessThan(1e-9);
  });

  test("finds exactly the crossings a brute-force sweep finds", () => {
    expect(set.arrangement.stats.crossings).toBe(sweepCrossings(set.curves, W, H));
  });

  test("no degenerate crossings (the jitter absorbs coincidences)", () => {
    expect(set.arrangement.stats.degenerate).toBe(0);
  });

  // At 4× the raster's ~0.75 px lines swallow slivers where curves cross at
  // shallow angles and pinch narrow necks, so only impurity (a real engine bug)
  // and regions thick enough to see are checked here; the full check runs at
  // 16× on one scene below.
  test("raster oracle agrees", () => {
    const res = rasterOracle(set, { checkPieces: () => false, mustAppear: (id) => inradius(set, id) >= 0.75 });
    expect(res.impure).toEqual([]);
    expect(res.missing).toEqual([]);
  });

  test("locate agrees with the region polygons", () => {
    let seed = 99;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = set.locate(x, y)!;
      expect(r).not.toBeNull();
      if (r.polygons.some((p) => distanceSqToRings(p, x, y) < 0.01)) continue;
      checked++;
      expect(r.polygons.some((p) => pointInRings(p, x, y))).toBe(true);
    }
    expect(checked).toBeGreaterThan(300);
  });

  test("adjacency is symmetric and regions are not tiny", () => {
    for (const r of set.regions) {
      expect(set.neighbours(r.id).has(r.id)).toBe(false);
      for (const n of set.neighbours(r.id)) expect(set.neighbours(n).has(r.id)).toBe(true);
      if (set.regions.length > 1) expect(r.area).toBeGreaterThanOrEqual(MIN_REGION_AREA);
    }
  });

  test("interior points locate back to their region", () => {
    for (const r of set.regions) {
      const [x, y] = set.interiorPoint(r.id);
      expect(set.locate(x, y)?.id).toBe(r.id);
    }
  });
});

describe("arrangement specifics", () => {
  test("raster oracle agrees exactly at 16× on a multi-centre scene", () => {
    const set = new RegionSet({ width: 150, height: 100, elements: [g(50, 35), g(100, 35), g(50, 65), g(100, 65), line(0, 20, 150, 90)] });
    // Merged regions legitimately show as several pieces, and so does a region
    // with a neck thinner than the raster's lines (curves passing within ~0.1 px
    // without crossing; the sweep test below checks no crossing is missed).
    const pieceCheck = (id: string) => {
      const r = set.byId.get(id)!;
      return r.polygons.length === 1 && neckWidth(r.polygons[0]![0]!) >= 3 / 16;
    };
    const res = rasterOracle(set, { supersample: 16, checkPieces: pieceCheck, mustAppear: (id) => inradius(set, id) >= 0.1 });
    expect(res.impure).toEqual([]);
    expect(res.pieceMismatches).toEqual([]);
    expect(res.missing).toEqual([]);
  });

  test("an empty scene is one face", () => {
    const a = arrange([], W, H);
    expect(a.faces.length).toBe(1);
    expect(a.faces[0]!.area).toBeCloseTo(W * H, 6);
  });

  test("a floating segment makes a hole, not a new region", () => {
    const set = built.get("lines only, with a floating segment")!;
    expect(set.regions.length).toBe(4);
    const holed = set.arrangement.faces.filter((f) => f.rings.length > 1);
    expect(holed.length).toBe(1);
  });

  test("duplicate elements don't add visible regions", () => {
    expect(built.get("duplicate groups")!.regions.length).toBe(built.get("single centre")!.regions.length);
  });

  test("2×2 preset at full size builds quickly", () => {
    const s: Scene = { width: 1200, height: 800, elements: PRESETS[1]!.make(1200, 800) };
    const t = performance.now();
    new RegionSet(s);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

// Single-centre scenes must reproduce the Part 1 analytic engine (origin model, a = 1).
describe.each([
  [8, 0.25, 1200, 800],
  [7, 0.3, 600, 400],
  [2, 0.2, 500, 500],
  [12, 0.15, 800, 600],
])("matches the analytic engine: n=%d b=%d %dx%d", (n, b, w, h) => {
  const set = new RegionSet({ width: w, height: h, elements: [spiralGroup(w / 2, h / 2, { count: n, growth: b })] });
  const analytic = new AnalyticRegionSet({ width: w, height: h, spiralCount: n, startRadius: 1, growthRate: b, centreModel: "origin" });
  const toAnalytic = new Map(set.regions.map((r) => [r.id, analytic.locate(...set.interiorPoint(r.id))!.id]));

  test("one region per analytic region, with the same areas", () => {
    expect(new Set(toAnalytic.values()).size).toBe(set.regions.length);
    expect(set.regions.length).toBe(analytic.regions.length);
    for (const r of set.regions) expect(Math.abs(r.area - analytic.byId.get(toAnalytic.get(r.id)!)!.area)).toBeLessThan(1);
  });

  test("same adjacency", () => {
    for (const r of set.regions) {
      const mine = new Set([...set.neighbours(r.id)].map((id) => toAnalytic.get(id)));
      expect(mine).toEqual(new Set(analytic.neighbours(toAnalytic.get(r.id)!)));
    }
  });
});
