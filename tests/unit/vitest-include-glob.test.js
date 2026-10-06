/**
 * Regression guard: every `*.test.*` file under tests/unit/ and
 * packages/dice-core/test/ must be picked up by exactly one vitest project.
 * The include used to be hardcoded to `**\/*.test.js`, so a `foo.test.ts`
 * silently ran zero tests (vitest reports success having executed nothing)
 * instead of failing loudly. With projects, a file can also fall between
 * them (e.g. a `.wasm.test.ts` outside dice-core) — this catches both.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_ROOTS = ['tests/unit', 'packages/dice-core/test'];

function listTestFiles(dir) {
    const files = [];
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) files.push(...listTestFiles(rel));
        else if (/\.test\.[^.]+$/.test(entry.name)) files.push(rel);
    }
    return files;
}

const matchesAny = (file, globs = []) => globs.some((glob) => path.matchesGlob(file, glob));

describe('vitest projects', () => {
    it('run every *.test.* file exactly once', () => {
        const projects =
            /** @type {{ test: { name: string, include?: string[], exclude?: string[] } }[]} */ (
                vitestConfig.test?.projects
            );
        expect(projects.map((p) => p.test.name)).toEqual(['dice-core', 'dice-core-wasm', 'ui']);

        const testFiles = TEST_ROOTS.flatMap(listTestFiles);
        expect(testFiles.length).toBeGreaterThan(0);

        const owners = testFiles.map((file) => ({
            file,
            projects: projects
                .filter(
                    (p) => matchesAny(file, p.test.include) && !matchesAny(file, p.test.exclude)
                )
                .map((p) => p.test.name),
        }));
        expect(owners.filter((o) => o.projects.length !== 1)).toEqual([]);
    });

    it('keep compiled-engine tests in the project that cannot skip them', () => {
        const wasmTests = TEST_ROOTS.flatMap(listTestFiles).filter((f) =>
            f.includes('.wasm.test.')
        );
        expect(wasmTests.length).toBeGreaterThan(0);
        expect(wasmTests.every((f) => f.startsWith('packages/dice-core/test/'))).toBe(true);
    });
});
