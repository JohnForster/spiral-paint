// Headless visual check: renders sample images to PNG with resvg.
// Usage: bun scripts/render.ts [outDir]
import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_CONFIG, type SpiralConfig } from "../src/geometry/config";
import { PaintDocument } from "../src/model/document";
import { History } from "../src/model/history";
import { bucketFill } from "../src/model/tools";
import { exportSvg } from "../src/render/svg";

const outDir = process.argv[2] ?? "out/renders";
const PALETTE = ["#e63946", "#f4a261", "#2a9d8f", "#264653", "#e9c46a", "#8ecae6", "#6d597a"];

const samples: [string, Partial<SpiralConfig>][] = [
  ["default", {}],
  ["n3-odd", { spiralCount: 3, growthRate: 0.2 }],
  ["n2", { spiralCount: 2, growthRate: 0.15 }],
  ["n12-dense", { spiralCount: 12, startRadius: 4, growthRate: 0.15 }],
  ["big-a", { startRadius: 150, spiralCount: 6 }],
  ["origin", { centreModel: "origin" }],
];

for (const [name, partial] of samples) {
  const config = { ...DEFAULT_CONFIG, ...partial };
  const doc = new PaintDocument(config);
  const h = new History(doc);
  // Colour cells by lattice index, so neighbouring cells differ.
  const changes = new Map<string, string>();
  for (const r of doc.regions.regions) {
    changes.set(r.id, PALETTE[r.cell ? (r.cell[0] * 3 + r.cell[1]) % PALETTE.length : 0]!);
  }
  h.apply(changes);
  for (const lines of [true, false]) {
    const svg = exportSvg(doc, { showLines: lines });
    const png = new Resvg(svg).render().asPng();
    await Bun.write(`${outDir}/${name}${lines ? "" : "-nolines"}.png`, png);
  }
  // Seam check: bucket-fill everything with one colour, lines hidden — should be perfectly flat.
  if (name === "default") {
    const flat = new PaintDocument(config);
    const ids = bucketFill(flat.regions, (id) => flat.colourOf(id), "c", "#264653");
    new History(flat).apply(new Map(ids.map((id) => [id, "#264653"])));
    await Bun.write(`${outDir}/${name}-flat.png`, new Resvg(exportSvg(flat, { showLines: false })).render().asPng());
  }
  console.log(`${name}: ${doc.regions.regions.length} regions`);
}
