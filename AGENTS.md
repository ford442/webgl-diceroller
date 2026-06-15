# WebGL Dice Roller — Agent Documentation

## Project Overview

This is a **WebGL-based 3D dice roller application** built with Three.js. It simulates a tavern-themed environment where users can spawn, throw, and interact with various gaming dice (d4, d6, d8, d10, d12, d20) using realistic rigid-body physics. The project was originally built using the CubicVR engine (preserved in `legacy/`) and has been migrated to a modern Three.js + Vite stack.

> **Note on naming:** The HTML `<title>` reads "WebGPU Dice Roller". The default runtime remains `THREE.WebGLRenderer`, but the repo now includes an opt-in `?webgpu` prototype path using Three.js `WebGPURenderer` with a TSL post stack. `?webgl` forces the stable WebGL path.

## Technology Stack

| Component | Technology |
|-----------|------------|
| 3D Engine | Three.js (`^0.181.2`) |
| Physics | Custom `DicePhysicsEngine` WASM (SAT polyhedral) + ammo.js (`^0.0.10`) fallback/interaction bridge |
| Build Tool | Vite (`^7.3.1`) |
| Rendering | WebGLRenderer by default, optional WebGPURenderer prototype behind `?webgpu` |
| Module System | ES Modules |
| Test Automation | Playwright (`^1.58.2`, ad-hoc Node.js scripts only) |

## Project Structure

```
webgl-diceroller/
├── src/                        # Main source code
│   ├── main.js                 # Entry point: scene setup, render loop, camera, loading tiers
│   ├── dice.js                 # Dice loading (glTF/Draco), spawning, throw logic
│   ├── physics.js              # ammo.js physics initialization and helpers
│   ├── core/FrameScheduler.js  # Ordered frame phases + fixed-timestep physics hook
│   ├── interaction.js          # Mouse/raycaster interaction (drag, levitate)
│   ├── ui.js                   # DOM-based UI controls and crosshair
│   ├── shaders/                # Custom GLSL shaders
│   │   ├── VignetteShader.js   # Active: used in post-processing pipeline
│   │   └── GodRayShader.js     # Defined but unused in current pipeline
│   └── environment/            # Scene environment components (84 prop modules)
│       ├── PropRegistry.js     # Auto-discovers prop factories + tier definitions
│       ├── Table.js            # Main dice table (36×36 surface with velvet dice zone)
│       ├── TavernWalls.js      # Room walls with fireplace
│       ├── TavernEnvironment.js# PMREM environment map for PBR
│       ├── Clutter.js          # Candle and small items (positions key PointLight)
│       ├── Lamp.js             # Hanging billiard lamp (OBJ, multiple light modes)
│       ├── Atmosphere.js       # Dust motes particle system
│       ├── Fire.js             # Fireplace fire effect
│       └── Bookshelf.js, Chair.js, Chest.js, Gong.js, etc.  # Decor props
├── public/                     # Static assets served as-is
│   ├── images/                 # Textures, lamp OBJ + textures
│   │   └── dice/               # Draco-compressed dice models (die_*.glb)
│   ├── draco/                  # Self-hosted Draco decoder (wasm) for GLTFLoader
│   └── js/                     # Legacy script placements
├── raw_models/                 # Source Blender files (.blend); dae/ holds legacy Collada conversion inputs
├── legacy/                     # Original CubicVR implementation (HTML + JS)
├── index.html                  # HTML entry point
├── vite.config.js              # Vite configuration
├── package.json                # npm dependencies and scripts
├── deploy.py                   # SFTP deployment script
├── test_playingcards.js        # Playwright smoke test: verifies PlayingCards prop
├── test_flute.js               # Playwright smoke test: verifies Flute prop
├── test_debug.js               # Playwright debug script: polls window.sceneReady
├── plan.md                     # Roadmap (glTF migration, WebGPU ideas)
├── weekly_plan.md              # Session progress notes
└── claude.md                   # Session-specific context (e.g., lamp height issue)
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (opens browser, hot reload on http://localhost:5173)
npm run dev

# Build the custom WASM physics module (requires Emscripten)
npm run build:wasm

# Convert dice Collada sources to Draco GLB (requires Playwright)
npm run convert:dice

# Convert prop meshes (lamp OBJ) + shared JPG textures to Draco GLB / KTX2
npm run convert:props

# Build for production (outputs to dist/)
npm run build

# Preview production build locally (http://localhost:4173)
npm run preview
```

