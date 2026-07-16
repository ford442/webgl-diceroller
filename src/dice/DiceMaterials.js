import * as THREE from 'three';

/** @typedef {'resin'|'metal'|'gemstone'|'bone'|'obsidian'|'glow'} DiceMaterialPresetId */

/**
 * @typedef {Object} DiceMaterialPreset
 * @property {DiceMaterialPresetId} id
 * @property {string} label
 * @property {boolean} [requiresHighQuality]
 * @property {(ctx: { bodyColor: THREE.Color, pipColor: THREE.Color, envMap: THREE.Texture|null, highQuality: boolean }) => { body: THREE.Material, pip: THREE.Material }} build
 */

/** @type {Record<DiceMaterialPresetId, DiceMaterialPreset>} */
export const DICE_MATERIAL_PRESETS = {
    resin: {
        id: 'resin',
        label: 'Resin',
        build: ({ bodyColor, pipColor, envMap }) => ({
            body: new THREE.MeshPhysicalMaterial({
                color: bodyColor,
                roughness: 0.18,
                metalness: 0.0,
                clearcoat: 0.85,
                clearcoatRoughness: 0.12,
                envMap,
                envMapIntensity: 1.0
            }),
            pip: new THREE.MeshPhysicalMaterial({
                color: pipColor,
                roughness: 0.22,
                metalness: 0.0,
                clearcoat: 0.6,
                clearcoatRoughness: 0.15,
                envMap,
                envMapIntensity: 0.9
            })
        })
    },
    metal: {
        id: 'metal',
        label: 'Metal',
        build: ({ bodyColor, pipColor, envMap }) => ({
            body: new THREE.MeshStandardMaterial({
                color: bodyColor,
                roughness: 0.22,
                metalness: 0.92,
                envMap,
                envMapIntensity: 1.2
            }),
            pip: new THREE.MeshStandardMaterial({
                color: pipColor,
                roughness: 0.35,
                metalness: 0.75,
                envMap,
                envMapIntensity: 1.0
            })
        })
    },
    gemstone: {
        id: 'gemstone',
        label: 'Gemstone',
        requiresHighQuality: true,
        build: ({ bodyColor, pipColor, envMap, highQuality }) => {
            if (highQuality) {
                return {
                    body: new THREE.MeshPhysicalMaterial({
                        color: bodyColor,
                        roughness: 0.05,
                        metalness: 0.0,
                        transmission: 0.72,
                        thickness: 0.65,
                        ior: 1.52,
                        envMap,
                        envMapIntensity: 1.4
                    }),
                    pip: new THREE.MeshPhysicalMaterial({
                        color: pipColor,
                        roughness: 0.08,
                        metalness: 0.0,
                        transmission: 0.35,
                        thickness: 0.35,
                        ior: 1.45,
                        envMap,
                        envMapIntensity: 1.1
                    })
                };
            }

            // Fake-refraction cubemap fallback for medium/low quality profiles.
            return {
                body: new THREE.MeshPhysicalMaterial({
                    color: bodyColor,
                    roughness: 0.08,
                    metalness: 0.15,
                    clearcoat: 1.0,
                    clearcoatRoughness: 0.05,
                    envMap,
                    envMapIntensity: 1.6
                }),
                pip: new THREE.MeshPhysicalMaterial({
                    color: pipColor,
                    roughness: 0.12,
                    metalness: 0.1,
                    clearcoat: 0.8,
                    clearcoatRoughness: 0.08,
                    envMap,
                    envMapIntensity: 1.2
                })
            };
        }
    },
    bone: {
        id: 'bone',
        label: 'Bone / Ivory',
        build: ({ bodyColor, pipColor, envMap }) => ({
            body: new THREE.MeshStandardMaterial({
                color: bodyColor,
                roughness: 0.62,
                metalness: 0.02,
                envMap,
                envMapIntensity: 0.55
            }),
            pip: new THREE.MeshStandardMaterial({
                color: pipColor,
                roughness: 0.7,
                metalness: 0.0,
                envMap,
                envMapIntensity: 0.45
            })
        })
    },
    obsidian: {
        id: 'obsidian',
        label: 'Obsidian',
        build: ({ bodyColor, pipColor, envMap }) => ({
            body: new THREE.MeshPhysicalMaterial({
                color: bodyColor,
                roughness: 0.12,
                metalness: 0.05,
                clearcoat: 0.9,
                clearcoatRoughness: 0.04,
                envMap,
                envMapIntensity: 1.3
            }),
            pip: new THREE.MeshStandardMaterial({
                color: pipColor,
                roughness: 0.25,
                metalness: 0.35,
                envMap,
                envMapIntensity: 0.9
            })
        })
    },
    glow: {
        id: 'glow',
        label: 'Glow',
        build: ({ bodyColor, pipColor, envMap }) => ({
            body: new THREE.MeshStandardMaterial({
                color: bodyColor,
                roughness: 0.35,
                metalness: 0.05,
                envMap,
                envMapIntensity: 0.8
            }),
            pip: new THREE.MeshStandardMaterial({
                color: pipColor,
                roughness: 0.4,
                metalness: 0.0,
                emissive: pipColor.clone(),
                emissiveIntensity: 1.4,
                envMap,
                envMapIntensity: 0.6
            })
        })
    }
};

