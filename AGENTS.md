# WebGL Dice Roller — Agent Documentation

## Project Overview

This is a **WebGL-based 3D dice roller application** built with Three.js. It simulates a tavern-themed environment where users can spawn, throw, and interact with various gaming dice (d4, d6, d8, d10, d12, d20) using realistic rigid-body physics. The project was originally built using the CubicVR engine (preserved in `legacy/`) and has been migrated to a modern Three.js + Vite stack.

> **Renderer default:** The default runtime is `THREE.WebGPURenderer` (with a TSL post stack) on browsers that expose `navigator.gpu`; it automatically falls back to `THREE.WebGLRenderer` when WebGPU is unavailable or init fails. `?webgl` forces the stable WebGL baseline path (kept as the supported fallback for older browsers and testing). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the renderer selection table.

**Further reading:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (scheduler, tiers, props, renderer) · [`docs/WASM_ENGINE.md`](docs/WASM_ENGINE.md) (physics) · [`docs/XR.md`](docs/XR.md) (WebXR seated spike) · [GitHub Issues](https://github.com/ford442/webgl-diceroller/issues) (roadmap)

## Technology Stack

| Component       | Technology                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------- |
| 3D Engine       | Three.js (`^0.181.2`)                                                                              |
| Physics         | Custom `DicePhysicsEngine` WASM (SAT polyhedral) + ammo.js (`^0.0.10`) fallback/interaction bridge |
| Build Tool      | Vite (`^7.3.1`)                                                                                    |
| Rendering       | WebGPURenderer by default (auto-fallback to WebGLRenderer); `?webgl` forces the WebGL baseline     |
| Module System   | ES Modules                                                                                         |
| Test Automation | Playwright (`^1.58.2`, ad-hoc Node.js scripts only)                                                |

## Project Structure

```
webgl-diceroller/
├── src/                        # Main source code
│   ├── main.js                 # Entry point: scene setup, render loop, camera, loading tiers
│   ├── dice.js                 # Dice public API barrel (implementation under src/dice/)
│   ├── physics.js              # ammo.js physics initialization and helpers
│   ├── core/                   # FrameScheduler, LoadingTiers, RendererFactory, textures, culling
│   ├── interaction.js          # Mouse/raycaster interaction (drag, levitate)
│   ├── interaction/            # Dice cup + shared WasmDieGrab helper
│   ├── xr/                     # WebXR seated-table spike (?xr)
│   ├── ui.js                   # DOM-based UI controls and crosshair
│   ├── shaders/                # Custom GLSL + TSL node materials
│   │   ├── VignetteShader.js   # WebGL post vignette pass
│   │   ├── GodRayShader.js     # WebGL scene-space moonlight beams (TavernWalls)
│   │   └── GodRayNodeMaterial.js # WebGPU god-ray twin
│   └── environment/            # Scene environment (~95 prop modules)
│       ├── PropRegistry.js     # Auto-discovers prop factories + tier definitions
│       ├── propKit.js          # createProp / materials / mesh helpers (required for new props)
│       ├── Table.js            # Main dice table (36×36 surface with velvet dice zone)
│       └── …                   # TavernWalls, Lamp, Clutter, Bookshelf, etc.
├── docs/
│   ├── ARCHITECTURE.md         # Scheduler phases, tier loading, prop registry, renderer
│   ├── WASM_ENGINE.md          # Custom WASM physics
│   ├── XR.md                   # WebXR seated-table spike
│   └── MULTIPLAYER.md          # Optional signaling / rooms
├── tests/                      # Playwright smoke / a11y scripts (see Testing Instructions)
├── scripts/                    # Asset conversion + verify-* harnesses
├── public/                     # Static assets (dice GLB, draco, basis, wasm)
├── raw_models/                 # Source Blender / legacy Collada inputs
├── legacy/                     # Original CubicVR implementation
├── index.html
├── vite.config.js
├── package.json
├── deploy.py                   # Upload dist/ via Contabo storage manager API
├── git.sh                      # Ad-hoc pull/add/commit/push helper (not CI)
├── plan.md                     # Pointer to docs/ + GitHub Issues (historical roadmap retired)
└── claude.md                   # Pointer to AGENTS.md (avoid doc drift)
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (opens browser, hot reload on http://localhost:5173)
npm run dev

# Build the custom WASM physics module (requires Emscripten)
npm run build:wasm

# Debug WASM build (same output paths; overwrites release artifacts)
npm run build:wasm:debug

# Native C++ solver unit + fuzz tests (g++/clang only, no browser)
npm run test:solver

# Convert dice Collada sources to Draco GLB (requires Playwright)
npm run convert:dice

# Convert prop meshes (lamp OBJ) + shared JPG textures to Draco GLB / KTX2
npm run convert:props

# Build for production (outputs to dist/)
npm run build

# Preview production build locally (http://localhost:4173)
npm run preview

# Lint and format (required before PR — also enforced in CI)
npm run lint
npm run lint:fix          # auto-fix imports + safe ESLint fixes
npm run format              # Prettier write
npm run format:check        # Prettier check (CI)
```

- `npm run dev` still works without compiled WASM artifacts; the bridge falls back to ammo.js automatically.
- `?no-wasm` is the **only** physics escape hatch: it forces the full ammo fallback even if `public/wasm/` exists.
- **Every other session** (including the default) never loads the ammo.js chunk and never creates an ammo rigid body for a die. Dice simulation, drag, levitation, and flicks run entirely in the WASM worker.
- The `?dual-physics`, `?ammo-drag`, and `?wasm-drag` flags were removed with the Phase 5 cut-over; there is no dual-authority sync left in `src/dice/`.
- `?worker-physics` (experimental) runs the WASM engine inside a Web Worker.
- `?no-drag` disables quadratic air resistance on both ammo.js and WASM paths.
- `?fair-dice` disables the pipping COM bias.
- Render/perf flags:
    - WebGPU is the default; `?webgpu` / `?wgpu` are redundant but still force it explicitly.
    - `?webgl` forces the stable WebGL baseline path (escape hatch / older browsers).
    - `?xr` / `?xr-emulator` enable the seated WebXR spike (forces WebGL + no-post). See [`docs/XR.md`](docs/XR.md).
    - `?xr-snap=45` sets VR snap-turn degrees (15–90) when `?xr` is active.
    - `?pr=N` sets render pixel ratio (clamped to `[0.5, 3]`); default is `min(devicePixelRatio, 2)`. At `pr=1` MSAA is enabled; above 1.0 FXAA is used in the post chain instead.
    - Pixel ratio auto step-down: when sustained frame times exceed ~32 ms, ratio steps down toward 1.0 (skipped when `?pr=` forces a ratio).
    - Software WebGL rasterizers (SwiftShader, llvmpipe, etc.) auto-enable the `low-post` profile.
    - GPU context/device loss surfaces the renderer badge and attempts WebGL fallback recovery.
    - `?no-post` disables the composer entirely (both renderers).
    - `?low-post` keeps post enabled but lowers bloom quality (both renderers).
    - `?no-bloom` disables only bloom (both renderers).
    - `?no-godrays` disables the tavern window volumetric beam meshes (both renderers).
    - `?renderer-info` shows a small badge with the active renderer type.
    - `?debug` / `?debug-perf` shows render stats (incl. renderer type + fallback); `debug-perf` also logs slow frame systems.

## Architecture Details

### Audio system

- `src/audio/DiceCollisionAudio.js` synthesises all tavern audio with the Web Audio API (no external sound assets): dice collisions, prop accents, ambient bed, and a flute melody hook.
- Collision events from WASM (`pollPhysicsCollisionEvents`) and ammo.js (`pollAmmoCollisionEvents`) are enriched in `dice.js` (`enrichCollisionEventForAudio`) with world position, die sides, and surface hints before playback.
- Kinetic energy `E_k = 1/2*m*v^2 + 1/2*I*omega^2` drives volume and brightness; material voices distinguish die-on-die clack, velvet table thump, leather cup rattle, metal/glass props.
- Impacts route through HRTF `PannerNode`s at the die position; the listener follows the camera each frame. Per-pair cooldowns and a `maxVoices` cap prevent machine-gun stacking.
- Die sides map to playback pitch (d20 lower than d4). Prop one-shots (gong, bell, cauldron bubble, skull bone knock, lamp click) share the same master gain.
- Ambient bed: looping room rumble, irregular fire crackle, rare wood creak; louder in pointer-lock FPS mode via `setAmbientIntensity`.
- Master volume slider + mute toggle in `ui.js` (persisted in `localStorage`). Hard impacts near the billiard lamp trigger a shade jiggle + faint chain click.
- Audio starts suspended and resumes on the first pointer or key event.

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
- Loads `src/wasm/WasmPhysicsBridge.js` asynchronously. When WASM is available (default), the custom engine is authoritative for dice simulation, drag, and levitation. The ammo.js chunk loads only for `?no-wasm` (or when WASM artifacts are missing) via `shouldLoadAmmoPhysics()` and the lazy `src/dice/AmmoDiceBackend.js` module.
- Implements **tiered async loading** with a loading overlay and progress bar:
    - **Tier 0 (Critical, 10–40%):** Physics engine, core environment (walls, room, table, candle), dice models, UI, interaction. Rendering starts immediately after this tier.
    - **Tier 1 (Important, 55–70%):** Furniture and background props (bookshelf, chairs, chest, rug, atmosphere, billiard lamp, floating candles, runecircle).
    - **Tier 2 (Secondary, ~85%):** Tabletop props arranged around the dice zone edges (dice tower, tray, jail, bag, bell, meal, hourglass, map, scroll, crystal ball, potions, skull, scale, lantern, spellbook, mug, tankard).
    - **Tier 3 (Decorative, 95%):** Background/decorative props (dagger, sword, shield, axe, pocket watch, compass, chalice, miniature, character sheet, bounty poster, pencil, coin pouch, lute, runestones, candelabra, smoking pipe, gemstones, writing set, cheese wheel, wax seal, crown, helmet, gong, mystic orb, DM screen, dragon scale, spyglass, playing cards, key, padlock, lockpicks, spectacles, leather journal, drinking horn, wand, coin, amulet, abacus, dart, scroll case, magnifying glass, rope, goblet, crossbow, waterskin, astrolabe, sundial, ale keg, flute, apple).
    - **Finalizing (100%):** Disables `castShadow` on small decorative props by name, fades out loading overlay, sets `app.ready = true` (exposed as `window.__app.ready` / shim `window.sceneReady` under `?test` / `?debug`).
- Implements an **"Eye-Head" FPS camera** with pointer lock (right-click to enter, ESC to exit). WASD moves, Space jumps.
- Manages the **dice focus state machine** after a roll:
  `IDLE` → `WAITING_FOR_STOP` → `FOCUSING` → `HOLDING` (2s) → `RETURNING` → `IDLE`
  When focusing, the camera dynamically calculates distance based on dice spread.
- Exposes `app.stats` (shim `window.__renderStats` under test/debug flags) for scheduler timings / renderer info when `?debug-perf` is enabled.
- Under `?test` / `?debug` / `?debug-perf`, installs `window.__app` (stable API) plus deprecated flat shims. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### `src/dice.js` (barrel) and `src/dice/`

- Public API re-exported from focused modules: `DiceModels.js` (load/pool), `DiceSpawn.js`, `DiceThrow.js`, `DiceResults.js`, `DiceSync.js`, `DicePhysicsPresets.js`.
- Ammo dice bodies live in `AmmoDiceBackend.js`, dynamically imported only when `needsAmmoDiceBackend()` — i.e. when the WASM engine is not live (`?no-wasm` or missing artifacts).
- Loads Draco-compressed glTF (`.glb`) dice models from `public/images/dice/` using `GLTFLoader` + `DRACOLoader`.
- `spawnObjects(scene, world, config)` — spawns WASM dice; an ammo body is created only on the `?no-wasm` fallback.
- `updateDiceVisuals()` — reads the WASM transform buffer; on the ammo fallback it reads ammo transforms through `AmmoDiceBackend`. There is no per-die `physicsAuthority` any more: the backend is a whole-session choice.
- `throwDice(scene, world, seed)` — WASM-authoritative throws; seeded replay uses the WASM PRNG/worker path.
- `clearDice(scene, world)` — removes dice and tears down WASM ids; ammo heap cleanup via `AmmoDiceBackend` when loaded.

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
- Exports `getAmmo()` for other modules to access the initialized Ammo instance. Prop modules must not call it directly — they go through `src/environment/PropPhysics.js` (`getPropAmmo` / `createPropStaticBody`), the single ammo seam for props.

### `src/interaction.js`

- `initInteraction(camera, scene, physicsWorld)` — sets up `Raycaster`, pre-warms shaders for levitation effects (hidden sphere + light at y=-1000, compiled then disposed after 500ms).
- `registerInteractiveObject(mesh, callback)` — API for static props (e.g., lamp, skull, gong) to receive click events.
- Left-click on a die starts WASM kinematic drag by default (`setDieKinematic` + `setDieVelocity` toward the cursor). Mouse movement updates the die inside the WASM worker.
- Double-clicking a die (within 300ms) triggers **levitation** in WASM: the die rises with a blue glow (`0x0088ff` PointLight), spins, then is released with a random throw after 1.5s.
- **Ammo fallback (`?no-wasm` only):** drag + levitation route through ammo.js `btPoint2PointConstraint` / kinematic flags. Unreachable whenever the WASM engine is live.
- **Dice cup (`DiceCup` prop):** WASM-only scoop/shake/pour ritual. Click the cup to scoop nearby dice, hold and wiggle to rattle (interior container planes + muffled leather audio), release or press `T` to pour onto the velvet zone. Cup pours use `seed = null` and are excluded from share URLs. Test hook: `window.__app.interactables.diceCup` (shim `window.__interactables.diceCup`).
- The WASM control primitives live in `src/dice.js`: `driveDieWasmTransform`, `setDieWasmVelocity`, `getDieWasmTransform` (alongside `applyWasmImpulseForDie`).
- `getHoveredDie(camera, normX, normY)` — returns the die under the cursor for hover cursor changes.
- `updateInteraction(deltaTime)` — activates dragged bodies (ammo) or drives the WASM drag, and updates levitation state each frame.

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
- Legacy physics-enabled props build invisible collision meshes with `createPropStaticBody()` / `getPropAmmo()` from [`PropPhysics.js`](src/environment/PropPhysics.js). Those colliders exist only when ammo is loaded (`?no-wasm`); otherwise the prop is visual-only. New props use `StaticColliderBridge` collider specs instead, which prefer WASM.
- Shadows are aggressively optimized: small decorative props are listed in `SHADOW_DISABLED_PROP_NAMES` in `src/environment/PropRegistry.js`.

### Rendering Notes

- WebGPU is the default on supported browsers; WebGL is the automatic fallback and the most compatible baseline (force it with `?webgl`).
- WebGPU uses `WebGPURenderer` plus the TSL post pipeline (bloom, vignette, optional chromatic aberration in high quality).
- The tavern window god rays render on both paths: WebGL uses the raw-GLSL `GodRayShader.js` `ShaderMaterial`; WebGPU uses the TSL `MeshBasicNodeMaterial` in `src/shaders/GodRayNodeMaterial.js`. Toggle with `?no-godrays` independent of renderer.
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

- **ESLint + Prettier** enforce a minimal ruleset (`eslint:recommended`, unused imports/vars, `eqeqeq`, import resolution). Config: [`eslint.config.js`](eslint.config.js), [`.prettierrc`](.prettierrc).
- Run `npm run lint` before committing; CI blocks merge on lint/format failures.
- **Format on save (Cursor / VS Code):** enable Prettier as the default formatter and `"editor.formatOnSave": true` so agent edits match project style. ESLint fixes on save: `"editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }`.
- Optional local hook: `npm install` runs `husky` + `lint-staged` (ESLint fix + Prettier on staged `*.{js,mjs}`).
- Prefix intentionally unused bindings with `_` (e.g. `_elapsedTime`, `catch (_e)`).
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
- In the ammo.js fallback path, `AmmoDiceBackend.spawnAmmoDieBody` / `spawnDicePhysics` may build a `btCompoundShape` for COM bias.
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

**New props must use `propKit`.** Legacy modules are migrated opportunistically when touched — do not bulk-rewrite the full catalogue.

#### Authoring recipe

1. Create `src/environment/PropName.js` using `createProp` from [`src/environment/propKit.js`](src/environment/propKit.js).
2. Export a factory: `(scene, physicsWorld?, position?, rotation?)`.
3. Build geometry inside the `build({ group, materials, mesh })` callback; use `materials.*` from the kit (backed by [`MaterialPalette.js`](src/core/MaterialPalette.js)) instead of inline `MeshStandardMaterial`.
4. Declare colliders as a spec array — routed through [`StaticColliderBridge.js`](src/core/StaticColliderBridge.js), not direct `getPropAmmo` / `createPropStaticBody` calls.
5. Return `{ group }` plus optional `update`, `interact`, `body`, etc.
6. Register in the appropriate tier in [`PropRegistry.js`](src/environment/PropRegistry.js).
7. Wire `afterCreate` for per-frame updates or click handlers.
8. For small/decorative props, add the factory name to `SHADOW_DISABLED_PROP_NAMES` in `PropRegistry.js` (shadow policy lives in the registry, not in the prop module).

Tabletop positions in tier entries may still use legacy `y: -2.75`; `PropRegistry.resolveEntryPosition` applies `toCurrentTabletopY` at spawn. Use `footOffsetY` in `createProp` when the mesh origin is not at the resting foot (e.g. a cylinder whose center is mid-height).

#### Collider spec examples

```js
// Box — half-extents in group-local space
colliders: [{ type: 'box', halfExtents: [1.0, 0.15, 1.0] }];

// Cylinder — ammo Y-axis convention; rotate to match mesh orientation
colliders: [
    {
        type: 'cylinder',
        radius: 0.08,
        halfHeight: 1.0,
        rotation: { z: Math.PI / 2 },
    },
];

// Compound — child parts with local offset/rotation
colliders: [
    {
        type: 'compound',
        parts: [{ type: 'box', halfExtents: [hx, hy, hz], offset: { y: hy } }],
    },
];
```

#### Minimal example (migrated Horseshoe)

```js
import * as THREE from 'three';
import { createProp, materials, mesh } from './propKit.js';

export function createHorseshoe(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotation = 0
) {
    return createProp(scene, physicsWorld, {
        name: 'Horseshoe',
        position,
        rotation,
        colliders: [{ type: 'box', halfExtents: [1.0, 0.15, 1.0] }],
        build({ group }) {
            group.add(
                mesh(
                    new THREE.TorusGeometry(0.8, 0.15, 8, 24, Math.PI * 1.4),
                    materials.rustedIron(),
                    { rotation: { x: Math.PI / 2, z: Math.PI / 2 } }
                )
            );
        },
    });
}
```

#### Migration policy

- **New props:** `propKit` + `materials.*` + `StaticColliderBridge` collider specs (required).
- **Existing props:** convert when you edit them for other reasons; no mass migration pass.
- **Do not** import `getPropAmmo`, `btBoxShape`, or `createPropStaticBody` in new or migrated prop modules (and never import `physics.js` from a prop).

#### Registry checklist (unchanged)

1. Add the prop to the appropriate tier in `PropRegistry.js`.
2. If it has per-frame behavior, register `result.update` in the entry’s `afterCreate` hook.
3. If it is interactive, register the callback in the entry’s `afterCreate` hook.
4. If it is small/decorative, add its name to `SHADOW_DISABLED_PROP_NAMES`.

### Memory Management

- When removing dice, always call `Ammo.destroy()` on `body.getMotionState()` and `body` itself.
- When removing dice visuals, call `geometry.dispose()` and `material.dispose()`.
- Reusable transforms (`_sharedTransform`, `_levitationTransform`) are used in `updateDiceVisuals` and `updateLevitation` to minimize Ammo.js heap churn.

### Shadow Best Practices

- Prefer disabling `castShadow` at prop registration time via `PropRegistry` instead of relying on a late full-scene traverse.
- Keep `renderer.shadowMap.autoUpdate = false` by default; motion systems should temporarily re-enable shadow updates during rolls, drags, or levitation.
- If a prop includes tiny accent meshes, default them to `castShadow = false` unless the shadow is visually important.

## Testing Instructions

There is **no formal unit or integration test suite** (no Jest/Vitest runner), but several ad-hoc scripts exist under [`tests/`](tests/) and [`scripts/`](scripts/). Browser smoke tests target the **preview server** (`http://localhost:4173/?no-post`), not the dev server.

```bash
# 1. Build and start the preview server in one terminal
npm run build          # or: npx vite build  (when WASM build is unavailable)
npm run preview

# 2. In another terminal — npm scripts wrap tests/ entries
npm run test:debug            # Polls window.__app.ready (tests/debug.js)
npm run test:playingcards     # PlayingCards prop in scene graph
npm run test:flute            # Flute prop in scene graph
npm run test:lamp             # Lamp prop smoke
npm run test:cauldron         # Cauldron interactable
npm run test:mobile-touch     # Touch input smoke
npm run test:wasm-authoritative  # Visual sync + interaction with physicsWorld === null (#250)
npm run test:wasm-gameplay-loop  # Full-app: visual sync, drag interaction, collision audio (getStats().played)
npm run test:share-roll-replay   # Two page loads of the same share URL settle to identical readAllDiceValues()
npm run test:a11y             # axe accessibility scan
npm run test:notation         # Roll notation parser (Node, no browser)
npm run test:share-roll       # Shareable roll encoding (Node)
node test_dicecup.js          # DiceCup interactable (root; needs WASM for available:true)

# Physics / renderer harnesses (scripts/)
npm run test:solver                 # Native C++ unit + fuzz (see docs/WASM_ENGINE.md)
node scripts/verify-wasm-primitives.mjs
npm run verify:wasm-interaction     # drag + levitation on the WASM-only path (needs a build)
npm run verify:worker-replay        # Worker-module replay determinism (seededPhysicsThrow) — isolated from the app UI
npm run verify:bundle-loading       # no ammo chunk / no ammo dice bodies by default
node scripts/verify-renderer-factory.mjs
npm run verify:render-regression    # WebGL vs WebGPU screenshot compare (when baselines exist)
```

- `test:wasm-gameplay-loop`, `test:wasm-authoritative`, and `test:share-roll-replay` all run in CI (`verify-tests` matrix); `verify:worker-replay` runs in the `verify` matrix. All four need the `wasm-artifacts` build (`npm run build:wasm`) to exercise the WASM-authoritative path rather than skipping.

**Automation hooks** (require `?test`, `?debug`, or `?debug-perf`):
- `window.__app` — stable API (`ready`, `scene`, `camera`, `renderer`, `interactables`, `replayRoll`, …). Prefer this.
- Flat shims (`window.scene`, `window.sceneReady`, …) — deprecated for one release; see docs/ARCHITECTURE.md.
- Smoke scripts use `?no-post` (and often `?webgl&fair-dice&test` in headless CI) to reduce GPU load.

## Deployment

The [`deploy.py`](deploy.py) script zips `dist/` and uploads via the Contabo storage manager HTTP API (see the script header for `PROJECT_NAME`, `BUILD_DIR`, and optional `DEPLOY_TOKEN`):

```bash
# 1. Build first
npm run build

# 2. Deploy (requires: pip install requests)
python deploy.py
```

- **Remote target:** configured in `deploy.py` (`PROJECT_NAME` → `dice-roller` on the storage host)
- **Local directory:** `dist/`

**`git.sh`** is a personal convenience wrapper (`git pull`, `git add .`, commit, push). It is not part of CI and should not be treated as project documentation.

## Security Considerations

- `deploy.py` may contain a deploy token or legacy credentials in local copies — prefer environment variables or a secrets manager for production use.
- No server-side user input processing (pure client-side application).
- Physics simulation runs locally only.

## Known Limitations

- **Dice result determination** is implemented in `src/dice.js` via `_computeFaceNormals` and `readDiceValue()`.
- **ColladaLoader migration is complete** — dice models now load as Draco-compressed `.glb` files from `public/images/dice/`.
- **WASM die-to-die contacts are now SAT-based polyhedral** (Phase 3). Bounding spheres remain as a fallback when hulls are not loaded.
- **No automated test coverage** beyond ad-hoc Playwright scripts in `tests/` and verify harnesses in `scripts/`.
- **GodRayShader** drives the scene-space moonlight beam mesh in `TavernWalls.js` (not the fullscreen composer); WebGPU uses `GodRayNodeMaterial.js`. Toggle with `?no-godrays`.
- **Roadmap** lives in [GitHub Issues](https://github.com/ford442/webgl-diceroller/issues); `plan.md` is a pointer only.

## Cursor Cloud specific instructions

Setup is just `npm install` (the startup update script). Run `npm run test:solver` for native C++ physics tests (no browser). Playwright smoke scripts target the preview server on `:4173` — see "Testing Instructions" above.

Running/verifying the app in this headless, software-rendered, WASM-absent environment has a few non-obvious gotchas:

- **Use the `?webgl` baseline path.** There is no GPU, so WebGPU is unavailable. The default renderer falls back to the Three.js WebGL2 _TSL_ backend, which throws `Cannot read properties of undefined (reading 'buffers')` under SwiftShader and never finishes loading. Forcing `?webgl` (the classic `WebGLRenderer`) renders fine.
- **Add `?fair-dice` when WASM is not compiled.** Emscripten is not installed, so there are no `public/wasm/` artifacts and physics uses the ammo.js fallback. The default pipping-bias path then calls `btCompoundShape.recalculateLocalAabb()`, which the bundled `ammo.js@0.0.10` build does not expose — this throws `Failed to load scene tiers: TypeError: ...recalculateLocalAabb is not a function` and the scene never becomes ready. `?fair-dice` disables the COM-bias compound-shape path and the scene loads (`window.__app.ready === true` under `&test`). Building the WASM module (`npm run build:wasm`, needs Emscripten) is the alternative that routes the bias through the WASM engine instead.
- So a reliable local URL is e.g. `http://localhost:5173/?webgl&no-post&fair-dice&test&renderer-info` (dev) or the same on `:4173` (preview). Trigger a roll programmatically with `window.__app.replayRoll(seed)` (or shim `window.replayRoll`) or via the top-right "Roll All" button / `R` key.
- **Multiplayer (optional):** run `npm run signal:dev` (Cloudflare Worker on `:8787`), then `VITE_SIGNALING_URL=http://127.0.0.1:8787 npm run dev`. See [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md). Guests need WASM for deterministic replay.
- **Browser WebGL needs software flags.** Launch Chrome/Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; rendering is slow but functional.
- **`npm run build` fails here** because it runs `build:wasm` first (needs Emscripten at `/root/emsdk`). To build only the frontend bundle, run `npx vite build` (succeeds and is what `npm run preview` serves).
- **Dev server + low-resource browsers:** Vite dev serves 160+ unbundled ES modules, which can trip `net::ERR_INSUFFICIENT_RESOURCES` in a resource-constrained browser. Playwright's chromium and the bundled preview server (fewer requests) both load fine.
