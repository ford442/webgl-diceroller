import * as THREE from 'three';
import { getWoodTextures } from './TexturePipeline.js';

/**
 * Shared MeshStandardMaterial singletons for environment props.
 *
 * Identical material instances let Three.js sort draws by program and reduce
 * shader switches. Tune roughness / color grading here instead of per-prop.
 */
const cache = new Map();

function singleton(key, factory) {
    if (!cache.has(key)) cache.set(key, factory());
    return cache.get(key);
}

const BOOK_COLORS = [
    0x8b0000, // dark red
    0x006400, // dark green
    0x00008b, // dark blue
    0x2f4f4f, // dark slate gray
    0x8b4513, // saddle brown
    0x000000  // black
];

/** @returns {THREE.MeshStandardMaterial} */
export function getSteelMaterial() {
    return singleton('steel', () => new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 1.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getGoldMaterial() {
    return singleton('gold', () => new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.8,
        roughness: 0.3,
        envMapIntensity: 1.1
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getBrassMaterial() {
    return singleton('brass', () => new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 0.85,
        roughness: 0.25,
        envMapIntensity: 1.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getSilverMaterial() {
    return singleton('silver', () => new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getCopperMaterial() {
    return singleton('copper', () => new THREE.MeshStandardMaterial({
        color: 0xb87333,
        metalness: 0.95,
        roughness: 0.35,
        envMapIntensity: 0.9
    }));
}

/** Metallic instanced prop base (per-instance color via instanceColor). */
export function getInstancedMetalMaterial() {
    return singleton('instancedMetal', () => new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.1
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getIronMaterial() {
    return singleton('iron', () => new THREE.MeshStandardMaterial({
        color: 0x333333,
        metalness: 0.7,
        roughness: 0.8
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getWroughtIronMaterial() {
    return singleton('wroughtIron', () => new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        metalness: 0.85,
        roughness: 0.5
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getLeatherMaterial() {
    return singleton('leather', () => new THREE.MeshStandardMaterial({
        color: 0x4a3c31,
        roughness: 0.9,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getDarkLeatherMaterial() {
    return singleton('darkLeather', () => new THREE.MeshStandardMaterial({
        color: 0x3f1f1f,
        roughness: 0.3,
        metalness: 0.15,
        envMapIntensity: 0.6
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getCeramicMaterial() {
    return singleton('ceramic', () => new THREE.MeshStandardMaterial({
        color: 0x4a3c31,
        roughness: 0.3,
        metalness: 0.05,
        envMapIntensity: 0.8
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getCeramicInnerMaterial() {
    return singleton('ceramicInner', () => new THREE.MeshStandardMaterial({
        color: 0x2a1c11,
        roughness: 0.9,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getWaxMaterial() {
    return singleton('wax', () => new THREE.MeshStandardMaterial({
        color: 0xf5f5e0,
        roughness: 0.4,
        metalness: 0.0,
        emissive: 0x221a10,
        emissiveIntensity: 0.1
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getParchmentMaterial() {
    return singleton('parchment', () => new THREE.MeshStandardMaterial({
        color: 0xf5deb3,
        roughness: 0.95,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getPaperMaterial() {
    return singleton('paper', () => new THREE.MeshStandardMaterial({
        color: 0xfffff0,
        roughness: 0.9,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getDarkRedMaterial() {
    return singleton('darkRed', () => new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.6,
        metalness: 0.1
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getBookCoverMaterial(colorIndex = 0) {
    const idx = ((colorIndex % BOOK_COLORS.length) + BOOK_COLORS.length) % BOOK_COLORS.length;
    return singleton(`bookCover_${idx}`, () => new THREE.MeshStandardMaterial({
        color: BOOK_COLORS[idx],
        roughness: 0.6,
        metalness: 0.1
    }));
}

/** @returns {THREE.MeshStandardMaterial[]} */
export function getBookCoverMaterials() {
    return BOOK_COLORS.map((_, i) => getBookCoverMaterial(i));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getBlackAccentMaterial() {
    return singleton('blackAccent', () => new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.9,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getWickMaterial() {
    return singleton('wick', () => new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 1.0,
        emissive: 0x331100,
        emissiveIntensity: 0.3
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getPewterMaterial() {
    return singleton('pewter', () => new THREE.MeshStandardMaterial({
        color: 0x8c92ac,
        roughness: 0.5,
        metalness: 0.85,
        envMapIntensity: 1.0
    }));
}

/** Textured wood (diffuse + bump + roughness maps). */
export function getWoodTexturedMaterial() {
    return singleton('woodTextured', () => {
        const { diffuse, bump, roughness } = getWoodTextures();
        return new THREE.MeshStandardMaterial({
            map: diffuse,
            bumpMap: bump,
            bumpScale: 0.1,
            roughnessMap: roughness,
            color: 0x8B4513,
            roughness: 0.8
        });
    });
}

/** @returns {THREE.MeshStandardMaterial} */
export function getWoodMaterial(color = 0x553311) {
    const key = `wood_${color.toString(16)}`;
    return singleton(key, () => new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.0
    }));
}

/** @returns {THREE.MeshStandardMaterial} */
export function getClothMaterial(color = 0x5c4033) {
    const key = `cloth_${color.toString(16)}`;
    return singleton(key, () => new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.0
    }));
}

/** Palette materials must not be disposed with individual props. */
export function isPaletteMaterial(material) {
    if (!material) return false;
    if (Array.isArray(material)) return material.every(isPaletteMaterial);
    for (const cached of cache.values()) {
        if (cached === material) return true;
    }
    return false;
}
