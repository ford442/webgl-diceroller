// Unit-style checks for RendererFactory pixel-ratio / AA helpers.
// Run: node scripts/verify-renderer-factory.mjs
import {
    resolvePixelRatioConfig,
    resolveAntialias,
    probeSoftwareWebGL,
    createRenderer,
    getWebGlContextAttributes,
    describeLimitMismatches,
    isSoftwareWebGpuAdapter,
    PREVIEW_WEBGL_CONTEXT,
    SOFTWARE_PROBE_CONTEXT_ATTRIBUTES,
    getRendererPreference,
    getWebGlRendererParameters,
    getWebGpuRendererParameters,
    getWebGpuRequiredFeatures,
    wantsWebGpuTimestampQuery,
    WEBGPU_REQUIRED_LIMITS,
    WEBGPU_CURATED_FEATURES,
    WEBGPU_TIMESTAMP_QUERY_FEATURE,
    isXrRequested,
    getXrSnapDegrees,
} from '../src/core/RendererFactory.js';
import { resolveDeviceSession } from '../src/core/DeviceSession.js';

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

// Software probe without a DOM resolves to "not software" and never throws.
{
    const result = await probeSoftwareWebGL({ doc: undefined });
    assert(
        result.isSoftware === false && result.released === 'none',
        'probe is inert without a DOM'
    );
}

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

{
    const gl = getWebGlRendererParameters({ antialias: true, xrCompatible: false });
    assert(gl.alpha === false, 'WebGL alpha is false (opaque tavern)');
    assert(gl.stencil === false, 'WebGL stencil is false');
    assert(gl.powerPreference === 'high-performance', 'WebGL powerPreference is high-performance');
    assert(gl.xrCompatible === false, 'WebGL xrCompatible false by default');
    assert(gl.preserveDrawingBuffer === false, 'WebGL preserveDrawingBuffer stays false');
}

{
    const xr = getWebGlRendererParameters({ antialias: false, xrCompatible: true });
    assert(xr.xrCompatible === true, 'WebGL xrCompatible true when XR is requested');
}

{
    const gpu = getWebGpuRendererParameters({ antialias: true });
    assert(gpu.alpha === false, 'WebGPU alpha is false');
    assert(gpu.stencil === false, 'WebGPU stencil is false');
    assert(
        gpu.powerPreference === 'high-performance',
        'WebGPU powerPreference is high-performance'
    );
    assert(
        gpu.requiredLimits.maxTextureDimension2D === WEBGPU_REQUIRED_LIMITS.maxTextureDimension2D,
        'WebGPU requiredLimits uses documented floor'
    );
}

// Curated WebGPU requiredFeatures: never grabs everything the adapter has.
{
    const fullFeatureSet = new Set([
        'timestamp-query',
        'float32-filterable',
        'texture-compression-bc',
    ]);
    const noneRequested = getWebGpuRequiredFeatures(fullFeatureSet, { wantTimestampQuery: false });
    assert(
        noneRequested.length === WEBGPU_CURATED_FEATURES.length,
        'requiredFeatures stays at the documented (currently empty) floor when timestamp query is not wanted'
    );

    const withTimestamp = getWebGpuRequiredFeatures(fullFeatureSet, { wantTimestampQuery: true });
    assert(
        withTimestamp.includes(WEBGPU_TIMESTAMP_QUERY_FEATURE),
        'requiredFeatures includes timestamp-query when wanted and supported'
    );
    assert(
        withTimestamp.length === WEBGPU_CURATED_FEATURES.length + 1,
        'requiredFeatures adds exactly one feature for timestamp query, not the whole adapter set'
    );

    const noAdapterSupport = getWebGpuRequiredFeatures(new Set(), { wantTimestampQuery: true });
    assert(
        !noAdapterSupport.includes(WEBGPU_TIMESTAMP_QUERY_FEATURE),
        'requiredFeatures never requests a feature the adapter does not report (requestDevice would reject)'
    );
}

