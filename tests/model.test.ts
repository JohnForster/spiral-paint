import { describe, expect, test } from "bun:test";
import { line, spiralGroup, type Scene } from "../src/geometry/scene";
import { normaliseColour } from "../src/model/colour";
import { PaintDocument } from "../src/model/document";
import { parse, serialise, SpiralFileError } from "../src/model/fileFormat";
import { History } from "../src/model/history";
import { bucketFill, regionsAlongSegment } from "../src/model/tools";

const scene: Scene = { width: 400, height: 300, elements: [spiralGroup(200, 150, { count: 6, growth: 0.3 })] };
const RED = "#ff0000";
const BLUE = "#0000ff";
const centreId = (doc: PaintDocument) => doc.regions.locate(200, 150)!.id;

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
    const doc = new PaintDocument(scene);
    const h = new History(doc);
    const c = centreId(doc);
    h.apply(new Map([[c, RED]]));
    expect(doc.colourOf(c)).toBe(RED);
    h.undo();
    expect(doc.colourOf(c)).toBe("#ffffff");
    expect(doc.paintedColours().size).toBe(0);
    h.redo();
    expect(doc.colourOf(c)).toBe(RED);
  });

  test("a stroke is one undo step and a new step clears redo", () => {
    const doc = new PaintDocument(scene);
    const h = new History(doc);
    const [a, b] = doc.regions.regions.slice(1, 3).map((r) => r.id) as [string, string];
    h.beginStroke();
    h.strokePaint(new Map([[a, RED]]));
    h.strokePaint(new Map([[b, RED]]));
    h.strokePaint(new Map([[a, BLUE]]));
    h.endStroke();
    expect(doc.colourOf(a)).toBe(BLUE);
    h.undo();
    expect([doc.colourOf(a), doc.colourOf(b)]).toEqual(["#ffffff", "#ffffff"]);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect([doc.colourOf(a), doc.colourOf(b)]).toEqual([BLUE, RED]);
    h.undo();
    h.apply(new Map([[a, RED]]));
    expect(h.canRedo).toBe(false);
  });

  test("no-op changes don't create steps", () => {
    const doc = new PaintDocument(scene);
    const h = new History(doc);
    const c = centreId(doc);
    h.apply(new Map([[c, "#ffffff"]]));
    h.beginStroke();
    h.strokePaint(new Map([[c, RED]]));
    h.strokePaint(new Map([[c, "#ffffff"]]));
    h.endStroke();
    expect(h.canUndo).toBe(false);
  });

  test("scene edits are undoable and keep older colour steps valid", () => {
    const a = new PaintDocument(scene);
    const switched: PaintDocument[] = [];
    const h = new History(a, (d) => switched.push(d));
    h.apply(new Map([[centreId(a), RED]]));
    const b = PaintDocument.fromColourPoints({ ...scene, elements: [...scene.elements, line(0, 150, 400, 150)] }, a.colourPoints()).doc;
    h.replaceDocument(b);
    expect(h.doc).toBe(b);
    h.apply(new Map([[b.regions.regions[0]!.id, BLUE]]));
    h.undo(); // colours on b
    h.undo(); // scene edit
    expect(h.doc).toBe(a);
    expect(a.colourOf(centreId(a))).toBe(RED);
    h.undo(); // colours on a
    expect(a.paintedColours().size).toBe(0);
    h.redo();
    h.redo();
    expect(h.doc).toBe(b);
    expect(switched).toEqual([b, a, b]);
  });
});

