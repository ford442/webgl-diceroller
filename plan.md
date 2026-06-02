# Agentic Development Plan

This document outlines the roadmap for the further development of the WebGPU Dice Roller project, specifically focusing on agentic workflows and future optimizations.

## 1. Dice Logic Requirements

The following dice types are required and have been partially implemented in the initial migration:

*   **d4 (4-sided)**
*   **d6 (6-sided)**
*   **d8 (8-sided)**
*   **d10 (10-sided)**
*   **d12 (12-sided)**
*   **d20 (20-sided)**

### Future Agentic Tasks for Dice Logic:
*   **Result Determination:** Implement logic to determine which face is "up" after the physics simulation settles. This involves raycasting or analyzing the quaternion orientation relative to the dice geometry.
*   **Throwing Mechanics:** Implement a user-input driven throwing mechanism (drag and release vector) rather than the current static drop.
*   **Materials & Visuals:** Improve the visual fidelity using PBR materials (roughness, metalness) instead of basic standard materials, potentially leveraging the texture maps embedded in the original DAEs more effectively.

## 2. Asset Optimization Pipeline ✅ (dice done)

The legacy Collada (`.dae`) dice assets have been converted to Draco-compressed glTF/GLB.

### Conversion Strategy:
1.  **Automated Conversion Script:** ✅ `scripts/convert-dice-to-glb.mjs` (`npm run convert:dice`) batch-converts the `.dae` sources (now in `raw_models/dae/`) to `.glb`. It drives headless Chromium (Playwright) for `ColladaLoader`→`GLTFExporter`, then post-processes with `@gltf-transform` (dedup/weld/prune/quantize). (Blender CLI was unavailable in the build env, so the browser loaders were used directly.)
2.  **Draco Compression:** ✅ `KHR_draco_mesh_compression` applied to all six dice. Total payload ~243 KB (~227 KB gzipped), down from ~4 MB of `.dae` XML.
3.  **Loader Update:** ✅ `src/dice.js` now uses `GLTFLoader` + `DRACOLoader` (decoder self-hosted in `public/draco/`).

### Remaining:
- Convert the 80+ environment props (`raw_models/*.blend`, OBJ lamp) to GLB/Draco the same way.
- KTX2 + Basis texture compression for the shared PBR texture sets.

## 3. WebGPU & WGSL Optimizations

The current production path still uses Three.js `WebGLRenderer` by default. The repo now has an experimental `?webgpu` prototype path, but it is not yet the primary renderer. For high-performance physics or custom visual effects, raw WGSL (WebGPU Shading Language) can be utilized on top of that prototype.

### Current Prototype Status
*   **Renderer abstraction:** `src/core/RendererFactory.js` can select `WebGPURenderer` behind `?webgpu` and falls back to `WebGLRenderer` when init fails or `?webgl` is forced.
*   **Post stack split:** WebGL keeps `EffectComposer`; WebGPU uses Three.js TSL `PostProcessing`.
*   **Known compatibility gap:** `ShaderMaterial`-based effects like the tavern window god rays do not run on the WebGPU path and are disabled there.

### Migration Steps
1.  **Keep the opt-in boundary strict:** land WebGPU changes only when `?webgpu` visuals remain close to `?webgl`.
2.  **Port custom shaders to TSL/WGSL:** replace `ShaderMaterial` effects, starting with `GodRayShader.js`, before making WebGPU the default.
3.  **Audit materials and loaders:** verify environment maps, shadow quality, tone mapping, and texture color spaces match across both renderers.
4.  **Add a regression harness:** compare `?webgl` and `?webgpu` screenshots or scene stats in Playwright where browser support allows it.
5.  **Only then consider default-on WebGPU:** after parity and fallback behavior are stable.

### Roadmap for Compute Shaders:
*   **Physics Offloading:** Currently, `ammo.js` (WASM) handles physics on the CPU. A major optimization would be to implement a **Compute Shader** based physics engine (or use a library that does) to handle collision detection and rigid body dynamics entirely on the GPU.
    *   *Step 1:* Implement a basic particle system using WGSL compute shaders.
    *   *Step 2:* Attempt to port simple rigid body collision logic to WGSL.
*   **Visual Effects:** Use TSL (Three.js Shading Language) or raw WGSL nodes to create dynamic effects like:
    *   Motion blur on fast-moving dice.
    *   Glow effects when a die settles on a critical number (e.g., natural 20).

## 4. WebGL2 Fallback Robustness

*   Ensure all custom shaders or materials written for WebGPU have appropriate fallbacks or transpilation for WebGL2 to maintain broad compatibility.
*   Test on devices with disabled WebGPU flags.
*   Preserve the existing `WebGLRenderer` path as the stable baseline until WebGPU is proven across Chrome/Edge and non-WebGPU browsers still render identically under `?webgl`.
