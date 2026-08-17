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

| Concern              | Current (ammo.js)                   | WASM Engine                      |
| -------------------- | ----------------------------------- | -------------------------------- |
| Execution speed      | ~JS speed (Bullet WASM via ammo.js) | Near-native via Emscripten       |
| Bundle size          | ~2 MB (full Bullet Physics)         | ~16 KB gzipped (tailored solver) |
| Dice-specific tuning | Limited — general-purpose solver    | Full control                     |
| Determinism          | Floating-point non-determinism      | Reproducible with fixed seed     |
| Multi-threading      | Not supported                       | Experimental Web Worker bridge   |

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
- [x] **Phase 5:** Native solver test harness (`npm run test:solver`) — unit tests,
      2000-seed invariant fuzz loop, determinism checks, optional native↔WASM parity.

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

The WASM engine owns **all** dice simulation when the compiled module is
available — including drag, levitation, and flicks. `ammo.js` still exists for
two reasons:

- Browser/build fallback when the WASM artifacts are absent or `?no-wasm` is
  set. That fallback is complete: ammo dice bodies, ammo drag constraints, and
  ammo levitation.
- Hand-built static prop colliders, behind `src/environment/PropPhysics.js`.
  These only exist when ammo is loaded; on the default path props are
  visual-only (declarative specs go to WASM via `StaticColliderBridge`).

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
heap — **zero copy** from C++ to JS. The view is valid until the next
structural mutation (`addDie` / `removeDie` / `clearAllDice`).

### Convex Hull Pipeline

Dice models are now Draco-compressed GLB files (`public/images/dice/*.glb`).
A build-time Node script (`scripts/extract-hulls.mjs`) reads each GLB via
`@gltf-transform/core` + `draco3dgltf`, computes the canonical polyhedral
vertices, and writes `public/wasm/hulls.json`. At runtime the JS bridge loads
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

Shared Emscripten flags live in [`src/wasm/emcc_flags.inc.sh`](src/wasm/emcc_flags.inc.sh) and are consumed by [`build.sh`](src/wasm/build.sh), [`build_colab.sh`](src/wasm/build_colab.sh), and CMake (via [`emcc_flags.sh --print-link-line`](src/wasm/emcc_flags.sh)).

```bash
# Release profile (default): -O3 -flto -msimd128, ASSERTIONS=0
npm run build:wasm

# Debug profile: -O0 -g, ASSERTIONS=2, SAFE_HEAP=1 (no SIMD/LTO)
npm run build:wasm:debug

# Equivalent direct invocation:
cd src/wasm && ./build.sh
cd src/wasm && ./build.sh --debug
```

Both profiles write to the same paths (`public/wasm/dice_physics.{js,wasm}`); a release build overwrites a prior debug build and vice versa. The Embind API surface is identical.

After each build, [`build.sh`](src/wasm/build.sh) emits `public/wasm/build-info.json` (gitignored) with `emcc_version`, full flag list, `git_sha`, and artifact byte sizes. CI uploads it inside the `wasm-artifacts` artifact.

#### Release flag set (EMSDK 3.1.61 / CI pin)

| Flag | Purpose |
|------|---------|
| `--bind -std=c++17` | Embind exports |
| `-O3 -flto` | Release optimisation (+ ~30–60 s link time in CI) |
| `-msimd128` | WASM SIMD128 for SAT hot paths (`projectHullOntoAxis`, `transformHullVerts`; `#ifdef __wasm_simd128__`; native `test:solver` stays scalar) |
| `DICE_FORCE_SCALAR_SAT` | Compile-time scalar SAT path (`build.sh --scalar` → `public/wasm-scalar/`) for SIMD parity checks |
| `-s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=64MB` | Heap policy |
| `-s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=DicePhysicsModule` | ES module factory |
| `-s ENVIRONMENT=web,worker,node` | Main thread, physics worker, and Node parity tooling |
| `-s FILESYSTEM=0` | No FS usage in `dice_physics.cpp` |
| `-s ABORTING_MALLOC=0` | OOM returns null under the 64 MB cap |
| `-s ASSERTIONS=0` | Release assertions off |

