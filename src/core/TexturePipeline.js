import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

let pipeline = null;
const sets = {
    wood: null,
    table: null,
    brick: null,
    lamp: null,
};

function applyRepeat(textures, repeatX = 1, repeatY = 1) {
    for (const texture of textures) {
        if (!texture) continue;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        if (repeatX !== 1 || repeatY !== 1) {
            texture.repeat.set(repeatX, repeatY);
        }
    }
}

function assignColorSpace(texture, colorSpace) {
    if (texture) texture.colorSpace = colorSpace;
}

/**
 * Initialize KTX2 + JPG fallback texture loading. Must be called once the
 * renderer exists (KTX2Loader.detectSupport needs it).
 */
export function initTexturePipeline(renderer) {
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('./basis/');
    ktx2Loader.detectSupport(renderer);

    const jpgLoader = new THREE.TextureLoader();

    async function load(url, { colorSpace = THREE.SRGBColorSpace } = {}) {
        const ktx2Url = url.replace(/\.jpe?g$/i, '.ktx2');
        if (ktx2Url !== url) {
            try {
                const texture = await ktx2Loader.loadAsync(ktx2Url);
                texture.colorSpace = colorSpace;
                return texture;
            } catch {
                // Fall back to legacy JPG shipped alongside KTX2.
            }
        }

        const texture = await jpgLoader.loadAsync(url);
        texture.colorSpace = colorSpace;
        return texture;
    }

    pipeline = { load, ktx2Loader, jpgLoader };
    return pipeline;
}

export function getTexturePipeline() {
    if (!pipeline) {
        throw new Error('TexturePipeline not initialized — call initTexturePipeline(renderer) first.');
    }
    return pipeline;
}

export function getWoodTextures() {
    if (!sets.wood) {
        throw new Error('Shared wood textures not preloaded — call preloadSharedTextures() first.');
    }
    return sets.wood;
}

export function getTableTextures() {
    if (!sets.table) {
        throw new Error('Shared table textures not preloaded — call preloadSharedTextures() first.');
    }
    return sets.table;
}

export function getBrickTextures() {
    if (!sets.brick) {
        throw new Error('Shared brick textures not preloaded — call preloadSharedTextures() first.');
    }
    return sets.brick;
}

export function getLampTextures() {
    if (!sets.lamp) {
        throw new Error('Lamp textures not preloaded — call preloadSharedTextures() first.');
    }
    return sets.lamp;
}

async function loadWoodSet(tp) {
    const srgb = THREE.SRGBColorSpace;
    const linear = THREE.NoColorSpace;
    const [diffuse, roughness, bump] = await Promise.all([
        tp.load('./images/wood_diffuse.jpg', { colorSpace: srgb }),
        tp.load('./images/wood_roughness.jpg', { colorSpace: linear }),
        tp.load('./images/wood_bump.jpg', { colorSpace: linear }),
    ]);
    applyRepeat([diffuse, roughness, bump]);
    assignColorSpace(diffuse, srgb);
    assignColorSpace(roughness, linear);
    assignColorSpace(bump, linear);
    return { diffuse, roughness, bump };
}

async function loadTableSet(tp) {
    const srgb = THREE.SRGBColorSpace;
    const linear = THREE.NoColorSpace;
    const [diffuse, roughness, normal, ao] = await Promise.all([
        tp.load('./images/table_diff.jpg', { colorSpace: srgb }),
        tp.load('./images/table_rough.jpg', { colorSpace: linear }),
        tp.load('./images/table_nor.jpg', { colorSpace: linear }),
        tp.load('./images/table_ao.jpg', { colorSpace: linear }),
    ]);
    applyRepeat([diffuse, roughness, normal, ao], 4, 4);
    assignColorSpace(diffuse, srgb);
    for (const t of [roughness, normal, ao]) assignColorSpace(t, linear);
    return { diffuse, roughness, normal, ao };
}

async function loadBrickSet(tp) {
    const srgb = THREE.SRGBColorSpace;
    const linear = THREE.NoColorSpace;
    const [diffuse, bump, roughness] = await Promise.all([
        tp.load('./images/brick_diffuse.jpg', { colorSpace: srgb }),
        tp.load('./images/brick_bump.jpg', { colorSpace: linear }),
        tp.load('./images/brick_roughness.jpg', { colorSpace: linear }),
    ]);
    applyRepeat([diffuse, bump, roughness]);
    assignColorSpace(diffuse, srgb);
    assignColorSpace(bump, linear);
    assignColorSpace(roughness, linear);
    return { diffuse, bump, roughness };
}

async function loadLampSet(tp) {
    const srgb = THREE.SRGBColorSpace;
    const linear = THREE.NoColorSpace;
    const base = './images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp_';
    const [copper, glass, glassBump, steel, wood] = await Promise.all([
        tp.load(`${base}cooper.jpg`, { colorSpace: srgb }),
        tp.load(`${base}glass.jpg`, { colorSpace: srgb }),
        tp.load(`${base}glass_bump.jpg`, { colorSpace: linear }),
        tp.load(`${base}steel.jpg`, { colorSpace: srgb }),
        tp.load(`${base}wood.jpg`, { colorSpace: srgb }),
    ]);
    return { copper, glass, glassBump, steel, wood };
}

/**
 * Preload all shared texture sets used by environment props.
 * Safe to call multiple times — only loads once.
 */
export async function preloadSharedTextures(renderer) {
    if (!pipeline) initTexturePipeline(renderer);
    const tp = getTexturePipeline();

    if (!sets.wood) {
        [sets.wood, sets.table, sets.brick, sets.lamp] = await Promise.all([
            loadWoodSet(tp),
            loadTableSet(tp),
            loadBrickSet(tp),
            loadLampSet(tp),
        ]);
    }

    return sets;
}
