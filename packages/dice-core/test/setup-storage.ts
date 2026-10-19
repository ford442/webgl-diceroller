/**
 * dice-core persists roll history, stats and the active dice set through a
 * `localStorage` global when the host has one (pages do; Node does not, and
 * the code guards on `typeof localStorage`). The core tests run in the plain
 * node environment, so give them an in-memory one with the Storage surface
 * the core touches.
 */
class MemoryStorage {
    private items = new Map<string, string>();
    get length(): number {
        return this.items.size;
    }
    key(index: number): string | null {
        return [...this.items.keys()][index] ?? null;
    }
    getItem(key: string): string | null {
        return this.items.has(key) ? (this.items.get(key) as string) : null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, String(value));
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
    clear(): void {
        this.items.clear();
    }
}

Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
});
