import { describe, expect, it, vi } from 'vitest';
import {
    CHUNK_RELOAD_KEY,
    isChunkLoadError,
    recoverFromStaleChunk,
    type StorageLike,
} from '../../src/core/StaleChunkRecovery.js';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
    };
}

describe('isChunkLoadError', () => {
    it.each([
        'Failed to fetch dynamically imported module: https://x/assets/GameTable-abc.js',
        'error loading dynamically imported module: https://x/a.js',
        'Importing a module script failed.',
        'Unable to preload CSS for /assets/index-1.css',
        'Loading chunk 12 failed.',
    ])('recognises %s', (message) => {
        expect(isChunkLoadError(new TypeError(message))).toBe(true);
        expect(isChunkLoadError(message)).toBe(true);
    });

    it('ignores unrelated errors', () => {
        expect(isChunkLoadError(new Error('x is not a function'))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError({})).toBe(false);
    });
});

describe('recoverFromStaleChunk', () => {
    it('reloads once, then refuses inside the window', async () => {
        const storage = memoryStorage();
        const reload = vi.fn();
        let t = 1_000_000;
        const opts = { storage, reload, now: () => t, updateServiceWorker: async () => {} };

        expect(await recoverFromStaleChunk(opts)).toBe('reloaded');
        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.data.get(CHUNK_RELOAD_KEY)).toBe('1000000');

        t += 5_000;
        expect(await recoverFromStaleChunk(opts)).toBe('already-tried');
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('allows another reload once the window has passed (a later, different deploy)', async () => {
        const storage = memoryStorage();
        const reload = vi.fn();
        let t = 1_000_000;
        const opts = { storage, reload, now: () => t, updateServiceWorker: async () => {} };
        await recoverFromStaleChunk(opts);
        t += 61_000;
        expect(await recoverFromStaleChunk(opts)).toBe('reloaded');
        expect(reload).toHaveBeenCalledTimes(2);
    });

    it('does not reload without storage: it could not remember the attempt and might loop', async () => {
        const reload = vi.fn();
        expect(await recoverFromStaleChunk({ storage: null, reload })).toBe('no-storage');
        const broken: StorageLike = {
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('SecurityError');
            },
        };
        expect(await recoverFromStaleChunk({ storage: broken, reload })).toBe('no-storage');
        expect(reload).not.toHaveBeenCalled();
    });

    it('still reloads when the service-worker update check fails', async () => {
        const reload = vi.fn();
        const outcome = await recoverFromStaleChunk({
            storage: memoryStorage(),
            reload,
            updateServiceWorker: async () => {
                throw new Error('offline');
            },
        });
        expect(outcome).toBe('reloaded');
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
