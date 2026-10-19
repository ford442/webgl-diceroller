#!/usr/bin/env node
/**
 * Fail the build if packages/dice-core grows a Three.js or DOM-document import,
 * or if app code hides the package behind a re-export barrel.
 *
 * The compiler already enforces most of this (packages/dice-core/tsconfig.json
 * has no DOM lib, `tsc -p packages/dice-core` runs in `npm run typecheck`); this
 * grep is the cheap, fast first line and also covers `.js` and barrels.
 * `window` / `document` as *identifiers* in typeof checks are allowed;
 * module specifiers named `three`, and identifier imports of `document`
 * from a module, are not.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'src');
const PACKAGE = path.join(REPO_ROOT, 'packages', 'dice-core');
const ROOT = path.join(PACKAGE, 'src');

const FORBIDDEN_SPECIFIERS = [
    /from\s+['"]three(?:\/[^'"]*)?['"]/,
    /import\s+['"]three(?:\/[^'"]*)?['"]/,
    /import\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\)/,
    /require\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\)/,
    /from\s+['"][^'"]*\/three['"]/,
];

const FORBIDDEN_IMPORT_BINDINGS = [
    /import\s+document\s+from/,
    /import\s+\*\s+as\s+document\s+from/,
    /import\s+\{[^}]*\bdocument\b[^}]*\}\s+from/,
];

const FORBIDDEN_IDENTIFIERS = [/\bdocument\./, /\bdocument\[/, /\bwindow\./, /\bwindow\[/];

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else if (/\.(js|mjs|ts)$/.test(entry.name)) files.push(full);
    }
    return files;
}

const files = await walk(ROOT);
const violations = [];

for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const re of FORBIDDEN_SPECIFIERS) {
        if (re.test(source)) {
            violations.push(`${rel}: forbidden module specifier matching ${re}`);
        }
    }
    for (const re of FORBIDDEN_IMPORT_BINDINGS) {
        if (re.test(source)) {
            violations.push(`${rel}: forbidden document import binding matching ${re}`);
        }
    }
    // host.d.ts declares the (non-DOM) host surface; it names no DOM globals.
    // Allow `typeof window` / `typeof document` and comments.
    const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/typeof\s+window/g, 'typeof _global')
        .replace(/typeof\s+document/g, 'typeof _doc');
    for (const re of FORBIDDEN_IDENTIFIERS) {
        if (re.test(stripped)) {
            violations.push(`${rel}: forbidden DOM global matching ${re}`);
        }
    }
}

// A module in src/ whose whole body is `export * from 'dice-core…'` (or the old
// relative `…/core-engine/…`) hides the package boundary from its importers.
// Call sites import dice-core directly instead.
const PASSTHROUGH_LINE =
    /^export\s+(?:type\s+)?\*\s+from\s+['"](?:dice-core(?:\/[^'"]*)?|[^'"]*\/core-engine\/[^'"]*)['"];?$/;
const shellFiles = await walk(SRC);
for (const file of shellFiles) {
    const lines = (await readFile(file, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length && lines.every((l) => PASSTHROUGH_LINE.test(l))) {
        violations.push(
            `${path.relative(REPO_ROOT, file)}: re-export barrel of dice-core — import dice-core directly`
        );
    }
}

// The package must not depend on the app (or on three) to build.
const pkg = JSON.parse(await readFile(path.join(PACKAGE, 'package.json'), 'utf8'));
for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (dep === 'three' || dep.startsWith('@types/three')) {
        violations.push(`packages/dice-core/package.json: depends on ${dep}`);
    }
}
const tsconfig = await readFile(path.join(PACKAGE, 'tsconfig.json'), 'utf8');
if (/"lib"\s*:\s*\[[^\]]*"DOM/i.test(tsconfig)) {
    violations.push('packages/dice-core/tsconfig.json: lib must not include DOM');
}

if (violations.length) {
    console.error(
        '[check:dice-core] isolation failed:\n' + violations.map((v) => `  - ${v}`).join('\n')
    );
    process.exit(1);
}

console.log(
    `[check:dice-core] ${files.length} files in packages/dice-core/src are three/DOM-import free; ` +
        `no dice-core re-export barrels in the ${shellFiles.length} src/ files.`
);
