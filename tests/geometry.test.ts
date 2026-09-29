import { describe, expect, test } from "bun:test";
import type { SpiralConfig } from "../src/geometry/config";
import { Lattice } from "../src/geometry/lattice";
import { CENTRE_ID, RegionSet } from "../src/geometry/regions";
import { bboxContains, distanceSqToRings, pointInRings } from "../src/geometry/polygon";
import { rasterOracle } from "./oracle";

const cfg = (c: Partial<SpiralConfig>): SpiralConfig => ({
  width: 200,
  height: 150,
  spiralCount: 6,
  startRadius: 8,
  growthRate: 0.4,
  centreModel: "startRadius",
  ...c,
});

// Small canvases so the raster oracle stays fast; covers n = 2…12, odd n,
// tiny/large start radius, small/large growth, wide/tall/square, both centre models.
const MATRIX: SpiralConfig[] = [
  cfg({ spiralCount: 2, startRadius: 5, growthRate: 0.3 }),
  cfg({ spiralCount: 3, startRadius: 5, growthRate: 0.3 }),
  cfg({ spiralCount: 4, startRadius: 60, growthRate: 0.15 }),
  cfg({ spiralCount: 5, width: 300, height: 100, startRadius: 10, growthRate: 1.2 }),
  cfg({ spiralCount: 6 }),
  cfg({ spiralCount: 7, width: 120, height: 260, startRadius: 3, growthRate: 0.35 }),
  cfg({ spiralCount: 8, startRadius: 3, growthRate: 0.5 }),
  cfg({ spiralCount: 11, startRadius: 12, growthRate: 0.6 }),
  cfg({ spiralCount: 12, width: 150, height: 150, startRadius: 20, growthRate: 0.8 }),
  cfg({ spiralCount: 2, growthRate: 2, startRadius: 2 }),
  // The origin model's centre blob is only a few px across, so these use a
  // smaller canvas and a finer raster (see supersampleFor).
  cfg({ spiralCount: 6, width: 120, height: 100, centreModel: "origin" }),
  cfg({ spiralCount: 3, width: 120, height: 100, centreModel: "origin", growthRate: 0.3 }),
];

const supersampleFor = (c: SpiralConfig) => (c.centreModel === "origin" ? 16 : 4);

const name = (c: SpiralConfig) =>
  `n=${c.spiralCount} ${c.width}x${c.height} a=${c.startRadius} b=${c.growthRate} ${c.centreModel}`;

const sets = new Map(MATRIX.map((c) => [c, new RegionSet(c)]));

