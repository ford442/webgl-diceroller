WebGL Dice Roller
===========================================

This is a WebGL application that uses the CubicVR engine to spawn 3D models of gaming dice (found on blender forums) and allows the user to fling them around like real dice.

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
