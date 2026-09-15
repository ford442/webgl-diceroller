import type { CollisionEvent } from './physicsTypes.js';

/** Floats per collision record from WASM (9 since static-collider rollout). */
export const COLLISION_EVENT_STRIDE = 9;

export function parseCollisionEventBuffer(buf: Float32Array | null | undefined): CollisionEvent[] {
    if (!buf || buf.length === 0) return [];
    const stride = buf.length % COLLISION_EVENT_STRIDE === 0 ? COLLISION_EVENT_STRIDE : 7;
    const out: CollisionEvent[] = [];
    for (let i = 0; i + stride - 1 < buf.length; i += stride) {
        const ev: CollisionEvent = {
            idA: Math.round(buf[i] ?? 0),
            idB: Math.round(buf[i + 1] ?? 0),
            impactSpeed: buf[i + 2] ?? 0,
            mass: buf[i + 3] ?? 0,
            inertiaScalar: buf[i + 4] ?? 0,
            linearSpeedSq: buf[i + 5] ?? 0,
            angularSpeedSq: buf[i + 6] ?? 0,
            staticColliderId: 0,
            materialTag: 0,
        };
        if (stride >= COLLISION_EVENT_STRIDE) {
            ev.staticColliderId = Math.round(buf[i + 7] ?? 0);
            ev.materialTag = Math.round(buf[i + 8] ?? 0);
        }
        out.push(ev);
    }
    return out;
}
