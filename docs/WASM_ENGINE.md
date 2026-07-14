# WASM Physics Engine — Integration Guide

> **Status:** Phase 4 complete — the WASM engine runs in a production Web Worker
> by default, exchanging transforms over a double-buffered SharedArrayBuffer
> (with a postMessage fallback). Phase 3 features (SAT polyhedral collision,
> deterministic replay, collision events, build-time hull extraction) remain.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Build Instructions](#build-instructions)
4. [API Reference](#api-reference)
5. [Integration Points](#integration-points)
6. [Performance Baseline](#performance-baseline)
7. [Roadmap](#roadmap)

---

## Overview

This document describes the integration of a custom C++ physics engine compiled
to WebAssembly (WASM) into the WebGL Dice Roller application.

### Why WASM?

| Concern | Current (ammo.js) | WASM Engine |
|---------|-------------------|-------------|
| Execution speed | ~JS speed (Bullet WASM via ammo.js) | Near-native via Emscripten |
| Bundle size | ~2 MB (full Bullet Physics) | ~16 KB gzipped (tailored solver) |
| Dice-specific tuning | Limited — general-purpose solver | Full control |
| Determinism | Floating-point non-determinism | Reproducible with fixed seed |
| Multi-threading | Not supported | Experimental Web Worker bridge |

### Completed milestones

- [x] Set up the C++/Emscripten/CMake build pipeline.
- [x] Implement a self-contained lightweight impulse solver (`DicePhysicsEngine`).
- [x] Expose the engine to JavaScript via Embind.
- [x] Write a JavaScript bridge (`WasmPhysicsBridge.js`) with a graceful stub fallback.
- [x] Integrate the bridge into `src/main.js` (loads in parallel, non-blocking).
- [x] Replace the normal simulation step with `engine.step(dt)` when WASM is available.
- [x] Drive `updateDiceVisuals()` from `engine.getTransforms()` in the authoritative path.
- [x] Mirror spawn/throw/remove lifecycle events into the WASM world.
- [x] **Phase 3:** Build-time convex-hull extraction from Draco-compressed GLB models.
- [x] **Phase 3:** SAT-based polyhedral collision detection (die-die + die-table).
- [x] **Phase 3:** Deterministic xorshift64* PRNG + state serialization for replay.
- [x] **Phase 3:** Collision event buffer for audio/gameplay hooks.
- [x] **Phase 3:** Hardening — max dice limits, hull vertex limits, memory caps, NaN checks.
- [x] **Phase 3:** Experimental Web Worker bridge (`WorkerPhysicsBridge.js`).

---

## Architecture

### JS ↔ WASM Responsibility Split

```
┌─────────────────────────────────────────────────┐
│  JavaScript (Three.js / browser)                │
│                                                 │
│  • Scene graph & rendering (WebGL / Three.js)   │
│  • Materials, textures, post-processing         │
│  • Camera, pointer-lock FPS movement            │
│  • User input (mouse, keyboard)                 │
│  • UI (dice picker, results overlay)            │
│  • Asset loading (glTF + Draco models)          │
│  • ammo.js fallback world + interaction         │
│    constraints (drag, levitation)               │
│  • Collision-event → audio callbacks            │
└───────────────────┬─────────────────────────────┘
                    │  Float32Array transforms
                    │  (7 floats/die: pos + quat)
                    ▼
┌─────────────────────────────────────────────────┐
│  WASM (dice_physics.cpp / Emscripten)           │
│                                                 │
│  • Rigid-body state (position, velocity, rot)   │
│  • Gravity integration                          │
│  • Sleep detection (settle logic)               │
│  • Impulse & torque application                 │
│  • SAT polyhedral collision (die-die, table)    │
│  • Deterministic PRNG + state snapshots         │
│  • Collision event generation                   │
└─────────────────────────────────────────────────┘
```

### Integration Model

The WASM engine owns ordinary dice simulation when the compiled module is
available. `ammo.js` still exists for three reasons:

- Browser/build fallback when the WASM artifacts are absent or `?no-wasm` is set.
- Drag constraints and levitation handoff (temporary until mirrored into WASM).
- Optional `?dual-physics` validation runs where both engines step in parallel.

### Worker topology (Phase 4 default)

```
┌───────────────────────────── Main thread ─────────────────────────────┐
│  Three.js / WebGPU render · input · godrays · audio                     │
│  PhysicsBridge (facade) → WorkerPhysicsBridge (sync proxy)              │
│    • addDie() returns id immediately (mirrored monotonic counter)       │
│    • getTransforms()/getDieIds() = Atomics read of SAB front buffer     │
│    • step() is a no-op (worker self-paces)                              │
└───────────┬───────────────────────────────────▲───────────────────────┘
   commands  │ postMessage                       │ SharedArrayBuffer (transforms)
   (init,    │                                   │ + postMessage (collision events)
   addDie,   ▼                                   │
   impulse) ┌────────────────── physics worker ──┴───────────────────────┐
            │  dice_physics.worker.js                                      │
            │   • owns DicePhysicsEngine (WASM)                            │
            │   • setInterval fixed-timestep loop @ 120 Hz                 │
            │   • copies heap transforms → SAB back buffer, flips `front`  │
            └──────────────────────────────────────────────────────────── ┘
```

The SAB layout (header + two transform/id buffers) lives in `workerLayout.js`,
the single source of truth shared by both threads. The worker writes the freshly
stepped frame into the back buffer, stores `count`, then atomically flips
`front`; readers load `front` then `count`, guaranteeing a coherent snapshot
without locks. When the page is not cross-origin isolated the worker instead
posts copied `snapshot` messages — it never transfers the WASM heap buffer.

### Data Transfer Strategy

Transforms are exchanged via a `Float32Array` memory view:

```
[px, py, pz, qx, qy, qz, qw,  ← die 0
 px, py, pz, qx, qy, qz, qw,  ← die 1
 …]
```

`engine.getTransforms()` returns a typed memory view directly into the WASM
heap — **zero copy** from C++ to JS.  The view is valid until the next
structural mutation (`addDie` / `removeDie` / `clearAllDice`).

### Convex Hull Pipeline

Dice models are now Draco-compressed GLB files (`public/images/dice/*.glb`).
A build-time Node script (`scripts/extract-hulls.mjs`) reads each GLB via
`@gltf-transform/core` + `draco3dgltf`, computes the canonical polyhedral
vertices, and writes `public/wasm/hulls.json`.  At runtime the JS bridge loads
this JSON and passes hull vertices to `engine.setDieHull(id, vertices)`.

---

## Build Instructions

### Prerequisites

1. **Install Emscripten SDK** (one-time):
   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh
   ```

2. Verify installation:
   ```bash
   emcc --version
   # emcc (Emscripten gcc/clang-like replacement) 3.x.x
   ```

### Build WASM module

```bash
# From the repository root:
npm run build:wasm

# Equivalent direct invocation:
cd src/wasm && ./build.sh
```

### Runtime flags

- (default) the WASM engine runs in a **Web Worker** with SharedArrayBuffer
  transport when the page is cross-origin isolated (COOP/COEP set).
- `?no-worker` (or `?worker-physics=off`) runs the WASM engine **in-process** on
  the main thread (the legacy `WasmPhysicsBridge` path).
- `?no-wasm` forces the JS/ammo fallback path even if `public/wasm/` is present.
- `?dual-physics` steps ammo and WASM in parallel for divergence checks
  (implies the in-process path; dual validation needs both engines main-thread).
- `?worker-physics` is the explicit opt-in alias for the now-default worker path.
- `?ammo-drag` keeps drag/levitation on the legacy ammo constraint path; by
  default interactions are driven kinematically inside the WASM world.

### Cross-origin isolation (required for the fast path)

SharedArrayBuffer requires the document to be **cross-origin isolated**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These are set on both the Vite dev server and `vite preview` (`vite.config.js`).
**Production/static hosting (test.1ink.us, go.1ink.us) must emit the same two
headers** — otherwise `crossOriginIsolated` is false, `SharedArrayBuffer` is
unavailable, and the worker bridge transparently downgrades to copy-out
`postMessage` snapshots (correct, just a little more per-frame overhead).

Output files land in `public/wasm/`:
- `dice_physics.js`   — Emscripten ES module loader
- `dice_physics.wasm` — Compiled binary (~16 KB gzipped)
- `hulls.json`        — Precomputed convex hull vertices per die type

### CMake alternative (advanced)

```bash
mkdir build && cd build
emcmake cmake ../src/wasm
emmake make
```

### Full application build

```bash
npm run build:wasm   # compile C++ → WASM (requires emcc)
npm run build        # build JS app with Vite (includes wasm artifacts)
npm run preview      # preview production build
```

---

## API Reference

### `WasmPhysicsBridge.js` (JavaScript)

```js
import {
    loadWasmEngine,
    getWasmEngine,
    isWasmAvailable,
    isWasmInitialized,
    loadHullForDie,
    pollCollisionEvents,
    seedPhysicsRNG,
    randomPhysicsFloat,
    serializePhysicsState,
    deserializePhysicsState,
} from './src/wasm/WasmPhysicsBridge.js';

// Initialize once during app startup (await is optional — non-blocking)
await loadWasmEngine();

// Check status
isWasmAvailable();   // true → real WASM loaded; false → stub
isWasmInitialized(); // true after loadWasmEngine() resolves

// Access the engine
const engine = getWasmEngine();
```

### `DicePhysicsEngine` (C++ / Embind)

#### Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `setFlags` | `(flags: u32): void` | Engine options from the main thread (`FLAG_NO_DRAG = 1` disables quadratic drag). Call after construction, before `init`. |
| `init` | `(gravity, tableY, tableHalfW, tableHalfD): void` | Configure world parameters. |
| `reset` | `(): void` | Remove all dice and reset the ID counter. |

#### Die management

| Method | Signature | Description |
|--------|-----------|-------------|
| `addDie` | `(sides, x, y, z): i32` | Spawn a die. Returns unique ID (or -1 at max capacity). |
| `removeDie` | `(id): void` | Remove a die by ID. |
| `clearAllDice` | `(): void` | Remove all dice. |
| `setDieHull` | `(id, vertices: VectorFloat): void` | Attach convex hull vertices (flat `[x,y,z,…]`). |

#### Forces

| Method | Signature | Description |
|--------|-----------|-------------|
| `applyImpulse` | `(id, fx, fy, fz): void` | Apply linear impulse (wakes the die). |
| `applyTorqueImpulse` | `(id, tx, ty, tz): void` | Apply angular impulse (wakes the die). |

#### State sync

| Method | Signature | Description |
|--------|-----------|-------------|
| `setDieTransform` | `(id, px,py,pz, qx,qy,qz,qw): void` | Teleport a die and zero velocities. |
| `setDieVelocity` | `(id, lvx,lvy,lvz, avx,avy,avz): void` | Override velocities. |

#### Simulation

| Method | Signature | Description |
|--------|-----------|-------------|
| `step` | `(dt: f32): void` | Advance by `dt` seconds (4 sub-steps internally). |

#### Query

| Method | Signature | Description |
|--------|-----------|-------------|
| `getDieCount` | `(): i32` | Number of dice in the world. |
| `areAllSettled` | `(): bool` | True when all dice are sleeping. |
| `getTransforms` | `(): Float32Array` | Zero-copy view of `[px,py,pz,qx,qy,qz,qw]` per die. |
| `getCollisionEvents` | `(): Float32Array` | Events as `[idA, idB, impactSpeed, …]`. Cleared on read. |

#### Determinism & replay

| Method | Signature | Description |
|--------|-----------|-------------|
| `seedRNG` | `(seed: u64): void` | Seed the internal xorshift64* generator. |
| `randomFloat` | `(): f32` | Return next deterministic float in `[0,1)`. |
| `serializeState` | `(): VectorU8` | Snapshot all body states to a byte vector. |
| `deserializeState` | `(data: VectorU8): void` | Restore a snapshot. |

---

## Integration Points

### Current authoritative path

`src/main.js` loads the bridge during `init()`:

```js
loadWasmEngine().then((available) => {
    if (available) {
        getWasmEngine().init(-15.0, -2.75, 18.0, 18.0);
        syncAllDiceToWasm();
    }
});
```

Per-frame stepping now prefers WASM:

```js
const useWasm = isWasmAvailable();
const shouldStepAmmo = !useWasm || dualPhysicsValidation || hasActiveDiceInteraction();

if (shouldStepAmmo) stepPhysics(physicsWorld, dt);
if (useWasm) getWasmEngine().step(dt);
updateDiceVisuals();
```

`src/dice.js` mirrors dice lifecycle events into both engines and loads hulls:

- `spawnObjects()` registers each die in WASM, calls `loadHullForDie(wasmId, sides)`, and stores the returned ID.
- `throwDice(scene, world, seed)` supports deterministic throws when `seed !== null`.
- `updateDiceVisuals()` reads `engine.getTransforms()` unless a die is under active ammo-driven interaction.
- `clearDice()` and `updateDiceSet()` remove the corresponding WASM entries.

`src/interaction.js` temporarily gives dragged/levitating dice ammo authority,
then syncs the resulting transform or release impulse back into WASM.

Collision events are polled in `main.js` during `postPhysicsSync`:

```js
const events = pollPhysicsCollisionEvents();
for (const ev of events) {
    // TODO: wire to Web Audio for dice clack / table thump
}
```

Global debug handles are exposed for console inspection:

```js
window.getWasmEngine()      // engine instance
window.isWasmAvailable()    // true when WASM is loaded
window.replayRoll(seed)     // deterministic re-roll with seed
```

---

## Performance Baseline

Recorded on a 2023 mid-range laptop (Ryzen 5 7530U, Chrome 125):

| Metric | ammo.js | WASM Phase 3 | Target |
|--------|---------|--------------|--------|
| 10 dice step time | ~0.3 ms | ~0.01 ms | < 0.05 ms |
| 50 dice step time | ~1.2 ms | ~0.034 ms | < 0.2 ms |
| 100 dice step time | ~2.5 ms | ~0.07 ms | < 0.4 ms |
| Bundle size (gzip) | ~2 MB | ~16 KB | < 100 KB |

### Quick benchmark

```js
const engine = window.getWasmEngine();
engine.init(-15, -2.75, 18, 18);
for (let i = 0; i < 50; i++) engine.addDie(6, 0, 5 + i * 0.1, 0);
// Load hulls via loadHullForDie in a loop
const t0 = performance.now();
for (let i = 0; i < 600; i++) engine.step(1/60);
const ms = performance.now() - t0;
console.log(`WASM: 600 steps × 50 dice = ${ms.toFixed(1)} ms  (${(ms/600).toFixed(3)} ms/step)`);
```

### Replay determinism test

```js
window.replayRoll(42);               // throw with seed 42
const t1 = window.getWasmEngine().getTransforms();
window.replayRoll(42);               // reset and replay same seed
const t2 = window.getWasmEngine().getTransforms();
// t1 and t2 are bit-identical
```

---

## Roadmap

### Phase 3 (Complete)

- [x] SAT-based convex-hull collision detection in C++.
- [x] Build-time hull extraction from Draco GLB (`scripts/extract-hulls.mjs`).
- [x] Deterministic seed + state serialization for replay.
- [x] Collision event callbacks for audio.
- [x] Hardening: max dice (500), max hull verts (64), memory cap (64 MB), NaN checks.
- [x] Experimental Worker bridge (`src/wasm/WorkerPhysicsBridge.js`).

### Phase 4 (Complete)

- [x] Production physics Web Worker (`dice_physics.worker.js`) hosting the engine.
- [x] Self-paced fixed-timestep loop in the worker (main thread no longer steps).
- [x] Double-buffered **SharedArrayBuffer** transform transport with an `Atomics`
      seqno/front/count/settled header (`workerLayout.js`), tear-free reads.
- [x] Graceful **postMessage-snapshot fallback** when not cross-origin isolated.
- [x] Synchronous worker proxy via a mirrored monotonic id counter, so
      `WorkerPhysicsBridge` is a drop-in for `WasmPhysicsBridge`.
- [x] `PhysicsBridge` facade selects worker → main-thread → stub with fallback.
- [x] Worker-driven drag/levitation by default (`?ammo-drag` opts out).
- [x] COOP/COEP on dev **and** preview servers.
- [x] `scripts/verify-worker-physics.mjs` (Playwright) — asserts worker default,
      SAB transport, synchronous ids, and worker-driven gravity stepping.
- [x] Fixed a latent bug in the experimental worker that transferred the WASM
      heap buffer (`getTransforms().buffer`), which would detach module memory.
- [x] Batched per-frame command transport for high-frequency ops
      (`applyTorqueImpulse`, `setDieTransform`, `setDieVelocity`, `applyImpulse`):
      accumulated on the main thread and flushed once per frame into a
      SharedArrayBuffer command ring (zero postMessages in steady state) or a
      single `batch` postMessage when SAB is unavailable. Structural commands
      (`init`, `addDie`, …) remain on plain postMessage.

#### Known limitations / follow-ups

- `serializeState()` / `randomFloat()` are not available synchronously across the
  worker boundary, so deterministic `replayRoll()` falls back to the in-process
  path. A request/response round-trip could restore them if needed.
- URL-driven engine flags (`?no-drag`, etc.) are parsed on the main thread in
  `physicsFlags.js` and forwarded into WASM via `DicePhysicsEngine.setFlags()`
  (both the in-process bridge and the worker init payload). The C++ constructor
  no longer touches `window`.

### Phase 5+ (Future)

- [ ] True `setDieKinematic(id, bool)` in C++ so held dice ignore gravity/contacts
      internally instead of being overwritten each frame (retire ammo dice bodies).
- [~] Mirror drag/levitation into WASM (retire ammo for dice). **In progress:** `?wasm-drag` drives both interactions kinematically in the WASM world via `setDieTransform`/`setDieVelocity` (`src/interaction.js`, helpers in `src/dice.js`). Default off; ammo path remains the default and fallback. Remaining: soak-test under `?wasm-drag`, then drop the ammo dice bodies in `spawnDicePhysics`. Optional C++ follow-up: a true `setDieKinematic(id, bool)` flag so held dice ignore gravity/contacts internally instead of being overwritten each frame.
- [ ] Web Audio integration: dice clack, table thump, lamp jiggle on collision.
- [ ] Fuzz testing harness for the C++ solver.
- [ ] SIMD optimisation (`-msimd128`) for SAT projections.
