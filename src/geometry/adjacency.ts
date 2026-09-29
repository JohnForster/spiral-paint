import type { Pt } from "./polygon";
import type { Edge, RegionSet } from "./regions";

/** Offset (in s/t units) used to step off an edge to either side. */
const SIDE_STEP = 1e-9;
/** Probes closer than this to the canvas border are skipped. */
const BORDER_MARGIN = 1e-6;

/**
 * Region adjacency by probing both sides of every lattice edge (PLAN.md §3.8).
 * Stepping sideways in (s, t) space lands exactly on the neighbouring cells,
 * and restricting probes to the canvas interior means edges (or parts of
 * edges) outside the canvas never make regions adjacent.
 */
export function buildAdjacency(set: RegionSet, edges: Iterable<Edge>): Map<string, Set<string>> {
  const L = set.lattice;
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let sa = adjacency.get(a);
    if (!sa) adjacency.set(a, (sa = new Set()));
    sa.add(b);
    let sb = adjacency.get(b);
    if (!sb) adjacency.set(b, (sb = new Set()));
    sb.add(a);
  };
  const W = set.width;
  const H = set.height;
  const probe = (s: number, t: number) => {
    const [x, y] = L.toXY(s, t);
    if (x < BORDER_MARGIN || y < BORDER_MARGIN || x > W - BORDER_MARGIN || y > H - BORDER_MARGIN) return null;
    return set.locateST(s, t, x, y);
  };
  for (const e of edges) {
    for (let k = 1; k < e.us.length; k++) {
      // Probe the middle of the part of this chord that lies inside the canvas,
      // so thin slivers cut off by the canvas edge still get probed.
      const span = chordInsideRect(e.points[k - 1]!, e.points[k]!, W, H);
      if (!span) continue;
      const f = (span[0] + span[1]) / 2;
      const u = e.us[k - 1]! + (e.us[k]! - e.us[k - 1]!) * f;
      const other = 2 * u - e.value;
      const [a, b] =
        e.family === "s"
          ? [probe(e.value - SIDE_STEP, other), probe(e.value + SIDE_STEP, other)]
          : [probe(other, e.value - SIDE_STEP), probe(other, e.value + SIDE_STEP)];
      if (a && b && a.id !== b.id) link(a.id, b.id);
    }
  }
  return adjacency;
}

/** Liang–Barsky: the parameter range [f0, f1] ⊆ [0, 1] of segment a→b inside [0,W]×[0,H], or null. */
function chordInsideRect(a: Pt, b: Pt, W: number, H: number): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let f0 = 0;
  let f1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) f0 = Math.max(f0, r);
    else f1 = Math.min(f1, r);
    return f0 <= f1;
  };
  if (clip(-dx, a[0]) && clip(dx, W - a[0]) && clip(-dy, a[1]) && clip(dy, H - a[1])) return [f0, f1];
  return null;
}
