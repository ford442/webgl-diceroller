/**
 * The app's top-level error boundary (#383).
 *
 * Three jobs, one place:
 *  1. **Isolate**: a frame-scheduler system that throws is reported here
 *     (`onSystemError`) instead of ending the render loop.
 *  2. **Surface once**: every failure goes through `ErrorReporter` (logged once,
 *     repeats counted) and, where a person needs to know, a banner with a
 *     reload action. Nothing prints per frame.
 *  3. **Recover from a stale deploy**: a failed lazy import reloads the page once.
 *
 * Decisions (also in docs/ARCHITECTURE.md, "Error boundary"):
 *  - Uncaught exceptions and failed systems show the banner; **unhandled
 *    promise rejections are logged and counted but do not show it**. They are
 *    mostly benign here (a blocked AudioContext resume, a dead signaling
 *    server, an aborted fetch) and a banner per one would cry wolf. They stay
 *    visible in `window.__app.errors` under ?test / ?debug.
 *  - Known-harmless browser noise (ResizeObserver loop notices, opaque
 *    cross-origin "Script error.") is ignored.
 */

import { createErrorReporter, describeError } from './ErrorReporter.js';
import type { ErrorKind, ErrorReporter, ReportedError } from './ErrorReporter.js';
import type { SystemErrorInfo } from './FrameScheduler.js';
import {
    hardReload,
    isChunkLoadError,
    recoverFromStaleChunk,
    type ChunkRecovery,
    type StorageLike,
} from './StaleChunkRecovery.js';
import { showErrorBanner, type ErrorBannerAction } from '../ui/ErrorBanner.js';
import { watchForServiceWorkerUpdate } from './UpdateNotice.js';

/** Window-level messages that are not application failures. */
const IGNORED_MESSAGES =
    /ResizeObserver loop (limit exceeded|completed with undelivered notifications)|^Script error\.?$/i;

export interface ErrorBoundaryOptions {
    win?: Window;
    doc?: Document;
    /** Defaults to `sessionStorage`, or null when the browser refuses it. */
    storage?: StorageLike | null;
    reload?: () => void;
    /** Overridable for tests; defaults to the DOM banner. */
    banner?: typeof showErrorBanner;
    log?: (line: string, error: unknown) => void;
}

export interface ErrorBoundary {
    reporter: ErrorReporter;
    /** Hand to `FrameScheduler` as `onSystemError`. */
    onSystemError(error: unknown, info: SystemErrorInfo): void;
    /** `init()` failed: the page is unusable, say so instead of sitting on "Loading". */
    reportBoot(error: unknown): void;
    /** A caught-but-notable failure from a feature (kept out of the banner). */
    report(kind: ErrorKind, error: unknown, source?: string): void;
    dispose(): void;
}

function safeSessionStorage(win: Window): StorageLike | null {
    try {
        return win.sessionStorage ?? null;
    } catch {
        return null;
    }
}

/** What a player reads, by kind of failure. */
function friendlyMessage(entry: ReportedError): string {
    switch (entry.kind) {
        case 'system':
            return `Part of the scene stopped working (${entry.source}). The rest keeps running.`;
        case 'boot':
            return 'The tavern could not start.';
        case 'chunk':
            return 'This page is out of date. Reload to get the latest version.';
        default:
            return 'Something went wrong.';
    }
}

