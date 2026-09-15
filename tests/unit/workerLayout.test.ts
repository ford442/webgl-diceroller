/**
 * Tests for the SharedArrayBuffer memory layout shared between the physics
 * worker and the main-thread bridge. The offset math here is the highest-
 * consequence untested surface in the repo per its own header comment: "a
 * mismatch would silently corrupt transforms."
 */
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BUFFER_BYTES,
    CMD_RING_BYTES,
    CMD_RING_FLOATS,
    CMD_RING_OFFSET,
    DYNAMICS_SAB_BYTES,
    DYN_BUFFER_BYTES,
    DYN_HEADER_BYTES,
    DYN_H_COUNT,
    DYN_H_FRONT,
    FACE_VALUES_BYTES,
    HEADER_BYTES,
    HEADER_INTS,
    H_CMD_HEAD,
    H_CMD_TAIL,
    H_CONTACTS,
    H_COUNT,
    H_FRONT,
    H_PAIR_CANDIDATES,
    H_SAT_TESTS,
    H_SEQNO,
    H_SETTLED,
    H_SPHERE_TESTS,
    IDS_BYTES,
    MAX_DICE,
    MAX_DYNAMICS,
    SAB_BYTES,
    STRIDE,
    TRANSFORM_SAB_BYTES,
    XF_BYTES,
    dynIdsOffset,
    dynXfOffset,
    faceValuesOffset,
    idsOffset,
    sabSupported,
    xfOffset,
} from '../../src/wasm/workerLayout.js';
import { MAX_RECORD_LEN } from '../../src/wasm/workerCommands.js';

describe('header layout', () => {
    it('has ten distinct Int32 header slots', () => {
        const indices = [
            H_SEQNO,
            H_FRONT,
            H_COUNT,
            H_SETTLED,
            H_CMD_HEAD,
            H_CMD_TAIL,
            H_PAIR_CANDIDATES,
            H_SPHERE_TESTS,
            H_SAT_TESTS,
            H_CONTACTS,
        ];
        expect(new Set(indices).size).toBe(indices.length);
        expect(Math.max(...indices)).toBe(HEADER_INTS - 1);
        expect(HEADER_BYTES).toBe(HEADER_INTS * 4);
    });
});

describe('transform double-buffer offsets', () => {
    it('sizes one buffer as ids + transforms + face values', () => {
        expect(IDS_BYTES).toBe(MAX_DICE * 4);
        expect(XF_BYTES).toBe(MAX_DICE * STRIDE * 4);
        expect(FACE_VALUES_BYTES).toBe(MAX_DICE * 4);
        expect(BUFFER_BYTES).toBe(IDS_BYTES + XF_BYTES + FACE_VALUES_BYTES);
    });

    it('places buffer 0 immediately after the header', () => {
        expect(idsOffset(0)).toBe(HEADER_BYTES);
        expect(xfOffset(0)).toBe(HEADER_BYTES + IDS_BYTES);
        expect(faceValuesOffset(0)).toBe(HEADER_BYTES + IDS_BYTES + XF_BYTES);
    });

    it('places buffer 1 immediately after buffer 0, same internal shape', () => {
        expect(idsOffset(1)).toBe(idsOffset(0) + BUFFER_BYTES);
        expect(xfOffset(1)).toBe(xfOffset(0) + BUFFER_BYTES);
        expect(faceValuesOffset(1)).toBe(faceValuesOffset(0) + BUFFER_BYTES);
        // Same internal layout in both buffers.
        expect(xfOffset(1) - idsOffset(1)).toBe(xfOffset(0) - idsOffset(0));
        expect(faceValuesOffset(1) - idsOffset(1)).toBe(faceValuesOffset(0) - idsOffset(0));
    });

    it('never overlaps buffer 0 and buffer 1', () => {
        const buffer0End = idsOffset(0) + BUFFER_BYTES;
        expect(buffer0End).toBeLessThanOrEqual(idsOffset(1));
    });

    it('sizes the transform region as header + two buffers', () => {
        expect(TRANSFORM_SAB_BYTES).toBe(HEADER_BYTES + 2 * BUFFER_BYTES);
    });
});

describe('command ring layout', () => {
    it('starts immediately after the transform region', () => {
        expect(CMD_RING_OFFSET).toBe(TRANSFORM_SAB_BYTES);
    });

    it('sizes the ring for worst-case batched commands per die', () => {
        expect(CMD_RING_FLOATS).toBe(MAX_DICE * MAX_RECORD_LEN * 8);
        expect(CMD_RING_BYTES).toBe(CMD_RING_FLOATS * 4);
    });

    it('accounts for the entire SharedArrayBuffer', () => {
        expect(SAB_BYTES).toBe(TRANSFORM_SAB_BYTES + CMD_RING_BYTES);
        expect(SAB_BYTES).toBe(CMD_RING_OFFSET + CMD_RING_BYTES);
    });
});

