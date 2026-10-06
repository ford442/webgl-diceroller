/**
 * The roll history / stats modules persist through the Web Storage API when
 * it exists. Node has none, so give the `dice-core` project an in-memory one:
 * the persistence round-trips are part of what those tests pin.
 */
class MemoryStorage implements Storage {
    #items = new Map<string, string>();
    get length() {
        return this.#items.size;
    }
    clear() {
        this.#items.clear();
    }
    getItem(key: string) {
        return this.#items.get(key) ?? null;
    }
    key(index: number) {
        return [...this.#items.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.#items.delete(key);
    }
    setItem(key: string, value: string) {
        this.#items.set(key, String(value));
    }
}

if (!('localStorage' in globalThis) || !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', {
        value: new MemoryStorage(),
        configurable: true,
    });
}
