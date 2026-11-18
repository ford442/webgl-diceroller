import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { ContextShadows } from './ContextProfile.js';
import { applyRendererSize } from './PixelRatioPolicy.js';

/**
 * Renderer settings both backends share (size, colour space, shadow map, tone
 * mapping). Lives apart from the two renderer builders so neither has to import
 * the other, nor the factory that picks between them.
 */
const SHADOW_MAP_TYPES: Record<Exclude<ContextShadows, 'off'>, THREE.ShadowMapType> = {
    'pcf-soft': THREE.PCFSoftShadowMap,
    pcf: THREE.PCFShadowMap,
    basic: THREE.BasicShadowMap,
};

export function applySharedRendererConfig(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number,
    { shadows = 'pcf-soft', alpha = false }: { shadows?: ContextShadows; alpha?: boolean } = {}
): void {
    applyRendererSize(renderer, width, height, pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = shadows !== 'off';
    renderer.shadowMap.type = SHADOW_MAP_TYPES[shadows === 'off' ? 'pcf-soft' : shadows];
    // A transparent profile clears to alpha 0 so the page shows through;
    // SceneSetup also drops the opaque scene.background for it.
    if (alpha) renderer.setClearColor(0x000000, 0);
    const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap;
    shadowMap.autoUpdate = false;
    shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
}
