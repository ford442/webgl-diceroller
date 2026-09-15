import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { publicAssetUrl } from '../core/publicAssetUrl.js';
import { ensureBodyPipGroups } from './DiceGeometryGroups.js';
import {
    backendForRenderer,
    createDiceMaterialForEntry,
    applyMaterialToDieMesh,
    disposeDiceMaterials,
    setDiceMaterialBackend,
} from './DiceMaterials.js';
import {
    applyDiceSetPresence,
    buildDiceSetPresence,
    getActiveDiceSet,
    getDieEntry,
    getDieShape,
    initDiceSetRuntime,
    listDieKeys,
    subscribeDiceSet,
    updateDieEntry,
} from './DiceSetRuntime.js';
import { diceModels, spawnedDice, diceMeshPool, diceTypes } from './DiceState.js';
import { finalizeDieTemplateUserData } from './DiceFaceData.js';

/**
 * Die templates, and the materials they wear.
 *
 * Templates are keyed by *die key* (`d6`, `dF`), not by mesh: a derived type
 * clones the hull it rides on and differs only in its descriptor entry, which is
 * what lets `DIE_TYPE_CATALOG` add a die type without adding an asset.
 *
 * Appearance is owned by `DiceSetRuntime`; this module only turns the active set
 * into materials and keeps templates, pooled meshes and spawned dice wearing the
 * current one.
 */

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(publicAssetUrl('draco/'));
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

let diceAppearanceScene = null;
let diceAppearanceEnvMap = null;
let diceAppearanceQualityProfile = null;
let unsubscribeDiceSet = null;

/** Disposers for the materials currently worn, by die key. */
const materialDisposers = new Map();

function getAppearanceOptions() {
    return {
        envMap: diceAppearanceEnvMap ?? diceAppearanceScene?.environment ?? null,
        qualityProfile:
            diceAppearanceQualityProfile ??
            (typeof window !== 'undefined' ? window.__app?.qualityProfile : null),
    };
}

/**
 * The template for a die key, cloning its hull's template the first time a
 * derived type (dF on a d6, d100 on a d10) is asked for.
 */
export function ensureDieTemplate(dieKey) {
    const existing = diceModels[dieKey];
    if (existing) return existing;

    const shape = getDieShape(dieKey);
    const hull = diceModels[shape];
    if (!hull || shape === dieKey) return hull ?? null;

    // Geometry, face normals and face values all belong to the hull and are
    // shared; only the material and the descriptor entry differ.
    const clone = hull.clone();
    clone.userData = { ...hull.userData };
    diceModels[dieKey] = clone;
    return clone;
}

export const loadDiceModels = async (onProgress) => {
    let done = 0;
    const total = diceTypes.length;

    const report = (label) => {
        if (typeof onProgress === 'function') onProgress(done, total, label);
    };

    await Promise.all(
        diceTypes.map(
            (d) =>
                new Promise((resolve) => {
                    let timedOut = false;
                    const url = publicAssetUrl(`images/${d.file}`);
                    const timer = setTimeout(() => {
                        console.warn(`Timeout loading ${url}`);
                        timedOut = true;
                        done++;
                        report(d.type);
                        resolve();
                    }, 15000);

                    loader.load(
                        url,
                        (gltf) => {
                            if (timedOut) return;
                            clearTimeout(timer);

                            /** @type {import('three').Mesh | null} */
                            let mesh = null;
                            gltf.scene.traverse((child) => {
                                if (
                                    /** @type {import('three').Object3D & { isMesh?: boolean }} */ (
                                        child
                                    ).isMesh
                                )
                                    mesh = /** @type {import('three').Mesh} */ (child);
                            });

                            if (mesh) {
                                const geometry = mesh.geometry.clone();
                                geometry.center();
                                mesh.updateMatrixWorld(true);
                                geometry.applyMatrix4(mesh.matrixWorld);
                                geometry.rotateX(-Math.PI / 2);
                                geometry.center();
                                ensureBodyPipGroups(geometry);

                                const cleanMesh = new THREE.Mesh(
                                    geometry,
                                    new THREE.MeshStandardMaterial({
                                        color: 0xcccccc,
                                        roughness: 0.3,
                                        metalness: 0.0,
                                    })
                                );
                                cleanMesh.position.set(0, 0, 0);
                                cleanMesh.rotation.set(0, 0, 0);
                                cleanMesh.scale.set(1, 1, 1);
                                cleanMesh.castShadow = true;
                                cleanMesh.receiveShadow = true;
                                cleanMesh.userData.physicsShape = null;
                                cleanMesh.geometry.computeBoundingBox();

                                finalizeDieTemplateUserData(cleanMesh, d.type);
                                diceModels[d.type] = cleanMesh;
                            }

                            done++;
                            report(d.type);
                            resolve();
                        },
                        undefined,
                        (error) => {
                            if (timedOut) return;
                            clearTimeout(timer);
                            console.warn(`Error loading ${url}:`, error);
                            done++;
                            report(d.type);
                            resolve();
                        }
                    );
                })
        )
    );

    console.log('All dice models loaded');
};

/**
 * Build and wear the material the active set describes for one die key.
 * @param {string} dieKey
 * @param {import('three').Mesh[]} meshes every mesh of that key to re-dress
 */
function applyEntryToMeshes(dieKey, meshes) {
    const template = ensureDieTemplate(dieKey);
    if (!template || !meshes.length) return;

    const built = createDiceMaterialForEntry(getDieEntry(dieKey), template, getAppearanceOptions());
    const previous = materialDisposers.get(dieKey);
    materialDisposers.set(dieKey, built.dispose);

    meshes.forEach((mesh) => {
        if (!mesh) return;
        applyMaterialToDieMesh(mesh, built.materials);
        mesh.userData.dieKey = dieKey;
    });

    // The old material (and its atlas) is only dead once nothing wears it.
    previous?.();
}

