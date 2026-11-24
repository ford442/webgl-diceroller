/**
 * Stale-chunk recovery: the deploy replaced the hashed file a lazy import wanted.
 *
 * A tab opened before a redeploy holds the old entry chunk, which names old
 * hashed chunks (`MultiplayerRoom-<oldhash>.js`). Once the new deploy is live
 * those can 404 (host pruned them, or the new service worker's precache no
 * longer has them) and the dynamic import rejects. The page is not broken, it
 * is *old*: a reload fetches the matching entry. We reload exactly once per
 * minute; a second failure inside the window means a reload did not help
 * (offline, host down), so we stop and let the banner offer a manual retry
 * instead of looping.
 */

/** Messages browsers give a failed dynamic import / module preload. */
const CHUNK_ERROR_PATTERN =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk [\w-]+ failed|Loading CSS chunk [\w-]+ failed/i;

export function isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const message =
        typeof error === 'string'
            ? error
            : ((error as { message?: unknown }).message as string | undefined);
    return typeof message === 'string' && CHUNK_ERROR_PATTERN.test(message);
}

export const CHUNK_RELOAD_KEY = 'dice:chunk-reload-at';
/** A reload inside this window of the last one is not repeated. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface StaleChunkOptions {
    /** `sessionStorage` (survives the reload, dies with the tab). Null/throwing = unavailable. */
    storage?: StorageLike | null;
    now?: () => number;
    reload: () => void;
    /** Ask the service worker to look for the new build first. Best effort. */
    updateServiceWorker?: () => Promise<void>;
    windowMs?: number;
}

export type ChunkRecovery = 'reloaded' | 'already-tried' | 'no-storage';

/**
 * Reload once. Returns what happened so the caller can fall back to a banner:
 * - `already-tried`: we reloaded within the window and it did not help.
 * - `no-storage`: with no way to remember the attempt a reload could loop
 *   forever (private mode, blocked storage), so we do not start one.
 */
export async function recoverFromStaleChunk(options: StaleChunkOptions): Promise<ChunkRecovery> {
    const now = options.now ?? (() => Date.now());
    const windowMs = options.windowMs ?? CHUNK_RELOAD_WINDOW_MS;
    const storage = options.storage ?? null;
    if (!storage) return 'no-storage';

    let last = 0;
    try {
        last = Number(storage.getItem(CHUNK_RELOAD_KEY)) || 0;
    } catch {
        return 'no-storage';
    }
    const at = now();
    if (last && at - last < windowMs) return 'already-tried';
    try {
        storage.setItem(CHUNK_RELOAD_KEY, String(at));
    } catch {
        return 'no-storage';
    }

    try {
        // Let the worker fetch the new precache so the reload lands on the new
        // build, but never wait on it for long: offline, update() never settles.
        await Promise.race([
            options.updateServiceWorker?.() ?? Promise.resolve(),
            new Promise<void>((resolve) => setTimeout(resolve, 2500)),
        ]);
    } catch {
        /* a failed update check must not block the reload */
    }
    options.reload();
    return 'reloaded';
}

/** Unregister every service worker and drop every cache, then reload: the manual "something is stuck" exit. */
export async function hardReload(win: Window = window): Promise<void> {
    try {
        const registrations = (await win.navigator.serviceWorker?.getRegistrations?.()) ?? [];
        await Promise.all(registrations.map((r) => r.unregister()));
    } catch {
        /* no service worker support */
    }
    try {
        const keys = (await win.caches?.keys?.()) ?? [];
        await Promise.all(keys.map((k) => win.caches.delete(k)));
    } catch {
        /* no Cache Storage */
    }
    win.location.reload();
}
