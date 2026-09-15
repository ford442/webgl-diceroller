/**
 * Tests for the batched physics command protocol: record encoding, linear
 * dispatch, and the ring-buffer drain/copy used by the SAB command channel.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    MAX_RECORD_LEN,
    OP,
    RECORD_LEN,
    copyIntoRing,
    countRecords,
    dispatchLinear,
    drainRing,
} from '../../src/wasm/workerCommands.js';

function makeMockEngine() {
    return {
        applyImpulse: vi.fn(),
        applyTorqueImpulse: vi.fn(),
        setDieTransform: vi.fn(),
        setDieVelocity: vi.fn(),
        applyDynamicImpulse: vi.fn(),
        applyDynamicTorqueImpulse: vi.fn(),
        setDynamicTransform: vi.fn(),
        setDynamicVelocity: vi.fn(),
    };
}

describe('record shapes', () => {
    it('MAX_RECORD_LEN covers the longest declared record', () => {
        expect(MAX_RECORD_LEN).toBe(Math.max(...Object.values(RECORD_LEN)));
    });

    it('every opcode has a positive, distinct record length mapping', () => {
        for (const [opcode, len] of Object.entries(RECORD_LEN)) {
            expect(Number(opcode)).toBeGreaterThan(0);
            expect(len).toBeGreaterThan(0);
            expect(len).toBeLessThanOrEqual(MAX_RECORD_LEN);
        }
    });

    it('opcode 0 is reserved (never a valid record), used as a ring wrap marker', () => {
        expect(RECORD_LEN[0 as keyof typeof RECORD_LEN]).toBeUndefined();
    });
});

describe('dispatchLinear', () => {
    it('dispatches an APPLY_IMPULSE record with the right args', () => {
        const engine = makeMockEngine();
        const buf = new Float32Array([OP.APPLY_IMPULSE, 7, 1, 2, 3]);
        const records = dispatchLinear(engine, buf);
        expect(records).toBe(1);
        expect(engine.applyImpulse).toHaveBeenCalledWith(7, 1, 2, 3);
    });

    it('dispatches every opcode type in one buffer, in order', () => {
        const engine = makeMockEngine();
        const buf = new Float32Array([
            OP.APPLY_IMPULSE,
            1,
            10,
            11,
            12,
            OP.APPLY_TORQUE,
            1,
            20,
            21,
            22,
            OP.SET_TRANSFORM,
            2,
            1,
            2,
            3,
            0,
            0,
            0,
            1,
            OP.SET_VELOCITY,
            2,
            4,
            5,
            6,
            0.5,
            0.25,
            0.125,
            OP.PROP_APPLY_IMPULSE,
            9,
            30,
            31,
            32,
            OP.PROP_APPLY_TORQUE,
            9,
            40,
            41,
            42,
            OP.PROP_SET_TRANSFORM,
            3,
            5,
            6,
            7,
            0,
            0,
            0,
            1,
            OP.PROP_SET_VELOCITY,
            3,
            8,
            9,
            10,
            0.25,
            0.5,
            0.75,
        ]);
        const records = dispatchLinear(engine, buf);
        expect(records).toBe(8);
        expect(engine.applyImpulse).toHaveBeenCalledWith(1, 10, 11, 12);
        expect(engine.applyTorqueImpulse).toHaveBeenCalledWith(1, 20, 21, 22);
        expect(engine.setDieTransform).toHaveBeenCalledWith(2, 1, 2, 3, 0, 0, 0, 1);
        expect(engine.setDieVelocity).toHaveBeenCalledWith(2, 4, 5, 6, 0.5, 0.25, 0.125);
        expect(engine.applyDynamicImpulse).toHaveBeenCalledWith(9, 30, 31, 32);
        expect(engine.applyDynamicTorqueImpulse).toHaveBeenCalledWith(9, 40, 41, 42);
        expect(engine.setDynamicTransform).toHaveBeenCalledWith(3, 5, 6, 7, 0, 0, 0, 1);
        expect(engine.setDynamicVelocity).toHaveBeenCalledWith(3, 8, 9, 10, 0.25, 0.5, 0.75);
    });

    it('tolerates optional dynamic-prop methods being absent on the target', () => {
        const engine = {
            applyImpulse: vi.fn(),
            applyTorqueImpulse: vi.fn(),
            setDieTransform: vi.fn(),
            setDieVelocity: vi.fn(),
            // no applyDynamicImpulse etc. — PhysicsCommandTarget marks these optional.
        };
        const buf = new Float32Array([OP.PROP_APPLY_IMPULSE, 1, 1, 2, 3]);
        expect(() => dispatchLinear(engine, buf)).not.toThrow();
    });

    it('stops at an unrecognized opcode without throwing', () => {
        const engine = makeMockEngine();
        const buf = new Float32Array([OP.APPLY_IMPULSE, 1, 1, 2, 3, 255, 0, 0, 0, 0]);
        const records = dispatchLinear(engine, buf);
        expect(records).toBe(1);
        expect(engine.applyImpulse).toHaveBeenCalledTimes(1);
    });

    it('stops when a trailing record is truncated (not enough floats left)', () => {
        const engine = makeMockEngine();
        // A SET_TRANSFORM record needs 9 floats; only 5 remain after the header.
        const buf = new Float32Array([OP.SET_TRANSFORM, 1, 1, 2, 3]);
        const records = dispatchLinear(engine, buf);
        expect(records).toBe(0);
        expect(engine.setDieTransform).not.toHaveBeenCalled();
    });

    it('respects the start/end window', () => {
        const engine = makeMockEngine();
        const buf = new Float32Array([
            OP.APPLY_IMPULSE,
            1,
            1,
            1,
            1,
            OP.APPLY_IMPULSE,
            2,
            2,
            2,
            2,
            OP.APPLY_IMPULSE,
            3,
            3,
            3,
            3,
        ]);
        const records = dispatchLinear(engine, buf, 5, 10);
        expect(records).toBe(1);
        expect(engine.applyImpulse).toHaveBeenCalledOnce();
        expect(engine.applyImpulse).toHaveBeenCalledWith(2, 2, 2, 2);
    });
});

describe('countRecords', () => {
    it('counts complete records and ignores a truncated trailing one', () => {
        const buf = new Float32Array([
            OP.APPLY_IMPULSE,
            1,
            1,
            1,
            1,
            OP.APPLY_TORQUE,
            2,
            2,
            2,
            2,
            OP.SET_TRANSFORM,
            3,
            1,
            2, // truncated — only 4 of 9 floats
        ]);
        expect(countRecords(buf)).toBe(2);
    });

    it('returns 0 for an empty buffer', () => {
        expect(countRecords(new Float32Array(0))).toBe(0);
    });
});

describe('copyIntoRing', () => {
    it('copies a record without wrapping when there is room', () => {
        const ring = new Float32Array(16);
        const src = new Float32Array([OP.APPLY_IMPULSE, 1, 2, 3, 4]);
        const newHead = copyIntoRing(ring, ring.length, 0, src);
        expect(newHead).toBe(5);
        expect(Array.from(ring.subarray(0, 5))).toEqual(Array.from(src));
    });

    it('wraps around the end of the ring', () => {
        const ring = new Float32Array(8);
        const src = new Float32Array([OP.APPLY_IMPULSE, 1, 2, 3, 4]); // 5 floats
        const newHead = copyIntoRing(ring, ring.length, 6, src); // starts 2 from the end
        // indices 6,7,0,1,2 (wrapping)
        expect(newHead).toBe(3);
        expect(ring[6]).toBe(OP.APPLY_IMPULSE);
        expect(ring[7]).toBe(1);
        expect(ring[0]).toBe(2);
        expect(ring[1]).toBe(3);
        expect(ring[2]).toBe(4);
    });
});

describe('drainRing', () => {
    it('drains a single record and dispatches it', () => {
        const engine = makeMockEngine();
        const ring = new Float32Array(16);
        const head = copyIntoRing(ring, ring.length, 0, [OP.APPLY_IMPULSE, 5, 1, 2, 3]);
        const newTail = drainRing(engine, ring, head, 0, ring.length);
        expect(newTail).toBe(head);
        expect(engine.applyImpulse).toHaveBeenCalledWith(5, 1, 2, 3);
    });

    it('drains multiple records written back-to-back', () => {
        const engine = makeMockEngine();
        const ring = new Float32Array(32);
        let head = 0;
        head = copyIntoRing(ring, ring.length, head, [OP.APPLY_IMPULSE, 1, 1, 1, 1]);
        head = copyIntoRing(ring, ring.length, head, [OP.APPLY_TORQUE, 2, 2, 2, 2]);
        const newTail = drainRing(engine, ring, head, 0, ring.length);
        expect(newTail).toBe(head);
        expect(engine.applyImpulse).toHaveBeenCalledWith(1, 1, 1, 1);
        expect(engine.applyTorqueImpulse).toHaveBeenCalledWith(2, 2, 2, 2);
    });

    it('drains a record that wraps around the ring boundary', () => {
        const engine = makeMockEngine();
        const capacity = 8;
        const ring = new Float32Array(capacity);
        // Place a 5-float record starting 2 slots from the end, so it wraps.
        const head = copyIntoRing(ring, capacity, 6, [OP.APPLY_IMPULSE, 42, 9, 8, 7]);
        expect(head).toBe(3); // (6 + 5) % 8

        const newTail = drainRing(engine, ring, head, 6, capacity);
        expect(newTail).toBe(head);
        expect(engine.applyImpulse).toHaveBeenCalledWith(42, 9, 8, 7);
    });

    it('treats a 0 opcode as an end-of-buffer wrap marker, not a record', () => {
        const engine = makeMockEngine();
        const capacity = 8;
        const ring = new Float32Array(capacity);
        // Tail starts at 6; slots 6,7 are left as the zero-padding wrap
        // marker, and the real record starts at 0.
        ring[6] = 0;
        ring[7] = 0;
        const head = copyIntoRing(ring, capacity, 0, [OP.APPLY_IMPULSE, 1, 1, 1, 1]);

        const newTail = drainRing(engine, ring, head, 6, capacity);
        expect(newTail).toBe(head);
        expect(engine.applyImpulse).toHaveBeenCalledWith(1, 1, 1, 1);
        expect(engine.applyImpulse).toHaveBeenCalledOnce();
    });

    it('does nothing when head === tail (empty ring)', () => {
        const engine = makeMockEngine();
        const ring = new Float32Array(8);
        const newTail = drainRing(engine, ring, 3, 3, ring.length);
        expect(newTail).toBe(3);
        expect(engine.applyImpulse).not.toHaveBeenCalled();
    });

    it('round-trips many records through copyIntoRing -> drainRing across wraps', () => {
        const engine = makeMockEngine();
        const capacity = 64;
        const ring = new Float32Array(capacity);
        let head = 0;
        let tail = 0;
        const expected: Array<[number, number, number, number]> = [];

        for (let i = 0; i < 40; i++) {
            const args: [number, number, number, number] = [i, i * 2, i * 3, i * 4];
            head = copyIntoRing(ring, capacity, head, [OP.APPLY_IMPULSE, ...args]);
            expected.push(args);
            // Drain eagerly every few writes, like the real head/tail protocol.
            if (i % 3 === 0) {
                tail = drainRing(engine, ring, head, tail, capacity);
            }
        }
        tail = drainRing(engine, ring, head, tail, capacity);
        expect(tail).toBe(head);

        expect(engine.applyImpulse).toHaveBeenCalledTimes(expected.length);
        expected.forEach((args, i) => {
            expect(engine.applyImpulse).toHaveBeenNthCalledWith(i + 1, ...args);
        });
    });
});