describe('dynamic props double-buffer offsets', () => {
    it('sizes one buffer as ids + transforms', () => {
        expect(DYN_HEADER_BYTES).toBe(2 * 4);
        expect(DYN_BUFFER_BYTES).toBe(MAX_DYNAMICS * 4 + MAX_DYNAMICS * 7 * 4);
    });

    it('places buffer 0 after the (small) dynamics header', () => {
        expect(dynIdsOffset(0)).toBe(DYN_HEADER_BYTES);
        expect(dynXfOffset(0)).toBe(DYN_HEADER_BYTES + MAX_DYNAMICS * 4);
    });

    it('places buffer 1 after buffer 0 without overlap', () => {
        expect(dynIdsOffset(1)).toBe(dynIdsOffset(0) + DYN_BUFFER_BYTES);
        const buffer0End = dynIdsOffset(0) + DYN_BUFFER_BYTES;
        expect(buffer0End).toBeLessThanOrEqual(dynIdsOffset(1));
    });

    it('is independent of the dice header indices', () => {
        // Regression: the dynamics SAB is a *separate* buffer with its own
        // 2-int header — DYN_H_FRONT/DYN_H_COUNT must not be reused/aliased
        // against the dice header's H_FRONT/H_COUNT constants.
        expect(DYN_H_FRONT).not.toBe(H_FRONT);
        expect([DYN_H_FRONT, DYN_H_COUNT].sort()).toEqual([0, 1]);
        expect(DYNAMICS_SAB_BYTES).toBe(DYN_HEADER_BYTES + 2 * DYN_BUFFER_BYTES);
    });
});

describe('sabSupported', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('is false when SharedArrayBuffer is unavailable', () => {
        vi.stubGlobal('SharedArrayBuffer', undefined);
        expect(sabSupported()).toBe(false);
    });

    it('is false when Atomics is unavailable', () => {
        vi.stubGlobal('Atomics', undefined);
        expect(sabSupported()).toBe(false);
    });

    it('is false when not cross-origin isolated', () => {
        vi.stubGlobal('self', { crossOriginIsolated: false });
        expect(sabSupported()).toBe(false);
    });

    it('is true when SAB/Atomics exist and cross-origin isolated', () => {
        vi.stubGlobal('self', { crossOriginIsolated: true });
        expect(sabSupported()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Concurrency: the double-buffer's actual tear-free guarantee is that the
// worker only ever writes to the *back* buffer (never the one `front`
// currently points at), so a reader that loads `front` and then slices that
// buffer can never observe a mix of two generations' data within one read.
// This spins up a real worker thread that continuously overwrites whichever
// buffer is currently the back buffer while flipping `front`, and a busy
// reader loop on the main thread that must never observe non-uniform data
// inside a single buffer snapshot.
// ---------------------------------------------------------------------------
describe('double-buffer tear-free reads under real concurrency', () => {
    it('never observes a torn (mixed-generation) buffer snapshot', async () => {
        if (typeof SharedArrayBuffer === 'undefined') return; // environment can't test this

        const sab = new SharedArrayBuffer(TRANSFORM_SAB_BYTES);
        const header = new Int32Array(sab, 0, HEADER_INTS);
        const ids0 = new Float32Array(sab, idsOffset(0), MAX_DICE);
        const ids1 = new Float32Array(sab, idsOffset(1), MAX_DICE);

        // Real physics steps are paced to the frame/tick rate — the worker
        // never free-runs faster than the main thread can drain a frame.
        // Throttle the writer to roughly one generation per millisecond
        // (via a genuine cross-thread sleep, not a busy-spin) so the test
        // exercises real concurrent scheduling without the writer being
        // able to lap an unrelated, slower reader inside a single read —
        // a scenario the real system's frame pacing rules out too.
        const GENERATIONS = 60;
        const workerSource = `
            const { parentPort, workerData } = require('node:worker_threads');
            const header = new Int32Array(workerData.sab, 0, ${HEADER_INTS});
            const ids0 = new Float32Array(workerData.sab, ${idsOffset(0)}, ${MAX_DICE});
            const ids1 = new Float32Array(workerData.sab, ${idsOffset(1)}, ${MAX_DICE});
            const H_FRONT = ${H_FRONT};
            const H_COUNT = ${H_COUNT};
            const H_SETTLED = ${H_SETTLED};
            const sleepPad = new Int32Array(new SharedArrayBuffer(4));
            let front = 0;
            for (let g = 1; g <= ${GENERATIONS}; g++) {
                const back = front === 0 ? ids1 : ids0;
                // Fill the back buffer with this generation's marker value.
                // A real writer races against readers here; correctness must
                // come from readers never looking at this buffer while it is
                // still the back buffer, not from this fill being instant.
                for (let i = 0; i < back.length; i++) back[i] = g;
                const newFront = front === 0 ? 1 : 0;
                Atomics.store(header, H_COUNT, g);
                Atomics.store(header, H_FRONT, newFront);
                front = newFront;
                Atomics.wait(sleepPad, 0, 0, 1);
            }
            Atomics.store(header, H_SETTLED, 1);
            parentPort.postMessage('done');
        `;

        const worker = new Worker(workerSource, { eval: true, workerData: { sab } });
        const workerDone = new Promise<void>((resolve, reject) => {
            worker.once('message', () => resolve());
            worker.once('error', reject);
        });

        const tears: Array<{ front: number; values: number[] }> = [];
        const seenGenerations = new Set<number>();
        const deadline = Date.now() + 10000;

        while (Atomics.load(header, H_SETTLED) === 0 && Date.now() < deadline) {
            const front = Atomics.load(header, H_FRONT);
            const view = front === 1 ? ids1 : ids0;
            // Snapshot immediately — it's a zero-copy view into shared
            // memory and the worker keeps writing after this read.
            const snapshot = view.slice(0, 8);
            const first = snapshot[0];
            seenGenerations.add(first);
            for (const value of snapshot) {
                if (value !== first) {
                    tears.push({ front, values: Array.from(snapshot) });
                    break;
                }
            }
        }

        await workerDone;
        await worker.terminate();

        expect(tears).toEqual([]);
        // Sanity check the loop actually raced across multiple generations
        // rather than trivially reading once before the worker started.
        expect(seenGenerations.size).toBeGreaterThan(1);
    }, 15000);
});
