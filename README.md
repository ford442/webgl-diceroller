WebGPU Dice Roller
===========================================

A Three.js application that spawns 3D models of gaming dice (d4–d20) in a tavern-themed
scene and lets you fling, drag, and levitate them with realistic rigid-body physics.
(Originally built on the CubicVR engine — preserved in `legacy/` — and since migrated to
a modern Three.js + Vite stack.)

## Rendering

The app renders with **`WebGPURenderer` by default** on browsers that support WebGPU
(`navigator.gpu`), using a TSL post-processing stack (bloom, vignette, optional
chromatic aberration). On browsers without WebGPU — or if WebGPU init fails — it
**automatically falls back to `WebGLRenderer`**, the stable baseline path.

Renderer / post flags (work on both paths unless noted):

- `?webgl` — force the WebGL baseline renderer (escape hatch / older browsers).
- `?webgpu` / `?wgpu` — force WebGPU explicitly (redundant with the default).
- `?renderer-info` — show a small badge with the active renderer type.
- `?no-post` — disable post-processing entirely.
- `?low-post` — lower post / bloom quality.
- `?no-bloom` — disable bloom only.
- `?no-godrays` — disable the tavern window volumetric light beams.
- `?debug` / `?debug-perf` — show render stats (incl. renderer type and any fallback).

## WASM Physics Engine

The custom C++ `DicePhysicsEngine` (compiled to WebAssembly) is the **only** physics
backend — dice simulation, drag, levitation, flicks, and all prop colliders run on WASM.
ammo.js has been retired entirely. If `public/wasm/` artifacts are missing or fail to
load (or `?no-wasm` is set), the app shows an honest failure banner and loads a static
tavern with zero dice rather than falling back to a different engine.

See [docs/WASM_ENGINE.md](docs/WASM_ENGINE.md) for build instructions, API reference, and
status. Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Agent/contributor
guide: [AGENTS.md](AGENTS.md).

Quick start (requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)):

```bash
npm run build:wasm   # compile C++ → WASM
npm run build        # production build (includes WASM artifacts)
npm run dev          # development server (WASM stub used if binary absent)
```

Runtime flags:

- `?no-wasm` — forces the physics bridge's no-op stub even if `public/wasm/` artifacts
  exist: no dice spawn, and the app shows the honest failure banner. There is no
  fallback engine to fall back to any more. The former `?dual-physics`, `?ammo-drag`,
  and `?wasm-drag` flags have been removed.
