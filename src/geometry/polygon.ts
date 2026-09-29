export type Pt = [number, number];
export type Ring = Pt[];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Signed shoelace area of an open ring (no repeated closing point). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let k = 0, n = ring.length; k < n; k++) {
    const [x1, y1] = ring[k]!;
    const [x2, y2] = ring[(k + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Area of a polygon given as rings with even-odd fill. */
export function polygonArea(rings: Ring[]): number {
  const [outer, ...holes] = rings;
  if (!outer) return 0;
  return Math.abs(signedArea(outer)) - holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
}

export function bboxOf(rings: Ring[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  return b;
}

export function bboxContains(b: BBox, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Even-odd point in polygon over all rings. */
export function pointInRings(rings: Ring[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings)
    for (let k = 0, n = ring.length, m = n - 1; k < n; m = k++) {
      const [xi, yi] = ring[k]!;
      const [xj, yj] = ring[m]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Squared distance from a point to the nearest edge of any ring. */
export function distanceSqToRings(rings: Ring[], x: number, y: number): number {
  let best = Infinity;
  for (const ring of rings)
    for (let k = 0, n = ring.length, m = n - 1; k < n; m = k++) {
      const [ax, ay] = ring[m]!;
      const [bx, by] = ring[k]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const f = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
      const ex = ax + f * dx - x;
      const ey = ay + f * dy - y;
      best = Math.min(best, ex * ex + ey * ey);
    }
  return best;
}