/** Every mesh currently wearing a die key's look: template, spawned, pooled. */
function meshesForKey(dieKey) {
    const meshes = [];
    const template = diceModels[dieKey];
    if (template) meshes.push(template);
    spawnedDice.forEach((die) => {
        if (die.type === dieKey) meshes.push(die.mesh);
    });
    (diceMeshPool[dieKey] ?? []).forEach((mesh) => meshes.push(mesh));
    return meshes;
}

/**
 * Resolve the active dice set and dress every die with it.
 *
 * @param {import('three').Scene} scene
 * @param {{ renderer?: object|null, envMap?: import('three').Texture|null, qualityProfile?: object|null, adaptiveProfile?: object|null }} [options]
 */
export function initDiceAppearance(scene, options = {}) {
    diceAppearanceScene = scene;
    diceAppearanceEnvMap = options.envMap ?? scene?.environment ?? null;
    diceAppearanceQualityProfile = options.qualityProfile ?? options.adaptiveProfile ?? null;

    initDiceSetRuntime();

    // The two material twins differ only in backend; pick before the first build
    // so nothing has to be rebuilt once WebGPU reports in. Asked of the renderer
    // itself — handing the wrong twin to a renderer is a hard crash, not a
    // degraded look, so this must not come from a flag set somewhere alongside.
    const backendReady = setDiceMaterialBackend(backendForRenderer(options.renderer));

    unsubscribeDiceSet?.();
    unsubscribeDiceSet = subscribeDiceSet((_set, changedKeys) => {
        changedKeys.forEach((key) => refreshDiceAppearance(key));
    });

    refreshDiceAppearance();

    // A WebGPU table re-dresses once its node factory lands; on WebGL this
    // resolves immediately and the second pass is a no-op rebuild.
    return backendReady.then(() => refreshDiceAppearance());
}

/**
 * Re-pick the material twin after the renderer is replaced, and re-dress every
 * die with it.
 *
 * Renderer recovery can swap a WebGPU renderer for a WebGL one mid-session.
 * Dice still wearing node materials would then take down the frame inside
 * `WebGLProgram`, so this is not cosmetic.
 *
 * @param {object|null} renderer the renderer now drawing the table
 */
export async function setDiceRenderer(renderer) {
    await setDiceMaterialBackend(backendForRenderer(renderer));
    refreshDiceAppearance();
}

/** Update quality profile used when (re)building dice materials. */
export function setDiceAppearanceQualityProfile(profile) {
    diceAppearanceQualityProfile = profile ?? null;
}

/**
 * Re-dress one die key, or every key that is actually on the table.
 *
 * Keys the catalog knows but nothing has asked for yet are skipped: building an
 * atlas for a d100 nobody has rolled would cost a load-time hitch for a die that
 * may never appear. `ensureDressedTemplate` dresses those on first use.
 */
export function refreshDiceAppearance(dieKey = null) {
    const keys = dieKey ? [dieKey] : listDieKeys().filter((key) => diceModels[key]);
    keys.forEach((key) => {
        const meshes = meshesForKey(key);
        if (meshes.length) applyEntryToMeshes(key, meshes);
    });
}

/**
 * Materials for a die key built for a *plain* `WebGLRenderer`, whatever the
 * table is drawn with. The dice case preview owns its own GL context, and a
 * node material would die in its `WebGLProgram`.
 *
 * The caller owns the returned disposer — these are not the template's.
 */
export function buildPreviewMaterials(dieKey) {
    const template = ensureDressedTemplate(dieKey);
    if (!template) return null;
    return createDiceMaterialForEntry(getDieEntry(dieKey), template, {
        ...getAppearanceOptions(),
        forceWebGL: true,
    });
}

/** The template for a die key, wearing the active set's look for it. */
export function ensureDressedTemplate(dieKey) {
    const template = ensureDieTemplate(dieKey);
    if (template && !materialDisposers.has(dieKey)) applyEntryToMeshes(dieKey, [template]);
    return template;
}

/** Patch one die's descriptor entry; the subscription re-dresses it. */
export function setDieAppearance(dieKey, patch) {
    return updateDieEntry(dieKey, patch);
}

/** Presence payload for multiplayer — the whole set, hashed. */
export function buildDicePresencePayload() {
    return buildDiceSetPresence();
}

/** Adopt a peer's set. Returns the set actually applied, or `null` if rejected. */
export function applyDicePresencePayload(presence) {
    return applyDiceSetPresence(presence);
}

export function acquireDiceMesh(type) {
    const pool = diceMeshPool[type];
    if (pool && pool.length > 0) {
        const mesh = pool.pop();
        mesh.visible = true;
        return mesh;
    }
    const template = ensureDressedTemplate(type);
    if (!template) return null;

    const mesh = template.clone();
    // A fresh clone wears the template's material, which is already the active
    // entry's — no rebuild needed, and no second material to dispose.
    mesh.material = template.material;
    return mesh;
}

export function releaseDiceMesh(scene, type, mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.userData.body = null;
    (diceMeshPool[type] ??= []).push(mesh);
}

/** Drop every built material. Used by renderer recovery before a rebuild. */
export function disposeDiceAppearance() {
    materialDisposers.forEach((dispose) => dispose());
    materialDisposers.clear();
}

export { disposeDiceMaterials, getActiveDiceSet, diceModels, diceTypes };