// ?debug-perf / ?gpu-timer opt into WebGPU timestamp tracking; neither by default.
assert(
    wantsWebGpuTimestampQuery(new URLSearchParams('')) === false,
    'no timestamp query by default'
);
assert(
    wantsWebGpuTimestampQuery(new URLSearchParams('debug-perf')) === true,
    '?debug-perf opts into timestamp query'
);
assert(
    wantsWebGpuTimestampQuery(new URLSearchParams('gpu-timer')) === true,
    '?gpu-timer opts into timestamp query'
);

// ---------------------------------------------------------------------------
// Attribute bag: defaults unchanged, a profile can flip alpha / power.
{
    const tavern = getWebGlContextAttributes({ antialias: true });
    assert(
        tavern.alpha === false && tavern.powerPreference === 'high-performance',
        'tavern context defaults stay opaque + high-performance'
    );
    const preview = getWebGlRendererParameters(PREVIEW_WEBGL_CONTEXT);
    assert(
        preview.alpha === true && preview.powerPreference === 'low-power',
        'preview profile flips alpha and requests low-power through the same helper'
    );
    const attrs = getWebGlContextAttributes({ antialias: false, powerPreference: 'low-power' });
    const params = getWebGlRendererParameters({ antialias: false, powerPreference: 'low-power' });
    assert(
        [
            'antialias',
            'alpha',
            'stencil',
            'depth',
            'preserveDrawingBuffer',
            'powerPreference',
        ].every((k) => attrs[k] === params[k]),
        'getWebGlRendererParameters mirrors getWebGlContextAttributes'
    );
    const gpuLow = getWebGpuRendererParameters({ antialias: false, powerPreference: 'low-power' });
    assert(
        gpuLow.powerPreference === 'low-power',
        'WebGPU parameters accept a session power preference'
    );
}

assert(
    describeLimitMismatches({ maxTextureDimension2D: 1024 }) ===
        'maxTextureDimension2D: need 2048, adapter 1024',
    'describeLimitMismatches reports short limits from an existing adapter'
);
assert(describeLimitMismatches(null) === null, 'describeLimitMismatches tolerates missing limits');
assert(
    isSoftwareWebGpuAdapter({ architecture: 'swiftshader' }) === true,
    'SwiftShader WebGPU adapter is software'
);
assert(isSoftwareWebGpuAdapter({}, true) === true, 'fallback adapter is software');
assert(isSoftwareWebGpuAdapter({ vendor: 'nvidia' }) === false, 'discrete adapter is not software');

// ---------------------------------------------------------------------------
// createRenderer integration with fake DOM / GPU seams.

/**
 * Fake document whose canvases log every getContext call. The GL returned by
 * getContext reports `rendererString` and, on loseContext(), dispatches
 * `webglcontextlost` after `loseDelayMs` (never, when null).
 */
function makeFakeDom({ rendererString = 'ANGLE (NVIDIA GeForce)', loseDelayMs = 5, log }) {
    const getContextCalls = [];
    const doc = {
        createElement(tag) {
            if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
            const canvas = new EventTarget();
            canvas.width = 300;
            canvas.height = 150;
            canvas.getContext = (kind, attrs) => {
                getContextCalls.push({ kind, attrs });
                log?.push(`getContext:${kind}:${attrs?.powerPreference}`);
                return {
                    UNMASKED_RENDERER_WEBGL: 0x9246,
                    getParameter: () => rendererString,
                    getExtension(name) {
                        if (name === 'WEBGL_debug_renderer_info') {
                            return { UNMASKED_RENDERER_WEBGL: 0x9246 };
                        }
                        if (name === 'WEBGL_lose_context') {
                            return {
                                loseContext() {
                                    log?.push('loseContext');
                                    if (loseDelayMs === null) return;
                                    setTimeout(() => {
                                        log?.push('contextlost');
                                        canvas.dispatchEvent(new Event('webglcontextlost'));
                                    }, loseDelayMs);
                                },
                            };
                        }
                        return null;
                    },
                };
            };
            return canvas;
        },
    };
    return { doc, getContextCalls };
}

