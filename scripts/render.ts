// Headless visual check: renders sample scenes to PNG with resvg.
// Usage: bun scripts/render.ts [outDir]
import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_SCENE, line, PRESETS, spiralGroup, type Scene } from "../src/geometry/scene";
import { PaintDocument } from "../src/model/document";
import { bucketFill } from "../src/model/tools";
import { exportSvg } from "../src/render/svg";

const outDir = process.argv[2] ?? "out/renders";
const PALETTE = ["#e63946", "#f4a261", "#2a9d8f", "#264653", "#e9c46a", "#8ecae6", "#6d597a"];
const { width: W, height: H } = DEFAULT_SCENE;

const samples: [string, Scene][] = [
  ...PRESETS.map((p): [string, Scene] => [p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), { width: W, height: H, elements: p.make(W, H) }]),
  ["dense-2x2", { width: W, height: H, elements: PRESETS[1]!.make(W, H).map((e) => ({ ...e, count: 12, growth: 0.15 })) }],
  ["off-canvas-and-segments", { width: W, height: H, elements: [spiralGroup(-150, 400, { count: 10 }), spiralGroup(700, 350, { direction: "cw", count: 6 }), line(100, 700, 1100, 100, "segment"), line(200, 100, 500, 250, "segment")] }],
];

for (const [name, scene] of samples) {
  const doc = new PaintDocument(scene);
  // Greedy graph colouring, so neighbouring regions always differ.
  const colours = new Map<string, string>();
  for (const r of [...doc.regions.regions].sort((a, b) => b.area - a.area)) {
    const used = new Set([...doc.regions.neighbours(r.id)].map((n) => colours.get(n)));
    colours.set(r.id, PALETTE.find((c) => !used.has(c)) ?? PALETTE[0]!);
  }
  doc.setColours(colours);
  for (const lines of [true, false])
    await Bun.write(`${outDir}/${name}${lines ? "" : "-nolines"}.png`, new Resvg(exportSvg(doc, { showLines: lines })).render().asPng());
  // Seam check: bucket-fill everything with one colour, lines hidden — should be perfectly flat.
  const flat = new PaintDocument(scene);
  const start = flat.regions.regions[0]!.id;
  flat.setColours(new Map(bucketFill(flat.regions, (id) => flat.colourOf(id), start, "#264653").map((id) => [id, "#264653"])));
  await Bun.write(`${outDir}/${name}-flat.png`, new Resvg(exportSvg(flat, { showLines: false })).render().asPng());
  console.log(`${name}: ${doc.regions.regions.length} regions`);
}
