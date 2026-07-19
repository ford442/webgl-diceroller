const { runTest } = require('./helpers/browser');

// Mobile smoke: portrait viewport, forced touch path, responsive aspect + adaptive quality hooks.
const url = 'http://localhost:4173/?webgl&no-post&fair-dice&touch&fill';

runTest(async (page, errors) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 150000 });

    const state = await page.evaluate(() => {
        const container = document.getElementById('canvas-container');
        const rect = container?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
        return {
            sceneReady: window.sceneReady === true,
            touchInputEnabled: window.touchInputEnabled === true,
            isTouchPrimaryDevice: window.isTouchPrimaryDevice === true,
            qualityProfile: window.qualityProfile ?? null,
            cameraAspect: window.camera?.aspect ?? null,
            containerAspect: rect.width > 0 ? rect.width / rect.height : null,
            portrait: rect.height > rect.width
        };
    });

    let pass = true;

    if (!state.sceneReady) {
        console.error('FAILURE: scene did not become ready');
        pass = false;
    } else {
        console.log('✓ sceneReady');
    }

    if (!state.touchInputEnabled || !state.isTouchPrimaryDevice) {
        console.error('FAILURE: touch input path not enabled');
        pass = false;
    } else {
        console.log('✓ touch input path enabled');
    }

    if (!state.portrait) {
        console.error('FAILURE: viewport is not portrait');
        pass = false;
    } else {
        console.log('✓ portrait viewport');
    }

    if (!state.cameraAspect || state.cameraAspect >= 0.98) {
        console.error(`FAILURE: camera aspect should be portrait (<1), got ${state.cameraAspect}`);
        pass = false;
    } else {
        console.log(`✓ camera aspect ${state.cameraAspect.toFixed(3)}`);
    }

    if (!state.qualityProfile) {
        console.error('FAILURE: quality profile not exposed');
        pass = false;
    } else if (state.qualityProfile === 'manual') {
        console.log('✓ quality profile manual (URL overrides active)');
    } else {
        console.log(`✓ quality profile ${state.qualityProfile}`);
    }

    // Dispatch synthetic touch flick on the canvas; should not throw.
    const touchOk = await page.evaluate(async () => {
        const canvas = document.querySelector('#canvas-container canvas');
        if (!canvas) return false;
        const rect = canvas.getBoundingClientRect();
        const startX = rect.left + rect.width * 0.5;
        const startY = rect.top + rect.height * 0.62;
        const endX = startX + 80;
        const endY = startY - 120;

        const mkTouch = (x, y) => new Touch({
            identifier: 1,
            target: canvas,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 1
        });

        canvas.dispatchEvent(new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            touches: [mkTouch(startX, startY)],
            targetTouches: [mkTouch(startX, startY)],
            changedTouches: [mkTouch(startX, startY)]
        }));

        await new Promise((r) => requestAnimationFrame(r));

        canvas.dispatchEvent(new TouchEvent('touchmove', {
            bubbles: true,
            cancelable: true,
            touches: [mkTouch(endX, endY)],
            targetTouches: [mkTouch(endX, endY)],
            changedTouches: [mkTouch(endX, endY)]
        }));

        canvas.dispatchEvent(new TouchEvent('touchend', {
            bubbles: true,
            cancelable: true,
            touches: [],
            targetTouches: [],
            changedTouches: [mkTouch(endX, endY)]
        }));

        return true;
    });

    if (!touchOk) {
        console.error('FAILURE: could not dispatch touch flick');
        pass = false;
    } else {
        console.log('✓ synthetic touch flick dispatched');
    }

    if (errors.length) {
        const critical = errors.filter((msg) => !/404|dice_physics|wasm/i.test(msg));
        if (critical.length) {
            console.error('FAILURE: page errors:', critical.slice(0, 5));
            pass = false;
        } else {
            console.log('✓ no critical page errors (ignored expected wasm 404s)');
        }
    } else {
        console.log('✓ no page errors');
    }

    console.log(pass ? '\n=== MOBILE TOUCH TEST PASSED ===' : '\n=== MOBILE TOUCH TEST FAILED ===');
    return pass;
}, { logConsole: false });
