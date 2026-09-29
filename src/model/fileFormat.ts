import { validateScene, type Scene, type SceneElement } from "../geometry/scene";
import { normaliseColour } from "./colour";
import type { ColourPoint, PaintDocument } from "./document";

export const FILE_FORMAT = "spiral-paint";
export const FILE_VERSION = 2;
export const FILE_EXTENSION = ".spiral";

export class SpiralFileError extends Error {}

export interface ParsedFile {
  scene: Scene;
  colours: ColourPoint[];
}

/**
 * Version 2: the scene plus one colour point per painted region (a point well
 * inside it), so files don't depend on how regions are numbered internally.
 */
export function serialise(doc: PaintDocument): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, scene: doc.scene, colours: doc.colourPoints() });
}

export function parse(text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SpiralFileError("This file isn't valid JSON, so it can't be a .spiral image.");
  }
  if (!isObject(data) || data.format !== FILE_FORMAT) throw new SpiralFileError("This isn't a Spiral Paint file.");
  if (typeof data.version !== "number") throw new SpiralFileError("This Spiral Paint file has no version.");
  if (data.version < FILE_VERSION)
    throw new SpiralFileError("This file is from an older version of Spiral Paint (single-centre images) and can't be opened.");
  if (data.version > FILE_VERSION) throw new SpiralFileError("This file was saved by a newer version of Spiral Paint.");
  if (!isObject(data.scene)) throw new SpiralFileError("The file has no scene.");
  const scene = readScene(data.scene);
  const errors = validateScene(scene);
  if (errors.length) throw new SpiralFileError(`The scene in this file is invalid: ${errors.join(" ")}`);
  if (data.colours !== undefined && !Array.isArray(data.colours)) throw new SpiralFileError("The colours in this file are malformed.");
  const colours: ColourPoint[] = [];
  for (const c of (data.colours as unknown[] | undefined) ?? []) {
    if (!isObject(c)) continue;
    const colour = normaliseColour(c.colour);
    if (colour && Number.isFinite(c.x) && Number.isFinite(c.y)) colours.push({ x: c.x as number, y: c.y as number, colour });
  }
  return { scene, colours };
}

/** Copies only known fields, so stray properties in a file never reach the app. */
function readScene(s: Record<string, unknown>): Scene {
  const elements = Array.isArray(s.elements) ? s.elements.filter(isObject).map(readElement) : [];
  return { width: Number(s.width), height: Number(s.height), elements };
}

function readElement(e: Record<string, unknown>): SceneElement {
  if (e.kind === "line")
    return { kind: "line", x1: Number(e.x1), y1: Number(e.y1), x2: Number(e.x2), y2: Number(e.y2), extent: e.extent as never };
  return {
    kind: e.kind as "spirals",
    x: Number(e.x),
    y: Number(e.y),
    count: Number(e.count),
    growth: Number(e.growth),
    rotation: Number(e.rotation ?? 0),
    direction: e.direction as never,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
