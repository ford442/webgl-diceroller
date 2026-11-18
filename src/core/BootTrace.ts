/**
 * Boot trace — what the page did between navigation and `ready`, in numbers.
 *
 * The boot path had been typed and given one device session but never
 * *budgeted* (#365): a warm second visit ran tier 0 and every shader compile
 * back to back and blocked the main thread for tens of seconds, and nothing
 * said where. This records spans around each phase, tier, prop and compile
 * (`performance.measure`, so they sit on the DevTools / Perfetto timeline next
 * to the long tasks they cause) and keeps its own copy for `__app.bootTrace()`.
 *
 * DOM-free apart from `performance` / `PerformanceObserver`, and the clock is
 * injectable, so it unit-tests in node.
 */
import type { FrameScheduler } from './FrameScheduler';

export type BootSpanKind = 'phase' | 'tier' | 'prop' | 'compile' | 'frame';

export interface BootSpan {
    name: string;
    kind: BootSpanKind;
    /** The tier span this one ran under (`null` for a tier itself or outside any). */
    tier: string | null;
    /** `performance.now()` at start / end: ms since navigation start. */
    start: number;
    end: number;
    duration: number;
    detail?: Record<string, unknown>;
}

export interface BootTierSummary {
    name: string;
    start: number;
    end: number;
    duration: number;
    props: number;
    /** Wall time of the slowest prop (includes any async load the prop awaited). */
    longestPropMs: number;
    longestProp: string | null;
    /** Times the spawn budget handed the thread back to a frame inside this tier. */
    yields: number;
    compileMs: number;
}

export interface BootFrameRecord {
    /** 1-based index among the frames the trace watched. */
    n: number;
    at: number;
    duration: number;
    /** `false` when the render phase was held (boot hides the scene until shaders are linked). */
    rendered: boolean;
    /** Programs the renderer created during this frame (a frame that compiles is a stall). */
    newPrograms: number | null;
}

export interface BootLongTask {
    start: number;
    duration: number;
    /** Boot spans that overlap this task, biggest overlap first. */
    during: string[];
}

export interface BootTraceSnapshot {
    /** `performance.now()` when the snapshot was taken. */
    now: number;
    /** When `app.ready` was set, or `null` while booting. */
    ready: number | null;
    /** Spans still open: what the page is doing right now. */
    active: string[];
    tiers: BootTierSummary[];
    spans: BootSpan[];
    compile: {
        totalMs: number;
        longestMs: number;
        /** Live programs after the last compile pass (`renderer.info.programs`). */
        programs: number | null;
        passes: number;
    };
    firstFrame: { at: number; duration: number; newPrograms: number | null } | null;
    frames: BootFrameRecord[];
    longTasks: BootLongTask[];
    counters: Record<string, number>;
    notes: Record<string, unknown>;
}

export interface BootTrace {
    /** Start a span; call the returned function to end it. */
    begin(
        name: string,
        kind: BootSpanKind,
        detail?: Record<string, unknown>
    ): (extra?: Record<string, unknown>) => BootSpan;
    /** Run a synchronous `fn` inside a span. */
    span<T>(name: string, kind: BootSpanKind, fn: () => T, detail?: Record<string, unknown>): T;
    /** Run an async `fn` inside a span, ending it when its promise settles. */
    spanAsync<T>(
        name: string,
        kind: BootSpanKind,
        fn: () => Promise<T>,
        detail?: Record<string, unknown>
    ): Promise<T>;
    /** A tier span; spans begun while it is open carry its name. Call the result to close. */
    beginTier(name: string): () => BootSpan;
    mark(name: string, detail?: Record<string, unknown>): void;
    count(name: string, delta?: number): void;
    note(key: string, value: unknown): void;
    /** Called once when `app.ready` is set; later prop / compile spans are not kept. */
    markReady(): void;
    /** Watch the first frames: when the first real render happened and what it cost. */
    attachScheduler(
        scheduler: FrameScheduler,
        options?: { getProgramCount?: () => number | null }
    ): void;
    snapshot(): BootTraceSnapshot;
    /** Subscribe to span begin/end (the `?debug` overlay). Returns an unsubscribe. */
    onChange(listener: () => void): () => void;
    /** Plain-text rendering of the snapshot (overlay + console). */
    format(): string;
}

