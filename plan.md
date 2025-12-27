# WebGPU Dice Roller Migration Plan

This document outlines the roadmap for upgrading the existing WebGL Dice Roller application to WebGPU using Three.js.

## Goals

1.  **Migrate to WebGPU**: Replace the legacy CubicVR.js engine with Three.js using its WebGPU renderer.
2.  **Support Standard Dice**: Implement 4, 6, 8, 10, 12, and 20-sided dice.
3.  **Add 100-sided Die**: Implement a new 100-sided die.

## Implementation Steps

### 1. Technology Stack
*   **Rendering Engine**: Three.js (with WebGPURenderer).
*   **Physics Engine**: Cannon-es or Ammo.js (compatible with Three.js).
*   **Language**: JavaScript / TypeScript.

### 2. Dice Models
*   **Existing Dice (d4, d6, d8, d10, d12, d20)**:
    *   Port existing Collada (`.dae`) or Blender (`.blend`) models to a format compatible with Three.js (e.g., glTF/GLB).
    *   Ensure textures and UV maps are correctly preserved.
    *   Set up physics collision meshes for each die type.
*   **100-sided Die (d100)**:
    *   Procedurally generate the geometry for a "Zocchihedron" or similar sphere-like polyhedron.
    *   Generate texture coordinates and number labels programmatically.

### 3. Application Logic
*   **Scene Setup**: Recreate the floor and walls setup with correct physics boundaries.
*   **Dice Spawning**: Implement logic to spawn selected dice types.
*   **Interaction**: Implement mouse/touch interaction to throw or interact with dice (similar to the current "pick constraint" or drag-to-throw).
*   **Animation**: Ensure smooth simulation steps using the physics engine loop.

### 4. Milestones
1.  **Basic Setup**: Initialize Three.js WebGPU renderer and physics world.
2.  **Asset Conversion**: Convert d4-d20 models to GLB.
3.  **Standard Dice Implementation**: Get d4-d20 rolling in the new engine.
4.  **d100 Implementation**: Develop the procedural generation algorithm for the d100.
5.  **UI/UX**: Add controls to select dice and reset the board.
