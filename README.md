WebGL Dice Roller
===========================================

This is a WebGL application that uses the CubicVR engine to spawn 3D models of gaming dice (found on blender forums) and allows the user to fling them around like real dice.

## WASM Physics Engine (Phase 1)

A high-performance C++ physics engine compiled to WebAssembly is being integrated
to replace the existing ammo.js simulation for improved performance and determinism.

**Current status:** Phase 1 complete — build pipeline, C++ rigid-body solver,
JavaScript bridge, and documentation are in place.  The WASM engine loads
alongside ammo.js in Phase 1; full replacement is targeted for Phase 2.

See [docs/WASM_ENGINE.md](docs/WASM_ENGINE.md) for build instructions, API reference, and roadmap.

Quick start (requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)):

```bash
npm run build:wasm   # compile C++ → WASM
npm run build        # production build (includes WASM artifacts)
npm run dev          # development server (WASM stub used if binary absent)
```

