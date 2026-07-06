import * as THREE from 'three';

function getRendererPreference(searchParams) {
    if (searchParams.has('webgl')) {
        return 'webgl';
    }

    if (searchParams.has('webgpu') || searchParams.has('wgpu')) {
        return 'webgpu';
    }

    // Default to the modern WebGPU path. When the browser lacks `navigator.gpu`
    // or WebGPU init fails, createRenderer() gracefully falls back to WebGL.
    // `?webgl` is the explicit escape hatch to the stable baseline renderer.
    return 'webgpu';
}

function applySharedRendererConfig(renderer, width, height) {
    renderer.setPixelRatio(1.0);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
}

function createWebGlRenderer({ antialias, width, height, requestedRenderer, fallbackReason }) {
    const renderer = new THREE.WebGLRenderer({ antialias });
    applySharedRendererConfig(renderer, width, height);

    return {
        renderer,
        rendererType: 'webgl',
        usingWebGPU: false,
        usingWebGL: true,
        requestedRenderer,
        fallbackReason
    };
}

export async function createRenderer(container, { antialias = false } = {}) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const searchParams = new URLSearchParams(window.location.search);
    const preferredRenderer = getRendererPreference(searchParams);
    // Distinguish an explicit `?webgpu` request from the implicit default so a
    // fallback on an unsupported browser logs calmly (info) rather than alarmingly
    // (warn) for the common no-flag case.
    const webgpuExplicit = searchParams.has('webgpu') || searchParams.has('wgpu');

    if (preferredRenderer === 'webgpu') {
        const hasWebGpuApi = typeof navigator !== 'undefined' && Boolean(navigator.gpu);

        if (!hasWebGpuApi) {
            const reason = 'WebGPU unavailable (navigator.gpu missing); using WebGLRenderer.';
            (webgpuExplicit ? console.warn : console.info)(`[RendererFactory] ${reason}`);
            return createWebGlRenderer({
                antialias, width, height,
                requestedRenderer: preferredRenderer,
                fallbackReason: reason
            });
        }

        try {
            const THREE_WEBGPU = await import('three/webgpu');
            const renderer = new THREE_WEBGPU.WebGPURenderer({ antialias });
            applySharedRendererConfig(renderer, width, height);
            await renderer.init();

            return {
                renderer,
                rendererType: 'webgpu',
                usingWebGPU: true,
                usingWebGL: false,
                requestedRenderer: preferredRenderer,
                fallbackReason: null
            };
        } catch (error) {
            const reason = `WebGPU init failed (${error?.message ?? error}); using WebGLRenderer fallback.`;
            console.warn(`[RendererFactory] ${reason}`, error);
            return createWebGlRenderer({
                antialias, width, height,
                requestedRenderer: preferredRenderer,
                fallbackReason: reason
            });
        }
    }

    return createWebGlRenderer({
        antialias, width, height,
        requestedRenderer: preferredRenderer,
        fallbackReason: null
    });
}
