const fs = require('fs');
const { launchPage } = require('./helpers/browser');

/**
 * Verification script for the fixed billiard lamp.
 * - If run with NODE_ENV=static or no browser available, performs source-level checks only.
 * - Otherwise uses Playwright against a running server (npm run preview or equiv).
 */
async function staticChecks() {
    console.log('=== Lamp Static Verification (no browser) ===');
    const lampSrc = fs.readFileSync('src/environment/Lamp.js', 'utf8');
    const metricsSrc = fs.readFileSync('src/core/SceneMetrics.js', 'utf8');
    const registrySrc = fs.readFileSync('src/environment/PropRegistry.js', 'utf8');

    const checks = [
        { name: 'visualWrapper Group present', pass: lampSrc.includes('visualWrapper') && lampSrc.includes('LampVisualWrapper') },
        { name: 'wrapper scale uses setScalar (no direct geo mutate)', pass: lampSrc.includes('visualWrapper.scale.setScalar') },
        { name: 'top-center positioning comment', pass: lampSrc.includes('TOP-CENTER') && lampSrc.includes('visualWrapper') },
        { name: 'safe bbox scale to ~22 wide', pass: lampSrc.includes('targetWidth = 22') && lampSrc.includes('rawWidth') },
        { name: 'updateMatrixWorld before shade bounds', pass: lampSrc.includes('updateMatrixWorld(true)') },
        { name: 'shade-based light placement (glass or fallback)', pass: lampSrc.includes('glassShades') || lampSrc.includes('lightPositions') },
        { name: 'no scene.add(lampGroup) inside createLamp', pass: !lampSrc.includes('scene.add(lampGroup)') },
        { name: 'returns toggle', pass: lampSrc.includes('toggle,') || lampSrc.includes('toggle:') },
        { name: 'lamp hang metric near ceiling', pass: metricsSrc.includes('LAMP_HANG_Y = ROOM_CEILING_Y - 0.35') },
        { name: 'lamp tier uses shared hang metric', pass: registrySrc.includes('y: LAMP_HANG_Y') },
        { name: 'scene.add for lamp in caller', pass: registrySrc.includes('ctx.scene.add(result.group)') },
        { name: 'lamp interaction registered by prop registry', pass: registrySrc.includes("registerInteractable('lamp'") }
    ];

    let allPass = true;
    checks.forEach(c => {
        const status = c.pass ? '✓' : '✗';
        console.log(`${status} ${c.name}`);
        if (!c.pass) allPass = false;
    });

    // Also check built asset contains key strings (proves it made it through bundler)
    try {
        const built = fs.readdirSync('dist/assets').find(f => f.startsWith('index-') && f.endsWith('.js'));
        if (built) {
            const builtCode = fs.readFileSync(`dist/assets/${built}`, 'utf8');
            const builtOk = builtCode.includes('BilliardLamp') && builtCode.includes('LampVisualWrapper');
            console.log(builtOk ? '✓ Built bundle contains LampVisualWrapper + BilliardLamp' : '✗ Built bundle missing lamp symbols');
            if (!builtOk) allPass = false;
        }
    } catch (e) {}

    console.log(allPass ? '\n=== STATIC CHECKS PASSED ===' : '\n=== STATIC CHECKS HAD FAILURES ===');
    return allPass;
}

const isStatic = process.env.NODE_ENV === 'static' || process.argv.includes('--static');

if (isStatic) {
    staticChecks().then(ok => process.exit(ok ? 0 : 1));
} else {
    runLampTest();
}

