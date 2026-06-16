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

A high-performance C++ physics engine compiled to WebAssembly is being integrated
to replace the existing ammo.js simulation for improved performance and determinism.

**Current status:** Phase 2 partial cut-over is in place. Normal dice rolling now
steps in the custom WASM solver when the module is available, while `ammo.js`
remains the fallback backend and is still used for drag/levitation interaction
support during the transition.

See [docs/WASM_ENGINE.md](docs/WASM_ENGINE.md) for build instructions, API reference, and roadmap.

Quick start (requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)):

```bash
npm run build:wasm   # compile C++ → WASM
npm run build        # production build (includes WASM artifacts)
npm run dev          # development server (WASM stub used if binary absent)
```

Runtime flags:

- `?no-wasm` forces the ammo.js fallback path even if `public/wasm/` artifacts exist.
- `?dual-physics` steps ammo and WASM in parallel for validation/debugging.
