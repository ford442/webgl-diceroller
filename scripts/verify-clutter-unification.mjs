#!/usr/bin/env node
/**
 * Verifies the unified prop-authoring path end to end in a real browser:
 *
 * 1. The clutter registry spawns the shared prop modules (`Mug`, `Pencil`,
 *    `Key`, `Spyglass`, `Miniature`, `SmokingPipe`, `DMScreen`, `Quill`,
 *    `Book`, `D20Holder`, `Gemstone`, `PotionBottle`, `Parchment`,
 *    `WantedPoster`, `TarotCards`) rather than a per-clutter `clutter/*` twin.
 * 2. Merged clutter geometry stays coincident with its prop root — the
 *    StaticPropMerger regression that offset merged meshes by the root's own
 *    transform.
 * 3. The WebGPU-only accent light rig stays inert on the WebGL baseline.
 * 4. A die impulse knocks the (forced) dynamic Mug and `DynamicPropSync`
 *    carries the WASM dynamic body's new transform onto the mesh.
 *
 * Usage: npm run preview & node scripts/verify-clutter-unification.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runTest } = require('../tests/helpers/browser.js');
const { BASE } = require('../tests/helpers/server.js');

const SHARED_PROP_NAMES = [
    'Mug',
    'Pencil',
    'Key',
    'Spyglass',
    'Miniature',
    'SmokingPipe',
    'DMScreen',
    'Quill',
    'Book',
    'D20Holder',
    'Gemstone',
    'PotionBottle',
    'Parchment',
    'WantedPoster',
    'TarotCards',
];

// A fixed seed + max clutter count so every registry entry gets a fair chance.
// `forceProps=Mug` guarantees a dynamic Mug spawns via the tier registry (at
// its fixed tier2 slot) regardless of what the clutter weighted draw picks,
// so the knock check below always has a target.
const URL =
    `${BASE}/?webgl&no-post&test&layout-seed=8&clutter-count=10&density=high` + `&forceProps=Mug`;

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

    // --- dynamic prop knock: a die impulse should move the Mug's WASM dynamic
    // body, and DynamicPropSync should carry that transform onto the mesh. ---
    await page.evaluate(() => {
        for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
            const input = document.getElementById(`dice-count-${type}`);
            if (!input) continue;
            input.value = type === 'd6' ? '1' : '0';
            input.dispatchEvent(new Event('change'));
        }
    });
    await page.waitForFunction(() => window.__app.dice?.areDiceSettled?.() === true, null, {
        timeout: 60000,
        polling: 100,
    });

    const knock = await page.evaluate(async () => {
        const app = window.__app;
        if (!app.isWasmAvailable?.()) return { skipped: 'wasm unavailable' };

        const engine = app.getWasmEngine();
        let mugGroup = null;
        app.scene.traverse((obj) => {
            if (!mugGroup && obj.name === 'Mug' && obj.userData?.isDynamicProp) {
                mugGroup = obj;
            }
        });
        if (!mugGroup) return { error: 'no dynamic Mug found in scene' };

        const dieIds = engine.getDieIds?.();
        if (!dieIds || dieIds.length === 0) return { error: 'no dice spawned' };
        const dieId = Math.round(dieIds[0]);

        const before = mugGroup.position.clone();
        const mugWorldPos = mugGroup.getWorldPosition(new app.THREE.Vector3());

        // Teleport the die to overlap the Mug's collider with a strong velocity
        // toward it, so the next physics steps produce a real contact impulse.
        engine.setDieKinematic(dieId, false);
        engine.setDieTransform(
            dieId,
            mugWorldPos.x + 0.3,
            mugWorldPos.y + 1.5,
            mugWorldPos.z,
            0,
            0,
            0,
            1
        );
        engine.setDieVelocity(dieId, -3, -6, 0, 0, 0, 0);

        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
        for (let i = 0; i < 90; i++) await frame();

        const after = mugGroup.position.clone();
        return { displacement: before.distanceTo(after) };
    });

    if (knock.skipped) {
        console.log(`skip: dynamic-prop knock check (${knock.skipped})`);
    } else if (knock.error) {
        console.error(`FAIL: dynamic-prop knock check could not run — ${knock.error}`);
        pass = false;
    } else if (knock.displacement > 0.05) {
        console.log(
            `ok: die impulse moved the dynamic Mug ${knock.displacement.toFixed(3)} units ` +
                `(DynamicPropSync carried the WASM transform onto the mesh)`
        );
    } else {
        console.error(
            `FAIL: die impulse did not move the dynamic Mug (moved ${knock.displacement.toFixed(3)} units)`
        );
        pass = false;
    }

    return pass;
});
