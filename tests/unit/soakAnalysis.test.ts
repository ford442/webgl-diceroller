import { describe, expect, it } from 'vitest';
import {
    detectDegradation,
    detectGrowth,
    linearSlope,
    percentile,
    summarizeFrames,
    // @ts-expect-error plain .mjs without types
} from '../../scripts/lib/soakAnalysis.mjs';

const ramp = (n: number, from: number, step: number) =>
    Array.from({ length: n }, (_, i) => from + i * step);

describe('percentile / summarizeFrames', () => {
    it('interpolates', () => {
        expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
        expect(percentile([10, 20], 50)).toBe(15);
        expect(percentile([5], 99)).toBe(5);
        expect(percentile([], 50)).toBeNaN();
    });

    it('summarises frame intervals', () => {
        const s = summarizeFrames([16, 16, 16, 16, 100]);
        expect(s.p50).toBe(16);
        expect(s.max).toBe(100);
        expect(s.fps).toBeCloseTo(62.5);
        expect(s.p99).toBeGreaterThan(s.p95 - 1e-9);
    });
});

describe('linearSlope', () => {
    it('is the per-sample gradient', () => {
        expect(linearSlope(ramp(10, 5, 2))).toBeCloseTo(2);
        expect(linearSlope([4, 4, 4, 4])).toBe(0);
        expect(linearSlope([1])).toBe(0);
    });
});

describe('detectGrowth', () => {
    it('passes a flat series, with or without noise', () => {
        expect(detectGrowth([100, 100, 100, 100, 100, 100, 100, 100], { tolerance: 0 }).ok).toBe(
            true
        );
        expect(detectGrowth([100, 103, 99, 101, 100, 102, 98, 101], { tolerance: 5 }).ok).toBe(
            true
        );
    });

    it('fails steady growth beyond the tolerance', () => {
        const r = detectGrowth(ramp(10, 100, 5), { tolerance: 20 });
        expect(r.ok).toBe(false);
        expect(r.growth).toBeGreaterThan(20);
    });

    it('allows growth within the tolerance', () => {
        expect(detectGrowth(ramp(10, 100, 1), { tolerance: 20 }).ok).toBe(true);
    });

    it('is strict at zero tolerance for counters that must not move', () => {
        expect(detectGrowth([40, 40, 40, 40, 41, 41, 42, 42], { tolerance: 0 }).ok).toBe(false);
        expect(detectGrowth([40, 40, 40, 40, 40, 40, 40, 40], { tolerance: 0 }).ok).toBe(true);
    });

    it('does not call a dip-and-recover a leak, nor a falling series', () => {
        expect(detectGrowth([100, 100, 70, 80, 90, 100, 100, 100], { tolerance: 0 }).ok).toBe(true);
        expect(detectGrowth(ramp(10, 200, -5), { tolerance: 0 }).ok).toBe(true);
    });

    it('skips (passes, flagged) when there are too few samples', () => {
        const r = detectGrowth([1, 50], { tolerance: 0 });
        expect(r.ok).toBe(true);
        expect(r.skipped).toBe(true);
    });

    it('ignores non-finite samples (a metric the renderer does not report)', () => {
        expect(detectGrowth([NaN, NaN, NaN, NaN, NaN], { tolerance: 0 }).skipped).toBe(true);
    });
});

describe('detectDegradation', () => {
    const steady = Array.from({ length: 200 }, (_, i) => 16 + (i % 5));
    it('passes similar windows', () => {
        expect(detectDegradation(steady, steady).ok).toBe(true);
    });
    it('fails a window that got much slower', () => {
        const slower = steady.map((v) => v * 2);
        const r = detectDegradation(steady, slower);
        expect(r.ok).toBe(false);
        expect(r.ratio).toBeGreaterThan(1.35);
    });
    it('passes (skipped) when a window is empty', () => {
        expect(detectDegradation([], steady).skipped).toBe(true);
    });
});
