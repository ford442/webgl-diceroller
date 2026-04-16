# WebGL Dice Roller - Agent Documentation

## Project Overview

This is a **WebGL-based 3D dice roller application** built with Three.js. It simulates a tavern-themed environment where users can spawn, throw, and interact with various gaming dice (d4, d6, d8, d10, d12, d20) using realistic physics. The project was originally built using the CubicVR engine (preserved in `legacy/`) and has been migrated to a modern Three.js + Vite stack.

## Technology Stack

| Component | Technology |
|-----------|------------|
| 3D Engine | Three.js (r0.181.2) |
| Physics | ammo.js (v0.0.10, Bullet Physics WASM port) |
| Build Tool | Vite (v7.3.1) |
| Rendering | WebGLRenderer with post-processing |
| Module System | ES Modules |
| Test Automation | Playwright (ad-hoc script only) |

## Project Structure

```
webgl-diceroller/
├── src/                      # Main source code
│   ├── main.js               # Entry point: scene setup, render loop, camera logic
│   ├── dice.js               # Dice loading (Collada), spawning, throw logic
│   ├── physics.js            # ammo.js physics initialization and helpers
│   ├── interaction.js        # Mouse/raycaster interaction (drag, levitate)
│   ├── ui.js                 # DOM-based UI controls
│   ├── shaders/              # Custom GLSL shaders
│   │   ├── VignetteShader.js # Used in post-processing
│   │   └── GodRayShader.js   # Defined but unused in current pipeline
│   └── environment/          # Scene environment components (~78 prop modules)
│       ├── Table.js          # Main dice table (36x36 surface)
│       ├── TavernWalls.js    # Room walls with fireplace
│       ├── TavernEnvironment.js  # Environment map for PBR
│       ├── Clutter.js        # Candle and small items
│       ├── Lamp.js           # Hanging billiard lamp (OBJ, multiple modes)
│       ├── Atmosphere.js     # Dust motes particle system
│       ├── Fire.js           # Fireplace fire effect
│       └── Bookshelf.js, Chair.js, Chest.js, etc.  # Decor props
├── public/                   # Static assets served as-is
│   ├── images/               # Dice models (.dae), textures, lamp OBJ
│   └── js/                   # Legacy script placements
├── raw_models/               # Source Blender files (.blend)
├── legacy/                   # Original CubicVR implementation
├── index.html                # HTML entry point
├── vite.config.js            # Vite configuration
├── package.json              # npm dependencies and scripts
├── deploy.py                 # SFTP deployment script
└── test_playingcards.js      # Ad-hoc Playwright verification script
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (opens browser, hot reload on http://localhost:5173)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Preview production build locally
npm run preview
```

## Architecture Details

### `src/main.js`
- Initializes Three.js `Scene`, `WebGLRenderer` (antialias: false, pixelRatio: 1.0, `PCFSoftShadowMap`, `ACESFilmicToneMapping`), and `EffectComposer`.
- Sets up lighting: warm flickering candle `PointLight` (0xff9933), cool moonlight `SpotLight` (0x4444dd), and very low ambient light.
- Configures post-processing pipeline: `RenderPass` → `UnrealBloomPass` (threshold=0.6, strength=0.6, radius=0.4) → `ShaderPass(VignetteShader)` → `OutputPass`. Disable with `?no-post`.
- Loads a PMREM environment map from `TavernEnvironment.js`.
- Implements tiered async loading (Critical → Important → Secondary → Decorative) with a loading overlay and progress bar.
- Implements an "Eye-Head" FPS camera with pointer lock (right-click to enter, ESC to exit). WASD moves, Space jumps.
- Manages the dice focus state machine (`IDLE` → `WAITING_FOR_STOP` → `FOCUSING` → `HOLDING` → `RETURNING`) after a roll.
- Registers ~80 environment props and maintains an `updateRegistry` for per-frame animated updates.
- Exposes `window.camera`, `window.scene`, `window.physicsWorld`, `window.renderer`, and `window.THREE` for debugging.

