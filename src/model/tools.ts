import type { RegionSet } from "../geometry/regions";
import type { Pt } from "../geometry/polygon";

/**
 * Regions under the segment a→b, sampled every `step` canvas units, in order
 * and without repeats. Used for drag painting so fast drags don't skip regions.
 */
export function regionsAlongSegment(set: RegionSet, a: Pt, b: Pt, step: number): string[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / step));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let k = 0; k <= n; k++) {
    const r = set.locate(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      ids.push(r.id);
    }
  }
  return ids;
}

/**
 * Bucket fill: the start region plus every region reachable from it through
 * shared edges while staying on the start region's current colour.
 * Returns an empty list when the start region already has the target colour.
 */
export function bucketFill(
  set: RegionSet,
  colourOf: (id: string) => string,
  startId: string,
  colour: string,
): string[] {
  const target = colourOf(startId);
  if (target === colour) return [];
  const seen = new Set([startId]);
  const queue = [startId];
  for (let k = 0; k < queue.length; k++)
    for (const n of set.neighbours(queue[k]!))
      if (!seen.has(n) && colourOf(n) === target) {
        seen.add(n);
        queue.push(n);
      }
  return queue;
}
