import type { Lattice } from "./lattice";
import type { Pt } from "./polygon";

/** Maximum distance (canvas px) between a sampled chord and the true spiral. */
export const SAMPLE_EPSILON = 0.02;

export interface SampledLine {
  /** u value of each sample, increasing. */
  us: number[];
  points: Pt[];
}

/**
 * Samples a lattice line (family "s": s = value, family "t": t = value) between
 * two u values, so that every chord stays within SAMPLE_EPSILON of the curve.
 *
 * A log spiral at radius r has curvature 1/(r·√(1+b²)); a chord spanning Δθ
 * has sagitta ≈ r·√(1+b²)·Δθ²/8. Keeping that ≤ ε at every r means stepping
 * uniformly in w = e^(u/2); the count follows from integrating du/Δu.
 *
 * Optional `startPoint`/`endPoint` replace the computed endpoints so shared
 * vertices are bit-identical everywhere they are used.
 */
export function sampleLine(
  lattice: Lattice,
  family: "s" | "t",
  value: number,
  uLo: number,
  uHi: number,
  startPoint?: Pt,
  endPoint?: Pt,
): SampledLine {
  const b = lattice.b;
  const c = Math.sqrt((8 * SAMPLE_EPSILON) / Math.sqrt(1 + b * b));
  const wLo = Math.exp(uLo / 2);
  const wHi = Math.exp(uHi / 2);
  const count = Math.max(1, Math.ceil((2 / (b * c)) * (wHi - wLo)));
  const us: number[] = [];
  const points: Pt[] = [];
  for (let k = 0; k <= count; k++) {
    const u = k === 0 ? uLo : k === count ? uHi : 2 * Math.log(wLo + ((wHi - wLo) * k) / count);
    us.push(u);
    points.push(family === "s" ? lattice.toXY(value, 2 * u - value) : lattice.toXY(2 * u - value, value));
  }
  if (startPoint) points[0] = startPoint;
  if (endPoint) points[count] = endPoint;
  return { us, points };
}

/** Polyline of each spiral from where lines start to just beyond the farthest canvas corner. */
export function spiralPolylines(lattice: Lattice): Pt[][] {
  const uHi = lattice.uMax + 0.05;
  return lattice.spiralLines.map(({ family, value }) =>
    sampleLine(lattice, family, value, lattice.lineStartU, uHi).points,
  );
}
