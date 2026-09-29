// The only module that knows which clipping library is in use (PLAN.md §3.4).
import { intersection } from "polyclip-ts";
import type { Ring } from "./polygon";

/**
 * Intersects a simple (possibly self-touching) ring with the rectangle
 * [0, width] × [0, height]. Returns one entry per connected piece; each piece
 * is a list of rings (outer first, then holes), without repeated closing points.
 */
export function clipToRect(ring: Ring, width: number, height: number): Ring[][] {
  const rect = [[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]];
  const subject = [[...ring, ring[0]!]];
  const result = intersection(subject as never, rect as never) as unknown as number[][][][];
  return result.map((polygon) =>
    polygon.map((r) => r.slice(0, -1).map(([x, y]) => [x!, y!] as [number, number])),
  );
}
