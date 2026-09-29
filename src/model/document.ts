import type { Pt } from "../geometry/polygon";
import { RegionSet } from "../geometry/regions";
import type { Scene } from "../geometry/scene";
import { DEFAULT_COLOUR } from "./colour";

export type ChangeListener = (ids: Iterable<string>) => void;

/** A colour pinned to a point inside the region it paints (how colours are saved and carried over). */
export interface ColourPoint {
  x: number;
  y: number;
  colour: string;
}

/**
 * An image: its scene, the regions derived from it, and the colour of each
 * painted region. Unpainted regions are white; painting white removes the
 * entry, so the colour map stays canonical.
 */
export class PaintDocument {
  readonly regions: RegionSet;
  private readonly colours = new Map<string, string>();
  private readonly listeners = new Set<ChangeListener>();

  constructor(readonly scene: Scene, colours?: Iterable<[string, string]>) {
    this.regions = new RegionSet(scene);
    if (colours) for (const [id, c] of colours) if (this.regions.byId.has(id)) this.setRaw(id, c);
  }

  /**
   * Builds a document and paints each colour point's region. Points are applied
   * in order, so later points win when several land in one region. Also
   * reports how many points fell outside the canvas.
   */
  static fromColourPoints(scene: Scene, points: Iterable<ColourPoint>): { doc: PaintDocument; unplaced: number } {
    const doc = new PaintDocument(scene);
    let unplaced = 0;
    for (const p of points) {
      const r = doc.regions.locate(p.x, p.y);
      if (r) doc.setRaw(r.id, p.colour);
      else unplaced++;
    }
    return { doc, unplaced };
  }

  /**
   * The painted regions as colour points, smallest region first, so that when
   * they're re-applied to a different scene the larger regions win conflicts.
   */
  colourPoints(): ColourPoint[] {
    return [...this.colours]
      .map(([id, colour]) => ({ id, colour, area: this.regions.byId.get(id)!.area }))
      .sort((a, b) => a.area - b.area)
      .map(({ id, colour }) => {
        const [x, y]: Pt = this.regions.interiorPoint(id);
        return { x: round(x), y: round(y), colour };
      });
  }

  colourOf(id: string): string {
    return this.colours.get(id) ?? DEFAULT_COLOUR;
  }

  /** Painted (non-white) regions. */
  paintedColours(): ReadonlyMap<string, string> {
    return this.colours;
  }

  /** Sets colours and notifies listeners. Callers should go through History to make it undoable. */
  setColours(changes: ReadonlyMap<string, string>): void {
    if (changes.size === 0) return;
    for (const [id, c] of changes) this.setRaw(id, c);
    for (const l of this.listeners) l(changes.keys());
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setRaw(id: string, colour: string): void {
    if (colour === DEFAULT_COLOUR) this.colours.delete(id);
    else this.colours.set(id, colour);
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