export const DICE_PRESET_IDS = Object.keys(DICE_MATERIAL_PRESETS);

const PRESET_SHORT = {
    resin: 'r',
    metal: 'm',
    gemstone: 'g',
    bone: 'b',
    obsidian: 'o',
    glow: 'l'
};

const PRESET_FROM_SHORT = Object.fromEntries(
    Object.entries(PRESET_SHORT).map(([id, short]) => [short, id])
);

export function getPresetById(id) {
    return DICE_MATERIAL_PRESETS[id] ?? DICE_MATERIAL_PRESETS.resin;
}

export function isHighQualityProfile(profile) {
    if (!profile) return true;
    return profile.id === 'high' || profile.postQuality === 'high';
}

/**
 * @param {DiceMaterialPresetId} presetId
 * @param {{ bodyColor: string, pipColor: string }} colors hex strings
 * @param {{ envMap?: THREE.Texture|null, qualityProfile?: object|null }} options
 * @returns {{ body: THREE.Material, pip: THREE.Material }}
 */
export function createDiceMaterials(presetId, colors, options = {}) {
    const preset = getPresetById(presetId);
    const bodyColor = new THREE.Color(colors.bodyColor ?? '#c43c3c');
    const pipColor = new THREE.Color(colors.pipColor ?? '#f5f0e6');
    const highQuality = isHighQualityProfile(options.qualityProfile);

    let effectivePreset = preset;
    if (preset.requiresHighQuality && !highQuality) {
        effectivePreset = DICE_MATERIAL_PRESETS.resin;
    }

    return effectivePreset.build({
        bodyColor,
        pipColor,
        envMap: options.envMap ?? null,
        highQuality
    });
}

/**
 * Dispose previous dice materials without touching shared geometry.
 * @param {THREE.Material|THREE.Material[]|null} material
 */
export function disposeDiceMaterials(material) {
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    list.forEach((mat) => mat?.dispose?.());
}

/**
 * Apply body/pip materials to a die mesh (single or dual-slot).
 * @param {THREE.Mesh} mesh
 * @param {{ body: THREE.Material, pip: THREE.Material }} materials
 */
export function applyMaterialsToDieMesh(mesh, materials) {
    const pipGroup = mesh.geometry?.userData?.pipGroupIndex ?? 1;
    const hasPipGroup = mesh.geometry?.groups?.length >= 2 && pipGroup > 0;

    if (hasPipGroup) {
        mesh.material = [materials.body, materials.pip];
    } else {
        mesh.material = materials.body;
    }
}

export function presetToShortCode(presetId) {
    return PRESET_SHORT[presetId] ?? PRESET_SHORT.resin;
}

export function presetFromShortCode(code) {
    return PRESET_FROM_SHORT[code] ?? 'resin';
}