### `src/dice.js`
- Loads Collada (`.dae`) dice models from `public/images/` using `ColladaLoader`.
- Converts materials to `MeshStandardMaterial` (roughness 0.2, metalness 0.0, envMapIntensity 1.0).
- Centers and rotates geometry, then creates convex hull collision shapes stored in `diceModels[type].userData.physicsShape`.
- `spawnObjects(scene, world, config)` — spawns dice with random positions/rotations. Default is one of each type (d4–d20).
- `updateDiceVisuals()` — syncs Three.js meshes with ammo.js physics bodies using a shared `btTransform` to avoid allocations.
- `updateDiceSet(scene, world, targetCounts)` — adds or removes dice dynamically to match UI counts.
- `throwDice(scene, world)` — resets dice to top center and applies randomized impulses and torque.
- `clearDice(scene, world)` — removes all dice and explicitly destroys Three.js geometries/materials and Ammo.js heap objects.

### `src/physics.js`
- `initPhysics()` — initializes the ammo.js world with gravity `(0, -15, 0)`.
- `stepPhysics(world, deltaTime)` — steps simulation with 4 substeps at 1/60s.
- `createFloorAndWalls(scene, world, tableConfig)` — creates static physics bounds from `Table.js` config (floor, walls, lips).
- `spawnDicePhysics(world, mesh, shape, position, rotation)` — spawns a dice rigid body with:
  - mass = 5
  - friction = 0.6
  - rollingFriction = 0.1
  - restitution = 0.2
  - damping = 0.05 linear / 0.1 angular
  - collision margin = 0.01
  - activation state = 4 (`DISABLE_DEACTIVATION`)
- `createConvexHullShape(mesh)` — clones geometry, merges vertices, iterates positions to build an `Ammo.btConvexHullShape`.
- `createStaticBody(world, mesh, shape)` — creates a mass-0 static rigid body from a mesh transform.
- All temporary Ammo.js objects (`btVector3`, `btTransform`, `btRigidBodyConstructionInfo`, etc.) are explicitly destroyed after use to prevent WASM heap leaks.

### `src/interaction.js`
- `initInteraction(camera, scene, physicsWorld)` — sets up raycaster and pre-warms shaders for levitation effects.
- `registerInteractiveObject(mesh, callback)` — API for static props (e.g., lamp, skull, gong) to receive click events.
- Left-click on a die starts a point-to-point constraint drag. Mouse movement updates the constraint pivot on a camera-aligned plane.
- Double-clicking a die (within 300ms) triggers **levitation**: the body becomes kinematic, rises with a blue glow, spins, then is released with a random throw after 1.5s.
- `getHoveredDie(camera, normX, normY)` — returns the die under the cursor for hover cursor changes.

### `src/ui.js`
- `initUI(onUpdateDice, onRollAll)` — creates a DOM overlay in the top-right with number inputs for each dice type (d4–d20, range 0–10) and a "Roll All" button.
- `createCrosshair()` — creates a centered circular crosshair for FPS mode.
- Adds a controls help panel in the bottom-left explaining Left Click (grab), Right Click (FPS mode), WASD, ESC, and R (roll).

### Environment System
Environment components are modular factory functions, typically:
```js
export function createXxx(scene, physicsWorld, position, rotation) {
    // ... build group/mesh ...
    return { group, update?, physicsBody? };
}
```
- Props that need per-frame animation provide an `update(deltaTime, elapsedTime)` function.
- `main.js` registers these in `updateRegistry` and calls them each frame.
- Shadows are aggressively optimized: small decorative props disable `castShadow` by name in a traversal at the end of `init()`.

### Post-Processing Pipeline
1. **RenderPass**
2. **UnrealBloomPass** (glow for flames/lights)
3. **ShaderPass(VignetteShader)**
4. **OutputPass**

