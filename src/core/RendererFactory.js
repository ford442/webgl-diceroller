import * as THREE from 'three';

function getRendererPreference(searchParams) {
    if (searchParams.has('webgl')) {
        return 'webgl';
    }

    if (searchParams.has('webgpu') || searchParams.has('wgpu')) {
        return 'webgpu';
    }

    return 'webgl';
}

function applySharedRendererConfig(renderer, width, height) {
    renderer.setPixelRatio(1.0);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
}

export async function createRenderer(container, { antialias = false } = {}) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const searchParams = new URLSearchParams(window.location.search);
    const preferredRenderer = getRendererPreference(searchParams);

    if (preferredRenderer === 'webgpu') {
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
            console.warn('[RendererFactory] WebGPU init failed, falling back to WebGLRenderer.', error);
        }
    }

    const renderer = new THREE.WebGLRenderer({ antialias });
    applySharedRendererConfig(renderer, width, height);

    return {
        renderer,
        rendererType: 'webgl',
        usingWebGPU: false,
        usingWebGL: true,
        requestedRenderer: preferredRenderer,
        fallbackReason: preferredRenderer === 'webgpu'
            ? 'WebGPU init failed; using WebGLRenderer fallback.'
            : null
    };
}
