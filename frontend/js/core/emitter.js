/**
 * Minimal synchronous event emitter. No bubbling, no magic — just handlers.
 * Listeners are copied before dispatch so a handler may unsubscribe itself.
 */
export class Emitter {
  constructor() {
    this._map = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(event, fn) {
    let set = this._map.get(event);
    if (!set) this._map.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Subscribe for exactly one delivery. */
  once(event, fn) {
    const off = this.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(event, fn) {
    const set = this._map.get(event);
    if (set) set.delete(fn);
  }

  emit(event, ...args) {
    const set = this._map.get(event);
    if (!set || set.size === 0) return false;
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch (err) {
        // One broken listener must never take down the whole UI.
        console.error(`[emitter] handler for "${event}" threw`, err);
      }
    }
    return true;
  }

  clear(event) {
    if (event === undefined) this._map.clear();
    else this._map.delete(event);
  }
}
