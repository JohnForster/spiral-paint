import { validateConfig, type SpiralConfig } from "../geometry/config";
import { normaliseColour } from "./colour";
import type { PaintDocument } from "./document";

export const FILE_FORMAT = "spiral-paint";
export const FILE_VERSION = 1;
export const FILE_EXTENSION = ".spiral";

export class SpiralFileError extends Error {}

export interface ParsedFile {
  config: SpiralConfig;
  colours: [string, string][];
}

export function serialise(doc: PaintDocument): string {
  const colours = Object.fromEntries([...doc.paintedColours()].sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, config: doc.config, colours }, null, 2);
}

/** Parses and validates a .spiral file. Colour ids are not checked against geometry here. */
export function parse(text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SpiralFileError("This file isn't valid JSON, so it can't be a .spiral image.");
  }
  if (!isObject(data) || data.format !== FILE_FORMAT) throw new SpiralFileError("This isn't a Spiral Paint file.");
  if (typeof data.version !== "number" || data.version > FILE_VERSION)
    throw new SpiralFileError("This file was saved by a newer version of Spiral Paint.");
  if (!isObject(data.config)) throw new SpiralFileError("The file has no image settings.");
  const c = data.config;
  const config: SpiralConfig = {
    width: Number(c.width),
    height: Number(c.height),
    spiralCount: Number(c.spiralCount),
    startRadius: Number(c.startRadius),
    growthRate: Number(c.growthRate),
    centreModel: c.centreModel === "origin" ? "origin" : c.centreModel === undefined ? "startRadius" : (c.centreModel as never),
  };
  const errors = validateConfig(config);
  if (errors.length) throw new SpiralFileError(`The image settings in this file are invalid: ${errors.join(" ")}`);
  const colours: [string, string][] = [];
  if (data.colours !== undefined) {
    if (!isObject(data.colours)) throw new SpiralFileError("The colours in this file are malformed.");
    for (const [id, value] of Object.entries(data.colours)) {
      const colour = normaliseColour(value);
      if (colour) colours.push([id, colour]);
    }
  }
  return { config, colours };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