- `npm run dev` still works without compiled WASM artifacts; the bridge falls back to ammo.js automatically.
- `?no-wasm` forces the ammo fallback path even if `public/wasm/` exists.
- `?dual-physics` steps ammo and WASM in parallel for validation/debugging.
- `?worker-physics` (experimental) runs the WASM engine inside a Web Worker.
- `?no-drag` disables quadratic air resistance on both ammo.js and WASM paths.
- `?fair-dice` disables the pipping COM bias.
- Render/perf flags:
  - `?webgpu` opts into the experimental WebGPU renderer path.
  - `?webgl` forces the stable WebGL renderer path.
  - `?no-post` disables the composer entirely.
  - `?low-post` keeps post enabled but lowers bloom quality.
  - `?no-bloom` disables only bloom.
  - `?no-godrays` disables the tavern window volumetric beam meshes.
  - `?debug` / `?debug-perf` shows render stats; `debug-perf` also logs slow frame systems.

## Architecture Details

### Audio system
- `src/audio/DiceCollisionAudio.js` synthesises dice impact sounds using the Web Audio API (no external sound assets).
- Collision events from both the WASM engine (`pollPhysicsCollisionEvents`) and the ammo.js fallback (`pollAmmoCollisionEvents`) provide per-impact metadata: mass, linear velocity squared, angular velocity squared, and a scalar moment-of-inertia estimate.
- The audio module computes kinetic energy as `E_k = 1/2*m*v^2 + 1/2*I*omega^2` and maps it to volume, pitch, and filter brightness:
  - Louder for harder impacts, clamped to `[0.04, 1.0]`.
  - Slight pitch jitter plus a lower pitch bias for heavier impacts.
  - Table collisions (`idB === -1`) use a bandpass thud; die-on-die collisions use a highpass clack.
- Audio starts in a suspended `AudioContext` and is resumed on the first user pointer or key event.

### `src/main.js`
- Initializes Three.js `Scene` plus the renderer selected by `src/core/RendererFactory.js`.
- Uses `FrameScheduler` to run named phases: `preStep` → `physicsStep` → `postPhysicsSync` → `updates` → `preRender` → `render` → `postRender`.
- Sets up lighting:
  - Warm flickering candle `PointLight` (`0xff9933`, intensity 2.5, distance 20, casts shadow)
  - Cool moonlight `SpotLight` (`0x4444dd`, intensity 5.0, outside window)
  - Very low ambient light (`0xffffff`, intensity 0.05)
- WebGL post pipeline: `RenderPass` → `UnrealBloomPass` → `ShaderPass(VignetteShader)` → `OutputPass`.
- WebGPU post pipeline: TSL `PostProcessing` scene pass with bloom, vignette, and a subtle chromatic aberration pass in high quality mode.
- Loads a PMREM environment map from `TavernEnvironment.js` for PBR reflections.
- Loads `src/wasm/WasmPhysicsBridge.js` asynchronously. When the module is present and `?no-wasm` is not set, the custom WASM engine becomes authoritative for ordinary dice simulation; ammo remains available as fallback and for active drag/levitation handoff.
- Implements **tiered async loading** with a loading overlay and progress bar:
  - **Tier 0 (Critical, 10–40%):** Physics engine, core environment (walls, room, table, candle), dice models, UI, interaction. Rendering starts immediately after this tier.
  - **Tier 1 (Important, 55–70%):** Furniture and background props (bookshelf, chairs, chest, rug, atmosphere, billiard lamp, floating candles, runecircle).
  - **Tier 2 (Secondary, ~85%):** Tabletop props arranged around the dice zone edges (dice tower, tray, jail, bag, bell, meal, hourglass, map, scroll, crystal ball, potions, skull, scale, lantern, spellbook, mug, tankard).
  - **Tier 3 (Decorative, 95%):** Background/decorative props (dagger, sword, shield, axe, pocket watch, compass, chalice, miniature, character sheet, bounty poster, pencil, coin pouch, lute, runestones, candelabra, smoking pipe, gemstones, writing set, cheese wheel, wax seal, crown, helmet, gong, mystic orb, DM screen, dragon scale, spyglass, playing cards, key, padlock, lockpicks, spectacles, leather journal, drinking horn, wand, coin, amulet, abacus, dart, scroll case, magnifying glass, rope, goblet, crossbow, waterskin, astrolabe, sundial, ale keg, flute, apple).
  - **Finalizing (100%):** Disables `castShadow` on small decorative props by name, fades out loading overlay, sets `window.sceneReady = true`.
