#!/usr/bin/env node
/**
 * Fail the build if src/core-engine grows a Three.js or DOM-document import.
 * `window` / `document` as *identifiers* in typeof checks are allowed;
 * module specifiers named `three`, and identifier imports of `document`
 * from a module, are not.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core-engine');

const FORBIDDEN_SPECIFIERS = [
    /from\s+['"]three(?:\/[^'"]*)?['"]/,
    /import\s*\(\s*['"]three(?:\/[^'"]*)?['"]\s*\)/,
    /from\s+['"][^'"]*\/three['"]/,
];

const FORBIDDEN_IDENTIFIERS = [/\bdocument\./, /\bdocument\[/, /\bwindow\./, /\bwindow\[/];

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else if (/\.(js|ts|d\.ts)$/.test(entry.name)) files.push(full);
    }
    return files;
}

const files = await walk(ROOT);
const violations = [];

for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(path.dirname(ROOT), file);
    for (const re of FORBIDDEN_SPECIFIERS) {
        if (re.test(source)) {
            violations.push(`${rel}: forbidden module specifier matching ${re}`);
        }
    }
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

if (violations.length) {
    console.error(
        '[check:core-engine] isolation failed:\n' + violations.map((v) => `  - ${v}`).join('\n')
    );
    process.exit(1);
}

console.log(
    `[check:core-engine] ${files.length} files in src/core-engine/ are three/DOM-import free.`
);
