/**
 * compare-solver-bench.mjs — Warn-only check of bench_json lines against baselines.
 *
 * Usage:
 *   node scripts/compare-solver-bench.mjs bench-results.txt
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('Usage: node scripts/compare-solver-bench.mjs <bench-results.txt>');
    process.exit(1);
}

const baselinesPath = path.join(REPO_ROOT, 'scripts/solver-bench-baselines.json');
const text = await readFile(inputPath, 'utf8');
const baselines = JSON.parse(await readFile(baselinesPath, 'utf8'));

let warnings = 0;
for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('bench_json ')) continue;
    const jsonText = trimmed.slice('bench_json '.length);
    let row;
    try {
        row = JSON.parse(jsonText);
    } catch {
        console.warn('[compare-solver-bench] Skipping malformed bench_json line');
        continue;
    }
    const profile = baselines.profiles?.[row.profile];
    if (!profile) continue;
    const budget = profile[String(row.dice)];
    if (!budget?.us_per_step_warn) continue;
    if (row.us_per_step > budget.us_per_step_warn) {
        warnings++;
        console.warn(
            `[compare-solver-bench] WARN ${row.profile} dice=${row.dice}: ` +
                `${row.us_per_step.toFixed(1)} us/step > budget ${budget.us_per_step_warn} us/step`
        );
    }
}

if (warnings === 0) {
    console.log('[compare-solver-bench] All bench rows within informational budgets.');
} else {
    console.warn(
        `[compare-solver-bench] ${warnings} row(s) exceeded warn thresholds (informational).`
    );
}
