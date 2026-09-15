import type { Object3D } from 'three';
import type { AnyColliderSpec, StaticColliderSpec } from '../types/staticCollider.js';
import {
    addDynamicCollider as wasmAddDynamicCollider,
    addStaticCollider as wasmAddStaticCollider,
    getWasmEngine,
    removeDynamicCollider as wasmRemoveDynamicCollider,
    removeStaticCollider as wasmRemoveStaticCollider,
} from '../wasm/PhysicsBridge.js';

let lastSeenStaticCapacityDropped = 0;

function warnOnStaticCapacityDrop(anchor: Object3D): void {
    const dropped = getWasmEngine?.()?.getStaticCapacityDroppedCount?.() ?? 0;
    if (dropped === lastSeenStaticCapacityDropped) return;
    lastSeenStaticCapacityDropped = dropped;
    if (!dropped) return;
    const label =
        anchor?.name || (anchor?.userData as { propName?: string })?.propName || 'unknown prop';
    console.warn(
        `StaticColliderBridge: MAX_STATICS capacity reached — ${dropped} static ` +
            `collider(s) dropped so far (most recently while registering "${label}").`
    );
}

let lastSeenDynamicCapacityDropped = 0;

function warnOnDynamicCapacityDrop(anchor: Object3D): void {
    const dropped = getWasmEngine?.()?.getDynamicCapacityDroppedCount?.() ?? 0;
    if (dropped === lastSeenDynamicCapacityDropped) return;
    lastSeenDynamicCapacityDropped = dropped;
    if (!dropped) return;
    const label =
        anchor?.name || (anchor?.userData as { propName?: string })?.propName || 'unknown prop';
    console.warn(
        `StaticColliderBridge: MAX_DYNAMICS capacity reached — ${dropped} dynamic ` +
            `prop(s) dropped so far (most recently while registering "${label}").`
    );
}

function vec3FromSpec(value: { x?: number; y?: number; z?: number } | number[] = {}): {
    x: number;
    y: number;
    z: number;
} {
    if (Array.isArray(value)) {
        return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
    }
    return {
        x: value.x ?? 0,
        y: value.y ?? 0,
        z: value.z ?? 0,
    };
}

function addVec3(
    base: { x?: number; y?: number; z?: number } | number[] | undefined,
    delta: { x?: number; y?: number; z?: number } | number[] | undefined
) {
    const a = vec3FromSpec(base);
    const b = vec3FromSpec(delta);
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function addEuler(
    base: { x?: number; y?: number; z?: number } | number[] | undefined,
    delta: { x?: number; y?: number; z?: number } | number[] | undefined
) {
    return addVec3(base, delta);
}

export function flattenColliderSpecs(
    spec: AnyColliderSpec | null | undefined
): StaticColliderSpec[] {
    if (!spec) return [];
    if (spec.type === 'compound') {
        const merged: StaticColliderSpec[] = [];
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
    return [spec];
}

function attachWasmIdToAnchor(anchor: Object3D, wasmId: number): void {
    if (wasmId == null || wasmId < 0) return;
    if (!Array.isArray(anchor.userData.wasmStaticIds)) {
        anchor.userData.wasmStaticIds = [];
    }
    (anchor.userData.wasmStaticIds as number[]).push(wasmId);
}

export function createStaticCollider(
    _physicsWorld: unknown,
    anchor: Object3D | null | undefined,
    spec: AnyColliderSpec | null | undefined
): { wasmId?: number } | null {
    if (!anchor || !spec) return null;

    const leaves = flattenColliderSpecs(spec);
    if (leaves.length === 0) return null;

    let first: { wasmId: number } | null = null;
    for (const leaf of leaves) {
        const wasmId = wasmAddStaticCollider(leaf, anchor);
        if (wasmId < 0) continue;
        attachWasmIdToAnchor(anchor, wasmId);
        if (!first) first = { wasmId };
    }
    warnOnStaticCapacityDrop(anchor);
    return first;
}

export function destroyWasmStaticCollider(wasmId: number): void {
    wasmRemoveStaticCollider(wasmId);
}

function attachWasmDynamicIdToAnchor(anchor: Object3D, wasmId: number): void {
    if (wasmId == null || wasmId < 0) return;
    if (!Array.isArray(anchor.userData.wasmDynamicIds)) {
        anchor.userData.wasmDynamicIds = [];
    }
    (anchor.userData.wasmDynamicIds as number[]).push(wasmId);
}

export function createDynamicCollider(
    _physicsWorld: unknown,
    anchor: Object3D | null | undefined,
    spec: StaticColliderSpec | null | undefined
): { wasmId?: number } | null {
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

export function destroyWasmDynamicCollider(wasmId: number): void {
    wasmRemoveDynamicCollider(wasmId);
}