- Implements an **"Eye-Head" FPS camera** with pointer lock (right-click to enter, ESC to exit). WASD moves, Space jumps.
- Manages the **dice focus state machine** after a roll:
  `IDLE` → `WAITING_FOR_STOP` → `FOCUSING` → `HOLDING` (2s) → `RETURNING` → `IDLE`
  When focusing, the camera dynamically calculates distance based on dice spread.
- Exposes `window.__renderStats` for scheduler timings / renderer info when `?debug-perf` is enabled.
- Exposes globals for debugging and test automation:
  `window.camera`, `window.scene`, `window.physicsWorld`, `window.renderer`, `window.THREE`, `window.sceneReady`, `window.usingWebGPU`, `window.usingWebGL`, `window.rendererType`.

### `src/dice.js`
- Loads Draco-compressed glTF (`.glb`) dice models from `public/images/dice/` using `GLTFLoader` + `DRACOLoader`.
- Converts materials to `MeshStandardMaterial` (roughness 0.2, metalness 0.0, envMapIntensity 1.0).
- Centers and rotates geometry, then creates convex hull collision shapes stored in `diceModels[type].userData.physicsShape`.
- Uses `window.crypto.getRandomValues` for secure randomness in spawns and throws.
- `spawnObjects(scene, world, config)` — spawns dice with random positions/rotations. Default is one of each type (d4–d20). Accepts either a counts object or an array of type strings. When WASM is ready it also registers each die in the C++ engine and stores the returned ID.
- `updateDiceVisuals()` — prefers `engine.getTransforms()` (zero-copy `Float32Array`) when WASM is active, but temporarily reads ammo transforms for dice under drag/levitation control.
- `updateDiceSet(scene, world, targetCounts)` — adds or removes dice dynamically to match UI counts. Properly disposes geometries, materials, and Ammo heap objects on removal.
- `throwDice(scene, world, seed)` — resets dice to top center and applies randomized impulses (±25 horizontal, ±5 vertical) and torque (±100 spin) to both engines. When `seed !== null`, uses the deterministic WASM PRNG for bit-identical replay. 
- `loadHullForDie(wasmId, sides)` — passes precomputed convex hull vertices from `public/wasm/hulls.json` into the WASM engine so each die uses accurate SAT polyhedral collision instead of bounding spheres.
- `clearDice(scene, world)` — removes all dice and explicitly destroys Three.js geometries/materials and Ammo.js heap objects.

### `src/physics.js`
- `initPhysics()` — initializes the ammo.js world with gravity `(0, -15, 0)`.
- `stepPhysics(world, deltaTime)` — steps simulation with 4 substeps at 1/60s.
- `createFloorAndWalls(scene, world, tableConfig)` — creates static physics bounds from `Table.js` config (floor, invisible walls, lips).
- `spawnDicePhysics(world, mesh, shape, position, rotation)` — spawns a dice rigid body with:
  - mass = 5
  - friction = 0.6
  - rollingFriction = 0.1
  - restitution = 0.2
  - damping = 0.05 linear / 0.1 angular
  - collision margin = 0.01
  - activation state = 4 (`DISABLE_DEACTIVATION`)
