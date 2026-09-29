import type { PaintDocument } from "./document";

/** One undoable step: recolouring regions, or replacing the whole document (a scene edit). */
export type Command =
  | { kind: "colours"; before: Map<string, string>; after: Map<string, string> }
  | { kind: "scene"; before: PaintDocument; after: PaintDocument };

/**
 * Undo/redo. A colour step is a single `apply` (bucket fill) or everything
 * painted between `beginStroke` and `endStroke` (a drag). A scene step swaps
 * the document; documents are kept whole, so undoing a scene edit restores
 * exactly the previous image and region ids of older steps stay valid.
 */
export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private stroke: Extract<Command, { kind: "colours" }> | null = null;
  private readonly listeners = new Set<() => void>();

  /** @param onDocument called whenever undo/redo/replace switches the current document */
  constructor(
    private current: PaintDocument,
    private readonly onDocument: (doc: PaintDocument) => void = () => {},
  ) {}

  get doc(): PaintDocument {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.stroke;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.stroke;
  }

  /** Applies a set of colour changes as one step. */
  apply(changes: ReadonlyMap<string, string>): void {
    const cmd = this.record(changes, { kind: "colours", before: new Map(), after: new Map() });
    if (cmd.after.size) this.push(cmd);
  }

  beginStroke(): void {
    this.endStroke();
    this.stroke = { kind: "colours", before: new Map(), after: new Map() };
  }

  /** Paints during a stroke (applied immediately, committed at endStroke). */
  strokePaint(changes: ReadonlyMap<string, string>): void {
    if (!this.stroke) return this.apply(changes);
    this.record(changes, this.stroke);
  }

  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    // Drop regions that ended up back at their original colour.
    for (const [id, c] of s.after) if (s.before.get(id) === c) (s.after.delete(id), s.before.delete(id));
    if (s.after.size) this.push(s);
    else this.notify();
  }

  /** Switches to a new document (e.g. after a scene edit) as one undoable step. */
  replaceDocument(next: PaintDocument): void {
    this.endStroke();
    this.push({ kind: "scene", before: this.current, after: next });
    this.switchTo(next);
  }

  undo(): void {
    if (!this.canUndo) return;
    const cmd = this.undoStack.pop()!;
    if (cmd.kind === "colours") this.current.setColours(cmd.before);
    else this.switchTo(cmd.before);
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    if (!this.canRedo) return;
    const cmd = this.redoStack.pop()!;
    if (cmd.kind === "colours") this.current.setColours(cmd.after);
    else this.switchTo(cmd.after);
    this.undoStack.push(cmd);
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private switchTo(doc: PaintDocument): void {
    this.current = doc;
    this.onDocument(doc);
  }

  private record<C extends Extract<Command, { kind: "colours" }>>(changes: ReadonlyMap<string, string>, cmd: C): C {
    const effective = new Map<string, string>();
    for (const [id, c] of changes) {
      const now = this.current.colourOf(id);
      if (now === c) continue;
      if (!cmd.before.has(id)) cmd.before.set(id, now);
      cmd.after.set(id, c);
      effective.set(id, c);
    }
    this.current.setColours(effective);
    return cmd;
  }

  private push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
