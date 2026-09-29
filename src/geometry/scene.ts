export interface SpiralGroup {
  kind: "spirals";
  /** Centre in canvas px (may be off-canvas). */
  x: number;
  y: number;
  count: number;
  /** Growth rate b in r = e^(bθ). */
  growth: number;
  /** Rotation of the whole group in degrees. */
  rotation: number;
  direction: "alternate" | "cw" | "ccw";
}

export interface LineElement {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "infinite" extends through both points to the canvas edges; "segment" stops at them. */
  extent: "infinite" | "segment";
}

export type SceneElement = SpiralGroup | LineElement;

export interface Scene {
  width: number;
  height: number;
  elements: SceneElement[];
}

export const LIMITS = {
  size: { min: 100, max: 4096 },
  count: { min: 1, max: 24 },
  growth: { min: 0.02, max: 2 },
  elements: 32,
  maxRegions: 20000,
};

export const spiralGroup = (x: number, y: number, over: Partial<SpiralGroup> = {}): SpiralGroup => ({
  kind: "spirals",
  x,
  y,
  count: 8,
  growth: 0.25,
  rotation: 0,
  direction: "alternate",
  ...over,
});

export const line = (x1: number, y1: number, x2: number, y2: number, extent: LineElement["extent"] = "infinite"): LineElement => ({
  kind: "line",
  x1,
  y1,
  x2,
  y2,
  extent,
});

export const DEFAULT_SCENE: Scene = { width: 1200, height: 800, elements: [spiralGroup(600, 400)] };

/** Starting layouts for the scene editor, as a function of canvas size. */
export const PRESETS: { name: string; make: (w: number, h: number) => SceneElement[] }[] = [
  { name: "Single centre", make: (w, h) => [spiralGroup(w / 2, h / 2)] },
  {
    name: "2×2 square",
    make: (w, h) => {
      const d = Math.min(w, h) / 4;
      return [-1, 1].flatMap((sy) => [-1, 1].map((sx) => spiralGroup(w / 2 + sx * d, h / 2 + sy * d)));
    },
  },
  { name: "Row of 3", make: (w, h) => [-1, 0, 1].map((k) => spiralGroup(w / 2 + (k * w) / 3, h / 2)) },
  {
    name: "Centre with cross lines",
    make: (w, h) => [spiralGroup(w / 2, h / 2), line(0, h / 2, w, h / 2), line(w / 2, 0, w / 2, h)],
  },
  {
    name: "Two centres with a diagonal",
    make: (w, h) => [spiralGroup(w / 3, h / 2), spiralGroup((2 * w) / 3, h / 2, { rotation: 22.5 }), line(0, 0, w, h)],
  },
];

/** Human-readable problems; empty when the scene is valid. */
export function validateScene(s: Scene): string[] {
  const errors: string[] = [];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const inRange = (v: number, lo: number, hi: number) => num(v) && v >= lo && v <= hi;
  if (!inRange(s.width, LIMITS.size.min, LIMITS.size.max) || !inRange(s.height, LIMITS.size.min, LIMITS.size.max))
    errors.push(`Width and height must be between ${LIMITS.size.min} and ${LIMITS.size.max}.`);
  if (!Array.isArray(s.elements) || s.elements.length === 0) errors.push("Add at least one element.");
  else if (s.elements.length > LIMITS.elements) errors.push(`At most ${LIMITS.elements} elements.`);
  (Array.isArray(s.elements) ? s.elements : []).forEach((e, k) => {
    const label = `Element ${k + 1}`;
    if (e?.kind === "spirals") {
      if (!num(e.x) || !num(e.y) || !num(e.rotation)) errors.push(`${label}: position and rotation must be numbers.`);
      if (!Number.isInteger(e.count) || !inRange(e.count, LIMITS.count.min, LIMITS.count.max))
        errors.push(`${label}: number of spirals must be a whole number from ${LIMITS.count.min} to ${LIMITS.count.max}.`);
      if (!inRange(e.growth, LIMITS.growth.min, LIMITS.growth.max))
        errors.push(`${label}: growth rate must be between ${LIMITS.growth.min} and ${LIMITS.growth.max}.`);
      if (!["alternate", "cw", "ccw"].includes(e.direction)) errors.push(`${label}: unknown direction.`);
    } else if (e?.kind === "line") {
      if (![e.x1, e.y1, e.x2, e.y2].every(num)) errors.push(`${label}: line points must be numbers.`);
      else if (e.x1 === e.x2 && e.y1 === e.y2) errors.push(`${label}: a line needs two different points.`);
      if (e.extent !== "infinite" && e.extent !== "segment") errors.push(`${label}: unknown line type.`);
    } else errors.push(`${label}: unknown element type.`);
  });
  return errors;
}
