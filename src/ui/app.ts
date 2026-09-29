import { DEFAULT_CONFIG } from "../geometry/config";
import type { Pt } from "../geometry/polygon";
import { CENTRE_ID, type Region } from "../geometry/regions";
import { normaliseColour } from "../model/colour";
import { PaintDocument } from "../model/document";
import { FILE_EXTENSION, parse, serialise, SpiralFileError } from "../model/fileFormat";
import { History } from "../model/history";
import { bucketFill, regionsAlongSegment } from "../model/tools";
import { exportPng } from "../render/png";
import { exportSvg } from "../render/svg";
import { CanvasView } from "./canvasView";
import { download, pickTextFile } from "./files";
import { openNewImageDialog } from "./newImageDialog";
import { AUTOSAVE_KEY, load, loadPrefs, PREFS_KEY, store, type Prefs } from "./storage";
import { Viewport } from "./viewport";

type Tool = "paint" | "fill" | "pick";

const PALETTE = [
  "#000000", "#7f7f7f", "#880015", "#ed1c24", "#ff7f27", "#fff200", "#22b14c", "#00a2e8",
  "#3f48cc", "#a349a4", "#ffffff", "#c3c3c3", "#b97a57", "#ffaec9", "#ffc90e", "#efe4b0",
  "#b5e61d", "#99d9ea", "#7092be", "#c8bfe7",
];
const MAX_RECENT = 8;
const AUTOSAVE_DELAY_MS = 500;
/** Drag painting samples the pointer path every this many screen pixels. */
const DRAG_STEP_PX = 0.5;

interface Autosave {
  name: string;
  dirty: boolean;
  data: string;
}

export class App {
  private doc!: PaintDocument;
  private history!: History;
  private view: CanvasView | null = null;
  private readonly viewport: Viewport;
  private readonly svg = document.getElementById("canvas") as unknown as SVGSVGElement;
  private tool: Tool = "paint";
  private toolBeforePick: Tool = "paint";
  private prefs: Prefs;
  private fileName = "untitled";
  private dirty = false;
  private autosaveTimer = 0;
  private drag: { kind: "paint" | "pan"; pointerId: number; last: Pt; lastClient: Pt } | null = null;
  private unsubscribeDoc: (() => void) | null = null;

  constructor() {
    this.prefs = loadPrefs({ colour: "#e63946", recent: [], showLines: true });
    this.viewport = new Viewport(this.svg, DEFAULT_CONFIG.width, DEFAULT_CONFIG.height);
    this.viewport.onChange(() => this.updateZoomLabel());
    this.bindToolbar();
    this.bindCanvas();
    this.bindKeyboard();
    this.renderSwatches();
    this.setColour(this.prefs.colour);
    this.setTool("paint");

    if (!this.restoreAutosave()) this.loadDocument(new PaintDocument(DEFAULT_CONFIG), "untitled", false);
  }

  // ---- documents -------------------------------------------------------

  private loadDocument(doc: PaintDocument, name: string, dirty: boolean): void {
    this.view?.destroy();
    this.unsubscribeDoc?.();
    this.doc = doc;
    this.history = new History(doc);
    this.history.onChange(() => this.updateButtons());
    this.unsubscribeDoc = doc.onChange(() => {
      this.dirty = true;
      this.scheduleAutosave();
    });
    this.fileName = name;
    this.dirty = dirty;
    this.view = new CanvasView(this.svg, doc);
    this.view.setLinesVisible(this.prefs.showLines);
    this.viewport.setCanvasSize(doc.config.width, doc.config.height);
    this.updateButtons();
    this.updateInfo();
    this.scheduleAutosave();
  }