describe("colour carry-over", () => {
  test("colours follow their regions to an edited scene", () => {
    const doc = new PaintDocument(scene);
    const big = [...doc.regions.regions].sort((p, q) => q.area - p.area).slice(0, 5);
    doc.setColours(new Map(big.map((r, k) => [r.id, `#00000${k + 1}`])));
    // Rotating a line in far away shouldn't disturb the big regions' colours.
    const edited: Scene = { ...scene, elements: [...scene.elements, line(0, 5, 400, 5)] };
    const { doc: next, unplaced } = PaintDocument.fromColourPoints(edited, doc.colourPoints());
    expect(unplaced).toBe(0);
    for (const [k, r] of big.entries()) {
      const [x, y] = doc.regions.interiorPoint(r.id);
      expect(next.colourOf(next.regions.locate(x, y)!.id)).toBe(`#00000${k + 1}`);
    }
  });

  test("when regions merge, the larger old region's colour wins", () => {
    const withLine: Scene = { width: 200, height: 100, elements: [line(100, 0, 100, 100)] };
    const doc = new PaintDocument(withLine);
    const left = doc.regions.locate(20, 50)!.id;
    const right = doc.regions.locate(190, 50)!.id;
    doc.setColours(new Map([[left, RED], [right, BLUE]]));
    // Move the line right: the left region is now the bigger one.
    const moved: Scene = { width: 200, height: 100, elements: [line(150, 0, 150, 100)] };
    const d2 = PaintDocument.fromColourPoints(moved, doc.colourPoints()).doc;
    expect(d2.colourOf(d2.regions.locate(20, 50)!.id)).toBe(RED);
    // Remove the line entirely: one region, the larger (red) wins.
    const noLine: Scene = { width: 200, height: 100, elements: [line(0, -10, 200, -10)] };
    const d3 = PaintDocument.fromColourPoints(noLine, doc.colourPoints()).doc;
    expect(d3.regions.regions.length).toBe(1);
    expect(d3.colourOf(d3.regions.regions[0]!.id)).toBe(RED);
  });
});

describe("tools", () => {
  test("bucket fill spreads over same-coloured neighbours only", () => {
    const d = new PaintDocument(scene);
    const start = d.regions.regions.find((r) => d.regions.neighbours(r.id).size === 4)!;
    const all = bucketFill(d.regions, (id) => d.colourOf(id), start.id, RED);
    expect(all.length).toBe(d.regions.regions.length);
    d.setColours(new Map([...d.regions.neighbours(start.id)].map((n) => [n, BLUE] as [string, string])));
    expect(bucketFill(d.regions, (id) => d.colourOf(id), start.id, RED)).toEqual([start.id]);
    expect(bucketFill(d.regions, (id) => d.colourOf(id), start.id, "#ffffff")).toEqual([]);
  });

  test("segment sampling finds every region crossed, in order", () => {
    const set = new PaintDocument(scene).regions;
    const ids = regionsAlongSegment(set, [0, 150], [400, 150], 0.25);
    expect(ids).toContain(set.locate(200, 150)!.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let k = 1; k < ids.length; k++) expect(set.neighbours(ids[k - 1]!).has(ids[k]!)).toBe(true);
  });
});

describe("file format", () => {
  test("round trip", () => {
    const multi: Scene = { width: 500, height: 300, elements: [spiralGroup(150, 150), spiralGroup(350, 150, { direction: "cw", rotation: 10 }), line(0, 0, 500, 300, "segment")] };
    const doc = new PaintDocument(multi);
    const ids = doc.regions.regions.filter((_, k) => k % 7 === 0).map((r) => r.id);
    doc.setColours(new Map(ids.map((id, k) => [id, k % 2 ? RED : BLUE])));
    const parsed = parse(serialise(doc));
    expect(parsed.scene).toEqual(multi);
    const { doc: again, unplaced } = PaintDocument.fromColourPoints(parsed.scene, parsed.colours);
    expect(unplaced).toBe(0);
    expect(new Map(again.paintedColours())).toEqual(new Map(doc.paintedColours()));
  });

  test("rejects bad and old files", () => {
    expect(() => parse("not json")).toThrow(SpiralFileError);
    expect(() => parse("{}")).toThrow(SpiralFileError);
    expect(() => parse(JSON.stringify({ format: "spiral-paint", version: 1, config: {} }))).toThrow(/older version/);
    expect(() => parse(JSON.stringify({ format: "spiral-paint", version: 3, scene }))).toThrow(/newer/);
    expect(() => parse(JSON.stringify({ format: "spiral-paint", version: 2, scene: { ...scene, elements: [] } }))).toThrow(SpiralFileError);
    expect(() =>
      parse(JSON.stringify({ format: "spiral-paint", version: 2, scene: { ...scene, elements: [{ ...scene.elements[0], count: 99 }] } })),
    ).toThrow(SpiralFileError);
  });

  test("ignores malformed colour entries and strips unknown fields", () => {
    const text = JSON.stringify({
      format: "spiral-paint",
      version: 2,
      scene: { ...scene, extra: 1, elements: [{ ...scene.elements[0], junk: true }] },
      colours: [{ x: 200, y: 150, colour: "#F00" }, { x: "a", y: 1, colour: RED }, { x: 1, y: 1, colour: "red" }],
    });
    const parsed = parse(text);
    expect(parsed.colours).toEqual([{ x: 200, y: 150, colour: RED }]);
    expect(parsed.scene).toEqual(scene);
  });
});
