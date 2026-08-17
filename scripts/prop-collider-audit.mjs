#!/usr/bin/env node
/**
 * Audit environment prop factories for collider migration status.
 *
 * Usage: node scripts/prop-collider-audit.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_DIR = path.resolve(__dirname, '../src/environment');
const jsonOut = process.argv.includes('--json');

/** @param {string} dir */
function walkJs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkJs(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const ENVIRONMENT_SHELL = new Set([
    'src/environment/Atmosphere.js',
    'src/environment/Clutter.js',
    'src/environment/DecorativeWalls.js',
    'src/environment/DiceCup.js',
    'src/environment/Fire.js',
    'src/environment/FloatingCandles.js',
    'src/environment/Lamp.js',
    'src/environment/RandomClutter.js',
    'src/environment/Room.js',
    'src/environment/RoomEnvironment.js',
    'src/environment/Rug.js',
    'src/environment/Runecircle.js',
    'src/environment/Table.js',
    'src/environment/TavernEnvironment.js',
]);

const INFRASTRUCTURE = new Set([
    'src/environment/PropPhysics.js',
    'src/environment/PropLifecycle.js',
    'src/environment/propKit.js',
    'src/environment/PropRegistry.js',
    'src/environment/propRegistry/factories.js',
    'src/environment/propRegistry/entryHelpers.js',
    'src/environment/propRegistry/propIndex.js',
    'src/environment/propRegistry/randomPool.js',
    'src/environment/propRegistry/shadowPolicy.js',
    'src/environment/propRegistry/spawn.js',
    'src/environment/propRegistry/tierDefinitions.js',
    'src/environment/clutter/ClutterPlacement.js',
]);

/** @param {string} src */
function analyzeFile(filePath, src) {
    const rel = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');
    if (INFRASTRUCTURE.has(rel)) {
        return { file: rel, category: 'infrastructure', factory: '(infra)' };
    }
    const factoryMatch = src.match(/export function (create[A-Za-z0-9_]+)/);
    const factory = factoryMatch?.[1] ?? '(none)';

    const usesPropKit = /from ['"]\.\/propKit\.js['"]/.test(src) || /from ['"]\.\.\/propKit\.js['"]/.test(src);
    const usesStaticBridge = /createStaticCollider/.test(src);
    const usesCreateProp = /\bcreateProp\s*\(/.test(src) && !rel.endsWith('propKit.js');
    const usesPropPhysics =
        /from ['"]\.\/PropPhysics\.js['"]/.test(src) || /from ['"]\.\.\/PropPhysics\.js['"]/.test(src);
    const usesPhysicsJs = /from ['"]\.\.\/physics\.js['"]/.test(src);

    const colliderTypes = [];
    for (const type of ['box', 'cylinder', 'openCylinder', 'plane', 'convexHull', 'compound']) {
        if (new RegExp(`type:\\s*['"]${type}['"]`).test(src)) colliderTypes.push(type);
    }
    for (const ammo of ['btBoxShape', 'btCylinderShape', 'btSphereShape', 'btCompoundShape', 'btStaticPlaneShape', 'btConvexHullShape']) {
        if (src.includes(ammo)) colliderTypes.push(ammo);
    }

    const hasInteract = /\binteract\b/.test(src) && /return\s*\{[^}]*interact/.test(src);
    const hasUpdate = /\bfunction update\b/.test(src) || /\bupdate\s*[,:]/.test(src);

    let category = 'visual-only';
    if ((usesCreateProp && usesPropKit) || usesStaticBridge) category = 'propKit';
    else if (usesPropPhysics) category = 'legacy-ammo';

    return {
        file: rel,
        factory,
        category,
        usesCreateProp,
        usesPropKit,
        usesPropPhysics,
        usesPhysicsJs,
        colliderTypes: [...new Set(colliderTypes)],
        hasInteract,
        hasUpdate,
    };
}

const files = walkJs(ENV_DIR);
const rows = files.map((f) => analyzeFile(f, fs.readFileSync(f, 'utf8')));

const props = rows.filter((r) => r.category !== 'infrastructure');
const targetProps = props.filter((r) => !ENVIRONMENT_SHELL.has(r.file));
const propKitCount = props.filter((r) => r.category === 'propKit').length;
const targetMigrated = targetProps.filter((r) => r.category === 'propKit').length;
const legacyCount = props.filter((r) => r.category === 'legacy-ammo').length;
const visualCount = props.filter((r) => r.category === 'visual-only').length;
const migratedPct = props.length ? Math.round((propKitCount / props.length) * 100) : 0;
const targetPct = targetProps.length ? Math.round((targetMigrated / targetProps.length) * 100) : 0;

if (jsonOut) {
    console.log(
        JSON.stringify(
            { summary: { propKitCount, legacyCount, visualCount, migratedPct, targetPct, targetMigrated, targetTotal: targetProps.length, total: props.length }, rows },
            null,
            2
        )
    );
    process.exit(0);
}

console.log('Prop collider audit');
console.log('=====================');
console.log(`propKit (migrated):  ${propKitCount}`);
console.log(`legacy-ammo:           ${legacyCount}`);
console.log(`visual-only:           ${visualCount}`);
console.log(`migration coverage:    ${migratedPct}% (all factories)`);
console.log(`tabletop prop coverage: ${targetPct}% (${targetMigrated}/${targetProps.length} excl. environment shell)`);
console.log('');

const byCategory = {
    'propKit': [],
    'legacy-ammo': [],
    'visual-only': [],
};
for (const row of props) byCategory[row.category].push(row);

for (const [cat, list] of Object.entries(byCategory)) {
    console.log(`\n## ${cat} (${list.length})`);
    for (const row of list.sort((a, b) => a.file.localeCompare(b.file))) {
        const hooks = [row.hasUpdate && 'update', row.hasInteract && 'interact'].filter(Boolean).join(',');
        const types = row.colliderTypes.length ? row.colliderTypes.join('|') : '—';
        console.log(`  ${row.factory.padEnd(22)} ${row.file}`);
        console.log(`    colliders: ${types}${hooks ? `  hooks: ${hooks}` : ''}`);
    }
}