const DESKTOP_HINTS = {
    preferredRenderer: 'webgpu',
    hasWebGpuApi: true,
    xr: false,
    touchPrimary: false,
    lowCores: false,
    isTest: true,
};

function sessionFor(overrides) {
    return resolveDeviceSession({ ...DESKTOP_HINTS, ...overrides });
}

function makeDeps({ dom, log, curatedResult, timeoutMs = 250 }) {
    const calls = { probe: 0, curated: 0, webgl: [], webgpu: [] };
    const deps = {
        probeSoftwareWebGL: () => {
            calls.probe += 1;
            return probeSoftwareWebGL({ doc: dom.doc, timeoutMs });
        },
        requestCuratedWebGpuDevice: async () => {
            calls.curated += 1;
            return curatedResult;
        },
        createWebGlRenderer: (args) => {
            calls.webgl.push(args);
            log?.push(`createWebGlRenderer:${args.powerPreference}`);
            return {
                renderer: { domElement: null },
                rendererType: 'webgl',
                usingWebGPU: false,
                usingWebGL: true,
                requestedRenderer: args.requestedRenderer,
                fallbackReason: args.fallbackReason,
            };
        },
        createWebGpuRenderer: async (args) => {
            calls.webgpu.push(args);
            return { domElement: null };
        },
    };
    return { deps, calls };
}

const CONTAINER = { clientWidth: 320, clientHeight: 240 };
const OK_DEVICE = {
    device: { destroy() {} },
    trackTimestamp: false,
    requiredFeatures: [],
    adapterLimits: { maxTextureDimension2D: 8192 },
    isSoftware: false,
};

// Any stray document.createElement (outside the injected probe) is counted too.
const strayDom = makeFakeDom({});
globalThis.document = strayDom.doc;

// 1. navigator.gpu present + curated device → no WebGL probe context at all.
{
    const dom = makeFakeDom({});
    const { deps, calls } = makeDeps({ dom, curatedResult: OK_DEVICE });
    const state = await createRenderer(CONTAINER, {
        session: sessionFor({}),
        searchParams: new URLSearchParams('test'),
        deps,
    });
    assert(state.rendererType === 'webgpu', 'WebGPU boot selects WebGPU');
    assert(calls.probe === 0, 'WebGPU boot does not run the WebGL software probe');
    assert(
        dom.getContextCalls.length === 0 && strayDom.getContextCalls.length === 0,
        'WebGPU boot never calls getContext(webgl/webgl2)'
    );
    assert(state.softwareProbe === null, 'rendererState.softwareProbe is null on WebGPU');
    assert(calls.webgl.length === 0, 'WebGPU boot does not build a WebGL renderer');
}

// 2. Curated device failure → WebGL, WebGPURenderer never constructed.
for (const [label, curatedResult] of [
    ['null', null],
    [
        'requestDevice rejected',
        {
            device: null,
            reason: 'requestDevice rejected: limit',
            limitNote: 'maxBufferSize: need 33554432, adapter 1',
        },
    ],
]) {
    const dom = makeFakeDom({});
    const { deps, calls } = makeDeps({ dom, curatedResult });
    const state = await createRenderer(CONTAINER, {
        session: sessionFor({}),
        searchParams: new URLSearchParams('test'),
        deps,
    });
    assert(state.rendererType === 'webgl', `curated ${label} → WebGL selected`);
    assert(calls.webgpu.length === 0, `curated ${label} → WebGPURenderer never constructed`);
    assert(
        /curated device unavailable/.test(state.fallbackReason ?? ''),
        `curated ${label} → fallbackReason records the curated failure`
    );
    if (curatedResult?.limitNote) {
        assert(
            state.gpuLimitNote === curatedResult.limitNote &&
                state.fallbackReason.includes(curatedResult.limitNote),
            'curated failure carries the limit note from the same adapter'
        );
    }
    assert(calls.probe === 1, `curated ${label} → WebGL fallback runs the probe lazily`);
}