export interface CreateBootTraceOptions {
    now?: () => number;
    /** Record `longtask` entries so they can be attributed to spans (default: on when supported). */
    observeLongTasks?: boolean;
    /** Frames to watch before the scheduler hooks remove themselves. */
    maxFrames?: number;
}

const MAX_SPANS = 1500;
const MAX_LONG_TASKS = 200;
const MAX_HELD_FRAME_RECORDS = 8;
const FRAME_WATCH_PRIORITY = 1e6;

interface OpenSpan {
    name: string;
    kind: BootSpanKind;
    tier: string | null;
    start: number;
    detail?: Record<string, unknown>;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

export function createBootTrace(options: CreateBootTraceOptions = {}): BootTrace {
    const now = options.now ?? (() => performance.now());
    const maxFrames = options.maxFrames ?? 24;
    const spans: BootSpan[] = [];
    const open = new Set<OpenSpan>();
    const listeners = new Set<() => void>();
    const counters: Record<string, number> = {};
    const notes: Record<string, unknown> = {};
    const frames: BootFrameRecord[] = [];
    const longTasks: Array<{ start: number; duration: number }> = [];
    let currentTier: string | null = null;
    let ready: number | null = null;
    let firstFrame: BootTraceSnapshot['firstFrame'] = null;
    let compileTotal = 0;
    let compileLongest = 0;
    /** Frames the scheduler ran with the render phase held (most of the boot). */
    let heldFrameCount = 0;

    if (options.observeLongTasks !== false && typeof PerformanceObserver !== 'undefined') {
        try {
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (longTasks.length < MAX_LONG_TASKS) {
                        longTasks.push({ start: entry.startTime, duration: entry.duration });
                    }
                }
            }).observe({ type: 'longtask', buffered: true });
        } catch {
            /* longtask is Chromium-only; the gate harness has its own observer */
        }
    }

    const notify = () => {
        for (const listener of listeners) listener();
    };

    const measure = (span: BootSpan) => {
        // After `ready` a re-rolled layout spawns through the same code; the
        // timeline entries it would add are not boot and would pile up.
        if (ready !== null) return;
        // performance.measure(name, { start, end, detail }) puts the span on the
        // timeline (and into `blink.user_timing` in a Chromium trace).
        try {
            performance.measure(`boot:${span.kind}:${span.name}`, {
                start: span.start,
                end: span.end,
                detail: span.detail,
            });
        } catch {
            /* no options-style measure, or no performance: the in-memory copy still exists */
        }
    };

    const begin: BootTrace['begin'] = (name, kind, detail) => {
        const record: OpenSpan = {
            name,
            kind,
            tier: kind === 'tier' ? null : currentTier,
            start: now(),
            detail,
        };
        open.add(record);
        notify();
        let ended: BootSpan | null = null;
        return (extra) => {
            if (ended) return ended;
            open.delete(record);
            const end = now();
            const span: BootSpan = {
                name,
                kind,
                tier: record.tier,
                start: record.start,
                end,
                duration: end - record.start,
                detail: extra ? { ...detail, ...extra } : detail,
            };
            ended = span;
            if (kind === 'compile') {
                compileTotal += span.duration;
                compileLongest = Math.max(compileLongest, span.duration);
            }
            // After `ready` only the frame watch keeps recording: a re-rolled
            // layout would otherwise grow this list for the life of the page.
            if (ready === null && spans.length < MAX_SPANS) spans.push(span);
            measure(span);
            notify();
            return span;
        };
    };

    const span: BootTrace['span'] = (name, kind, fn, detail) => {
        const end = begin(name, kind, detail);
        try {
            return fn();
        } catch (error) {
            end({ error: true });
            throw error;
        } finally {
            end();
        }
    };

    const spanAsync: BootTrace['spanAsync'] = async (name, kind, fn, detail) => {
        const end = begin(name, kind, detail);
        try {
            return await fn();
        } catch (error) {
            end({ error: true });
            throw error;
        } finally {
            end();
        }
    };

    const beginTier: BootTrace['beginTier'] = (name) => {
        const end = begin(name, 'tier');
        const previous = currentTier;
        currentTier = name;
        return () => {
            currentTier = previous;
            return end();
        };
    };

    const attributeLongTask = (task: { start: number; duration: number }): BootLongTask => {
        const taskEnd = task.start + task.duration;
        const overlaps: Array<{ name: string; overlap: number }> = [];
        const consider = (name: string, start: number, end: number) => {
            const overlap = Math.min(end, taskEnd) - Math.max(start, task.start);
            if (overlap > 0) overlaps.push({ name, overlap });
        };
        for (const s of spans) {
            // A tier encloses everything inside it; naming it says nothing the prop does not.
            if (s.kind !== 'tier') consider(`${s.kind}:${s.name}`, s.start, s.end);
        }
        for (const f of frames) consider(`frame#${f.n}`, f.at, f.at + f.duration);
        overlaps.sort((a, b) => b.overlap - a.overlap);
        return {
            start: round(task.start),
            duration: round(task.duration),
            during: overlaps.slice(0, 3).map((o) => o.name),
        };
    };

    const attachScheduler: BootTrace['attachScheduler'] = (scheduler, schedOptions = {}) => {
        let frameStart = 0;
        let programsBefore: number | null = null;
        let seen = 0;
        let renderedFrames = 0;
        let heldRecorded = 0;
        const readPrograms = schedOptions.getProgramCount ?? (() => null);
        const startHandle = scheduler.register(
            'preStep',
            'bootTrace:frameStart',
            () => {
                frameStart = now();
                programsBefore = readPrograms();
            },
            { priority: -FRAME_WATCH_PRIORITY }
        );
        const endHandle = scheduler.register(
            'postRender',
            'bootTrace:frameEnd',
            () => {
                const end = now();
                const rendered = !scheduler.isPhaseHeld('render');
                const after = readPrograms();
                const newPrograms =
                    programsBefore !== null && after !== null
                        ? Math.max(0, after - programsBefore)
                        : null;
                seen += 1;
                // The render phase is held for the whole boot, so most frames are
                // "held": keep the first few as a sample (a long held frame means
                // something other than rendering blocked it) and count the rest.
                if (!rendered) {
                    heldFrameCount += 1;
                    if (heldRecorded >= MAX_HELD_FRAME_RECORDS) return;
                    heldRecorded += 1;
                } else {
                    renderedFrames += 1;
                }
                const record: BootFrameRecord = {
                    n: seen,
                    at: round(frameStart),
                    duration: round(end - frameStart),
                    rendered,
                    newPrograms,
                };
                frames.push(record);
                if (rendered && firstFrame === null) {
                    firstFrame = {
                        at: record.at,
                        duration: record.duration,
                        newPrograms: record.newPrograms,
                    };
                    const marker = begin('first-render', 'frame', {
                        newPrograms: record.newPrograms,
                    });
                    marker();
                }
                if (renderedFrames >= maxFrames) {
                    startHandle.dispose();
                    endHandle.dispose();
                }
            },
            { priority: FRAME_WATCH_PRIORITY }
        );
    };

    const snapshot = (): BootTraceSnapshot => {
        const tiers: BootTierSummary[] = spans
            .filter((s) => s.kind === 'tier')
            .map((tierSpan) => {
                const props = spans.filter((s) => s.kind === 'prop' && s.tier === tierSpan.name);
                const slowest = props.reduce<BootSpan | null>(
                    (best, s) => (best === null || s.duration > best.duration ? s : best),
                    null
                );
                const compileMs = spans
                    .filter((s) => s.kind === 'compile' && s.tier === tierSpan.name)
                    .reduce((sum, s) => sum + s.duration, 0);
                return {
                    name: tierSpan.name,
                    start: round(tierSpan.start),
                    end: round(tierSpan.end),
                    duration: round(tierSpan.duration),
                    props: props.length,
                    longestPropMs: round(slowest?.duration ?? 0),
                    longestProp: slowest?.name ?? null,
                    yields: counters[`yields:${tierSpan.name}`] ?? 0,
                    compileMs: round(compileMs),
                };
            });
        const compileSpans = spans.filter((s) => s.kind === 'compile');
        const lastPrograms = [...compileSpans]
            .reverse()
            .map((s) => s.detail?.programsAfter)
            .find((v): v is number => typeof v === 'number');
        return {
            now: round(now()),
            ready: ready === null ? null : round(ready),
            active: [...open].map((s) => `${s.kind}:${s.name}`),
            tiers,
            spans: spans.map((s) => ({
                ...s,
                start: round(s.start),
                end: round(s.end),
                duration: round(s.duration),
            })),
            compile: {
                totalMs: round(compileTotal),
                longestMs: round(compileLongest),
                programs: lastPrograms ?? null,
                passes: compileSpans.length,
            },
            firstFrame,
            frames: frames.slice(),
            longTasks: longTasks.map(attributeLongTask),
            counters: { ...counters, heldFrames: heldFrameCount },
            notes: { ...notes },
        };
    };

    const format = (): string => {
        const snap = snapshot();
        const lines: string[] = [];
        const sec = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
        if (snap.active.length > 0) lines.push(`now: ${snap.active.join(' › ')}`);
        for (const tier of snap.tiers) {
            lines.push(
                `${tier.name.padEnd(8)} ${sec(tier.duration).padStart(7)}  ` +
                    `${String(tier.props).padStart(3)} props, slowest ${Math.round(tier.longestPropMs)}ms` +
                    (tier.longestProp ? ` (${tier.longestProp})` : '') +
                    `, ${tier.yields} yields, compile ${Math.round(tier.compileMs)}ms`
            );
        }
        if (snap.compile.passes > 0) {
            lines.push(
                `compile  ${sec(snap.compile.totalMs).padStart(7)}  longest ` +
                    `${Math.round(snap.compile.longestMs)}ms` +
                    (snap.compile.programs !== null ? `, ${snap.compile.programs} programs` : '')
            );
        }
        if (snap.firstFrame) {
            lines.push(
                `1st frame at ${sec(snap.firstFrame.at)} (${Math.round(snap.firstFrame.duration)}ms` +
                    (snap.firstFrame.newPrograms !== null
                        ? `, ${snap.firstFrame.newPrograms} new programs`
                        : '') +
                    ')'
            );
        }
        if (snap.ready !== null) lines.push(`ready at ${sec(snap.ready)}`);
        const slowest = snap.longTasks.slice().sort((a, b) => b.duration - a.duration)[0];
        if (slowest) {
            lines.push(
                `longest task ${Math.round(slowest.duration)}ms @ ${sec(slowest.start)}` +
                    (slowest.during.length ? ` (${slowest.during.join(', ')})` : '')
            );
        }
        return lines.join('\n');
    };

    return {
        begin,
        span,
        spanAsync,
        beginTier,
        mark(name, detail) {
            const at = now();
            try {
                performance.mark(`boot:${name}`, { startTime: at, detail });
            } catch {
                /* see measure() */
            }
        },
        count(name, delta = 1) {
            counters[name] = (counters[name] ?? 0) + delta;
        },
        note(key, value) {
            notes[key] = value;
        },
        markReady() {
            if (ready !== null) return;
            ready = now();
            try {
                performance.mark('boot:ready', { startTime: ready });
            } catch {
                /* see measure() */
            }
            notify();
        },
        attachScheduler,
        snapshot,
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        format,
    };
}

let shared: BootTrace | null = null;

/** The page's one trace; every boot module records into it. */
export function getBootTrace(): BootTrace {
    shared ??= createBootTrace();
    return shared;
}

/** Test hook: drop the shared trace so the next `getBootTrace()` starts empty. */
export function resetBootTrace(): void {
    shared = null;
}