  private restoreAutosave(): boolean {
    const raw = load(AUTOSAVE_KEY);
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw) as Autosave;
      const parsed = parse(saved.data);
      this.loadDocument(new PaintDocument(parsed.config, parsed.colours), saved.name || "untitled", !!saved.dirty);
      return true;
    } catch {
      return false;
    }
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      const saved: Autosave = { name: this.fileName, dirty: this.dirty, data: serialise(this.doc) };
      if (!store(AUTOSAVE_KEY, JSON.stringify(saved))) this.message("Autosave failed: browser storage is unavailable or full.", true);
    }, AUTOSAVE_DELAY_MS);
  }

  private async newImage(): Promise<void> {
    const config = await openNewImageDialog(this.doc.config, this.dirty);
    if (!config) return;
    this.loadDocument(new PaintDocument(config), "untitled", false);
    this.message("New image created.");
  }

  private async open(): Promise<void> {
    if (this.dirty && !confirm("Your current image has unsaved changes. Open another image anyway?")) return;
    const file = await pickTextFile(document.getElementById("file-input") as HTMLInputElement);
    if (!file) return;
    try {
      const parsed = parse(file.text);
      const doc = new PaintDocument(parsed.config, parsed.colours);
      this.loadDocument(doc, file.name.replace(/\.spiral$/i, ""), false);
      this.message(
        doc.ignoredColours
          ? `Opened ${file.name}. ${doc.ignoredColours} colour entries didn't match any region and were skipped.`
          : `Opened ${file.name}.`,
      );
    } catch (e) {
      this.message(e instanceof SpiralFileError ? e.message : `Couldn't open ${file.name}.`, true);
    }
  }

  private save(): void {
    download(new Blob([serialise(this.doc)], { type: "application/json" }), `${this.fileName}${FILE_EXTENSION}`);
    this.dirty = false;
    this.scheduleAutosave();
    this.message(`Saved ${this.fileName}${FILE_EXTENSION}.`);
  }

  private exportSvgFile(): void {
    const svg = exportSvg(this.doc, { showLines: this.prefs.showLines });
    download(new Blob([svg], { type: "image/svg+xml" }), `${this.fileName}.svg`);
  }

  private async exportPngFile(scale: number): Promise<void> {
    try {
      const blob = await exportPng(this.doc, { showLines: this.prefs.showLines }, scale);
      download(blob, `${this.fileName}${scale === 1 ? "" : `@${scale}x`}.png`);
    } catch (e) {
      this.message(`PNG export failed: ${e instanceof Error ? e.message : e}`, true);
    }
  }

  // ---- tools -----------------------------------------------------------

  private setTool(tool: Tool): void {
    if (tool === "pick" && this.tool !== "pick") this.toolBeforePick = this.tool;
    this.tool = tool;
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  }

  private setColour(value: string): void {
    const c = normaliseColour(value);
    if (!c) return;
    this.prefs.colour = c;
    (document.getElementById("colour") as HTMLInputElement).value = c;
    for (const s of document.querySelectorAll<HTMLButtonElement>(".swatch"))
      s.classList.toggle("current", s.dataset.colour === c);
    this.savePrefs();
  }

  private rememberColour(): void {
    const c = this.prefs.colour;
    this.prefs.recent = [c, ...this.prefs.recent.filter((r) => r !== c)].slice(0, MAX_RECENT);
    this.renderSwatches();
    this.savePrefs();
  }

  private pick(region: Region | null): void {
    if (!region) return;
    this.setColour(this.doc.colourOf(region.id));
    if (this.tool === "pick") this.setTool(this.toolBeforePick);
  }

  private fill(region: Region | null): void {
    if (!region) return;
    const ids = bucketFill(this.doc.regions, (id) => this.doc.colourOf(id), region.id, this.prefs.colour);
    if (ids.length === 0) return;
    this.history.apply(new Map(ids.map((id) => [id, this.prefs.colour])));
    this.rememberColour();
  }

  private paintAlong(from: Pt, to: Pt): void {
    const ids = regionsAlongSegment(this.doc.regions, from, to, DRAG_STEP_PX / this.viewport.scale);
    if (ids.length) this.history.strokePaint(new Map(ids.map((id) => [id, this.prefs.colour])));
  }

  // ---- input -----------------------------------------------------------

  private bindCanvas(): void {
    const svg = this.svg;
    // Suppress the browser's middle-click autoscroll.
    svg.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault());
    svg.addEventListener("auxclick", (e) => e.preventDefault());
    svg.addEventListener("contextmenu", (e) => this.drag && e.preventDefault());

    svg.addEventListener("pointerdown", (e) => {
      if (this.drag) return;
      const p = this.viewport.toCanvas(e.clientX, e.clientY);
      const client: Pt = [e.clientX, e.clientY];
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        this.drag = { kind: "pan", pointerId: e.pointerId, last: p, lastClient: client };
        svg.classList.add("panning");
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      const region = this.doc.regions.locate(p[0], p[1]);
      if (e.altKey || this.tool === "pick") return this.pick(region);
      if (this.tool === "fill") return this.fill(region);
      this.history.beginStroke();
      this.drag = { kind: "paint", pointerId: e.pointerId, last: p, lastClient: client };
      svg.setPointerCapture(e.pointerId);
      this.paintAlong(p, p);
    });

    svg.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (d && d.pointerId === e.pointerId) {
        if (d.kind === "pan") {
          this.viewport.panBy(e.clientX - d.lastClient[0], e.clientY - d.lastClient[1]);
          d.lastClient = [e.clientX, e.clientY];
          return;
        }
        const events = e.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e]) {
          const p = this.viewport.toCanvas(ev.clientX, ev.clientY);
          this.paintAlong(d.last, p);
          d.last = p;
        }
      }
      const p = this.viewport.toCanvas(e.clientX, e.clientY);
      this.hoverAt(this.doc.regions.locate(p[0], p[1]));
    });

    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.pointerId !== e.pointerId) return;
      this.drag = null;
      svg.classList.remove("panning");
      if (d.kind === "paint") {
        this.history.endStroke();
        this.rememberColour();
      }
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", () => !this.drag && this.hoverAt(null));

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
        this.viewport.zoomAt(Math.exp(-e.deltaY * unit), e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  private hoverAt(region: Region | null): void {
    this.view?.setHover(region);
    document.getElementById("status-region")!.textContent = region
      ? region.id === CENTRE_ID
        ? "Centre region"
        : `Region ${region.id}`
      : "";
  }

  private bindToolbar(): void {
    const actions: Record<string, () => void> = {
      new: () => void this.newImage(),
      open: () => void this.open(),
      save: () => this.save(),
      "export-svg": () => this.exportSvgFile(),
      "export-png": () => void this.exportPngFile(1),
      "export-png-2x": () => void this.exportPngFile(2),
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      lines: () => this.toggleLines(),
      "zoom-in": () => this.viewport.zoomAt(1.25),
      "zoom-out": () => this.viewport.zoomAt(0.8),
      fit: () => this.viewport.fit(),
    };
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-action]"))
      b.addEventListener("click", () => actions[b.dataset.action!]?.());
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))
      b.addEventListener("click", () => this.setTool(b.dataset.tool as Tool));
    document.getElementById("colour")!.addEventListener("input", (e) => this.setColour((e.target as HTMLInputElement).value));
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, select, textarea")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod) {
        if (key === "z") return run(() => (e.shiftKey ? this.history.redo() : this.history.undo()));
        if (key === "y") return run(() => this.history.redo());
        if (key === "s") return run(() => this.save());
        if (key === "o") return run(() => void this.open());
        if (key === "n") return run(() => void this.newImage());
        if (key === "e") return run(() => void this.exportPngFile(1));
        return;
      }
      if (e.altKey) return;
      switch (key) {
        case "p": return run(() => this.setTool("paint"));
        case "b":
        case "f": return run(() => this.setTool("fill"));
        case "i": return run(() => this.setTool("pick"));
        case "l": return run(() => this.toggleLines());
        case "n": return run(() => void this.newImage());
        case "0": return run(() => this.viewport.fit());
        case "+":
        case "=": return run(() => this.viewport.zoomAt(1.25));
        case "-":
        case "_": return run(() => this.viewport.zoomAt(0.8));
      }
    });
  }

  // ---- presentation ----------------------------------------------------

  private toggleLines(): void {
    this.prefs.showLines = !this.prefs.showLines;
    this.view?.setLinesVisible(this.prefs.showLines);
    document.querySelector('[data-action="lines"]')!.setAttribute("aria-pressed", String(this.prefs.showLines));
    this.savePrefs();
  }

  private renderSwatches(): void {
    const make = (c: string) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = c;
      b.dataset.colour = c;
      b.title = c;
      b.classList.toggle("current", c === this.prefs.colour);
      b.addEventListener("click", () => this.setColour(c));
      return b;
    };
    document.getElementById("swatches")!.replaceChildren(...PALETTE.map(make));
    document.getElementById("recent")!.replaceChildren(...this.prefs.recent.map(make));
    document.querySelector('[data-action="lines"]')?.setAttribute("aria-pressed", String(this.prefs.showLines));
  }

  private updateButtons(): void {
    (document.querySelector('[data-action="undo"]') as HTMLButtonElement).disabled = !this.history.canUndo;
    (document.querySelector('[data-action="redo"]') as HTMLButtonElement).disabled = !this.history.canRedo;
  }

  private updateZoomLabel(): void {
    document.getElementById("zoom")!.textContent = `${Math.round(this.viewport.scale * 100)}%`;
  }

  private updateInfo(): void {
    const c = this.doc.config;
    document.getElementById("status-info")!.textContent =
      `${c.width}×${c.height} · ${c.spiralCount} spirals · ${this.doc.regions.regions.length.toLocaleString()} regions`;
  }

  private message(text: string, isError = false): void {
    const el = document.getElementById("status-message")!;
    el.textContent = text;
    el.classList.toggle("error", isError);
  }

  private savePrefs(): void {
    store(PREFS_KEY, JSON.stringify(this.prefs));
  }
}