Note: `GodRayShader.js` exists in `src/shaders/` but is **not currently used** in the active pipeline.

## Asset Pipeline

### Dice Models
- **Format**: Collada (`.dae`) in `public/images/`
- **Source**: Blender files in `raw_models/`
- Geometry is centered and rotated on load to ensure proper center of mass for physics.
- `plan.md` mentions a future migration to glTF/GLB with Draco compression, but this has not yet been implemented.

### Textures
- PBR workflow: diffuse, roughness, normal, AO, bump maps.
- Table uses `table_diff.jpg`, `table_rough.jpg`, `table_nor.jpg`, `table_ao.jpg`.
- Wood props share `wood_diffuse.jpg`, `wood_roughness.jpg`, `wood_bump.jpg`.
- Brick walls use `brick_diffuse.jpg`, `brick_bump.jpg`, `brick_roughness.jpg`.
- Lamp is an external OBJ model with dedicated texture set in `public/images/lamp/`.
- All textures use `RepeatWrapping` with appropriate repeat counts.
- `colorSpace` is explicitly set: `SRGBColorSpace` for diffuse/albedo, `NoColorSpace` for normal/roughness/ao/bump data textures.

## Development Conventions

### Code Style
- ES6 modules with named exports.
- Factory functions for environment props use `camelCase`.
- Constants are `UPPER_SNAKE_CASE`.
- Physics-related objects store references in `userData` (e.g., `mesh.userData.body`).

### Physics Tuning
- Gravity: -15 Y
- Dice mass: 5
- Friction: 0.6
- Rolling friction: 0.1
- Restitution: 0.2
- Linear damping: 0.05, Angular damping: 0.1
- Collision margin: 0.01

### Adding New Environment Props
1. Create a new file in `src/environment/PropName.js`.
2. Export a factory function taking `(scene, physicsWorld?, position?, rotation?)`.
3. Return an object with at least `{ group }`, optionally `{ update }` for animations.
4. Import and call in `main.js` `init()` function.
5. Use `registerInteractiveObject(mesh, callback)` for clickable items.

### Memory Management
- When removing dice, always call `Ammo.destroy()` on `body.getMotionState()` and `body` itself.
- When removing dice visuals, call `geometry.dispose()` and `material.dispose()`.
- Reusable transforms (`_sharedTransform`, `_levitationTransform`) are used in `updateDiceVisuals` and `updateLevitation` to minimize Ammo.js heap churn.

## Testing Instructions

There is **no formal unit or integration test suite** (no Jest, Vitest, etc.).

The only verification script is:

```bash
# 1. Start the dev server in one terminal
npm run dev

# 2. In another terminal, run the Playwright script
node test_playingcards.js
```

This script launches Chromium (with SwiftShader), navigates to `http://localhost:5173/?no-post`, waits for `window.scene` to be defined, and verifies that a `PlayingCards` object exists in the scene graph.

## Deployment

The `deploy.py` script uploads the `dist/` directory via SFTP:

```bash
# 1. Build first
npm run build

# 2. Deploy (requires paramiko)
python deploy.py
```

- **Host**: `1ink.us`
- **Remote Directory**: `test.1ink.us/dice-roller`
- **Local Directory**: `dist/`

## Security Considerations

- `deploy.py` contains a hardcoded password. This is a known risk and should be moved to environment variables or a secrets manager.
- No server-side user input processing (pure client-side application).
- Physics simulation runs locally only.

## Known Limitations

- **Dice result determination** (reading which face is up after a roll) is **not yet implemented**.
- **ColladaLoader** is still used; migration to `GLTFLoader` with Draco-compressed `.glb` files is planned but incomplete.
- **Physics runs on the CPU** via ammo.js WASM. GPU physics is noted as a future optimization in `plan.md`.
- **No automated test coverage** beyond the single Playwright smoke test.
- **GodRayShader** exists but is not wired into the current post-processing pipeline.
