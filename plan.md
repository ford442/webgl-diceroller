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

## 2. Asset Optimization Pipeline

To fully modernize the application, the legacy Collada (`.dae`) assets should be converted to glTF/GLB.

### Conversion Strategy:
1.  **Automated Conversion Script:** Create a Node.js script using `gltf-pipeline` or Blender CLI to batch convert all `.dae` files in `public/images/` to `.glb` format.
2.  **Draco Compression:** Apply Draco compression to the resulting GLB files to reduce download sizes.
3.  **Loader Update:** Switch `ColladaLoader` to `GLTFLoader` in `src/dice.js`.

## 3. WebGPU & WGSL Optimizations

The current implementation uses Three.js's `WebGPURenderer` which abstracts much of the WebGPU complexity. However, for high-performance physics or custom visual effects, raw WGSL (WebGPU Shading Language) can be utilized.

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
