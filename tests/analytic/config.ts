export type CentreModel = "startRadius" | "origin";

export interface SpiralConfig {
  width: number;
  height: number;
  spiralCount: number;
  /** Radius `a` in r = a·e^(bθ). In the origin model it only rotates the pattern. */
  startRadius: number;
  /** Growth rate `b` in r = a·e^(bθ). */
  growthRate: number;
  centreModel: CentreModel;
}

export const DEFAULT_CONFIG: SpiralConfig = {
  width: 1200,
  height: 800,
  spiralCount: 8,
  startRadius: 10,
  growthRate: 0.25,
  centreModel: "startRadius",
};

export const LIMITS = {
  size: { min: 100, max: 4096 },
  spiralCount: { min: 2, max: 12 },
  growthRate: { min: 0.02, max: 2 },
  maxRegions: 20000,
};

/** Returns a list of human-readable problems; empty when the config is valid. */
export function validateConfig(c: SpiralConfig): string[] {
  const errors: string[] = [];
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!inRange(c.width, LIMITS.size.min, LIMITS.size.max) || !inRange(c.height, LIMITS.size.min, LIMITS.size.max))
    errors.push(`Width and height must be between ${LIMITS.size.min} and ${LIMITS.size.max}.`);
  if (!Number.isInteger(c.spiralCount) || !inRange(c.spiralCount, LIMITS.spiralCount.min, LIMITS.spiralCount.max))
    errors.push(`Number of spirals must be a whole number from ${LIMITS.spiralCount.min} to ${LIMITS.spiralCount.max}.`);
  if (!inRange(c.growthRate, LIMITS.growthRate.min, LIMITS.growthRate.max))
    errors.push(`Growth rate must be between ${LIMITS.growthRate.min} and ${LIMITS.growthRate.max}.`);
  const maxA = Math.min(c.width, c.height) / 2;
  if (!(Number.isFinite(c.startRadius) && c.startRadius > 0 && c.startRadius < maxA))
    errors.push(`Start radius must be greater than 0 and less than ${Math.floor(maxA)}.`);
  if (c.centreModel !== "startRadius" && c.centreModel !== "origin") errors.push("Unknown centre model.");
  return errors;
}
