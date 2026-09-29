// Independent check of the region model: rasterise the spirals, flood-fill the
// pixels (4-connected) and see which analytic region each pixel lands in.
import type { Pt } from "../src/geometry/polygon";

/** Anything with regions that can be located: the analytic engine or the arrangement engine. */
export interface Locatable {
  width: number;
  height: number;
  curves: Pt[][];
  regions: { id: string; area: number }[];
  locate(x: number, y: number): { id: string } | null;
}

export interface OracleResult {
  /** Raster components whose pixels map to more than one region. */
  impure: { size: number; ids: string[] }[];
  /** Region ids whose count of raster components (≥ minComponent px) differs from 1. */
  pieceMismatches: { id: string; raster: number }[];
  /** Regions big enough to be seen by the raster but with no component. */
  missing: string[];
  components: number;
}

export interface OracleOptions {
  supersample?: number;
  /** Raster components smaller than this many sub-pixels are ignored when counting pieces. */
  minComponent?: number;
  /** Regions for which the raster must find exactly one component. */
  checkPieces?: (id: string) => boolean;
  /** Regions the raster must find at all (default: area > 4 raster pixels). */
  mustAppear?: (id: string, area: number) => boolean;
}

export function rasterOracle(set: Locatable, opts: OracleOptions = {}): OracleResult {
  const supersample = opts.supersample ?? 4;
  const minComponent = opts.minComponent ?? (supersample * supersample) / 4;
  const checkPieces = opts.checkPieces ?? (() => true);
  const mustAppear = opts.mustAppear ?? ((_: string, area: number) => area > (minComponent * 4) / (supersample * supersample));
  const W = set.width * supersample;
  const H = set.height * supersample;
  const wall = new Uint8Array(W * H);
  const mark = (x: number, y: number) => {
    const gx = Math.floor(x * supersample);
    const gy = Math.floor(y * supersample);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = gx + dx;
        const Y = gy + dy;
        if (X >= 0 && Y >= 0 && X < W && Y < H) wall[Y * W + X] = 1;
      }
  };
  for (const line of set.curves)
    for (let m = 1; m < line.length; m++) {
      const [x1, y1] = line[m - 1]!;
      const [x2, y2] = line[m]!;
      const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * supersample * 3) + 1;
      for (let q = 0; q <= steps; q++) mark(x1 + ((x2 - x1) * q) / steps, y1 + ((y2 - y1) * q) / steps);
    }

  const seen = new Uint8Array(W * H);
  const impure: OracleResult["impure"] = [];
  const componentsPerId = new Map<string, number>();
  let components = 0;
  const stack: number[] = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (wall[p0] || seen[p0]) continue;
    components++;
    const ids = new Map<string, number>();
    let size = 0;
    seen[p0] = 1;
    stack.push(p0);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % W;
      const y = (p / W) | 0;
      const id = set.locate((x + 0.5) / supersample, (y + 0.5) / supersample)?.id ?? "null";
      ids.set(id, (ids.get(id) ?? 0) + 1);
      if (x > 0 && !wall[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
      if (x < W - 1 && !wall[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
      if (y > 0 && !wall[p - W] && !seen[p - W]) (seen[p - W] = 1), stack.push(p - W);
      if (y < H - 1 && !wall[p + W] && !seen[p + W]) (seen[p + W] = 1), stack.push(p + W);
    }
    if (ids.size > 1) impure.push({ size, ids: [...ids.keys()] });
    if (size >= minComponent) {
      const top = [...ids.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      componentsPerId.set(top, (componentsPerId.get(top) ?? 0) + 1);
    }
  }
  const pieceMismatches = [...componentsPerId]
    .filter(([id, n]) => n !== 1 && checkPieces(id))
    .map(([id, raster]) => ({ id, raster }));
  const missing = set.regions.filter((r) => mustAppear(r.id, r.area) && !componentsPerId.has(r.id)).map((r) => r.id);
  return { impure, pieceMismatches, missing, components };
}
