import { distanceSqToRings, pointInRings, type Pt, type Ring } from "./polygon";

/**
 * A point well inside a polygon (outer ring + holes): the "pole of
 * inaccessibility", found by a best-first search over square cells
 * (Garcia-Castellanos & Lombardo; as in mapbox/polylabel).
 */
export function poleOfInaccessibility(rings: Ring[], precision = 0.05): Pt {
  const outer = rings[0]!;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const size = Math.min(maxX - minX, maxY - minY);
  const signedDist = (x: number, y: number) => (pointInRings(rings, x, y) ? 1 : -1) * Math.sqrt(distanceSqToRings(rings, x, y));
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedDist(x, y);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  if (size <= 0) return outer[0]!;
  let best = cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const queue: Cell[] = [];
  const h = size / 2;
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h));
  // Centroid of the outer ring is often a good first guess.
  const centroid = ringCentroid(outer);
  const c = cell(centroid[0], centroid[1], 0);
  if (c.d > best.d) best = c;
  while (queue.length) {
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.max > queue[k]!.max) k = i;
    const q = queue.splice(k, 1)[0]!;
    if (q.d > best.d) best = q;
    if (q.max - best.d <= precision) continue;
    const hh = q.h / 2;
    queue.push(cell(q.x - hh, q.y - hh, hh), cell(q.x + hh, q.y - hh, hh), cell(q.x - hh, q.y + hh, hh), cell(q.x + hh, q.y + hh, hh));
    if (queue.length > 5000) break; // safety net; best is already inside
  }
  return [best.x, best.y];
}

function ringCentroid(ring: Ring): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [x1, y1] = ring[j]!;
    const [x2, y2] = ring[i]!;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return a === 0 ? ring[0]! : [cx / (3 * a), cy / (3 * a)];
}
