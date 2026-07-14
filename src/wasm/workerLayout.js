/**
 * workerLayout.js
 *
 * Single source of truth for the SharedArrayBuffer memory layout shared between
 * the physics Web Worker (`dice_physics.worker.js`) and the main-thread proxy
 * (`WorkerPhysicsBridge.js`).  Keeping the constants in one module guarantees
 * both sides agree on offsets — a mismatch would silently corrupt transforms.
 *
 * Layout (one SharedArrayBuffer):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Int32 header (HEADER_INTS)                                   │
 *   │   [0] seqno    — incremented after every published frame     │
 *   │   [1] front    — index (0|1) of the buffer safe to read      │
 *   │   [2] count    — number of dice in the front buffer          │
 *   │   [3] settled  — 1 when all dice are sleeping, else 0         │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Buffer 0:  ids[MAX_DICE] (f32)   transforms[MAX_DICE*7] (f32)│
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Buffer 1:  ids[MAX_DICE] (f32)   transforms[MAX_DICE*7] (f32)│
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Command ring: CMD_RING_FLOATS (f32) — batched per-frame ops  │
 *   │   header[4] cmdHead  — producer (main thread)                  │
 *   │   header[5] cmdTail  — consumer (worker)                     │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The worker writes the freshly stepped frame into the *back* buffer, stores the
 * count, then atomically flips `front`.  Readers load `front` then `count`, so a
 * new `front` always implies the matching `count` is already visible (the worker
 * stores count before flipping).  This double-buffering yields tear-free reads
 * without locking.
 */

export const MAX_DICE = 500;          // must match dice_physics.cpp MAX_DICE
export const STRIDE = 7;              // [px,py,pz, qx,qy,qz,qw] per die

// Header (Int32). Indices 4..7 reserved for future use.
export const HEADER_INTS = 8;
export const HEADER_BYTES = HEADER_INTS * 4;

export const H_SEQNO = 0;
export const H_FRONT = 1;
export const H_COUNT = 2;
export const H_SETTLED = 3;
// Batched per-frame command ring (float slots).  Main thread publishes head
// after each flush; the worker drains up to head and advances tail.
export const H_CMD_HEAD = 4;
export const H_CMD_TAIL = 5;

// Per-buffer byte sizes.
export const IDS_BYTES = MAX_DICE * 4;            // f32 ids
export const XF_BYTES = MAX_DICE * STRIDE * 4;    // f32 transforms
export const BUFFER_BYTES = IDS_BYTES + XF_BYTES;

import { MAX_RECORD_LEN } from './workerCommands.js';

// Ring holds several frames of worst-case batched commands (transform = 9 floats).
export const CMD_RING_FLOATS = MAX_DICE * MAX_RECORD_LEN * 8;
export const CMD_RING_BYTES = CMD_RING_FLOATS * 4;

/** Transform double-buffer region (unchanged size). */
export const TRANSFORM_SAB_BYTES = HEADER_BYTES + 2 * BUFFER_BYTES;

/** Full SharedArrayBuffer: transforms + command ring. */
export const SAB_BYTES = TRANSFORM_SAB_BYTES + CMD_RING_BYTES;

/** Byte offset of the command ring (f32 slots). */
export const CMD_RING_OFFSET = TRANSFORM_SAB_BYTES;

/** Byte offset of the ids region for buffer `b` (0|1). */
export const idsOffset = (b) => HEADER_BYTES + b * BUFFER_BYTES;
/** Byte offset of the transforms region for buffer `b` (0|1). */
export const xfOffset = (b) => HEADER_BYTES + b * BUFFER_BYTES + IDS_BYTES;

/** True when SharedArrayBuffer + Atomics may be used (cross-origin isolated). */
export const sabSupported = () =>
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined' &&
    (typeof self === 'undefined' ? false : self.crossOriginIsolated === true);
