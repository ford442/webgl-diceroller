import {
    addStaticCollider as wasmAddStaticCollider,
    addDynamicCollider as wasmAddDynamicCollider,
    getWasmEngine,
    removeStaticCollider as wasmRemoveStaticCollider,
    removeDynamicCollider as wasmRemoveDynamicCollider,
} from '../wasm/PhysicsBridge.js';

// getStaticCapacityDroppedCount() is only synchronously meaningful on the
// non-worker bridge (worker addStatic* commands are fire-and-forget and
// always return -1) — undefined there, so this stays silent on the default
// worker path. Track the last-seen count (not a monotonic high-water-mark)
// so a clearStatics()/init() reset (e.g. a table-layout reroll) re-arms the
// warning instead of a lower post-reset count being suppressed forever by a
// higher count from a previous registration pass.
let lastSeenStaticCapacityDropped = 0;

function warnOnStaticCapacityDrop(anchor) {
    const dropped = getWasmEngine?.()?.getStaticCapacityDroppedCount?.() ?? 0;
    if (dropped === lastSeenStaticCapacityDropped) return;
    lastSeenStaticCapacityDropped = dropped;
    if (!dropped) return;
    const label = anchor?.name || anchor?.userData?.propName || 'unknown prop';
    console.warn(
        `StaticColliderBridge: MAX_STATICS capacity reached — ${dropped} static ` +
            `collider(s) dropped so far (most recently while registering "${label}").`
    );
}

// Same "last-seen, not high-water-mark" tracking as warnOnStaticCapacityDrop,
// for the separate MAX_DYNAMICS cap.
let lastSeenDynamicCapacityDropped = 0;

function warnOnDynamicCapacityDrop(anchor) {
    const dropped = getWasmEngine?.()?.getDynamicCapacityDroppedCount?.() ?? 0;
    if (dropped === lastSeenDynamicCapacityDropped) return;
    lastSeenDynamicCapacityDropped = dropped;
    if (!dropped) return;
    const label = anchor?.name || anchor?.userData?.propName || 'unknown prop';
    console.warn(
        `StaticColliderBridge: MAX_DYNAMICS capacity reached — ${dropped} dynamic ` +
            `prop(s) dropped so far (most recently while registering "${label}").`
    );
}

/** @typedef {import('../types/staticCollider').StaticColliderSpec} StaticColliderSpec */

function vec3FromSpec(value = {}) {
    return {
        x: value.x ?? 0,
        y: value.y ?? 0,
        z: value.z ?? 0,
    };
}

function addVec3(base, delta) {
    const a = vec3FromSpec(base);
    const b = vec3FromSpec(delta);
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function addEuler(base, delta) {
    const a = vec3FromSpec(base);
    const b = vec3FromSpec(delta);
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Flatten compound specs into leaf colliders with merged local pose.
 * @param {StaticColliderSpec | { type: string, parts?: StaticColliderSpec[], offset?: object, rotation?: object, materialTag?: import('../types/staticCollider').StaticMaterialTag }} spec
 * @returns {StaticColliderSpec[]}
 */
export function flattenColliderSpecs(spec) {
    if (!spec) return [];
    if (spec.type === 'compound') {
        const merged = [];
        for (const part of spec.parts ?? []) {
            for (const leaf of flattenColliderSpecs(part)) {
                merged.push({
                    ...leaf,
                    offset: addVec3(spec.offset, leaf.offset),
                    rotation: addEuler(spec.rotation, leaf.rotation),
                    materialTag: leaf.materialTag ?? spec.materialTag,
                });
            }
        }
        return merged;
    }
    return [/** @type {StaticColliderSpec} */ (spec)];
}

function attachWasmIdToAnchor(anchor, wasmId) {
    if (wasmId == null || wasmId < 0) return;
    if (!Array.isArray(anchor.userData.wasmStaticIds)) {
        anchor.userData.wasmStaticIds = [];
    }
    anchor.userData.wasmStaticIds.push(wasmId);
}

/**
 * Create a static collider from a declarative spec on the WASM engine.
 *
 * @returns {{ wasmId?: number } | null}
 */
export function createStaticCollider(physicsWorld, anchor, spec) {
    if (!anchor || !spec) return null;

    const leaves = flattenColliderSpecs(spec);
    if (leaves.length === 0) return null;

    let first = null;
    for (const leaf of leaves) {
        const wasmId = wasmAddStaticCollider(leaf, anchor);
        if (wasmId < 0) continue;
        attachWasmIdToAnchor(anchor, wasmId);
        if (!first) first = { wasmId };
    }
    warnOnStaticCapacityDrop(anchor);
    return first;
}

export function destroyWasmStaticCollider(wasmId) {
    wasmRemoveStaticCollider(wasmId);
}

function attachWasmDynamicIdToAnchor(anchor, wasmId) {
    if (wasmId == null || wasmId < 0) return;
    if (!Array.isArray(anchor.userData.wasmDynamicIds)) {
        anchor.userData.wasmDynamicIds = [];
    }
    anchor.userData.wasmDynamicIds.push(wasmId);
}

/**
 * Create a dynamic (movable) collider from a declarative spec (`dynamic: true`
 * + `mass`). Unlike `createStaticCollider`, compound specs are not flattened
 * — a single moving rigid body per spec, matching the C++ addDynamicBox /
 * addDynamicHull surface.
 *
 * @returns {{ wasmId?: number } | null}
 */
export function createDynamicCollider(physicsWorld, anchor, spec) {
    if (!anchor || !spec) return null;
    if (!spec.mass || spec.mass <= 0) {
        console.warn(
            `StaticColliderBridge: dynamic collider requires mass > 0 (anchor "${anchor?.name || 'unknown'}")`
        );
        return null;
    }

    const wasmId = wasmAddDynamicCollider(spec, anchor);
    if (wasmId < 0) return null;
    attachWasmDynamicIdToAnchor(anchor, wasmId);
    anchor.userData.isDynamicProp = true;
    warnOnDynamicCapacityDrop(anchor);
    return { wasmId };
}

export function destroyWasmDynamicCollider(wasmId) {
    wasmRemoveDynamicCollider(wasmId);
}
