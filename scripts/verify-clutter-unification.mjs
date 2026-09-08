#!/usr/bin/env node
/**
 * Verifies the unified prop-authoring path end to end in a real browser:
 *
 * 1. The clutter registry spawns the shared prop modules (`Mug`, `Pencil`,
 *    `Key`, `Spyglass`, `Miniature`, `SmokingPipe`, `DMScreen`) rather than the
 *    deleted `clutter/*` twins.
 * 2. Merged clutter geometry stays coincident with its prop root — the
 *    StaticPropMerger regression that offset merged meshes by the root's own
 *    transform.
 * 3. The WebGPU-only accent light rig stays inert on the WebGL baseline.
 *
 * Usage: npm run preview & node scripts/verify-clutter-unification.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runTest } = require('../tests/helpers/browser.js');

const SHARED_PROP_NAMES = [
    'EnhancedMug',
    'Pencil',
    'Key',
    'Spyglass',
    'Miniature',
    'SmokingPipe',
    'DMScreen',
];

// A fixed seed + max clutter count so every registry entry gets a fair chance.
const URL = 'http://localhost:4173/?webgl&no-post&test&layout-seed=8&clutter-count=10&density=high';

runTest(async (page, errors) => {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Tier loading runs long after first paint under swiftshader, and the page
    // keeps a render loop going, so `networkidle` never settles here.
    await page.waitForFunction(() => window.__app?.ready === true, null, { timeout: 120000 });

    const report = await page.evaluate((sharedNames) => {
        const scene = window.__app.scene;

        /** Roots the clutter pass produced, by prop-module name. */
        const found = [];
        /** Merged children that drifted from their root's own transform. */
        const drifted = [];

        scene.traverse((obj) => {
            if (!obj.isGroup || !sharedNames.includes(obj.name)) return;
            found.push(obj.name);
        });

        scene.updateMatrixWorld(true);

        // Every clutter root is stamped with its registry id by RandomClutter.
        const clutterRoots = [];
        scene.traverse((obj) => {
            if (obj.userData?.clutterId) clutterRoots.push(obj);
        });

        // The StaticPropMerger bug baked matrixWorld into geometry that was then
        // re-parented under the (already transformed) root, throwing merged
        // geometry to roughly twice the prop's slot offset. Clutter props are
        // small and centred on their root, so a merged batch whose bounds sit
        // far from the root origin — or outside the 36x36 tabletop — is that bug.
        const TABLE_HALF = 18;

        for (const root of clutterRoots) {
            for (const obj of root.children.flatMap((c) => c.children ?? [])) {
                if (!obj.isMesh || !obj.userData.mergedStatic) continue;

                obj.geometry.computeBoundingBox();
                const { min, max } = obj.geometry.boundingBox;

                // Local bbox centre pushed through matrixWorld by hand, so the
                // page needs no THREE handle. Elements are column-major.
                const lx = (min.x + max.x) / 2;
                const ly = (min.y + max.y) / 2;
                const lz = (min.z + max.z) / 2;
                const e = obj.matrixWorld.elements;
                const cx = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
                const cy = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
                const cz = e[2] * lx + e[6] * ly + e[10] * lz + e[14];

                const r = root.matrixWorld.elements;
                const dx = cx - r[12];
                const dy = cy - r[13];
                const dz = cz - r[14];
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                const radius =
                    Math.sqrt((max.x - min.x) ** 2 + (max.y - min.y) ** 2 + (max.z - min.z) ** 2) /
                    2;

                const offRoot = distance > radius + 1;
                const offTable = Math.abs(cx) > TABLE_HALF || Math.abs(cz) > TABLE_HALF;

                if (offRoot || offTable) {
                    drifted.push({
                        root: `${root.userData.clutterId} (${root.name || 'unnamed'})`,
                        distance: Number(distance.toFixed(3)),
                        allowed: Number((radius + 1).toFixed(3)),
                        offTable,
                    });
                }
            }
        }

        return {
            found,
            clutterRootCount: clutterRoots.length,
            mergedBatches: clutterRoots.reduce(
                (n, root) =>
                    n +
                    root.children
                        .flatMap((c) => c.children ?? [])
                        .filter((o) => o.isMesh && o.userData.mergedStatic).length,
                0
            ),
            drifted,
            accentEnabled: window.__app.postConfig?.accentLightsEnabled,
            rectAreaLightCount: scene.children.filter((c) => c.isRectAreaLight).length,
        };
    }, SHARED_PROP_NAMES);

    let pass = true;

    if (report.found.length === 0) {
        console.error('FAIL: no shared prop modules found in the scene');
        pass = false;
    } else {
        console.log(`ok: shared prop modules spawned — ${[...new Set(report.found)].join(', ')}`);
    }

    if (report.clutterRootCount === 0) {
        console.error('FAIL: no clutter roots tagged with a registry id');
        pass = false;
    }

    if (report.drifted.length > 0) {
        console.error('FAIL: merged clutter geometry drifted from its prop root:');
        for (const d of report.drifted) {
            console.error(
                `  ${d.root}: ${d.distance} away (allowed ${d.allowed})` +
                    (d.offTable ? ' — and off the tabletop' : '')
            );
        }
        pass = false;
    } else {
        console.log(
            `ok: ${report.mergedBatches} merged batch(es) across ` +
                `${report.clutterRootCount} clutter roots stay on their prop roots`
        );
    }

    if (report.accentEnabled !== false || report.rectAreaLightCount !== 0) {
        console.error(
            `FAIL: accent rig active on the WebGL baseline ` +
                `(enabled=${report.accentEnabled}, rectAreaLights=${report.rectAreaLightCount})`
        );
        pass = false;
    } else {
        console.log('ok: accent light rig inert on ?webgl');
    }

    if (errors.length > 0) {
        console.error(`FAIL: ${errors.length} console/page error(s)`);
        pass = false;
    }

    return pass;
});