- `createConvexHullShape(mesh)` — clones geometry, merges vertices with `BufferGeometryUtils.mergeVertices`, iterates positions to build an `Ammo.btConvexHullShape`.
- `createStaticBody(world, mesh, shape)` — creates a mass-0 static rigid body from a mesh transform.
- All temporary Ammo.js objects (`btVector3`, `btTransform`, `btRigidBodyConstructionInfo`, etc.) are explicitly destroyed after use to prevent WASM heap leaks.
- Exports `getAmmo()` for other modules to access the initialized Ammo instance.

### `src/interaction.js`
- `initInteraction(camera, scene, physicsWorld)` — sets up `Raycaster`, pre-warms shaders for levitation effects (hidden sphere + light at y=-1000, compiled then disposed after 500ms).
- `registerInteractiveObject(mesh, callback)` — API for static props (e.g., lamp, skull, gong) to receive click events.
- Left-click on a die starts a `btPoint2PointConstraint` drag. Mouse movement updates the constraint pivot on a camera-aligned plane.
- Double-clicking a die (within 300ms) triggers **levitation**: the body becomes kinematic (`CF_KINEMATIC_OBJECT` flag | 2), rises with a blue glow (`0x0088ff` PointLight), spins, then is released with a random throw after 1.5s.
- `getHoveredDie(camera, normX, normY)` — returns the die under the cursor for hover cursor changes.
- `updateInteraction()` — activates dragged bodies and updates levitation state each frame.

### `src/ui.js`
- `initUI(onUpdateDice, onRollAll)` — creates a DOM overlay in the top-right with number inputs for each dice type (d4–d20, range 0–10) and a "Roll All" button.
- `createCrosshair()` — creates a centered circular crosshair for FPS mode.
- Adds a controls help panel in the bottom-left explaining Left Click (grab), Right Click (FPS mode), WASD, ESC, and R (roll).

### Environment System
Environment components are modular factory functions, typically:
```js
export function createXxx(scene, physicsWorld, position, rotation) {
    // ... build group/mesh ...
    return { group, update?, physicsBody?, interact?, toggle? };
}
```
- Props that need per-frame animation provide an `update(deltaTime, elapsedTime)` function.
- `LoadingTiers.js` wires these into `FrameScheduler` through the prop registry; do not add ad-hoc per-frame calls in `main.js`.
- Interactive props return callbacks (e.g., `interact`, `toggleGlow`) that are registered in the prop entry’s `afterCreate` hook.
- Physics-enabled props often use `createStaticBody()` from `physics.js` for invisible collision meshes.
- Shadows are aggressively optimized: small decorative props are listed in `SHADOW_DISABLED_PROP_NAMES` in `src/environment/PropRegistry.js`.

### Rendering Notes
- WebGL remains the default and most compatible runtime.
- `?webgpu` uses `WebGPURenderer` plus the TSL post pipeline. It is intentionally opt-in.
- The tavern window god-ray mesh uses `THREE.ShaderMaterial`, so it is disabled automatically on the WebGPU path unless that effect is ported to TSL/WGSL later.
- `GodRayShader.js` is used for the scene-space moonlight beam mesh in `TavernWalls.js`; it is not part of the fullscreen composer pipeline.

## Asset Pipeline

### Dice Models
- **Format**: Draco-compressed binary glTF (`.glb`) in `public/images/dice/` (`die_4.glb` … `die_20.glb`).
- **Source**: Blender files in `raw_models/`; the legacy Collada exports are kept (un-shipped) in `raw_models/dae/` as the conversion input.
- **Loader**: `GLTFLoader` + `DRACOLoader` in `src/dice.js`. The Draco decoder (wasm) is self-hosted in `public/draco/` (copied from `node_modules/three/examples/jsm/libs/draco/`) and referenced via `setDecoderPath('./draco/')` — no CDN dependency.
- **Conversion**: `npm run convert:dice` runs `scripts/convert-dice-to-glb.mjs`, which drives a headless Chromium (Playwright) to load each `.dae` with `ColladaLoader` and re-export it via `GLTFExporter`, then post-processes with `@gltf-transform` (dedup → weld → prune → quantize) and applies `KHR_draco_mesh_compression`. The world matrix is baked into the geometry so the runtime transform in `dice.js` (`center → applyMatrix4 → rotateX(-π/2) → center`) is mathematically identical to the old Collada path — physics hulls and `readDiceValue` face clustering are preserved.
- **Payload**: ~243 KB total (~227 KB gzipped), down from ~4 MB of raw `.dae` XML. `weld()` also collapses the heavily-duplicated Collada vertices (e.g. d4 34 470 → 5 747 verts).
- Geometry is centered and rotated on load to ensure proper center of mass for physics.
- To regenerate after editing a source model: export the `.blend` to `raw_models/dae/die_N.dae`, then `npm run convert:dice`.

