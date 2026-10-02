/**
 * Undo / redo. Snapshot based: the scene emits a `history` event whenever an
 * undoable change lands, and this stack keeps the before/after documents.
 *
 * Snapshots are the JSON strings produced by Scene#snapshot(), so an undo is a
 * single restore call with no reverse-operation bookkeeping to get wrong.
 */

export class History {
  constructor(scene, { limit = 240 } = {}) {
    this.scene = scene;
    this.limit = limit;
    this.past = [];
    this.future = [];
    /** Coalescing: consecutive edits to the same label within this window merge. */
    this.mergeWindow = 550;
    this._lastLabel = null;
    this._lastAt = 0;
    this._suspended = 0;

    scene.on("history", (entry) => this._record(entry));
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get depth() {
    return this.past.length;
  }

  undoLabel() {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  redoLabel() {
    return this.future.length ? this.future[this.future.length - 1].label : null;
  }

  /** Run `fn` without recording anything (used while restoring). */
  suspend(fn) {
    this._suspended += 1;
    try {
      return fn();
    } finally {
      this._suspended -= 1;
    }
  }

  clear() {
    this.past.length = 0;
    this.future.length = 0;
    this._lastLabel = null;
  }

  _record({ label, doc, before }) {
    if (this._suspended) return;
    if (doc === before) return;

    const now = performance.now();
    const merges =
      this.mergeable(label) &&
      this._lastLabel === label &&
      now - this._lastAt < this.mergeWindow &&
      this.past.length > 0;

    this.future.length = 0;
    this._lastLabel = label;
    this._lastAt = now;

    if (merges) {
      // Keep the older `before`, adopt the newer `doc`.
      this.past[this.past.length - 1].doc = doc;
      this.past[this.past.length - 1].at = now;
      return;
    }

    this.past.push({ label, doc, before, at: now });
    if (this.past.length > this.limit) this.past.shift();
  }

  /** Continuous edits (slider drags) collapse; structural ones never do. */
  mergeable(label) {
    if (!label) return false;
    return /^(prop|canvas|text|style|keyframe-value)/.test(label);
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return null;
    const current = this.scene.snapshot();
    this.future.push({ label: entry.label, doc: current });
    this.suspend(() => this.scene.restore(entry.before));
    this._lastLabel = null;
    return entry.label;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return null;
    const current = this.scene.snapshot();
    this.past.push({ label: entry.label, doc: current, before: current });
    this.suspend(() => this.scene.restore(entry.doc));
    this._lastLabel = null;
    return entry.label;
  }

  /** Drop history entries that touch a specific element being removed. */
  pruneForElement(id) {
    const marker = `"${id}"`;
    const keep = (entry) => !entry.before.includes(marker) && !entry.doc.includes(marker);
    const beforeLen = this.past.length;
    this.past = this.past.filter(keep).slice(-this.limit);
    this.future = this.future.filter(keep);
    return beforeLen !== this.past.length;
  }
}