**Browser note:** `-msimd128` requires WASM SIMD128 (Chrome 91+, Firefox 89+, Safari 16.4+). A scalar-only artifact is available via `cd src/wasm && ./build.sh --scalar` (`public/wasm-scalar/`).

#### Debug flag set

| Flag | Purpose |
|------|---------|
| `-O0 -g` | Fast rebuilds, source maps |
| `-s ASSERTIONS=2 -s SAFE_HEAP=1` | Extra runtime checks |
| (no `-msimd128`, no `-flto`) | Easier debugging |

### Native solver tests (no browser, no Emscripten)

The engine core lives in `dice_physics_engine.hpp` (a thin orchestrator that
declares `DicePhysicsEngine` and pulls in the `dice_physics/` module files for
math, types, SAT, and the engine's member-function definitions) and is
compiled natively with g++/clang for fast regression coverage:

```bash
# Unit tests (SAT, PRNG, serialize round-trip, determinism) + 2000-seed fuzz loop:
npm run test:solver

# Tune fuzz volume (default 2000 seeds, ~6 s on CI):
FUZZ_SEEDS=500 npm run test:solver
```

When `public/wasm/dice_physics.wasm` is present (after `npm run build:wasm`), the
same script also runs a native↔WASM `serializeState()` parity check (fixed-literal
scenario; no PRNG) via `scripts/compare-solver-wasm.mjs`.

Optional step-time benchmarks (native scalar path):

```bash
BENCH_SOLVER=1 npm run test:solver
# or: src/wasm/build-native/solver_tests --bench --dice=50 --steps=600
```

Source layout:

| File                                                | Role                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `dice_physics_engine.hpp`                            | Thin orchestrator: `DicePhysicsEngine` class declaration + module includes |
| `dice_physics/dice_math.hpp`                         | `Vec3`, `Quat`, `Mat3`, `PolyHull`                          |
| `dice_physics/dice_types.hpp`                        | `RigidBody`, `Contact`, `CollisionEvent`, `StaticBody`, etc. |
| `dice_physics/dice_sat.hpp`                          | SAT narrowphase helpers + `DeterministicRNG`                |
| `dice_physics/dice_engine_lifecycle.hpp`             | Engine construction, per-die setters, static-collider registration |
| `dice_physics/dice_engine_step.hpp`                  | `step()`, buffer builders, serialize/deserialize, invariant helpers |
| `dice_physics/dice_engine_collision_static.hpp`      | Static-collider + container-plane collision resolution      |
| `dice_physics/dice_engine_collision_dynamic.hpp`     | Die–die broadphase grid, narrowphase, and contact solver     |
| `dice_physics/dice_engine_integrate.hpp`             | Per-body integration, table/floor collision, sleep bookkeeping |
| `dice_physics.cpp`                                   | Emscripten Embind exports for the WASM build                |
| `solver_tests.cpp`                                   | doctest unit + fuzz harness (`--dump-serialize`, `--bench`) |
| `emcc_flags.inc.sh`                                  | Single source of truth for Emscripten link flags            |
| `build_solver_test.sh`                               | Native compile + run script                                 |

### Runtime flags

- (default) the WASM engine runs in a **Web Worker** with SharedArrayBuffer
  transport when the page is cross-origin isolated (COOP/COEP set).
- `?no-worker` (or `?worker-physics=off`) runs the WASM engine **in-process** on
  the main thread (the legacy `WasmPhysicsBridge` path).
- `?no-wasm` is the sole physics escape hatch: it forces the JS/ammo fallback
  path (dice bodies, drag, levitation) even if `public/wasm/` is present.
- `?worker-physics` is the explicit opt-in alias for the now-default worker path.

The `?dual-physics`, `?ammo-drag`, and `?wasm-drag` flags were removed in the
Phase 5 cut-over. All interactions are driven kinematically inside the WASM
world whenever the engine is live.

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

> **Meta tags are not enough.** `<meta http-equiv="Cross-Origin-Opener-Policy">`
> (or COEP) does **not** enable `crossOriginIsolated`. The values must arrive as
> real HTTP response headers from nginx, Caddy, Cloudflare, or equivalent.
> Optional companion header for static assets: `Cross-Origin-Resource-Policy: same-origin`.

Example host configs (also in the README deploy section):

```nginx
# nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
```

```caddy
# Caddy
header {
	Cross-Origin-Opener-Policy "same-origin"
	Cross-Origin-Embedder-Policy "require-corp"
	Cross-Origin-Resource-Policy "same-origin"
}
```

**Post-deploy check** (fetches the live host, asserts headers, then opens the
page in Playwright and checks `crossOriginIsolated` + `SharedArrayBuffer`):

```bash
npm run verify:production-isolation
PROD_URL=https://go.1ink.us/dice-roller/ npm run verify:production-isolation
```

Local SAB path (Vite already sends COOP/COEP): `npm run verify:worker-physics`
and `npm run verify:pwa-isolation`.

Output files land in `public/wasm/`:

- `dice_physics.js` — Emscripten ES module loader
- `dice_physics.wasm` — Compiled binary (~52 KB raw release; ~16 KB gzipped over the wire when served compressed)
- `build-info.json` — Build metadata (gitignored; see above)
- `hulls.json` — Precomputed convex hull vertices per die type

### CMake alternative (advanced)

Uses the same release flags as `build.sh` via `emcc_flags.sh --print-link-line release`:

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
isWasmAvailable(); // true → real WASM loaded; false → stub
isWasmInitialized(); // true after loadWasmEngine() resolves

// Access the engine
const engine = getWasmEngine();
```

### `DicePhysicsEngine` (C++ / Embind)

#### Lifecycle

| Method     | Signature                                         | Description                                                                                                               |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `setFlags` | `(flags: u32): void`                              | Engine options from the main thread (`FLAG_NO_DRAG = 1` disables quadratic drag). Call after construction, before `init`. |
| `init`     | `(gravity, tableY, tableHalfW, tableHalfD): void` | Configure world parameters.                                                                                               |
| `reset`    | `(): void`                                        | Remove all dice and reset the ID counter.                                                                                 |

#### Die management

| Method         | Signature                           | Description                                             |
| -------------- | ----------------------------------- | ------------------------------------------------------- |
| `addDie`       | `(sides, x, y, z): i32`             | Spawn a die. Returns unique ID (or -1 at max capacity). |
| `removeDie`    | `(id): void`                        | Remove a die by ID.                                     |
| `clearAllDice` | `(): void`                          | Remove all dice.                                        |
| `setDieHull`   | `(id, vertices: VectorFloat): void` | Attach convex hull vertices (flat `[x,y,z,…]`).         |

#### Forces

| Method               | Signature                | Description                            |
| -------------------- | ------------------------ | -------------------------------------- |
| `applyImpulse`       | `(id, fx, fy, fz): void` | Apply linear impulse (wakes the die).  |
| `applyTorqueImpulse` | `(id, tx, ty, tz): void` | Apply angular impulse (wakes the die). |

#### State sync

| Method               | Signature                              | Description                                                                                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `setDieTransform`    | `(id, px,py,pz, qx,qy,qz,qw): void`    | Teleport a die and zero velocities.                                                                                |
| `setDieVelocity`     | `(id, lvx,lvy,lvz, avx,avy,avz): void` | Override velocities.                                                                                               |
| `setDieKinematic`    | `(id, kinematic: bool): void`          | Toggle kinematic mode (no integration).                                                                            |
| `setContainerActive` | `(active: bool): void`                 | Enable/disable dice-cup interior planes.                                                                           |
| `setContainerPlanes` | `(planes: VectorFloat): void`          | Upload world-space planes (4 floats each: nx, ny, nz, d). Up to 9. Collision events use `idB = -100 - planeIndex`. |

#### Simulation

| Method | Signature         | Description                                       |
| ------ | ----------------- | ------------------------------------------------- |
| `step` | `(dt: f32): void` | Advance by `dt` seconds (4 sub-steps internally). |

#### Query

| Method               | Signature          | Description                                              |
| -------------------- | ------------------ | -------------------------------------------------------- |
| `getDieCount`        | `(): i32`          | Number of dice in the world.                             |
| `areAllSettled`      | `(): bool`         | True when all dice are sleeping.                         |
| `getTransforms`      | `(): Float32Array` | Zero-copy view of `[px,py,pz,qx,qy,qz,qw]` per die.      |
| `getCollisionEvents` | `(): Float32Array` | Events as `[idA, idB, impactSpeed, …]`. Cleared on read. |

#### Determinism & replay

| Method             | Signature                | Description                                 |
| ------------------ | ------------------------ | ------------------------------------------- |
| `seedRNG`          | `(seed: u64): void`      | Seed the internal xorshift64* generator.    |
| `randomFloat`      | `(): f32`                | Return next deterministic float in `[0,1)`. |
| `serializeState`   | `(): VectorU8`           | Snapshot all body states to a byte vector.  |
| `deserializeState` | `(data: VectorU8): void` | Restore a snapshot.                         |

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
window.getWasmEngine(); // engine instance
window.isWasmAvailable(); // true when WASM is loaded
window.replayRoll(seed); // deterministic re-roll with seed
```

---

## Performance Baseline

Recorded on a 2023 mid-range laptop (Ryzen 5 7530U, Chrome 125):

| Metric             | ammo.js | WASM Phase 3 | Target    |
| ------------------ | ------- | ------------ | --------- |
| 10 dice step time  | ~0.3 ms | ~0.01 ms     | < 0.05 ms |
| 50 dice step time  | ~1.2 ms | ~0.034 ms    | < 0.2 ms  |
| 100 dice step time | ~2.5 ms | ~0.07 ms     | < 0.4 ms  |
| 200 dice step time | —       | ~0.15 ms     | < 0.25 ms |
| Bundle size (gzip) | ~2 MB   | ~16 KB       | < 100 KB  |

CI informational warn thresholds (ubuntu-latest, `scripts/solver-bench-baselines.json`):

| Dice | WASM release warn | Native scalar warn |
| ---- | ----------------- | ------------------ |
| 200  | 0.8 ms/step       | 1.6 ms/step        |

### Quick benchmark

Browser/console (WASM release, SIMD when supported):

```js
const engine = window.getWasmEngine();
engine.init(-15, -2.75, 18, 18);
for (let i = 0; i < 50; i++) engine.addDie(6, 0, 5 + i * 0.1, 0);
// Load hulls via loadHullForDie in a loop
const t0 = performance.now();
for (let i = 0; i < 600; i++) engine.step(1 / 60);
const ms = performance.now() - t0;
console.log(`WASM: 600 steps × 50 dice = ${ms.toFixed(1)} ms  (${(ms / 600).toFixed(3)} ms/step)`);
```

Native scalar baseline (no Emscripten):

```bash
npm run test:solver   # compiles solver_tests
src/wasm/build-native/solver_tests --bench --dice=50 --steps=600 --warmup=60
# CI (informational): BENCH_SOLVER=1 npm run test:solver  (10/50/100/200 dice)
node scripts/bench-solver-wasm.mjs   # WASM release in Node (after build:wasm)
node scripts/compare-solver-bench.mjs bench-results.txt
```

WASM SIMD vs scalar parity (same engine/arch, fixed-literal scenario):

```bash
npm run build:wasm
cd src/wasm && ./build.sh --scalar   # → public/wasm-scalar/
node scripts/compare-solver-simd.mjs
```

Determinism notes:

- Native g++ vs Emscripten may diverge on seeded scenarios (toolchain FP); fixed-literal parity is CI-gated.
- Scalar vs SIMD WASM builds must match on the same host (`compare-solver-simd.mjs`).
- Native `test:solver` fuzz (2000 seeds) stays scalar-only (`-O2`, no `-msimd128`).

### Replay determinism test

```js
window.replayRoll(42); // throw with seed 42
const t1 = window.getWasmEngine().getTransforms();
window.replayRoll(42); // reset and replay same seed
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
- [x] Worker-driven drag/levitation (the only path while WASM is live).
- [x] COOP/COEP on dev **and** preview servers.
- [x] Post-deploy isolation verifier (`npm run verify:production-isolation`).
- [x] Render-regression baselines enforced for `?webgl` / `?webgl&no-post`.
- [x] `scripts/verify-worker-physics.mjs` (Playwright) — asserts worker default,
      SAB transport, synchronous ids, and worker-driven gravity stepping.
- [x] `scripts/verify-worker-replay.mjs` (Playwright) — asserts `seededPhysicsThrow`
      replay determinism on the worker path and async `serializePhysicsState()`.
- [x] Fixed a latent bug in the experimental worker that transferred the WASM
      heap buffer (`getTransforms().buffer`), which would detach module memory.
- [x] Batched per-frame command transport for high-frequency ops
      (`applyTorqueImpulse`, `setDieTransform`, `setDieVelocity`, `applyImpulse`):
      accumulated on the main thread and flushed once per frame into a
      SharedArrayBuffer command ring (zero postMessages in steady state) or a
      single `batch` postMessage when SAB is unavailable. Structural commands
      (`init`, `addDie`, …) remain on plain postMessage.

#### Known limitations / follow-ups

- `randomFloat()` is not available synchronously across the worker boundary;
  deterministic rolls use the `seededThrow` worker command (via `seededPhysicsThrow`)
  so RNG draws and impulses stay ordered in the worker. `serializePhysicsState()`
  is async on the worker path (request/response with a transferred `ArrayBuffer`).
- `applyDiceMassBiases()` posts one `applyTorqueImpulse` message per mass-biased
  die per frame; batching into a single message would cut chatter at high counts.
- `serializeState()` / `randomFloat()` are not available synchronously across the
  worker boundary, so deterministic `replayRoll()` falls back to the in-process
  path. A request/response round-trip could restore them if needed.
- URL-driven engine flags (`?no-drag`, etc.) are parsed on the main thread in
  `physicsFlags.js` and forwarded into WASM via `DicePhysicsEngine.setFlags()`
  (both the in-process bridge and the worker init payload). The C++ constructor
  no longer touches `window`.

### Phase 5 (Dice ammo retirement)

- [x] WASM worker is the default dice simulator; drag/levitation use WASM kinematic control (`setDieKinematic` in C++/embind/worker, with a velocity-clamp fallback if an older artifact lacks the binding).
- [x] `shouldLoadAmmoPhysics()` skips the ammo chunk unless `?no-wasm` is set or the WASM artifacts are missing.
- [x] Dice ammo helpers consolidated in `src/dice/AmmoDiceBackend.js` (dynamic import; not on the default critical path).
- [x] Ammo dice bodies exist only on the fallback path (`needsAmmoDiceBackend() === !isUsingWasmPhysics()`); the dual `physicsAuthority` sync is gone.
- [x] `?dual-physics` / `?ammo-drag` / `?wasm-drag` removed; `?no-wasm` is the only escape hatch.
- [x] Prop ammo usage funnelled through `src/environment/PropPhysics.js`; no prop imports `physics.js` directly.
- [x] `npm run verify:wasm-interaction` covers drag + levitation on the WASM-only path; `npm run verify:bundle-loading` asserts no ammo chunk and no ammo dice bodies by default.
- [x] Static prop colliders use declarative specs via `createProp` + `StaticColliderBridge` (WASM on the default path; ammo fallback on `?no-wasm`). Run `node scripts/prop-collider-audit.mjs` for migration coverage.
- [x] SIMD optimisation (`-msimd128`) for SAT axis projections (`projectHullOntoAxis` in `dice_physics/dice_sat.hpp`).

### Phase 6 (Broadphase, SIMD, bench — complete)

- [x] Uniform XZ grid broadphase for die–die pairs (`resolveDieCollisions` in `dice_physics/dice_engine_collision_dynamic.hpp`); brute-force parity unit test.
- [x] Skip container/static/table resolution for sleeping bodies.
- [x] Extended SIMD: `transformHullVerts` (quat→mat3, 4-wide) in `satTest`; scalar fallback via `DICE_FORCE_SCALAR_SAT` / `build.sh --scalar`.
- [x] `StepStats` + `getLastStepStats()` exposed to JS; worker SAB header slots for `?debug-perf`.
- [x] Bench harness: native `--bench` + `bench_json` lines (10/50/100/200 dice); `scripts/bench-solver-wasm.mjs`; CI artifact + warn-only `compare-solver-bench.mjs`.
- [x] `scripts/compare-solver-simd.mjs` — scalar vs SIMD WASM serialize parity on fixed-literal scenario.
