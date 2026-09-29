import type { Pt, Ring } from "../geometry/polygon";
import { signedArea } from "../geometry/polygon";
import type { Region } from "../geometry/regions";
import type { PaintDocument } from "../model/document";

export const LINE_COLOUR = "#1f2328";
export const LINE_WIDTH = 1;
/** Width (canvas px) of the underlay outline that keeps the background out of edges between colours. */
export const UNDERLAY_STROKE = 1;

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

export function ringsToPath(rings: Ring[]): string {
  return rings.map((r) => `M${r.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")}Z`).join("");
}

export function polylineToPath(line: Pt[]): string {
  return `M${line.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join("L")}`;
}

const pathCache = new WeakMap<Region, string>();

/**
 * Path data for a region with every outer ring oriented the same way (holes
 * opposite). Neighbouring regions share bit-identical edge points, so when
 * all regions of one colour are drawn as a single nonzero path the shared
 * edges cancel exactly and no anti-aliasing seam appears between them.
 */
export function regionPathData(region: Region): string {
  let d = pathCache.get(region);
  if (d === undefined) {
    const oriented = region.rings.map((ring, k) => ((signedArea(ring) > 0) === (k === 0) ? ring : [...ring].reverse()));
    d = ringsToPath(oriented);
    pathCache.set(region, d);
  }
  return d;
}

/** Path data per colour: one entry per colour in use. */
export function colourGroups(doc: PaintDocument): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const r of doc.regions.regions) {
    const c = doc.colourOf(r.id);
    let list = parts.get(c);
    if (!list) parts.set(c, (list = []));
    list.push(regionPathData(r));
  }
  return new Map([...parts].map(([c, list]) => [c, list.join("")]));
}

export interface ExportOptions {
  showLines: boolean;
}

/**
 * A standalone SVG of the image, built from the model (not the live DOM), so
 * it doesn't depend on zoom, pan or CSS. Uses plain stroke widths rather than
 * `vector-effect`, which some rasterisers ignore.
 */
export function exportSvg(doc: PaintDocument, { showLines }: ExportOptions, scale = 1): string {
  const { width: W, height: H } = doc.config;
  const groups = [...colourGroups(doc)];
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">`,
    `<defs><clipPath id="canvas"><rect width="${W}" height="${H}"/></clipPath></defs>`,
    `<g clip-path="url(#canvas)" fill="none" stroke-width="${UNDERLAY_STROKE}" stroke-linejoin="round">`,
    ...groups.map(([c, d]) => `<path stroke="${c}" d="${d}"/>`),
    `</g>`,
    `<g fill-rule="nonzero">`,
    ...groups.map(([c, d]) => `<path fill="${c}" d="${d}"/>`),
    `</g>`,
  ];
  if (showLines) {
    out.push(`<g clip-path="url(#canvas)" fill="none" stroke="${LINE_COLOUR}" stroke-width="${LINE_WIDTH}" stroke-linejoin="round">`);
    for (const line of doc.regions.spiralPolylines()) out.push(`<path d="${polylineToPath(line)}"/>`);
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n");
}