### Textures
- PBR workflow: diffuse, roughness, normal, AO, bump maps.
- **Runtime loader**: `src/core/TexturePipeline.js` preloads shared sets via `KTX2Loader` (Basis transcoder in `public/basis/`) with automatic JPG fallback when a `.ktx2` sibling is missing.
- **Conversion**: `npm run convert:props` runs `scripts/convert-textures-to-ktx2.mjs`, encoding JPGs with the `basisu` CLI (`-ktx2`, `-linear` for normal/roughness/bump/AO). Original JPGs remain in `public/images/` for fallback.
- Table uses `table_diff.jpg` / `table_diff.ktx2`, `table_rough`, `table_nor`, `table_ao`.
- Wood props share `wood_diffuse`, `wood_roughness`, `wood_bump`.
- Brick walls use `brick_diffuse`, `brick_bump`, `brick_roughness`.
- Lamp textures live in `public/images/lamp/` (JPG + KTX2).
- All textures use `RepeatWrapping` with appropriate repeat counts.
- `colorSpace` is explicitly set: `SRGBColorSpace` for diffuse/albedo, `NoColorSpace` for normal/roughness/ao/bump data textures.

### Prop Meshes (environment)
- **External mesh sources** are listed in `scripts/prop-asset-manifest.mjs`. Currently only the billiard lamp OBJ (`public/images/lamp/…`) ships as an external file; ~80 other environment props use inline `BufferGeometry` (procedural) and are documented in the manifest but not exported by the conversion pipeline.
- **Conversion**: `npm run convert:props` runs `scripts/convert-props-to-glb.mjs` (Playwright + `OBJLoader` → `GLTFExporter` → `@gltf-transform` dedup/weld/prune/quantize + Draco), outputting `public/images/props/billiard_lamp.glb` (~344 KB vs ~8.9 MB OBJ).
- **Runtime loader**: `src/core/PropAssetLoader.js` (`GLTFLoader` + `DRACOLoader`, OBJ fallback). `Lamp.js` uses the visual-wrapper group pattern — never mutate loaded geometry scale directly.
- **Audit report**: `scripts/prop-asset-audit.json` records before/after byte sizes (re-generated each `convert:props` run).
- Re-run `npm run convert:props` after editing lamp OBJ or shared JPG textures.

### Finish Asset Optimization Pipeline
- Dice: ✅ Draco GLB (`npm run convert:dice`).
- Shared PBR textures: ✅ KTX2 via `basisu` + JPG fallback (`TexturePipeline.js`).
- External prop mesh (lamp): ✅ Draco GLB + loader migration (`PropAssetLoader.js`).
- Procedural props: remain inline geometry; export to GLB would require artist `.blend` sources or a geometry-exporter pass (not in repo today).

## Development Conventions

### Code Style
- ES6 modules with named exports (`export function`, `export const`).
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

### Pipping bias (mass-asymmetric dice)
- Real dice lose material to recessed numbers, so the low-number face ("1") is heaviest and the high-number face is lightest.
- `src/dice.js` computes a centre-of-mass offset toward the "1" face equal to `0.75%` of the die's bounding-box height (`DEFAULT_MASS_BIAS_RATIO`).
- In the ammo.js path, `spawnDicePhysics` builds a `btCompoundShape` so the rigid-body COM is shifted away from the visual centroid.
- In the WASM path, `applyDiceMassBiases` applies a gravity torque that approximates the same effect.
- Toggle:
  - `?fair-dice` disables the bias entirely (perfect Platonic-solid COM).
  - `?bias-ratio=0.01` overrides the default magnitude (clamped to `[0, 0.05]`).

