// End-to-end check of the real app in headless Chrome (Playwright, installed Chrome).
// Usage: bun scripts/e2e.ts [screenshotDir]
import { chromium, type Page } from "playwright";
import index from "../src/index.html";
import { DEFAULT_CONFIG, type SpiralConfig } from "../src/geometry/config";
import type { Pt } from "../src/geometry/polygon";
import { CENTRE_ID, RegionSet } from "../src/geometry/regions";
import { regionsAlongSegment } from "../src/model/tools";
import { regionPathData } from "../src/render/svg";

const shotDir = process.argv[2] ?? "out/e2e";
const server = Bun.serve({ port: 0, routes: { "/": index }, development: false });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Canvas → client coordinates, from the live viewBox. */
async function toClient(p: Pt): Promise<Pt> {
  return page.evaluate(([x, y]) => {
    const svg = document.getElementById("canvas") as unknown as SVGSVGElement;
    const b = svg.getBoundingClientRect();
    const [vx, vy, vw] = svg.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number];
    const s = b.width / vw;
    return [b.left + (x - vx) * s, b.top + (y - vy) * s] as [number, number];
  }, p);
}

/** A point well inside a region (farthest from other regions on a coarse grid). */
function interiorPoint(set: RegionSet, id: string): Pt {
  const r = set.byId.get(id)!;
  let best: Pt = [0, 0];
  let bestScore = -1;
  const { minX, minY, maxX, maxY } = r.bbox;
  for (let gx = 0; gx <= 30; gx++)
    for (let gy = 0; gy <= 30; gy++) {
      const x = minX + ((maxX - minX) * gx) / 30;
      const y = minY + ((maxY - minY) * gy) / 30;
      if (set.locate(x, y)?.id !== id) continue;
      let score = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]] as const) {
        let d = 0;
        while (d < 200 && set.locate(x + dx * d, y + dy * d)?.id === id) d += 0.5;
        score = Math.min(score, d);
      }
      if (score > bestScore) (bestScore = score), (best = [x, y]);
    }
  return best;
}