describe.each(MATRIX)("geometry %#", (c) => {
  const set = sets.get(c)!;

  test(`${name(c)}: region areas partition the canvas`, () => {
    const total = set.regions.reduce((a, r) => a + r.area, 0);
    expect(Math.abs(total / (c.width * c.height) - 1)).toBeLessThan(1e-6);
  });

  test(`${name(c)}: raster oracle agrees`, () => {
    const ss = supersampleFor(c);
    const res = rasterOracle(set, ss, (ss * ss) / 4);
    expect(res.impure).toEqual([]);
    expect(res.pieceMismatches).toEqual([]);
    expect(res.missing).toEqual([]);
  });

  test(`${name(c)}: locate matches polygons away from edges`, () => {
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const x = rand() * c.width;
      const y = rand() * c.height;
      const r = set.locate(x, y);
      expect(r).not.toBeNull();
      if (distanceSqToRings(r!.rings, x, y) < 0.1 * 0.1) continue;
      checked++;
      expect(pointInRings(r!.rings, x, y)).toBe(true);
      const containing = set.regions.filter((q) => bboxContains(q.bbox, x, y) && pointInRings(q.rings, x, y));
      expect(containing.map((q) => q.id)).toEqual([r!.id]);
    }
    expect(checked).toBeGreaterThan(300);
  });

  test(`${name(c)}: centre region exists and contains the canvas centre`, () => {
    expect(set.locate(c.width / 2, c.height / 2)?.id).toBe(CENTRE_ID);
    expect(set.locate(c.width / 2 + 1e-9, c.height / 2)?.id).toBe(CENTRE_ID);
  });

  test(`${name(c)}: neighbouring cells share identical edge points`, () => {
    const L = set.lattice;
    const key = (p: [number, number]) => `${p[0]},${p[1]}`;
    for (const r of set.regions) {
      if (!r.cell) continue;
      const [i, j] = r.cell;
      // Right edge of (i, j) is the left edge of (i+1, j) — crosses the 2π seam when i = nCw − 1.
      const [ni, nj] = L.canon(i + 1, j);
      if (!L.isClosed(ni, nj)) continue;
      const mine = new Set(set.cellRing(i, j).map(key));
      for (const p of set.sEdge(ni, nj).points) expect(mine.has(key(p))).toBe(true);
    }
  });

  test(`${name(c)}: adjacency is symmetric and matches the lattice for unclipped cells`, () => {
    const L = set.lattice;
    const idOf = (i: number, j: number) => {
      if (!L.isClosed(i, j)) return CENTRE_ID;
      const [ci, cj] = L.canon(i, j);
      return set.byId.has(`${ci},${cj}:0`) && !set.byId.has(`${ci},${cj}:1`) ? `${ci},${cj}:0` : null;
    };
    const inside = (r: { bbox: { minX: number; minY: number; maxX: number; maxY: number } }) =>
      r.bbox.minX > 0 && r.bbox.minY > 0 && r.bbox.maxX < c.width && r.bbox.maxY < c.height;
    for (const r of set.regions) {
      for (const n of set.neighbours(r.id)) expect(set.neighbours(n).has(r.id)).toBe(true);
      if (!r.cell || !inside(r)) continue;
      const [i, j] = r.cell;
      const expected = new Set([idOf(i - 1, j), idOf(i + 1, j), idOf(i, j - 1), idOf(i, j + 1)]);
      if (expected.has(null)) continue; // a neighbour is split by the canvas edge
      expect(new Set(set.neighbours(r.id))).toEqual(expected as Set<string>);
    }
  });

  test(`${name(c)}: adjacency agrees with probing the raw spirals`, () => {
    // Independent sampling: walk each spiral with a fixed small θ step and look
    // at both sides of the curve, away from crossings and the canvas border.
    const L = set.lattice;
    const raw = new Set<string>();
    const delta = 1e-3;
    const TAU = Math.PI * 2;
    for (let k = 0; k < c.spiralCount; k++) {
      const o = (TAU * k) / c.spiralCount;
      const d = k % 2 === 0 ? 1 : -1;
      const thetaStart = (L.lineStartU - Math.log(c.startRadius)) / c.growthRate;
      const thetaEnd = (L.uMax + 0.05 - Math.log(c.startRadius)) / c.growthRate;
      for (let th = thetaStart + 1e-4; th < thetaEnd; th += 0.0007) {
        const rr = c.startRadius * Math.exp(c.growthRate * th);
        const phi = o + d * th;
        const x = L.cx + rr * Math.cos(phi);
        const y = L.cy + rr * Math.sin(phi);
        // tangent of the spiral, normal = rotate 90°
        const tx = c.growthRate * Math.cos(phi) - d * Math.sin(phi);
        const ty = c.growthRate * Math.sin(phi) + d * Math.cos(phi);
        const len = Math.hypot(tx, ty);
        const nx = -ty / len;
        const ny = tx / len;
        if (x < 0.01 || y < 0.01 || x > c.width - 0.01 || y > c.height - 0.01) continue;
        // skip points near a crossing with the other family
        const st = L.toST(x, y)!;
        const other = d === 1 ? st[1] : st[0];
        const idx = d === 1 ? L.tIndex(other) : L.sIndex(other);
        const lo = d === 1 ? L.t(idx) : L.s(idx);
        const hi = d === 1 ? L.t(idx + 1) : L.s(idx + 1);
        const gapPx = (Math.min(other - lo, hi - other) * rr) / Math.sqrt(1 + c.growthRate ** 2);
        if (gapPx < 20 * delta) continue;
        const a = set.locate(x + nx * delta, y + ny * delta);
        const b = set.locate(x - nx * delta, y - ny * delta);
        if (a && b && a.id !== b.id) raw.add([a.id, b.id].sort().join("|"));
      }
    }
    const built = new Set<string>();
    for (const r of set.regions) for (const n of set.neighbours(r.id)) built.add([r.id, n].sort().join("|"));
    const onlyRaw = [...raw].filter((p) => !built.has(p));
    expect(onlyRaw).toEqual([]);
    // Every built adjacency should also be seen by the raw walk unless the shared
    // edge is tiny; allow none missing for these configs.
    const onlyBuilt = [...built].filter((p) => !raw.has(p));
    expect(onlyBuilt).toEqual([]);
  });
});

describe("lattice", () => {
  test("canonical ids are invariant under a full turn", () => {
    const L = new Lattice(cfg({ spiralCount: 7 }));
    for (let i = -10; i < 10; i++)
      for (let j = -5; j < 5; j++)
        for (let k = -3; k <= 3; k++) expect(L.canon(i + k * L.nCw, j - k * L.nCcw)).toEqual(L.canon(i, j));
  });

  test("jStar is periodic and non-increasing", () => {
    for (const n of [2, 3, 5, 8, 12]) {
      const L = new Lattice(cfg({ spiralCount: n }));
      for (let i = -2 * L.nCw; i < 2 * L.nCw; i++) {
        expect(L.jStar(i + L.nCw)).toBe(L.jStar(i) - L.nCcw);
        expect(L.jStar(i + 1)).toBeLessThanOrEqual(L.jStar(i));
      }
    }
  });

  test("odd n gives unequal families", () => {
    const L = new Lattice(cfg({ spiralCount: 5 }));
    expect([L.nCw, L.nCcw]).toEqual([3, 2]);
  });

  test("spiral 0 turns clockwise on screen (y down)", () => {
    // θ = π/2 on spiral 0 (CW) is at φ = +π/2, i.e. below the centre in SVG coordinates.
    const c = cfg({});
    const L = new Lattice(c);
    const r = c.startRadius * Math.exp(c.growthRate * (Math.PI / 2));
    const set = new RegionSet(c);
    const line = set.spiralPolylines()[0]!;
    const nearest = Math.min(...line.map(([x, y]) => Math.hypot(x - L.cx, y - (L.cy + r))));
    const spacing = 2; // sample spacing is ~1–2 px at this radius
    expect(nearest).toBeLessThan(spacing);
    // and it is not on the mirrored (counter-clockwise) side
    const mirrored = Math.min(...line.map(([x, y]) => Math.hypot(x - L.cx, y - (L.cy - r))));
    expect(mirrored).toBeGreaterThan(r / 2);
  });

  test("locate agrees across the ±π seam", () => {
    const set = new RegionSet(cfg({ spiralCount: 5 }));
    const L = set.lattice;
    for (let r = 1; r < 90; r += 0.37) {
      const a = set.locate(L.cx - r, L.cy - 1e-9);
      const b = set.locate(L.cx - r, L.cy + 1e-9);
      expect(a?.id).toBe(b?.id);
    }
  });
});
