/**
 * The boundary end to end in a DOM: global handlers -> reporter -> banner,
 * one banner however many failures, rejections recorded but not announced,
 * and a failed lazy import reloading exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installErrorBoundary, type ErrorBoundary } from '../../src/core/ErrorBoundary.js';
import { ERROR_BANNER_ID, hideErrorBanner } from '../../src/ui/ErrorBanner.js';
import type { StorageLike } from '../../src/core/StaleChunkRecovery.js';

function memoryStorage(): StorageLike {
    const data = new Map<string, string>();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function banners(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`#${ERROR_BANNER_ID}`));
}

function fireError(error: Error): void {
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
}

function fireRejection(reason: unknown): void {
    const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
        reason: unknown;
    };
    event.reason = reason;
    window.dispatchEvent(event);
}

describe('installErrorBoundary', () => {
    let boundary: ErrorBoundary;
    let reload: ReturnType<typeof vi.fn>;
    const log = vi.fn();

    let storage: StorageLike;

    beforeEach(() => {
        document.body.innerHTML =
            '<div id="loading-overlay"><div id="loading-text">Loading Tavern...</div><div id="loading-bar"></div></div>';
        reload = vi.fn();
        storage = memoryStorage();
        log.mockClear();
        boundary = installErrorBoundary({ storage, reload, log });
    });

    afterEach(() => {
        boundary.dispose();
        hideErrorBanner();
    });

    it('shows one banner with a reload action for an uncaught error, and logs it once', () => {
        for (let i = 0; i < 25; i++) fireError(new Error('click handler broke'));
        expect(banners()).toHaveLength(1);
        expect(banners()[0]?.getAttribute('role')).toBe('alert');
        expect(banners()[0]?.textContent).toContain('click handler broke');
        expect(log).toHaveBeenCalledTimes(1);
        expect(boundary.reporter.list()[0]?.count).toBe(25);

        const reloadBtn = Array.from(banners()[0]?.querySelectorAll('button') ?? []).find(
            (b) => b.textContent === 'Reload'
        );
        reloadBtn?.click();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('lists a system failure by name and folds a burst into a single banner', () => {
        for (const name of ['a', 'b', 'c', 'd', 'e']) {
            boundary.onSystemError(new Error(`${name} failed`), {
                system: name,
                phase: 'updates',
                consecutive: 1,
                quarantined: false,
            });
        }
        expect(banners()).toHaveLength(1);
        expect(banners()[0]?.textContent).toContain('(a)');
        expect(banners()[0]?.textContent).toContain('and 2 more');
    });

    it('records an unhandled rejection without a banner, and prevents the duplicate console line', () => {
        const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
            reason: unknown;
        };
        event.reason = new Error('audio resume blocked');
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(banners()).toHaveLength(0);
        expect(boundary.reporter.list()[0]).toMatchObject({ kind: 'rejection' });
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('ignores ResizeObserver noise and resource-load errors', () => {
        fireError(new Error('ResizeObserver loop completed with undelivered notifications.'));
        const img = document.createElement('img');
        document.body.appendChild(img);
        img.dispatchEvent(new Event('error', { bubbles: true }));
        expect(banners()).toHaveLength(0);
        expect(boundary.reporter.total()).toBe(0);
    });

    it('reloads exactly once for a failed dynamic import, however many arrive', async () => {
        const err = new TypeError('Failed to fetch dynamically imported module: /assets/X-1.js');
        fireRejection(err);
        fireRejection(err);
        window.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: err }));
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        // The three signals were one problem: one reload, and no banner flashed before it.
        expect(banners()).toHaveLength(0);
        // The reloaded page (a fresh boundary, same tab storage) fails the same import again:
        // the guard says a reload was already tried.
        boundary.dispose();
        boundary = installErrorBoundary({ storage, reload, log });
        fireRejection(err);
        await vi.waitFor(() => expect(banners()).toHaveLength(1));
        expect(reload).toHaveBeenCalledTimes(1);
        expect(banners()[0]?.textContent).toContain('out of date');
        expect(banners()[0]?.textContent).toContain('Clear cache');
    });

    it('turns a failed boot into a visible message instead of an endless "Loading"', () => {
        const failure = new Error('no WebGL');
        boundary.reportBoot(failure);
        expect(document.getElementById('loading-text')?.textContent).toBe(
            'The tavern could not start.'
        );
        expect(banners()).toHaveLength(1);
        boundary.reportBoot(failure);
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('hands over from the index.html bootstrap script', () => {
        expect((window as unknown as { __diceBooted?: boolean }).__diceBooted).toBe(true);
    });
});
