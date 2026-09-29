import type { Pt } from "./polygon";
import type { LineElement, Scene, SceneElement, SpiralGroup } from "./scene";

/** Maximum distance (canvas px) between a sampled chord and the true curve. */
export const SAMPLE_EPSILON = 0.02;
/** Spiral arms closer together than this (px) near a centre are cut off; the area inside becomes one region. */
export const CENTRE_CUTOFF_PX = 1.5;

/** Polylines for every element of a scene, each covering at least the whole canvas. */
export function scenePolylines(scene: Scene): Pt[][] {
  return scene.elements.flatMap((e) => elementPolylines(e, scene.width, scene.height));
}

export function elementPolylines(e: SceneElement, width: number, height: number): Pt[][] {
  return e.kind === "spirals" ? spiralPolylines(e, width, height) : [linePolyline(e, width, height)];
}

/** Direction (+1 clockwise on screen, −1 counter-clockwise) of each arm of a group. */
export function armDirections(g: SpiralGroup): number[] {
  return Array.from({ length: g.count }, (_, k) =>
    g.direction === "cw" ? 1 : g.direction === "ccw" ? -1 : k % 2 === 0 ? 1 : -1,
  );
}

/**
 * Radius inside which a group's arms are cut off. Two arms of the same
 * direction Δφ apart are r·b·Δφ/√(1+b²) px apart at radius r; the cutoff is
 * where the closest such pair is CENTRE_CUTOFF_PX apart. (With an odd number of
 * alternating arms the gaps within a direction are uneven, so use the smallest.)
 */
export function cutoffRadius(g: SpiralGroup): number {
  const dirs = armDirections(g);
  let gap = 2 * Math.PI;
  for (const d of [1, -1]) {
    const offsets = dirs.flatMap((dir, k) => (dir === d ? [(2 * Math.PI * k) / g.count] : []));
    for (let k = 1; k < offsets.length; k++) gap = Math.min(gap, offsets[k]! - offsets[k - 1]!);
    if (offsets.length > 1) gap = Math.min(gap, 2 * Math.PI - offsets[offsets.length - 1]! + offsets[0]!);
  }
  const b = g.growth;
  return (CENTRE_CUTOFF_PX * Math.sqrt(1 + b * b)) / (b * gap);
}

/**
 * Arms r = e^(bθ), φ = rotation + 2πk/n + d·θ, sampled from the cutoff radius
 * (or the canvas, if the centre is off-canvas) to beyond the farthest corner.
 * The chord error stays ≤ SAMPLE_EPSILON by stepping uniformly in w = e^(u/2), u = ln r.
 */
export function spiralPolylines(g: SpiralGroup, width: number, height: number): Pt[][] {
  const { x: cx, y: cy, growth: b } = g;
  const corners = [[0, 0], [width, 0], [0, height], [width, height]] as const;
  const rFar = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy))) + 1;
  const dx = Math.max(0, -cx, cx - width);
  const dy = Math.max(0, -cy, cy - height);
  const rNear = Math.hypot(dx, dy); // distance from centre to the canvas
  const rStart = Math.max(cutoffRadius(g), rNear - 1);
  const uLo = Math.log(rStart);
  const uHi = Math.log(rFar);
  const wLo = Math.exp(uLo / 2);
  const wHi = Math.exp(uHi / 2);
  const c = Math.sqrt((8 * SAMPLE_EPSILON) / Math.sqrt(1 + b * b));
  const count = Math.max(1, Math.ceil((2 / (b * c)) * (wHi - wLo)));
  const rot = (g.rotation * Math.PI) / 180;
  return armDirections(g).map((d, k) => {
    const offset = rot + (2 * Math.PI * k) / g.count;
    const pts: Pt[] = [];
    for (let i = 0; i <= count; i++) {
      const u = i === 0 ? uLo : i === count ? uHi : 2 * Math.log(wLo + ((wHi - wLo) * i) / count);
      const r = Math.exp(u);
      const phi = offset + (d * u) / b;
      pts.push([cx + r * Math.cos(phi), cy + r * Math.sin(phi)]);
    }
    return pts;
  });
}

export function linePolyline(l: LineElement, width: number, height: number): Pt[] {
  if (l.extent === "segment") return [[l.x1, l.y1], [l.x2, l.y2]];
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const len = Math.hypot(dx, dy);
  // Far enough past both points to cross the whole canvas wherever the points are.
  const reach = 2 * (width + height) + Math.hypot(l.x1 - width / 2, l.y1 - height / 2);
  return [
    [l.x1 - (dx / len) * reach, l.y1 - (dy / len) * reach],
    [l.x2 + (dx / len) * reach, l.y2 + (dy / len) * reach],
  ];
}
