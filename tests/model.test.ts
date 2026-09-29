import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type SpiralConfig } from "../src/geometry/config";
import { CENTRE_ID } from "../src/geometry/regions";
import { normaliseColour } from "../src/model/colour";
import { PaintDocument } from "../src/model/document";
import { History } from "../src/model/history";
import { bucketFill, regionsAlongSegment } from "../src/model/tools";
import { parse, serialise, SpiralFileError } from "../src/model/fileFormat";

const config: SpiralConfig = { ...DEFAULT_CONFIG, width: 400, height: 300, spiralCount: 6, startRadius: 6, growthRate: 0.3 };
const RED = "#ff0000";
const BLUE = "#0000ff";

describe("colour", () => {
  test("normalises", () => {
    expect(normaliseColour("#ABC")).toBe("#aabbcc");
    expect(normaliseColour("#A1b2C3")).toBe("#a1b2c3");
    expect(normaliseColour("red")).toBeNull();
    expect(normaliseColour(12)).toBeNull();
  });
});

describe("history", () => {
  test("apply, undo, redo", () => {
    const doc = new PaintDocument(config);
    const h = new History(doc);
    h.apply(new Map([[CENTRE_ID, RED]]));
    expect(doc.colourOf(CENTRE_ID)).toBe(RED);
    h.undo();
    expect(doc.colourOf(CENTRE_ID)).toBe("#ffffff");
    expect(doc.paintedColours().size).toBe(0);
    h.redo();
    expect(doc.colourOf(CENTRE_ID)).toBe(RED);
  });

  test("a stroke is one undo step and a new step clears redo", () => {
    const doc = new PaintDocument(config);
    const h = new History(doc);
    const [a, b] = doc.regions.regions.slice(1, 3).map((r) => r.id) as [string, string];
    h.beginStroke();
    h.strokePaint(new Map([[a, RED]]));
    h.strokePaint(new Map([[b, RED]]));
    h.strokePaint(new Map([[a, BLUE]]));
    h.endStroke();
    expect(doc.colourOf(a)).toBe(BLUE);
    h.undo();
    expect(doc.colourOf(a)).toBe("#ffffff");
    expect(doc.colourOf(b)).toBe("#ffffff");
    expect(h.canUndo).toBe(false);
    h.redo();
    expect([doc.colourOf(a), doc.colourOf(b)]).toEqual([BLUE, RED]);
    h.undo();
    h.apply(new Map([[a, RED]]));
    expect(h.canRedo).toBe(false);
  });

  test("no-op changes don't create steps", () => {
    const doc = new PaintDocument(config);
    const h = new History(doc);
    h.apply(new Map([[CENTRE_ID, "#ffffff"]]));
    h.beginStroke();
    h.strokePaint(new Map([[CENTRE_ID, RED]]));
    h.strokePaint(new Map([[CENTRE_ID, "#ffffff"]]));
    h.endStroke();
    expect(h.canUndo).toBe(false);
  });
});

describe("tools", () => {
  const doc = new PaintDocument(config);

  test("bucket fill spreads over same-coloured neighbours only", () => {
    const d = new PaintDocument(config);
    const start = d.regions.regions.find((r) => r.cell && d.regions.neighbours(r.id).size === 4)!;
    const all = bucketFill(d.regions, (id) => d.colourOf(id), start.id, RED);
    expect(all.length).toBe(d.regions.regions.length); // everything white and connected
    // wall off the start region with blue neighbours
    const walls = new Map([...d.regions.neighbours(start.id)].map((n) => [n, BLUE] as [string, string]));
    d.setColours(walls);
    expect(bucketFill(d.regions, (id) => d.colourOf(id), start.id, RED)).toEqual([start.id]);
    expect(bucketFill(d.regions, (id) => d.colourOf(id), start.id, "#ffffff")).toEqual([]);
  });

  test("bucket fill does not leak through corners", () => {
    // A cell's diagonal neighbour (i+1, j+1) only touches it at a vertex.
    const set = doc.regions;
    for (const r of set.regions) {
      if (!r.cell) continue;
      const [i, j] = r.cell;
      const [di, dj] = set.lattice.canon(i + 1, j + 1);
      expect(set.neighbours(r.id).has(`${di},${dj}:0`)).toBe(false);
    }
  });

  test("segment sampling finds every region crossed, in order", () => {
    const set = doc.regions;
    const ids = regionsAlongSegment(set, [0, 150], [400, 150], 0.25);
    expect(ids).toContain(CENTRE_ID);
    expect(new Set(ids).size).toBe(ids.length);
    // consecutive regions along a horizontal line must be neighbours
    for (let k = 1; k < ids.length; k++) expect(set.neighbours(ids[k - 1]!).has(ids[k]!)).toBe(true);
  });
});

describe("file format", () => {
  test("round trip", () => {
    const doc = new PaintDocument(config);
    const h = new History(doc);
    const id = doc.regions.regions[5]!.id;
    h.apply(new Map([[CENTRE_ID, RED], [id, BLUE]]));
    const parsed = parse(serialise(doc));
    expect(parsed.config).toEqual(config);
    const again = new PaintDocument(parsed.config, parsed.colours);
    expect(again.colourOf(CENTRE_ID)).toBe(RED);
    expect(again.colourOf(id)).toBe(BLUE);
    expect(again.ignoredColours).toBe(0);
  });

  test("unknown region ids are ignored and counted", () => {
    const text = JSON.stringify({ format: "spiral-paint", version: 1, config, colours: { nope: RED, c: "#F00" } });
    const parsed = parse(text);
    const doc = new PaintDocument(parsed.config, parsed.colours);
    expect(doc.ignoredColours).toBe(1);
    expect(doc.colourOf(CENTRE_ID)).toBe(RED);
  });

  test("rejects bad files", () => {
    expect(() => parse("not json")).toThrow(SpiralFileError);
    expect(() => parse("{}")).toThrow(SpiralFileError);
    expect(() => parse(JSON.stringify({ format: "spiral-paint", version: 2, config }))).toThrow(/newer/);
    expect(() => parse(JSON.stringify({ format: "spiral-paint", version: 1, config: { ...config, spiralCount: 40 } }))).toThrow(SpiralFileError);
  });
});
