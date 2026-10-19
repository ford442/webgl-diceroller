#!/usr/bin/env node
/**
 * assert-no-skipped-tests.mjs — fail when a vitest JSON report holds skipped,
 * pending or todo tests, or no tests at all.
 *
 *   node scripts/assert-no-skipped-tests.mjs coverage/dice-core-results.json
 *
 * Used by `npm run test:core:coverage` (CI job unit-wasm). A test that skips
 * because the WASM artifacts are missing reports green having checked
 * nothing; that is how rollHeadless went broken in Node without CI noticing.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: assert-no-skipped-tests.mjs <vitest-json-report>');
    process.exit(2);
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const notRun = [];
let total = 0;
for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
        total += 1;
        if (test.status !== 'passed' && test.status !== 'failed') {
            notRun.push(`${test.status}: ${test.fullName ?? test.title}`);
        }
    }
}

if (total === 0) {
    console.error(`[assert-no-skipped-tests] ${file} reports no tests at all.`);
    process.exit(1);
}
if (notRun.length) {
    console.error(
        `[assert-no-skipped-tests] ${notRun.length} of ${total} tests did not run:\n  ` +
            notRun.join('\n  ')
    );
    process.exit(1);
}
console.log(`[assert-no-skipped-tests] ${total} tests, none skipped.`);
