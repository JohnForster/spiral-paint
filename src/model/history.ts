import type { PaintDocument } from "./document";

/** One undoable step: the colour of each touched region before and after. */
export interface Command {
  before: Map<string, string>;
  after: Map<string, string>;
}

/**
 * Undo/redo over a document. A step is either a single `apply` (bucket fill)
 * or everything painted between `beginStroke` and `endStroke` (a drag).
 */
export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private stroke: Command | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly doc: PaintDocument) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.stroke;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.stroke;
  }

  /** Applies a set of colour changes as one step. */
  apply(changes: ReadonlyMap<string, string>): void {
    const cmd = this.record(changes, { before: new Map(), after: new Map() });
    if (cmd.after.size) this.push(cmd);
  }

  beginStroke(): void {
    this.endStroke();
    this.stroke = { before: new Map(), after: new Map() };
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

  undo(): void {
    if (!this.canUndo) return;
    const cmd = this.undoStack.pop()!;
    this.doc.setColours(cmd.before);
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    if (!this.canRedo) return;
    const cmd = this.redoStack.pop()!;
    this.doc.setColours(cmd.after);
    this.undoStack.push(cmd);
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private record(changes: ReadonlyMap<string, string>, cmd: Command): Command {
    const effective = new Map<string, string>();
    for (const [id, c] of changes) {
      const current = this.doc.colourOf(id);
      if (current === c) continue;
      if (!cmd.before.has(id)) cmd.before.set(id, current);
      cmd.after.set(id, c);
      effective.set(id, c);
    }
    this.doc.setColours(effective);
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
