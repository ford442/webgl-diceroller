import { createDiceFaceMarkingMaterial } from './DiceFaceMarkingMaterial.js';
import { loadDiceFaceMarkingNodeMaterialFactory } from './DiceFaceMarkingNodeMaterial.js';
import { DICE_PRESET_PARAMS } from './DiceShadingParams.js';

/**
 * Which die material to build, for whichever renderer is live.
 *
 * There is one material per `DiceSet` entry and two implementations of it —
 * GLSL for `WebGLRenderer`, TSL nodes for `WebGPURenderer` — and nothing outside
 * this module needs to know which one it got. The six presets are still here,
 * but as *starting points* the descriptor overrides (`DICE_PRESET_PARAMS`), not
 * as an enum the renderer switches on.
 */

/** @typedef {'resin'|'metal'|'gemstone'|'bone'|'obsidian'|'glow'} DiceMaterialPresetId */

/** Preset metadata for the dice case: label, and whether it needs the good profile. */
export const DICE_MATERIAL_PRESETS = Object.fromEntries(
    Object.entries(DICE_PRESET_PARAMS).map(([id, params]) => [
        id,
        { id, label: params.label, requiresHighQuality: params.requiresHighQuality === true },
    ])
);

export const DICE_PRESET_IDS = Object.keys(DICE_MATERIAL_PRESETS);

export function getPresetById(id) {
    return DICE_MATERIAL_PRESETS[id] ?? DICE_MATERIAL_PRESETS.resin;
}

export function isHighQualityProfile(profile) {
    if (!profile) return true;
    return profile.id === 'high' || profile.postQuality === 'high';
}

let nodeMaterialFactory = null;
let nodeMaterialLoad = null;
let backend = 'webgl';

/**
 * Which twin a renderer needs.
 *
 * Asked of the renderer object, never of a flag someone set alongside it: a
 * node material handed to `WebGLRenderer` dies in `WebGLProgram`, and a plain
 * `MeshPhysicalMaterial` handed to `WebGPURenderer` dies in the node system.
 * `WebGPURenderer` keeps `isWebGPURenderer` true even when it has fallen back
 * to its WebGL2 *backend*, which is correct — it still wants nodes.
 *
 * @param {{ isWebGPURenderer?: boolean } | null | undefined} renderer
 * @returns {'webgl'|'webgpu'}
 */
export function backendForRenderer(renderer) {
    return renderer?.isWebGPURenderer === true ? 'webgpu' : 'webgl';
}

/**
 * Tell the dice which renderer they are being drawn by, and warm the node
 * material factory when that is WebGPU. Safe to call repeatedly (renderer
 * recovery re-runs it after a device loss).
 *
 * @param {'webgl'|'webgpu'} next
 * @returns {Promise<void>} resolves once the backend's factory is ready
 */
export async function setDiceMaterialBackend(next) {
    backend = next === 'webgpu' ? 'webgpu' : 'webgl';
    if (backend !== 'webgpu') return;

    nodeMaterialLoad ??= loadDiceFaceMarkingNodeMaterialFactory().then(
        (factory) => {
            nodeMaterialFactory = factory;
        },
        (error) => {
            // A missing node backend is not worth a blank table: fall back to the
            // GLSL twin, which a WebGPU renderer can still consume via its
            // WebGL fallback path.
            console.warn('[DiceMaterials] node material unavailable; using GLSL twin', error);
            nodeMaterialLoad = null;
        }
    );
    await nodeMaterialLoad;
}

export function getDiceMaterialBackend() {
    return backend;
}

/**
 * Build the material for one die, from its descriptor entry.
 *
 * @param {import('./DiceSetFormat.js').DiceSetEntry} entry
 * @param {import('three').Mesh} template die template the material will be worn by
 * @param {{ envMap?: import('three').Texture|null, qualityProfile?: object|null, forceWebGL?: boolean }} [options]
 * @returns {{ materials: import('three').Material[], dispose: () => void }}
 */
export function createDiceMaterialForEntry(entry, template, options = {}) {
    const shading = {
        envMap: options.envMap ?? null,
        highQuality: isHighQualityProfile(options.qualityProfile),
    };

    // `forceWebGL` is for surfaces that own a plain WebGLRenderer of their own
    // (the dice case preview), whatever the table is drawn with.
    const useNodes = !options.forceWebGL && backend === 'webgpu' && nodeMaterialFactory;
    if (useNodes) return nodeMaterialFactory(entry, template, shading);
    return createDiceFaceMarkingMaterial(entry, template, shading);
}

/**
 * Dispose previous dice materials without touching shared geometry.
 * @param {import('three').Material|import('three').Material[]|null} material
 */
export function disposeDiceMaterials(material) {
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    list.forEach((mat) => mat?.dispose?.());
}

/**
 * Wear a die material.
 *
 * A hull that authored its markings as a second draw group gets both instances;
 * one covering the whole mesh is enough for anything else. Both come from the
 * same descriptor entry either way.
 *
 * @param {import('three').Mesh} mesh
 * @param {import('three').Material[]} materials
 */
export function applyMaterialToDieMesh(mesh, materials) {
    if (!mesh || !materials?.length) return;
    const groups = mesh.geometry?.groups?.length ?? 0;
    mesh.material = groups >= 2 && materials.length >= 2 ? materials : materials[0];
}

export { DICE_PRESET_PARAMS };
