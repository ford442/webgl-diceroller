// Unit-style checks for RendererFactory pixel-ratio / AA helpers.
// Run: node scripts/verify-renderer-factory.mjs
import {
    resolvePixelRatioConfig,
    resolveAntialias,
    detectSoftwareWebGL,
    getRendererPreference,
} from '../src/core/RendererFactory.js';
import { isXrRequested, getXrSnapDegrees } from '../src/xr/XrFlags.js';

let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error('FAIL:', message);
        failed += 1;
    } else {
        console.log('ok:', message);
    }
}

// ?pr=1 escape hatch
{
    const cfg = resolvePixelRatioConfig(new URLSearchParams('pr=1'));
    assert(cfg.pixelRatio === 1, 'pr=1 forces pixelRatio 1');
    assert(cfg.forced === true, 'pr=1 marks ratio as forced');
}

// default cap at min(deviceDpr, 2)
{
    const cfg = resolvePixelRatioConfig(new URLSearchParams(''));
    assert(cfg.pixelRatio <= 2, 'default pixelRatio capped at 2');
    assert(cfg.forced === false, 'default ratio is not forced');
}

// ?pr=3 clamps to 3
{
    const cfg = resolvePixelRatioConfig(new URLSearchParams('pr=3'));
    assert(cfg.pixelRatio === 3, 'pr=3 accepts explicit cap');
}

// MSAA at DPR 1, post FXAA above
assert(resolveAntialias(1) === true, 'antialias enabled at pixelRatio 1');
assert(resolveAntialias(1.5) === false, 'antialias disabled above pixelRatio 1');
assert(resolveAntialias(2) === false, 'antialias disabled at pixelRatio 2');

// Software probe returns boolean (environment-dependent)
assert(typeof detectSoftwareWebGL() === 'boolean', 'detectSoftwareWebGL returns boolean');

// XR forces WebGL even when webgpu is also requested
assert(
    getRendererPreference(new URLSearchParams('')) === 'webgpu',
    'default renderer preference is webgpu'
);
assert(getRendererPreference(new URLSearchParams('xr')) === 'webgl', '?xr forces webgl preference');
assert(
    getRendererPreference(new URLSearchParams('xr-emulator')) === 'webgl',
    '?xr-emulator forces webgl preference'
);
assert(
    getRendererPreference(new URLSearchParams('xr&webgpu')) === 'webgl',
    '?xr wins over ?webgpu'
);
assert(isXrRequested(new URLSearchParams('')) === false, 'isXrRequested false by default');
assert(isXrRequested(new URLSearchParams('xr')) === true, 'isXrRequested true for ?xr');
assert(getXrSnapDegrees(new URLSearchParams('')) === 45, 'default xr snap is 45');
assert(getXrSnapDegrees(new URLSearchParams('xr-snap=30')) === 30, 'xr-snap=30 honored');
assert(getXrSnapDegrees(new URLSearchParams('xr-snap=5')) === 15, 'xr-snap clamps to min 15');

if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
}

console.log('\nAll RendererFactory checks passed.');