/** Colour the live view shows for a region (the colour group whose path contains it). */
async function shownColour(set: RegionSet, id: string): Promise<string | null> {
  const frag = regionPathData(set.byId.get(id)!);
  return page.evaluate((f) => {
    for (const p of document.querySelectorAll("#canvas path[fill]"))
      if (p.getAttribute("d")?.includes(f)) return p.getAttribute("fill");
    return null;
  }, frag);
}

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function fresh(): Promise<void> {
  await page.goto(server.url.href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#canvas path[fill]");
}

async function setColour(hex: string) {
  await page.evaluate((c) => {
    const input = document.getElementById("colour") as HTMLInputElement;
    input.value = c;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, hex);
}

async function download(action: () => Promise<unknown>) {
  const [d] = await Promise.all([page.waitForEvent("download"), action()]);
  return { name: d.suggestedFilename(), path: (await d.path())! };
}

const pngSize = async (path: string) => {
  const b = new Uint8Array(await Bun.file(path).arrayBuffer());
  const v = new DataView(b.buffer);
  return [v.getUint32(16), v.getUint32(20)];
};

try {
  const set = new RegionSet(DEFAULT_CONFIG);
  await fresh();
  await page.screenshot({ path: `${shotDir}/01-initial.png` });
  check("status shows region count", (await page.textContent("#status-info"))!.includes(`${set.regions.length} regions`));

  // Paint click (on a cell the drag below won't cross)
  const a: Pt = [150, 420];
  const b: Pt = [1050, 380];
  const expected = regionsAlongSegment(set, a, b, 0.05);
  const cellId = set.regions.find((r) => r.cell && r.area > 2000 && !expected.includes(r.id))!.id;
  await setColour("#ed1c24");
  let [cx, cy] = await toClient(interiorPoint(set, cellId));
  await page.mouse.click(cx, cy);
  await frame();
  check("click paints the region under the cursor", (await shownColour(set, cellId)) === "#ed1c24");
  check("click paints only that region", (await shownColour(set, CENTRE_ID)) === "#ffffff");

  // Fast drag across the canvas: 3 pointer events only, must still paint every region crossed.
  await setColour("#00a2e8");
  const ca = await toClient(a);
  const cb = await toClient(b);
  await page.mouse.move(ca[0], ca[1]);
  await page.mouse.down();
  await page.mouse.move(cb[0], cb[1], { steps: 2 });
  await page.mouse.up();
  await frame();
  const painted = await Promise.all(expected.map((id) => shownColour(set, id)));
  const missed = expected.filter((_, k) => painted[k] !== "#00a2e8");
  check(`fast drag paints all ${expected.length} regions crossed`, missed.length === 0, missed.length ? `missed ${missed.join(" ")}` : "");
  await page.screenshot({ path: `${shotDir}/02-painted.png` });

  // Undo / redo (one step per stroke)
  await page.keyboard.press("ControlOrMeta+z");
  await frame();
  check("undo reverts the whole stroke", (await Promise.all(expected.map((id) => shownColour(set, id)))).every((c) => c === "#ffffff"));
  check("undo keeps the earlier click", (await shownColour(set, cellId)) === "#ed1c24");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await frame();
  check("redo reapplies the stroke", (await shownColour(set, expected[0]!)) === "#00a2e8");

  // Eyedropper returns to the previous tool
  await setColour("#000000");
  await page.keyboard.press("i");
  [cx, cy] = await toClient(interiorPoint(set, cellId));
  await page.mouse.click(cx, cy);
  const picked = await page.inputValue("#colour");
  const toolAfter = await page.getAttribute('[data-tool="paint"]', "aria-pressed");
  check("eyedropper picks the region colour", picked === "#ed1c24", picked);
  check("eyedropper switches back to the previous tool", toolAfter === "true");

  // Lines toggle
  await page.keyboard.press("l");
  check("L hides spiral lines", (await page.$eval(".spiral-lines", (e) => (e as SVGElement).style.display)) === "none");
  await page.screenshot({ path: `${shotDir}/03-no-lines.png` });
  await page.keyboard.press("l");

  // Zoom keeps the point under the cursor fixed
  const anchor = interiorPoint(set, CENTRE_ID);
  const before = await toClient(anchor);
  await page.mouse.move(before[0], before[1]);
  await page.mouse.wheel(0, -600);
  await frame();
  const after = await toClient(anchor);
  const zoomLabel = await page.textContent("#zoom");
  check("wheel zooms in", zoomLabel !== "100%" && parseInt(zoomLabel!) > 100, zoomLabel!);
  check("zoom keeps the cursor point fixed", Math.hypot(after[0] - before[0], after[1] - before[1]) < 1);
  await page.screenshot({ path: `${shotDir}/04-zoomed.png` });

  // Shift-drag and middle-drag pan
  const p0 = await toClient(anchor);
  await page.keyboard.down("Shift");
  await page.mouse.move(700, 450);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const p1 = await toClient(anchor);
  check("shift-drag pans", Math.abs(p1[0] - p0[0] + 100) < 1 && Math.abs(p1[1] - p0[1] + 50) < 1, `${(p1[0] - p0[0]).toFixed(1)},${(p1[1] - p0[1]).toFixed(1)}`);
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(750, 470, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const p2 = await toClient(anchor);
  check("middle-drag pans", Math.abs(p2[0] - p1[0] - 50) < 1 && Math.abs(p2[1] - p1[1] - 20) < 1);
  check("panning doesn't paint", (await shownColour(set, CENTRE_ID)) !== "#000000");
  await page.keyboard.press("0");

  // Save / exports
  const saved = await download(() => page.keyboard.press("ControlOrMeta+s"));
  const savedJson = JSON.parse(await Bun.file(saved.path).text());
  check("save downloads a .spiral file", saved.name === "untitled.spiral" && savedJson.format === "spiral-paint");
  check("saved file has the painted colours", savedJson.colours[cellId] === "#ed1c24" && savedJson.colours[expected[0]!] === "#00a2e8");
  const svgFile = await download(() => page.click('[data-action="export-svg"]'));
  const svgText = await Bun.file(svgFile.path).text();
  check("SVG export", svgFile.name === "untitled.svg" && svgText.startsWith("<svg") && svgText.includes('fill="#ed1c24"'));
  const png1 = await download(() => page.click('[data-action="export-png"]'));
  check("PNG export is canvas-sized", JSON.stringify(await pngSize(png1.path)) === JSON.stringify([DEFAULT_CONFIG.width, DEFAULT_CONFIG.height]));
  const png2 = await download(() => page.click('[data-action="export-png-2x"]'));
  check("PNG 2× export is double size", JSON.stringify(await pngSize(png2.path)) === JSON.stringify([DEFAULT_CONFIG.width * 2, DEFAULT_CONFIG.height * 2]));
  await Bun.write(`${shotDir}/export.png`, Bun.file(png1.path));

  // Autosave survives reload
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector("#canvas path[fill]");
  await frame();
  check("autosave restores the image after reload", (await shownColour(set, cellId)) === "#ed1c24");

  // Fill on a fresh image: everything white is connected, so it all turns blue.
  await fresh();
  await setColour("#3f48cc");
  await page.keyboard.press("b");
  [cx, cy] = await toClient(interiorPoint(set, CENTRE_ID));
  await page.mouse.click(cx, cy);
  await frame();
  const fills = await page.$$eval("#canvas path[fill]", (ps) => ps.map((p) => p.getAttribute("fill")));
  check("bucket fill floods all connected white regions", JSON.stringify(fills) === JSON.stringify(["#3f48cc"]), JSON.stringify(fills));
  // Fill stops at a different colour: paint a cell red, fill it green → only it changes.
  await page.keyboard.press("p");
  await setColour("#ed1c24");
  [cx, cy] = await toClient(interiorPoint(set, cellId));
  await page.mouse.click(cx, cy);
  await page.keyboard.press("f");
  await setColour("#22b14c");
  await page.mouse.click(cx, cy);
  await frame();
  check("bucket fill stays inside a differently coloured region", (await shownColour(set, cellId)) === "#22b14c" && (await shownColour(set, CENTRE_ID)) === "#3f48cc");

  // Open the earlier saved file
  await page.evaluate(() => (window.confirm = () => true));
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+o");
  await (await chooser).setFiles(saved.path);
  await page.waitForFunction(() => document.getElementById("status-message")!.textContent!.startsWith("Opened"));
  await frame();
  check("open restores a saved file", (await shownColour(set, cellId)) === "#ed1c24" && (await shownColour(set, expected[0]!)) === "#00a2e8");

  // New image dialog: live count, then create with 5 spirals in the origin model.
  await page.keyboard.press("n");
  await page.waitForSelector("#new-dialog[open]");
  await page.fill('input[name="spiralCount"]', "5");
  await page.selectOption('select[name="centreModel"]', "origin");
  const cfg5: SpiralConfig = { ...DEFAULT_CONFIG, spiralCount: 5, centreModel: "origin" };
  const n5 = new RegionSet(cfg5).regions.length;
  await page.waitForFunction((n) => document.getElementById("new-count")!.textContent === `${n.toLocaleString()} regions`, n5);
  check("dialog preview shows the region count", true, `${n5} regions`);
  await page.screenshot({ path: `${shotDir}/05-new-dialog.png` });
  await page.fill('input[name="growthRate"]', "5");
  await page.waitForFunction(() => (document.getElementById("new-create") as HTMLButtonElement).disabled);
  check("invalid settings disable Create", true, (await page.textContent("#new-errors"))!);
  await page.fill('input[name="growthRate"]', "0.25");
  await page.waitForFunction(() => !(document.getElementById("new-create") as HTMLButtonElement).disabled);
  await page.click("#new-create");
  await frame();
  check("new image uses the dialog settings", (await page.textContent("#status-info"))!.includes(`5 spirals · ${n5} regions`));
  await page.screenshot({ path: `${shotDir}/06-new-image.png` });

  // Deep zoom on a dense image: click a tiny cell near the centre at maximum zoom.
  const dense: SpiralConfig = { ...DEFAULT_CONFIG, spiralCount: 12, startRadius: 4, growthRate: 0.15 };
  const denseSet = new RegionSet(dense);
  await page.keyboard.press("n");
  await page.waitForSelector("#new-dialog[open]");
  await page.fill('input[name="spiralCount"]', "12");
  await page.fill('input[name="startRadius"]', "4");
  await page.fill('input[name="growthRate"]', "0.15");
  await page.selectOption('select[name="centreModel"]', "startRadius");
  await page.waitForFunction((n) => document.getElementById("new-count")!.textContent === `${n.toLocaleString()} regions`, denseSet.regions.length);
  await page.click("#new-create");
  await frame();
  // Two targets: the cell nearest the centre, and the smallest sliver clipped by the canvas edge.
  const L = denseSet.lattice;
  const dist = (r: { bbox: { minX: number; minY: number; maxX: number; maxY: number } }) =>
    Math.hypot((r.bbox.minX + r.bbox.maxX) / 2 - L.cx, (r.bbox.minY + r.bbox.maxY) / 2 - L.cy);
  const innermost = denseSet.regions.filter((r) => r.cell).sort((p, q) => dist(p) - dist(q))[0]!;
  const sliver = denseSet.regions.filter((r) => r.cell && r.area > 0.5 && r.area < 3).sort((p, q) => p.area - q.area)[0]!;
  await page.keyboard.press("p");
  await setColour("#ff7f27");
  for (const [label, target] of [["innermost", innermost], ["edge sliver", sliver]] as const) {
    await page.keyboard.press("0");
    const pt = interiorPoint(denseSet, target.id);
    for (let k = 0; k < 12; k++) {
      const [tx, ty] = await toClient(pt);
      await page.mouse.move(tx, ty);
      await page.mouse.wheel(0, -500);
    }
    await frame();
    const [tx, ty] = await toClient(pt);
    await page.mouse.click(tx, ty);
    await frame();
    check(
      `max zoom click paints the ${label} cell (${target.area.toFixed(2)} px², ${dist(target).toFixed(1)} px from centre)`,
      (await shownColour(denseSet, target.id)) === "#ff7f27",
      `zoom ${await page.textContent("#zoom")}`,
    );
    if (label === "innermost") await page.screenshot({ path: `${shotDir}/07-deep-zoom.png` });
  }

  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} catch (e) {
  failures++;
  console.log("FAIL  script error —", e);
  await page.screenshot({ path: `${shotDir}/error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.stop(true);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
