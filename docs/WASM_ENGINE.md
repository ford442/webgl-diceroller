# WASM Physics Engine — Integration Guide

> **Status:** Phase 1 complete — foundation & bridge in place.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Build Instructions](#build-instructions)
4. [API Reference](#api-reference)
5. [Integration Points](#integration-points)
6. [Performance Baseline](#performance-baseline)
7. [Phase 2 Roadmap](#phase-2-roadmap)

---

## Overview

This document describes the integration of a custom C++ physics engine compiled
to WebAssembly (WASM) into the WebGL Dice Roller application.

### Why WASM?

| Concern | Current (ammo.js) | WASM Engine |
|---------|-------------------|-------------|
| Execution speed | ~JS speed (Bullet WASM via ammo.js) | Near-native via Emscripten |
| Bundle size | ~2 MB (full Bullet Physics) | ~30–80 KB (tailored solver) |
| Dice-specific tuning | Limited — general-purpose solver | Full control |
| Determinism | Floating-point non-determinism | Reproducible with fixed seed |
| Multi-threading (future) | Not supported | SharedArrayBuffer + Workers |

### Phase 1 Goals (this branch)

- [x] Set up the C++/Emscripten/CMake build pipeline.
- [x] Implement a self-contained lightweight impulse solver (`DicePhysicsEngine`).
- [x] Expose the engine to JavaScript via Embind.
- [x] Write a JavaScript bridge (`WasmPhysicsBridge.js`) with a graceful stub fallback.
- [x] Integrate the bridge into `src/main.js` (loads in parallel, non-blocking).
- [x] Document architecture decisions, API, and next steps.

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
│  • Asset loading (Collada models)               │
│  • ammo.js physics world (Phase 1 — authoritative) │
└───────────────────┬─────────────────────────────┘
                    │  Float32Array transforms
                    │  (7 floats/die: pos + quat)
                    ▼
┌─────────────────────────────────────────────────┐
│  WASM (dice_physics.cpp / Emscripten)           │
│                                                 │
│  • Rigid-body state (position, velocity, rot)   │
│  • Gravity integration                          │
│  • Floor & wall collision response              │
│  • Sleep detection (settle logic)               │
│  • Impulse & torque application                 │
│  • Phase 2: full collision detection & stacking │
└─────────────────────────────────────────────────┘
```

### Phase 1 Integration Model

In Phase 1 the WASM engine runs **alongside** ammo.js.  `ammo.js` remains the
authoritative physics backend for rendering.  The WASM module loads
asynchronously and silently falls back to a no-op stub when the compiled
binary is absent (e.g. in CI or before first build).

This allows:
- Side-by-side benchmarking of JS vs WASM physics.
- Incremental migration of subsystems in Phase 2.
- Zero disruption to the existing simulation.

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

Output files land in `public/wasm/`:
- `dice_physics.js`   — Emscripten ES module loader
- `dice_physics.wasm` — Compiled binary (~30–80 KB gzipped)

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
| `init` | `(gravity: f32, tableY: f32, tableHalfW: f32, tableHalfD: f32): void` | Configure world parameters. `tableHalfW` = half-width on the X axis; `tableHalfD` = half-depth on the Z axis. Safe to call multiple times. |
| `reset` | `(): void` | Remove all dice and reset the ID counter. |

#### Die management

| Method | Signature | Description |
|--------|-----------|-------------|
| `addDie` | `(sides: i32, x: f32, y: f32, z: f32): i32` | Spawn a die. Returns unique ID. |
| `removeDie` | `(id: i32): void` | Remove a die by ID. |
| `clearAllDice` | `(): void` | Remove all dice. |

#### Forces

| Method | Signature | Description |
|--------|-----------|-------------|
| `applyImpulse` | `(id, fx, fy, fz): void` | Apply linear impulse (wakes the die). |
| `applyTorqueImpulse` | `(id, tx, ty, tz): void` | Apply angular impulse (wakes the die). |

#### State sync (ammo.js ↔ WASM bridge)

| Method | Signature | Description |
|--------|-----------|-------------|
| `setDieTransform` | `(id, px,py,pz, qx,qy,qz,qw): void` | Teleport a die and zero its velocities. |
| `setDieVelocity` | `(id, lvx,lvy,lvz, avx,avy,avz): void` | Override velocities (for state synchronisation). |

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

---

## Integration Points

### Current (Phase 1 — non-authoritative parallel mode)

`src/main.js` loads the bridge during `init()`:

```js
loadWasmEngine().then((available) => {
    if (available) {
        getWasmEngine().init(-15.0, -2.75, 18.0, 18.0);
    }
});
```

Global debug handles are exposed for console inspection:

```js
window.getWasmEngine()      // engine instance
window.isWasmAvailable()    // true when WASM is loaded
```

### Phase 2 Migration Path

When ready to replace ammo.js for the simulation step:

1. In `src/dice.js` → `spawnObjects()`: call `engine.addDie(sides, x, y, z)` to
   register each die in the WASM world.
2. In `src/main.js` → `animate()`: replace `stepPhysics(physicsWorld, dt)` with
   `engine.step(dt)`.
3. In `src/dice.js` → `updateDiceVisuals()`: read positions from
   `engine.getTransforms()` instead of querying ammo.js motion states.
4. Retire ammo.js from the physics step (keep it for convex hull generation
   during model loading until a C++ replacement is available).

---

## Performance Baseline

> Measured data to be filled in after Phase 2 integration.

### Planned benchmark approach

A lightweight benchmark is available at the browser console:

```js
// After loading the app:
const engine = window.getWasmEngine();
if (!window.isWasmAvailable()) {
    console.warn('Build WASM first: npm run build:wasm');
} else {
    engine.init(-15, -2.75, 18, 18);
    // Spawn 100 dice
    for (let i = 0; i < 100; i++) engine.addDie(6, 0, 5 + i * 0.1, 0);
    // Warm-up
    for (let i = 0; i < 60; i++) engine.step(1/60);
    // Timed run
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) engine.step(1/60);
    const ms = performance.now() - t0;
    console.log(`WASM: 600 steps × 100 dice = ${ms.toFixed(1)} ms  (${(ms/600).toFixed(3)} ms/step)`);
}
```

### Target metrics (Phase 2)

| Metric | ammo.js | WASM target |
|--------|---------|-------------|
| 10 dice step time | ~0.3 ms | < 0.05 ms |
| 50 dice step time | ~1.2 ms | < 0.2 ms |
| 100 dice step time | ~2.5 ms | < 0.4 ms |
| Bundle size (gzip) | ~2 MB | < 100 KB |

---

## Phase 2 Roadmap

- [ ] Implement polyhedral convex-hull collision detection in C++ (OBB or GJK/EPA).
- [ ] Replace ammo.js `stepPhysics` with `engine.step()` in the render loop.
- [ ] Pipe die positions from `engine.getTransforms()` into Three.js meshes.
- [ ] Implement die-to-die collision (sphere-sphere first, then convex hull).
- [ ] Add deterministic seed support for replay / test reproducibility.
- [ ] Run benchmarks and compare with ammo.js baseline.

### Phase 3+

- Multi-threading via `SharedArrayBuffer` + `Worker`.
- Draco-compressed GLB models (already planned in `plan.md`) with C++ convex hull extraction.
- Audio trigger callbacks from WASM → JS.
- Production hardening: error handling, memory bounds, fuzzing.