export function installErrorBoundary(options: ErrorBoundaryOptions = {}): ErrorBoundary {
    const win = options.win ?? window;
    const doc = options.doc ?? document;
    const storage = options.storage === undefined ? safeSessionStorage(win) : options.storage;
    const reload = options.reload ?? (() => win.location.reload());
    const banner = options.banner ?? showErrorBanner;

    const reloadAction: ErrorBannerAction = { label: 'Reload', run: reload };
    const hardReloadAction: ErrorBannerAction = {
        label: 'Clear cache & reload',
        run: () => void hardReload(win),
    };

    const surface = (entry: ReportedError) => {
        // Rejections are recorded, not announced (see the decisions above).
        if (entry.kind === 'rejection') return;
        // A stale chunk reloads first and only then (if that did not help) shows its own
        // banner from handleChunk; showing one here would flash it right before the reload.
        if (entry.kind === 'chunk') return;
        try {
            banner(
                {
                    message: friendlyMessage(entry),
                    detail: entry.message,
                    actions:
                        entry.kind === 'chunk' ? [reloadAction, hardReloadAction] : [reloadAction],
                },
                doc
            );
        } catch {
            /* the banner is the last resort; it must not throw into the handler */
        }
    };

    const reporter = createErrorReporter({ onFirst: surface, log: options.log });

    const handleChunk = (error: unknown) => {
        reporter.report('chunk', error, 'import');
        void recoverFromStaleChunk({
            storage,
            reload,
            updateServiceWorker: async () => {
                const regs = (await win.navigator.serviceWorker?.getRegistrations?.()) ?? [];
                await Promise.all(regs.map((r) => r.update()));
            },
        }).then((outcome: ChunkRecovery) => {
            if (outcome === 'reloaded') return;
            // A reload did not help (or could not be tried safely): leave the choice to the player.
            try {
                banner(
                    {
                        message: 'This page is out of date. Reload to get the latest version.',
                        detail: describeError(error).message,
                        actions: [reloadAction, hardReloadAction],
                    },
                    doc
                );
            } catch {
                /* see surface() */
            }
        });
    };

    const onError = (event: ErrorEvent) => {
        // A failed <img>/<script> fires a plain Event on the element (it does not bubble
        // here anyway); only a real script error is an ErrorEvent with a message.
        if (!('message' in event)) return;
        const error = event.error ?? event.message;
        const { message } = describeError(error);
        if (IGNORED_MESSAGES.test(message)) return;
        if (isChunkLoadError(error)) {
            handleChunk(error);
            return;
        }
        reporter.report('error', error, 'window');
    };

    const onRejection = (event: PromiseRejectionEvent) => {
        const reason: unknown = event.reason;
        // We log it ourselves, once; the browser's own "Uncaught (in promise)" line would double it.
        event.preventDefault?.();
        if (isChunkLoadError(reason)) {
            handleChunk(reason);
            return;
        }
        reporter.report('rejection', reason, 'promise');
    };

    // Vite fires this before it rethrows a failed `import()` / preload; we only
    // observe (no preventDefault), so the caller's own catch still runs.
    const onPreloadError = (event: Event) => {
        handleChunk((event as Event & { payload?: unknown }).payload ?? 'vite:preloadError');
    };

    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    win.addEventListener('vite:preloadError', onPreloadError);
    const stopWatchingUpdates = watchForServiceWorkerUpdate({
        serviceWorker: win.navigator?.serviceWorker ?? null,
        notify: () => {
            try {
                banner(
                    {
                        message: 'A new version is ready.',
                        actions: [reloadAction],
                        role: 'status',
                    },
                    doc
                );
            } catch {
                /* see surface() */
            }
        },
    });
    // Hands the page over from the bootstrap script in index.html (which covers
    // errors before this module could run).
    (win as Window & { __diceBooted?: boolean }).__diceBooted = true;

    return {
        reporter,
        onSystemError(error, info) {
            reporter.report('system', error, info.system);
        },
        reportBoot(error) {
            const { first } = reporter.report('boot', error, 'init');
            if (!first) return;
            // The loading overlay (z-index 9999) would otherwise keep saying "Loading Tavern...".
            const text = doc.getElementById('loading-text');
            if (text) text.textContent = 'The tavern could not start.';
            const bar = doc.getElementById('loading-bar');
            if (bar) bar.style.background = '#a33';
        },
        report(kind, error, source) {
            reporter.report(kind, error, source);
        },
        dispose() {
            win.removeEventListener('error', onError);
            win.removeEventListener('unhandledrejection', onRejection);
            win.removeEventListener('vite:preloadError', onPreloadError);
            stopWatchingUpdates();
        },
    };
}