// 3. Probe ordering: low-power webgl2, tavern context only after contextlost.
{
    const log = [];
    const dom = makeFakeDom({ log, loseDelayMs: 20 });
    const { deps } = makeDeps({ dom, log });
    const state = await createRenderer(CONTAINER, {
        session: sessionFor({ preferredRenderer: 'webgl' }),
        searchParams: new URLSearchParams('webgl&test'),
        deps,
    });
    const probeCall = dom.getContextCalls[0];
    assert(
        probeCall?.kind === 'webgl2' &&
            probeCall.attrs.powerPreference === 'low-power' &&
            probeCall.attrs === SOFTWARE_PROBE_CONTEXT_ATTRIBUTES,
        'probe requests a low-power webgl2 context'
    );
    const lostAt = log.indexOf('contextlost');
    const createAt = log.findIndex((e) => e.startsWith('createWebGlRenderer'));
    assert(
        lostAt !== -1 && createAt > lostAt,
        `tavern context created only after the probe's webglcontextlost (${log.join(' → ')})`
    );
    assert(state.softwareProbe?.released === 'event', 'probe reports release via event');
    assert(
        state.glPowerPreference === 'high-performance',
        'desktop hardware WebGL session keeps high-performance'
    );
}
{
    const dom = makeFakeDom({ loseDelayMs: null });
    const started = Date.now();
    const result = await probeSoftwareWebGL({ doc: dom.doc, timeoutMs: 30 });
    assert(
        result.released === 'timeout' && Date.now() - started >= 25,
        'probe resolves via timeout when webglcontextlost never fires'
    );
}

// 4. Power preference on the real context.
{
    const dom = makeFakeDom({ rendererString: 'ANGLE (Google, Vulkan (SwiftShader Device))' });
    const { deps, calls } = makeDeps({ dom });
    const state = await createRenderer(CONTAINER, {
        session: sessionFor({ preferredRenderer: 'webgl' }),
        searchParams: new URLSearchParams('webgl'),
        deps,
    });
    assert(state.isSoftwareRenderer === true, 'SwiftShader probe → isSoftwareRenderer');
    assert(
        calls.webgl[0]?.powerPreference === 'low-power' && state.powerReasons.includes('software'),
        'software WebGL session requests low-power on the real context'
    );
}
{
    const dom = makeFakeDom({});
    const { deps, calls } = makeDeps({ dom });
    const state = await createRenderer(CONTAINER, {
        session: sessionFor({ preferredRenderer: 'webgl', xr: true }),
        searchParams: new URLSearchParams('xr'),
        deps,
    });
    assert(
        calls.webgl[0]?.powerPreference === 'low-power' && calls.webgl[0]?.xrCompatible === true,
        '?xr requests low-power + xrCompatible on the real context'
    );
    assert(state.xrCompatible === true, '?xr state reports xrCompatible');
}
{
    const dom = makeFakeDom({});
    const { deps, calls } = makeDeps({ dom });
    await createRenderer(CONTAINER, {
        session: sessionFor({ preferredRenderer: 'webgl' }),
        searchParams: new URLSearchParams('webgl'),
        deps,
    });
    assert(
        calls.webgl[0]?.powerPreference === 'high-performance',
        'desktop WebGL session requests high-performance'
    );
}
{
    // Recovery passes known software-ness → no re-probe.
    const dom = makeFakeDom({});
    const { deps, calls } = makeDeps({ dom });
    await createRenderer(CONTAINER, {
        session: sessionFor({}),
        searchParams: new URLSearchParams(''),
        forceWebGl: true,
        isSoftwareRenderer: false,
        deps,
    });
    assert(
        calls.probe === 0 && calls.curated === 0,
        'recovery with known software-ness skips the probe'
    );
}

delete globalThis.document;

if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
}

console.log('\nAll RendererFactory checks passed.');