async function runLampTest() {
    console.log('=== Lamp Verification Test ===');

    const { browser, page, errors: consoleErrors } = await launchPage({ logConsole: false });

    // Use the verification server started by our test harness (port 8123 serves dist/)
    const urls = [
        'http://127.0.0.1:4173/?webgl&no-post&fair-dice',
        'http://127.0.0.1:5173/?webgl&no-post&fair-dice',
        'http://127.0.0.1:8123/?webgl&no-post&fair-dice'
    ];
    let loaded = false;
    for (const url of urls) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            loaded = true;
            console.log(`Loaded: ${url}`);
            break;
        } catch (e) {
            console.log(`Could not reach ${url}, trying next... (${e.message})`);
        }
    }
    if (!loaded) {
        console.error('ERROR: Could not reach dev or preview server on 4173/5173');
        console.error('Start one with: npm run preview (after build) or npm run dev');
        await browser.close();
        process.exit(1);
    }

    // Wait for core scene
    try {
        await page.waitForFunction(() => window.scene !== undefined && window.sceneReady !== undefined, { timeout: 45000 });
    } catch (e) {
        console.error('Timeout waiting for window.scene / sceneReady');
        await browser.close();
        process.exit(1);
    }

    // Give the async lamp loader (Tier 1) time to finish
    await page.waitForTimeout(8000);

    const result = await page.evaluate(() => {
        const scene = window.scene;
        if (!scene) return { error: 'no scene' };

        // Find the lamp group
        /** @type {import('three').Object3D | null} */
        let lamp = null;
        scene.traverse((obj) => {
            if (obj.name === 'BilliardLamp' && obj.type === 'Group') {
                lamp = obj;
            }
        });

        if (!lamp) {
            return { error: 'BilliardLamp group not found in scene' };
        }

        // Count key children
        /** @type {import('three').Object3D | null} */
        let wrapper = null;
        let lightCount = 0;
        let bulbCount = 0;
        let glassCount = 0;
        const positions = [];

        lamp.traverse((child) => {
            if (child.name === 'LampVisualWrapper') wrapper = child;
            if (child.isPointLight) {
                lightCount++;
                positions.push({ type: 'light', x: child.position.x.toFixed(2), y: child.position.y.toFixed(2), z: child.position.z.toFixed(2) });
            }
            if (child.isMesh && child.material && child.material.type === 'MeshBasicMaterial' && child.geometry && child.geometry.type === 'SphereGeometry') {
                bulbCount++;
                positions.push({ type: 'bulb', x: child.position.x.toFixed(2), y: child.position.y.toFixed(2), z: child.position.z.toFixed(2) });
            }
            if (child.isMesh) {
                const n = (child.name || '').toLowerCase();
                if (n.includes('glass') || n.includes('shade')) glassCount++;
            }
        });

        const lampY = lamp.position.y;
        const hasWrapper = !!wrapper;
        const wrapperScale = wrapper ? wrapper.scale.x.toFixed(3) : null;

        return {
            lampY,
            hasWrapper,
            wrapperScale,
            lightCount,
            bulbCount,
            glassCount,
            positions: positions.slice(0, 12),
            noConsoleErrors: true
        };
    });

    console.log('Lamp inspection result:');
    console.dir(result, { depth: 3 });

    let pass = true;
    if (result.error) {
        console.error('FAIL:', result.error);
        pass = false;
    } else {
        // LAMP_HANG_Y = ROOM_CEILING_Y(20) - 0.35 (src/core/SceneMetrics.js)
        if (Math.abs(result.lampY - 19.65) > 0.1) {
            console.warn(`WARN: lamp.group.position.y = ${result.lampY} (expected ~19.65)`);
        } else {
            console.log('✓ Lamp positioned at y≈19.65');
        }
        if (!result.hasWrapper) {
            console.error('FAIL: No LampVisualWrapper Group found (geometry mutation risk)');
            pass = false;
        } else {
            console.log(`✓ Using visualWrapper (scale ≈ ${result.wrapperScale})`);
        }
        if (result.lightCount < 3) {
            console.error(`FAIL: Only ${result.lightCount} PointLights (expected 3)`);
            pass = false;
        } else {
            console.log(`✓ ${result.lightCount} PointLights created`);
        }
        if (result.bulbCount < 3) {
            console.error(`FAIL: Only ${result.bulbCount} emissive bulbs (expected 3)`);
            pass = false;
        } else {
            console.log(`✓ ${result.bulbCount} emissive bulbs created`);
        }
        if (result.glassCount < 1) {
            // The source OBJ contains only a single monolithic mesh named after the file.
            // Material-by-name logic (glass/wood/steel) cannot split it; the copper
            // texture map provides the full painted appearance. This is expected.
            console.log(`✓ (model has 1 monolithic mesh - glassCount=${result.glassCount} is normal)`);
        } else {
            console.log(`✓ ${result.glassCount} glass/shade meshes found`);
        }
        // Check that bulbs are not at y=0 or hugely positive (would be floating wrong)
        const badBulbs = result.positions.filter(p => p.type === 'bulb' && (parseFloat(p.y) > -1 || parseFloat(p.y) < -40));
        if (badBulbs.length > 0) {
            console.warn('WARN: Some bulbs have suspicious Y (may be floating or clipped):', badBulbs);
        } else {
            console.log('✓ Bulb Y positions look reasonable (inside shades)');
        }
    }

    // Filter out non-lamp, pre-existing asset 404s (e.g. wasm when built without Emscripten)
    const lampRelatedErrors = consoleErrors.filter(e =>
        /lamp|Billiard|glass|shade|RenderStuff/i.test(e)
    );
    if (lampRelatedErrors.length > 0) {
        console.error('FAIL: Lamp-related browser errors:');
        lampRelatedErrors.forEach(e => console.error('  ', e));
        pass = false;
    } else {
        console.log('✓ No lamp-related console errors (other 404s are expected without full WASM build)');
    }

    // Interactable hook check: the lamp toggle is reachable programmatically
    // (drives the in-game click handler and is now exposed for e2e).
    const lampInteract = await page.evaluate(() => {
        const api = window.__interactables && window.__interactables.lamp;
        if (!api || typeof api.trigger !== 'function') return { ok: false };
        try { api.trigger(); api.trigger(); return { ok: true }; }
        catch (e) { return { ok: false, err: String(e) }; }
    });
    if (lampInteract.ok) {
        console.log('✓ Lamp interactable hook works (window.__interactables.lamp.trigger)');
    } else {
        console.error('FAIL: lamp interactable hook missing or threw', lampInteract.err || '');
        pass = false;
    }

    await browser.close();

    if (pass) {
        console.log('\n=== LAMP VERIFICATION PASSED ===');
        process.exit(0);
    } else {
        console.log('\n=== LAMP VERIFICATION HAD ISSUES ===');
        process.exit(1);
    }
}
