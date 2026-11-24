/**
 * Pure analysis for `verify-perf-soak.mjs` (no browser, unit-tested): percentiles
 * for frame times and a growth detector for resource counters.
 */

/** Linear-interpolated percentile of `values` (any order); `p` in [0, 100]. */
export function percentile(values, p) {
    if (!values.length) return NaN;
    const sorted = Float64Array.from(values).sort();
    if (sorted.length === 1) return sorted[0];
    const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function median(values) {
    return percentile(values, 50);
}

/** Frame-interval summary in milliseconds (+ the median-based fps). */
export function summarizeFrames(deltasMs) {
    const count = deltasMs.length;
    if (!count) return { count: 0, mean: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN, fps: NaN };
    let sum = 0;
    let max = 0;
    for (const d of deltasMs) {
        sum += d;
        if (d > max) max = d;
    }
    const p50 = percentile(deltasMs, 50);
    return {
        count,
        mean: sum / count,
        p50,
        p95: percentile(deltasMs, 95),
        p99: percentile(deltasMs, 99),
        max,
        fps: p50 > 0 ? 1000 / p50 : NaN,
    };
}

/** Least-squares slope of `values` against their index. */
export function linearSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    const meanX = (n - 1) / 2;
    let meanY = 0;
    for (const v of values) meanY += v;
    meanY /= n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - meanX) * (values[i] - meanY);
        den += (i - meanX) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

/**
 * Did a counter grow across the run, beyond what is allowed?
 *
 * Compares the median of the first quarter of samples with the median of the
 * last quarter (endpoints would let one noisy sample decide), and requires the
 * least-squares trend to point upward too, so a dip-and-recover is not a leak
 * and a flat series with one noisy tail is not either.
 *
 * @param {number[]} samples      taken at the same point of each cycle, after warm-up
 * @param {{ tolerance: number, minSamples?: number }} options  `tolerance` is in the metric's own unit
 */
export function detectGrowth(samples, { tolerance, minSamples = 4 }) {
    const values = samples.filter((v) => Number.isFinite(v));
    if (values.length < minSamples) {
        return {
            ok: true,
            skipped: true,
            reason: `only ${values.length} samples (< ${minSamples})`,
        };
    }
    const q = Math.max(1, Math.floor(values.length / 4));
    const first = median(values.slice(0, q));
    const last = median(values.slice(-q));
    const growth = last - first;
    const slope = linearSlope(values);
    const ok = !(growth > tolerance && slope > 0);
    return {
        ok,
        skipped: false,
        first,
        last,
        growth,
        slope,
        tolerance,
        reason: ok
            ? `grew ${growth.toFixed(2)} (allowed ${tolerance})`
            : `grew ${growth.toFixed(2)} > ${tolerance} with an upward trend (${slope.toFixed(3)}/sample)`,
    };
}

/**
 * Frame-time degradation between the first and last windows of rolls: a run that
 * gets slower as it goes is the other face of a leak. `maxRatio` of 1.35 allows
 * a 35% worse p95 (noise on shared runners) before failing.
 */
export function detectDegradation(firstWindowMs, lastWindowMs, { maxRatio = 1.35 } = {}) {
    const a = summarizeFrames(firstWindowMs);
    const b = summarizeFrames(lastWindowMs);
    if (!a.count || !b.count) return { ok: true, skipped: true, reason: 'no frames in a window' };
    const ratio = b.p95 / a.p95;
    return {
        ok: !(ratio > maxRatio),
        skipped: false,
        firstP95: a.p95,
        lastP95: b.p95,
        ratio,
        reason: `p95 ${a.p95.toFixed(1)} ms -> ${b.p95.toFixed(1)} ms (x${ratio.toFixed(2)}, allowed x${maxRatio})`,
    };
}
