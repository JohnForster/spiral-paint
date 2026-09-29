import type { SpiralConfig } from "../geometry/config";
import { RegionSet } from "../geometry/regions";
import { DEFAULT_COLOUR } from "./colour";

export type ChangeListener = (ids: Iterable<string>) => void;

/**
 * An image: its (fixed) config, the regions derived from it, and the colour of
 * each painted region. Unpainted regions are white; painting white removes the
 * entry, so the colour map stays canonical.
 */
export class PaintDocument {
  readonly regions: RegionSet;
  private readonly colours = new Map<string, string>();
  private readonly listeners = new Set<ChangeListener>();
  /** Colour entries passed to the constructor whose region doesn't exist in this geometry. */
  readonly ignoredColours: number;

  constructor(readonly config: SpiralConfig, colours?: Iterable<[string, string]>) {
    this.regions = new RegionSet(config);
    let ignored = 0;
    if (colours)
      for (const [id, c] of colours) {
        if (this.regions.byId.has(id)) this.setRaw(id, c);
        else ignored++;
      }
    this.ignoredColours = ignored;
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