### Quadratic drag (air resistance)
- Dice experience velocity-squared drag in addition to linear/angular damping and collision friction.
- `src/dice.js` defines a per-type `dragFactor` in `PHYSICS_PRESETS`.
- `src/physics.js` → `stepPhysics` applies `applyAmmoQuadraticDrag` before each simulation step (`F_drag ~ -Cd * |v|^2 * v_hat`).
- The WASM engine applies the same drag in `DicePhysicsEngine::integrate` via `setDieDrag`.
- Disable with `?no-drag` for testing idealised friction-only behaviour.

### Adding New Environment Props
1. Create a new file in `src/environment/PropName.js`.
2. Export a factory function taking `(scene, physicsWorld?, position?, rotation?)`.
3. Return an object with at least `{ group }`, optionally `{ update }` for animations.
4. Add the prop to the appropriate tier in `src/environment/PropRegistry.js`.
5. If it has per-frame behavior, register `result.update` in the entry’s `afterCreate` hook.
6. If it is interactive, register the callback in the entry’s `afterCreate` hook.
7. If the prop is small/decorative, add its name to `SHADOW_DISABLED_PROP_NAMES` in `src/environment/PropRegistry.js`.

### Memory Management
- When removing dice, always call `Ammo.destroy()` on `body.getMotionState()` and `body` itself.
- When removing dice visuals, call `geometry.dispose()` and `material.dispose()`.
- Reusable transforms (`_sharedTransform`, `_levitationTransform`) are used in `updateDiceVisuals` and `updateLevitation` to minimize Ammo.js heap churn.

### Shadow Best Practices
- Prefer disabling `castShadow` at prop registration time via `PropRegistry` instead of relying on a late full-scene traverse.
- Keep `renderer.shadowMap.autoUpdate = false` by default; motion systems should temporarily re-enable shadow updates during rolls, drags, or levitation.
- If a prop includes tiny accent meshes, default them to `castShadow = false` unless the shadow is visually important.

## Testing Instructions

There is **no formal unit or integration test suite** (no Jest, Vitest, etc.).

Three ad-hoc Playwright verification scripts exist. They all target the **preview server** (`http://localhost:4173/?no-post`), not the dev server.

```bash
# 1. Build and start the preview server in one terminal
npm run build
npm run preview

# 2. In another terminal, run any of the test scripts
node test_playingcards.js   # Verifies PlayingCards object exists in scene graph
node test_flute.js          # Verifies Flute object exists in scene graph
node test_debug.js          # Polls window.sceneReady and logs scene child counts
node test_wasm_direct.js    # Smoke-tests WASM SAT collision, determinism, and stress (requires preview server)
```

**Automation hooks:**
- `window.scene` — set after Tier 0 completes.
- `window.sceneReady` — set to `true` after all loading tiers finish and the overlay is removed.
- All scripts use `?no-post` to bypass post-processing and reduce SwiftShader load.

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

- `deploy.py` contains a hardcoded password (`GoogleBez12!`). This is a known risk and should be moved to environment variables or a secrets manager.
- No server-side user input processing (pure client-side application).
- Physics simulation runs locally only.

## Known Limitations

- **Dice result determination** is implemented in `src/dice.js` via `_computeFaceNormals` and `readDiceValue()`.
- **ColladaLoader migration is complete** — dice models now load as Draco-compressed `.glb` files from `public/images/dice/`.
- **WASM die-to-die contacts are now SAT-based polyhedral** (Phase 3). Bounding spheres remain as a fallback when hulls are not loaded.
- **No automated test coverage** beyond the three ad-hoc Playwright smoke tests.
- **GodRayShader** exists but is not wired into the current post-processing pipeline.
- The HTML `<title>` says "WebGPU Dice Roller" but the renderer is WebGL.
