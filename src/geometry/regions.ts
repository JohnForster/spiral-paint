import { arrange, type Arrangement } from "./arrangement";
import { scenePolylines } from "./elements";
import { poleOfInaccessibility } from "./interior";
import { bboxContains, distanceSqToRings, pointInRings, type BBox, type Pt, type Ring } from "./polygon";
import type { Scene } from "./scene";

/** Faces smaller than this (px²) are merged into the neighbour they share the longest border with. */
export const MIN_REGION_AREA = 1;

export interface Region {
  id: string;
  /** One polygon per merged face, each [outer, ...holes]; outer rings share one orientation. */
  polygons: Ring[][];
  area: number;
  bbox: BBox;
}

/**
 * The paintable regions of a scene: faces of the polyline arrangement, with
 * tiny faces merged away. Ids ("r0", "r1", …) are deterministic for a given
 * scene but not stable across scene edits; files use interior points instead.
 */
export class RegionSet {
  readonly regions: Region[] = [];
  readonly byId = new Map<string, Region>();
  /** Unclipped element polylines, for drawing the lines. */
  readonly curves: Pt[][];
  readonly arrangement: Arrangement;
  private readonly regionOfFace: Region[] = [];
  private readonly neighbourIds = new Map<string, Set<string>>();
  private readonly grid: FaceGrid;

  constructor(readonly scene: Scene) {
    this.curves = scenePolylines(scene);
    this.arrangement = arrange(this.curves, scene.width, scene.height);
    const { faces, adjacency } = this.arrangement;

    // Merge tiny faces (union-find over faces, tracking area and border lengths per root).
    const parent = faces.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k]!)));
    const area = faces.map((f) => f.area);
    const border = adjacency.map((m) => new Map(m));
    let merged = true;
    while (merged) {
      merged = false;
      const small = faces.map((_, k) => k).filter((k) => find(k) === k && area[k]! < MIN_REGION_AREA);
      small.sort((a, b) => area[a]! - area[b]!);
      for (const k of small) {
        if (find(k) !== k || area[k]! >= MIN_REGION_AREA) continue;
        let target = -1;
        let best = -1;
        for (const [n, len] of border[k]!) if (len > best) (best = len), (target = n);
        if (target < 0) continue;
        parent[k] = target;
        area[target]! += area[k]!;
        for (const [n, len] of border[k]!) {
          border[n]!.delete(k);
          if (n === target) continue;
          border[target]!.set(n, (border[target]!.get(n) ?? 0) + len);
          border[n]!.set(target, (border[n]!.get(target) ?? 0) + len);
        }
        border[target]!.delete(k);
        border[k]!.clear();
        merged = true;
      }
    }

    // Build regions in a deterministic order (top-to-bottom, left-to-right).
    const members = new Map<number, number[]>();
    faces.forEach((_, k) => {
      const r = find(k);
      let list = members.get(r);
      if (!list) members.set(r, (list = []));
      list.push(k);
    });
    const roots = [...members.keys()]
      .map((r) => ({ r, bbox: unionBBox(members.get(r)!.map((f) => faces[f]!.bbox)) }))
      .sort((a, b) => a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX);
    const regionOfRoot = new Map<number, Region>();
    roots.forEach(({ r, bbox }, k) => {
      const list = members.get(r)!;
      const region: Region = { id: `r${k}`, polygons: list.map((f) => faces[f]!.rings), area: area[r]!, bbox };
      this.regions.push(region);
      this.byId.set(region.id, region);
      regionOfRoot.set(r, region);
      for (const f of list) this.regionOfFace[f] = region;
    });
    for (const { r } of roots) {
      const id = regionOfRoot.get(r)!.id;
      this.neighbourIds.set(id, new Set([...border[r]!.keys()].map((n) => regionOfRoot.get(n)!.id)));
    }
    this.grid = new FaceGrid(faces.map((f) => f.bbox), scene.width, scene.height);
  }

  get width(): number {
    return this.scene.width;
  }

  get height(): number {
    return this.scene.height;
  }

  /** The region containing a canvas point, or null outside the canvas. */
  locate(x: number, y: number): Region | null {
    if (!(x >= 0 && y >= 0 && x <= this.width && y <= this.height)) return null;
    const faces = this.arrangement.faces;
    const candidates = this.grid.query(x, y);
    let nearest = -1;
    let nearestDist = Infinity;
    for (const f of candidates) {
      const face = faces[f]!;
      if (!bboxContains(face.bbox, x, y)) continue;
      if (pointInRings(face.rings, x, y)) return this.regionOfFace[f]!;
    }
    // On an edge (or in float noise along one): take the nearest face.
    for (const f of candidates) {
      const d = distanceSqToRings(faces[f]!.rings, x, y);
      if (d < nearestDist) (nearestDist = d), (nearest = f);
    }
    return nearest >= 0 ? this.regionOfFace[nearest]! : null;
  }

  neighbours(id: string): ReadonlySet<string> {
    return this.neighbourIds.get(id) ?? new Set();
  }

  /** A point well inside a region (in its largest polygon), used to store colours in files. */
  interiorPoint(id: string): Pt {
    const r = this.byId.get(id)!;
    let largest = r.polygons[0]!;
    let largestArea = -1;
    for (const p of r.polygons) {
      const b = unionBBox([bboxOfRing(p[0]!)]);
      const a = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (a > largestArea) (largestArea = a), (largest = p);
    }
    return poleOfInaccessibility(largest);
  }
}

/** Uniform grid over face bounding boxes for point queries. */
class FaceGrid {
  private readonly cell: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cells: number[][];

  constructor(boxes: BBox[], width: number, height: number) {
    this.cell = Math.max(4, Math.sqrt((width * height) / Math.max(1, boxes.length)) * 2);
    this.gw = Math.ceil(width / this.cell) + 1;
    this.gh = Math.ceil(height / this.cell) + 1;
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    boxes.forEach((b, k) => {
      for (let gx = this.index(b.minX, this.gw); gx <= this.index(b.maxX, this.gw); gx++)
        for (let gy = this.index(b.minY, this.gh); gy <= this.index(b.maxY, this.gh); gy++) this.cells[gy * this.gw + gx]!.push(k);
    });
  }

  query(x: number, y: number): number[] {
    return this.cells[this.index(y, this.gh) * this.gw + this.index(x, this.gw)]!;
  }

  private index(v: number, max: number): number {
    return Math.min(max - 1, Math.max(0, Math.floor(v / this.cell)));
  }
}

function bboxOfRing(ring: Ring): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  }
  return b;
}

function unionBBox(boxes: BBox[]): BBox {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}
