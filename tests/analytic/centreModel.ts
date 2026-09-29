import type { SpiralConfig } from "./config";

/**
 * How the centre of the image is treated. Both models reduce to one number,
 * `uInner`: cells whose bottom vertex lies below it are merged into the single
 * centre region. `lineStartU` is where spiral lines start being drawn.
 * See PLAN.md §3.5.
 */
export interface CentreParams {
  uInner: number;
  lineStartU: number;
}

/** Size (canvas px) below which cells are merged into the centre in the origin model. */
export const ORIGIN_CUTOFF_PX = 1.5;

/**
 * @param minGap smallest spacing between neighbouring lines of either family, in s/t units.
 */
export function centreParams(config: SpiralConfig, minGap: number): CentreParams {
  const uPhase = Math.log(config.startRadius);
  switch (config.centreModel) {
    case "startRadius":
      return { uInner: uPhase, lineStartU: uPhase };
    case "origin": {
      // Lines a distance Δ apart in s (or t) are Δ/√(1+b²)·r apart on screen at radius r.
      const b = config.growthRate;
      const rCut = (ORIGIN_CUTOFF_PX * Math.sqrt(1 + b * b)) / minGap;
      const uInner = Math.log(rCut);
      return { uInner, lineStartU: uInner };
    }
  }
}
