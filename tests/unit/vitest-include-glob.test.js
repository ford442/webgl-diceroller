/**
 * Regression guard: vitest.config.js's `test.include` glob must match every
 * `*.test.*` file actually present under tests/unit/. The include used to be
 * hardcoded to `**\/*.test.js`, so a `tests/unit/foo.test.ts` file silently
 * ran zero tests (vitest reports success having executed nothing) instead of
 * failing loudly. This test fails the moment a new test-file extension shows
 * up that the glob doesn't cover.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unitDir = path.resolve(__dirname);

function listTestFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            files.push(...listTestFiles(path.join(dir, entry.name)));
        } else if (/\.test\.[^.]+$/.test(entry.name)) {
            files.push(entry.name);
        }
    }
    return files;
}

function extensionsFromIncludeGlob(include) {
    // e.g. 'tests/unit/**/*.test.{js,ts,mjs}' -> ['js', 'ts', 'mjs']
    const m = /\.test\.\{([^}]+)\}$/.exec(include) ?? /\.test\.([^.{}*]+)$/.exec(include);
    if (!m) throw new Error(`Could not parse extensions from include glob "${include}"`);
    return m[1].split(',');
}

describe('vitest include glob', () => {
    it('covers the extension of every *.test.* file under tests/unit/', () => {
        const includePatterns = vitestConfig.test.include;
        expect(Array.isArray(includePatterns)).toBe(true);

        const coveredExtensions = new Set(includePatterns.flatMap(extensionsFromIncludeGlob));
        const testFiles = listTestFiles(unitDir);
        expect(testFiles.length).toBeGreaterThan(0);

        const uncovered = testFiles.filter((name) => {
            const ext = name.split('.').pop();
            return !coveredExtensions.has(ext);
        });

        expect(uncovered).toEqual([]);
    });
});
