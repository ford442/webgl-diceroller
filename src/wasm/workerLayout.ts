/**
 * workerLayout.ts
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
 *   │   [4] cmdHead  — batched command ring producer (main thread)  │
 *   │   [5] cmdTail  — batched command ring consumer (worker)       │
 *   │   [6] pairCandidates — die–die broadphase pairs last step     │
 *   │   [7] sphereTests    — pairs passing sphere cull last step     │
 *   │   [8] satTests       — SAT hull tests last step               │
 *   │   [9] contacts       — die–die contacts resolved last step    │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Buffer 0:  ids[MAX_DICE] (f32)   transforms[MAX_DICE*7] (f32)│
 *   │            faceValues[MAX_DICE] (i32)                          │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Buffer 1:  ids[MAX_DICE] (f32)   transforms[MAX_DICE*7] (f32)│
 *   │            faceValues[MAX_DICE] (i32)                          │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Command ring: CMD_RING_FLOATS (f32) — batched per-frame ops  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The worker writes the freshly stepped frame into the *back* buffer, stores the
 * count, then atomically flips `front`.  Readers load `front` then `count`, so a
 * new `front` always implies the matching `count` is already visible (the worker
 * stores count before flipping).  This double-buffering yields tear-free reads
 * without locking.
 */

import { MAX_RECORD_LEN } from './workerCommands.js';

export const MAX_DICE = 500; // must match dice_physics.cpp MAX_DICE
export const STRIDE = 7; // [px,py,pz, qx,qy,qz,qw] per die

// Header (Int32).
export const HEADER_INTS = 10;
export const HEADER_BYTES = HEADER_INTS * 4;

export const H_SEQNO = 0;
export const H_FRONT = 1;
export const H_COUNT = 2;
export const H_SETTLED = 3;
export const H_CMD_HEAD = 4;
export const H_CMD_TAIL = 5;
export const H_PAIR_CANDIDATES = 6;
export const H_SPHERE_TESTS = 7;
export const H_SAT_TESTS = 8;
export const H_CONTACTS = 9;

// Per-buffer byte sizes.
export const IDS_BYTES = MAX_DICE * 4; // f32 ids
export const XF_BYTES = MAX_DICE * STRIDE * 4; // f32 transforms
export const FACE_VALUES_BYTES = MAX_DICE * 4; // i32 settled face values
export const BUFFER_BYTES = IDS_BYTES + XF_BYTES + FACE_VALUES_BYTES;

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
export const idsOffset = (b: 0 | 1): number => HEADER_BYTES + b * BUFFER_BYTES;
/** Byte offset of the transforms region for buffer `b` (0|1). */
export const xfOffset = (b: 0 | 1): number => HEADER_BYTES + b * BUFFER_BYTES + IDS_BYTES;
/** Byte offset of the settled face-value region for buffer `b` (0|1). */
export const faceValuesOffset = (b: 0 | 1): number =>
    HEADER_BYTES + b * BUFFER_BYTES + IDS_BYTES + XF_BYTES;

/** True when SharedArrayBuffer + Atomics may be used (cross-origin isolated). */
export const sabSupported = (): boolean =>
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined' &&
    (typeof self === 'undefined' ? false : self.crossOriginIsolated === true);

// ---------------------------------------------------------------------------
// Dynamic (non-die) rigid-body props — a second, separate SharedArrayBuffer.
//
// Kept independent of the dice transform SAB above rather than growing its
// header: dynamic props have their own small lifecycle (userId-addressed,
// capacity-checked, like static colliders) that shouldn't need to touch dice
// reset/replay bookkeeping. Same double-buffer discipline: worker writes the
// back buffer, stores count, then flips front.
//
//   ┌────────────────────────────────────────────────┐
//   │ Int32 header (DYN_HEADER_INTS)                   │
//   │   [0] front — index (0|1) of the buffer to read   │
//   │   [1] count — number of dynamic props in front    │
//   ├────────────────────────────────────────────────┤
//   │ Buffer 0: ids[MAX_DYNAMICS] (f32)  transforms[MAX_DYNAMICS*7] (f32) │
//   ├────────────────────────────────────────────────┤
//   │ Buffer 1: ids[MAX_DYNAMICS] (f32)  transforms[MAX_DYNAMICS*7] (f32) │
//   └────────────────────────────────────────────────┘
// ---------------------------------------------------------------------------

export const MAX_DYNAMICS = 64; // must match dice_physics_engine.hpp MAX_DYNAMICS
export const DYN_STRIDE = 7; // [px,py,pz, qx,qy,qz,qw] per dynamic prop

export const DYN_HEADER_INTS = 2;
export const DYN_HEADER_BYTES = DYN_HEADER_INTS * 4;
export const DYN_H_FRONT = 0;
export const DYN_H_COUNT = 1;

export const DYN_IDS_BYTES = MAX_DYNAMICS * 4;
export const DYN_XF_BYTES = MAX_DYNAMICS * DYN_STRIDE * 4;
export const DYN_BUFFER_BYTES = DYN_IDS_BYTES + DYN_XF_BYTES;

/** Full dynamics SharedArrayBuffer size. */
export const DYNAMICS_SAB_BYTES = DYN_HEADER_BYTES + 2 * DYN_BUFFER_BYTES;

/** Byte offset of the ids region for buffer `b` (0|1). */
export const dynIdsOffset = (b: 0 | 1): number => DYN_HEADER_BYTES + b * DYN_BUFFER_BYTES;
/** Byte offset of the transforms region for buffer `b` (0|1). */
export const dynXfOffset = (b: 0 | 1): number =>
    DYN_HEADER_BYTES + b * DYN_BUFFER_BYTES + DYN_IDS_BYTES;
