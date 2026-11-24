/**
 * Error bookkeeping with one rule: a given failure is logged once.
 *
 * A system that throws every frame would otherwise print 60 stack traces a
 * second (and the console itself then becomes the frame-time problem). Failures
 * are fingerprinted (kind + source + message + first stack frame); the first
 * occurrence is logged and reported, later ones only bump a counter that
 * `list()` exposes (`window.__app.errors` under ?test / ?debug).
 *
 * No DOM, no `window`: the banner and the global handlers live elsewhere, so
 * this is unit-testable in Node.
 */

export type ErrorKind =
    /** A frame-scheduler system threw (see FrameScheduler `onSystemError`). */
    | 'system'
    /** An uncaught exception (`window` `error`). */
    | 'error'
    /** An unhandled promise rejection. */
    | 'rejection'
    /** A lazy chunk could not be fetched (stale deploy, offline). */
    | 'chunk'
    /** `init()` failed: the app never became usable. */
    | 'boot';

export interface ReportedError {
    kind: ErrorKind;
    /** Where it came from: a scheduler system name, `window`, a feature name. */
    source: string;
    message: string;
    stack: string | null;
    count: number;
    firstAt: number;
    lastAt: number;
}

export interface ErrorReporterOptions {
    /** Called once per distinct failure, never again for repeats. */
    onFirst?: (entry: ReportedError) => void;
    /** Sink for the one console line; defaults to `console.error`. */
    log?: (line: string, error: unknown) => void;
    /** Distinct failures remembered; older ones are dropped. */
    maxEntries?: number;
    now?: () => number;
}

export interface ErrorReport {
    /** True when this failure had not been seen before. */
    first: boolean;
    entry: ReportedError;
}

export interface ErrorReporter {
    report(kind: ErrorKind, error: unknown, source?: string): ErrorReport;
    list(): ReportedError[];
    /** Total occurrences including repeats. */
    total(): number;
    clear(): void;
}

/** What a thrown value reads as, whatever was thrown. */
export function describeError(error: unknown): { message: string; stack: string | null } {
    if (error instanceof Error) {
        return { message: error.message || error.name, stack: error.stack ?? null };
    }
    if (typeof error === 'string') return { message: error, stack: null };
    if (error && typeof error === 'object') {
        const maybe = error as { message?: unknown; stack?: unknown };
        if (typeof maybe.message === 'string') {
            return {
                message: maybe.message,
                stack: typeof maybe.stack === 'string' ? maybe.stack : null,
            };
        }
        try {
            return { message: JSON.stringify(error), stack: null };
        } catch {
            return { message: Object.prototype.toString.call(error), stack: null };
        }
    }
    return { message: String(error), stack: null };
}

function firstFrame(stack: string | null): string {
    if (!stack) return '';
    // Skip the "Error: message" header; the first "at ..." line locates the throw.
    const line = stack.split('\n').find((l) => /^\s*(at |[^\s]+@)/.test(l));
    return line?.trim() ?? '';
}

export function createErrorReporter(options: ErrorReporterOptions = {}): ErrorReporter {
    const maxEntries = options.maxEntries ?? 50;
    const now = options.now ?? (() => Date.now());
    const log =
        options.log ??
        ((line: string, error: unknown) => {
            console.error(line, error);
        });
    const entries = new Map<string, ReportedError>();
    let total = 0;

    return {
        report(kind, error, source = 'app') {
            const { message, stack } = describeError(error);
            const key = `${kind}|${source}|${message}|${firstFrame(stack)}`;
            total += 1;
            const seen = entries.get(key);
            if (seen) {
                seen.count += 1;
                seen.lastAt = now();
                return { first: false, entry: seen };
            }
            const at = now();
            const entry: ReportedError = {
                kind,
                source,
                message,
                stack,
                count: 1,
                firstAt: at,
                lastAt: at,
            };
            entries.set(key, entry);
            if (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                if (oldest !== undefined) entries.delete(oldest);
            }
            log(
                `[${kind}] ${source}: ${message} (logged once; repeats are counted, not printed)`,
                error
            );
            options.onFirst?.(entry);
            return { first: true, entry };
        },
        list: () => [...entries.values()],
        total: () => total,
        clear() {
            entries.clear();
            total = 0;
        },
    };
}
