/**
 * workerCommands.js
 *
 * Shared batched-command protocol for the physics Web Worker.  High-frequency
 * per-die mutations (torque impulses, kinematic transforms/velocities) are
 * encoded as compact float records and flushed once per main-thread frame
 * instead of one postMessage per call.
 *
 * Record layout: [opcode, dieId, ...payload] — all f32.
 *
 * Structural / rare commands (addDie, init, …) stay on plain postMessage.
 */

/** @enum {number} */
export const OP = {
    APPLY_IMPULSE: 1,
    APPLY_TORQUE: 2,
    SET_TRANSFORM: 3,
    SET_VELOCITY: 4,
};

/** Floats per record (including opcode + id). */
export const RECORD_LEN = {
    [OP.APPLY_IMPULSE]: 5,
    [OP.APPLY_TORQUE]: 5,
    [OP.SET_TRANSFORM]: 9,
    [OP.SET_VELOCITY]: 8,
};

const MAX_RECORD_LEN = 9;

/**
 * Dispatch every record in a linear command buffer.
 * @param {import('./physicsTypes').PhysicsEngine} engine
 * @param {Float32Array} buf
 * @param {number} [start]
 * @param {number} [end]
 * @returns {number} records dispatched
 */
export function dispatchLinear(engine, buf, start = 0, end = buf.length) {
    let records = 0;
    let i = start;
    while (i < end) {
        const opcode = buf[i];
        const len = RECORD_LEN[opcode];
        if (!len || i + len > end) break;
        const id = buf[i + 1];
        switch (opcode) {
            case OP.APPLY_IMPULSE:
                engine.applyImpulse(id, buf[i + 2], buf[i + 3], buf[i + 4]);
                break;
            case OP.APPLY_TORQUE:
                engine.applyTorqueImpulse(id, buf[i + 2], buf[i + 3], buf[i + 4]);
                break;
            case OP.SET_TRANSFORM:
                engine.setDieTransform(
                    id,
                    buf[i + 2], buf[i + 3], buf[i + 4],
                    buf[i + 5], buf[i + 6], buf[i + 7], buf[i + 8]
                );
                break;
            case OP.SET_VELOCITY:
                engine.setDieVelocity(
                    id,
                    buf[i + 2], buf[i + 3], buf[i + 4],
                    buf[i + 5], buf[i + 6], buf[i + 7]
                );
                break;
            default:
                return records;
        }
        i += len;
        records++;
    }
    return records;
}

/**
 * Drain a ring-buffered command queue from `tail` up to `head` (exclusive).
 * @returns {number} new tail index
 */
export function drainRing(engine, ring, head, tail, capacity) {
    let t = tail;
    while (t !== head) {
        const opcode = ring[t];
        if (opcode === 0) {
            t = 0;
            if (t === head) break;
            continue;
        }
        const len = RECORD_LEN[opcode];
        if (!len) {
            t = (t + 1) % capacity;
            continue;
        }
        const scratch = new Float32Array(len);
        for (let j = 0; j < len; j++) scratch[j] = ring[(t + j) % capacity];
        dispatchLinear(engine, scratch, 0, len);
        t = (t + len) % capacity;
    }
    return t;
}

/** Copy `src` into `ring` starting at `head`, wrapping as needed. */
export function copyIntoRing(ring, capacity, head, src) {
    for (let i = 0; i < src.length; i++) {
        ring[(head + i) % capacity] = src[i];
    }
    return (head + src.length) % capacity;
}

/** Count records in a linear buffer (for debug stats). */
export function countRecords(buf, start = 0, end = buf.length) {
    let records = 0;
    let i = start;
    while (i < end) {
        const len = RECORD_LEN[buf[i]];
        if (!len || i + len > end) break;
        i += len;
        records++;
    }
    return records;
}

export { MAX_RECORD_LEN };
