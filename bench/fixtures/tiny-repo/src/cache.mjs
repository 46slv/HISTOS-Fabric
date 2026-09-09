export class DerivedCache {
  #entries = new Map();

  get(key) {
    return this.#entries.get(key) ?? null;
  }

  put(key, value) {
    this.#entries.set(key, value);
  }

  clear() {
    this.#entries.clear();
  }
}
