import type { Region } from "../geometry/regions";
import type { PaintDocument } from "../model/document";
import { LINE_COLOUR, polylineToPath, regionPathData } from "../render/svg";

const NS = "http://www.w3.org/2000/svg";

interface Group {
  regions: Set<Region>;
  underlay: SVGPathElement;
  fill: SVGPathElement;
}

/**
 * The live SVG view of a document. Regions of the same colour are drawn as a
 * single path (see regionPathData) over a same-coloured outline underlay, so
 * there are no anti-aliasing seams. Recolouring only rebuilds the affected
 * colour groups, batched once per animation frame.
 */
export class CanvasView {
  private readonly root: SVGGElement;
  private readonly underlayLayer: SVGGElement;
  private readonly fillLayer: SVGGElement;
  private readonly linesLayer: SVGGElement;
  private readonly hover: SVGPathElement;
  private readonly groups = new Map<string, Group>();
  private readonly shownColour = new Map<Region, string>();
  private readonly dirty = new Set<string>();
  private frame = 0;
  private readonly unsubscribe: () => void;

  constructor(
    svg: SVGSVGElement,
    private readonly doc: PaintDocument,
  ) {
    const { width: W, height: H } = doc.config;
    this.root = el("g");
    const clipId = "canvas-clip";
    const defs = el("defs");
    const clip = el("clipPath", { id: clipId });
    clip.append(el("rect", { width: W, height: H }));
    defs.append(clip);
    const shadow = el("rect", { width: W, height: H, class: "canvas-shadow" });
    this.underlayLayer = el("g", { "clip-path": `url(#${clipId})`, fill: "none", class: "underlay" });
    this.fillLayer = el("g", { "fill-rule": "nonzero" });
    this.linesLayer = el("g", { "clip-path": `url(#${clipId})`, fill: "none", stroke: LINE_COLOUR, class: "spiral-lines" });
    for (const line of doc.regions.spiralPolylines()) this.linesLayer.append(el("path", { d: polylineToPath(line) }));
    this.hover = el("path", { class: "hover-outline" });
    this.root.append(defs, shadow, this.underlayLayer, this.fillLayer, this.linesLayer, this.hover);
    svg.replaceChildren(this.root);

    for (const r of doc.regions.regions) this.assign(r, doc.colourOf(r.id));
    this.flush();
    this.unsubscribe = doc.onChange((ids) => {
      for (const id of ids) {
        const r = doc.regions.byId.get(id);
        if (r) this.assign(r, doc.colourOf(id));
      }
      this.frame ||= requestAnimationFrame(() => this.flush());
    });
  }

  setLinesVisible(visible: boolean): void {
    this.linesLayer.style.display = visible ? "" : "none";
  }

  setHover(region: Region | null): void {
    if (region) this.hover.setAttribute("d", regionPathData(region));
    else this.hover.removeAttribute("d");
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.root.remove();
  }

  private assign(region: Region, colour: string): void {
    const old = this.shownColour.get(region);
    if (old === colour) return;
    if (old !== undefined) {
      this.groups.get(old)?.regions.delete(region);
      this.dirty.add(old);
    }
    let g = this.groups.get(colour);
    if (!g) {
      g = {
        regions: new Set(),
        underlay: el("path", { stroke: colour }),
        fill: el("path", { fill: colour }),
      };
      this.groups.set(colour, g);
      this.underlayLayer.append(g.underlay);
      this.fillLayer.append(g.fill);
    }
    g.regions.add(region);
    this.shownColour.set(region, colour);
    this.dirty.add(colour);
  }

  private flush(): void {
    this.frame = 0;
    for (const colour of this.dirty) {
      const g = this.groups.get(colour);
      if (!g) continue;
      if (g.regions.size === 0) {
        g.underlay.remove();
        g.fill.remove();
        this.groups.delete(colour);
        continue;
      }
      let d = "";
      for (const r of g.regions) d += regionPathData(r);
      g.underlay.setAttribute("d", d);
      g.fill.setAttribute("d", d);
    }
    this.dirty.clear();
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
