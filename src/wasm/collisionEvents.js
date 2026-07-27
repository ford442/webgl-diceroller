/** Floats per collision record from WASM (9 since static-collider rollout). */
export const COLLISION_EVENT_STRIDE = 9;

/**
 * @param {Float32Array} buf
 * @returns {import('./physicsTypes').CollisionEvent[]}
 */
export function parseCollisionEventBuffer(buf) {
    if (!buf || buf.length === 0) return [];
    const stride = buf.length % COLLISION_EVENT_STRIDE === 0 ? COLLISION_EVENT_STRIDE : 7;
    /** @type {import('./physicsTypes').CollisionEvent[]} */
    const out = [];
    for (let i = 0; i + stride - 1 < buf.length; i += stride) {
        /** @type {import('./physicsTypes').CollisionEvent} */
        const ev = {
            idA: Math.round(buf[i]),
            idB: Math.round(buf[i + 1]),
            impactSpeed: buf[i + 2],
            mass: buf[i + 3],
            inertiaScalar: buf[i + 4],
            linearSpeedSq: buf[i + 5],
            angularSpeedSq: buf[i + 6],
            staticColliderId: 0,
            materialTag: 0,
        };
        if (stride >= COLLISION_EVENT_STRIDE) {
            ev.staticColliderId = Math.round(buf[i + 7]);
            ev.materialTag = Math.round(buf[i + 8]);
        }
        out.push(ev);
    }
    return out;
}
