# Architecture Overview

High-level map of how the WebGPU Dice Roller is structured. For agent-oriented detail (commands, flags, prop authoring), see [`AGENTS.md`](../AGENTS.md). For the WASM physics engine, see [`WASM_ENGINE.md`](WASM_ENGINE.md). For the WebXR seated-table spike, see [`XR.md`](XR.md).

## Entry point and orchestration

[`src/main.js`](../src/main.js) bootstraps the scene, renderer, physics world, and frame loop. It wires:

- **Renderer** — created via [`RendererFactory.js`](../src/core/RendererFactory.js) (see below).
- **Frame scheduler** — [`FrameScheduler.js`](../src/core/FrameScheduler.js) runs named phases each frame.
- **Tier loading** — [`LoadingTiers.js`](../src/core/LoadingTiers.js) async-loads environment, dice, UI, and interaction before the overlay fades.
- **AppContext + AppEvents** — internal service bag and pub/sub; see below. Production loads do **not** publish `window.*` app globals.

```
main.js
  ├── createAppContext() / createAppEvents()
  ├── RendererFactory.createRenderer()
  ├── initPhysics() / loadWasmEngine()
  ├── loadTiers()  ──► PropRegistry.spawnProp()
  └── scheduler.runFrame() each rAF
```

## AppContext and AppEvents

[`AppContext.js`](../src/core/AppContext.js) is a mutable bag filled during init (`scene`, `camera`, `renderer`, `scheduler`, `physics`, `dice`, `audio`, `ui`, `interactables`, …). Features take services from this object or subscribe to events — they should not reach for `window`.

[`AppEvents.js`](../src/core/AppEvents.js) is a tiny synchronous pub/sub. Documented event names (`AppEvent`):

| Event                | Payload (typical)                        | Producers                                | Consumers                                                       |
| -------------------- | ---------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `roll:started`       | `{ seed, expression, diceSet, source? }` | `beginRoll`, UI roll, cup pour, notation | RoomSession host broadcast                                      |
| `roll:settled`       | `{ results }`                            | Camera focus settle                      | Results HUD, history / fairness / game-feel / session strip     |
| `roll:evaluated`     | `{ result }`                             | Notation `RollSession` onComplete        | XR world HUD, session strip                                     |
| `session:initiative` | `{ order, currentIndex }`                | SessionWiring                            | Session strip                                                   |
| `session:turn`       | `{ actorId, actorName, direction }`      | Session strip pass turn                  | Session strip                                                   |
| `dice:collision`     | Enriched collision event                 | `postPhysicsSync` poll                   | Collision audio, game-feel; optional `__onDiceCollision` bridge |
| `renderer:lost`      | `{ reason, … }`                          | GPU context/device loss                  | (open)                                                          |
| `layout:rerolled`    | Layout manager result                    | Layout reroll                            | (open)                                                          |
| `app:ready`          | `{ ready: true }`                        | Loading tiers finalize                   | (open)                                                          |

Collision audio and the settled results overlay subscribe via events; the live per-frame dice HUD still updates on the scheduler (60 Hz reads are a poor fit for pub/sub).

### Multiplayer

Host-authoritative WebRTC tables use deterministic WASM seeded replay. See [`MULTIPLAYER.md`](MULTIPLAYER.md) for signaling (Cloudflare Durable Object rooms), `?room=` deep links, `?fair-commit` (protocol v2), and COOP/COEP constraints.

### Session layer

Desktop **initiative / turn strip** and multiplayer session sync live outside `main.js`:

- [`SessionState.ts`](src/session/SessionState.ts) — seat list, current actor, `lastExpression`; persisted in `localStorage` per room code.
- [`SessionWiring.js`](src/app/SessionWiring.js) — subscribes to `roll:settled` / `roll:evaluated`; emits `session:initiative` and `session:turn`; host broadcasts `session-sync` via [`RoomSession.ts`](src/net/RoomSession.ts).
- [`SessionStrip.js`](src/ui/SessionStrip.js) — DOM strip (pass turn, current actor).
- XR roll totals: [`XrResultsHud.js`](src/xr/XrResultsHud.js) on `xrWorld`; DOM HUD suppressed while presenting (`setDomResultsSuppressed`).

State flows through **`AppContext`** (`app.session`, `app.multiplayer`) and **`AppEvents`** — not new `window.*` globals.

### Headless core (`src/core-engine/`)

Physics loading, worker/in-process bridges, notation, shareable dice-set format, commit-reveal, and [`rollHeadless()`](../src/core-engine/rollHeadless.ts) live in a Three.js-free tree. The page still imports [`src/wasm/PhysicsBridge.ts`](../src/wasm/PhysicsBridge.ts) for collider helpers that need `THREE.Object3D`. `npm run check:core-engine` rejects a `three` import (or `window.` / `document.` use) in that folder. Unit tests call `rollHeadless()` under vitest when `public/wasm/` artifacts exist; `verify:worker-replay` compares solver face values against the worker path.

### Test / debug hooks

Under `?test`, `?debug`, or `?debug-perf`, [`AppTestHooks.js`](../src/core/AppTestHooks.js) installs **`window.__app`** — the stable documented API for Playwright and manual debugging.

Minimum `__app` surface:

| Field / method                                                                      | Notes                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------- |
| `ready`                                                                             | Scene fully loaded                      |
| `scene`, `camera`, `renderer`, `THREE`                                              | Three.js handles                        |
| `physicsWorld`, `physics.getWasmEngine`, `physics.isWasmAvailable`                  | Physics                                 |
| `rendererType`, `usingWebGPU`, `usingWebGL`, `rendererFallbackReason`, `postConfig` | Renderer                                |
| `qualityProfile`, `touchInputEnabled`, `isTouchPrimaryDevice`                       | Device / quality                        |
| `stats`                                                                             | Scheduler timings (was `__renderStats`) |
| `interactables`                                                                     | Named prop hooks                        |
| `replayRoll`, `areDiceSettled`, `readAllDiceValues`                                 | Dice / replay                           |
| `events`                                                                            | Subscribe to `AppEvent` names           |

Playwright URLs should include `&test`, e.g. `?webgl&no-post&fair-dice&test`.

## Frame scheduler phases

[`FrameScheduler`](../src/core/FrameScheduler.js) executes systems in a fixed order with optional priorities within each phase:

| Phase             | Typical work                                                |
| ----------------- | ----------------------------------------------------------- |
| `preStep`         | Input, camera prep                                          |
| `physicsStep`     | Fixed 1/60 s WASM step (may run multiple substeps)          |
| `postPhysicsSync` | `updateDiceVisuals()`, collision event polling              |
| `updates`         | Prop animations, interaction, dice-case preview, atmosphere |
| `preRender`       | Culling, shadow-map refresh hooks                           |
| `render`          | Composer / TSL post stack                                   |
| `postRender`      | Debug overlays, adaptive quality                            |

Systems register via `scheduler.register(phase, name, fn, { priority })`. Prop `update` callbacks and interactables hook into `updates` through [`LoadingTiers.js`](../src/core/LoadingTiers.js) and [`PropRegistry.js`](../src/environment/PropRegistry.js) `afterCreate` handlers — avoid ad-hoc per-frame calls in `main.js`.

## Tiered loading

[`loadTiers()`](../src/core/LoadingTiers.js) drives the loading overlay progress bar and yields to the main thread between heavy steps (`yieldToMain`).

| Stage             | Progress | Contents                                                                                     |
| ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| Textures + Tier 0 | ~10–40%  | Physics init, shared KTX2 preload, walls, room, table, clutter, dice models, UI, interaction |
| Tier 1            | ~55–70%  | Furniture: bookshelf, chairs, chest, rug, atmosphere, lamp, floating candles, runecircle     |
| Decorative pool   | ~85%     | Random subset of tabletop props from `DECORATIVE_TIER_ENTRIES` (layout seed)                 |
| Finalizing        | 100%     | Overlay fade, `app.ready = true` (and `app:ready` event)                                     |

Table layout (decor count, clutter, theme) comes from [`TableLayoutConfig.js`](../src/core/TableLayoutConfig.js) and [`RandomLayout.js`](../src/core/RandomLayout.js).

Shared KTX2/JPG textures, dice GLBs, Draco/Basis transcoders, and other files under `public/` must be loaded through [`publicAssetUrl.js`](../src/core/publicAssetUrl.js) (`import.meta.env.BASE_URL`) — not raw `./images/…` strings — so subdirectory deploys (e.g. `go.1ink.us/dice-roller/`) do not request host-root `/images/`.

## Prop registry

[`PropRegistry.js`](../src/environment/PropRegistry.js) is the catalogue and spawn pipeline for environment props.

**Factory discovery** — `import.meta.glob` in [`factories.js`](../src/environment/propRegistry/factories.js) collects every `createXxx` export from `src/environment/*.js` into `PROP_FACTORIES`, excluding the `PropRegistry.js` barrel and helper modules (`propKit`, `PropLifecycle`).

**Spawn** — `spawnProp(entry, context)` either calls `entry.call(context)` or invokes the factory with `(scene, physicsWorld, position, rotation)`. Positions with legacy tabletop `y ≈ -2.75` are adjusted via `toCurrentTabletopY()` from [`SceneMetrics.js`](../src/core/SceneMetrics.js).

**Post-spawn policy (registry-owned, not per-prop):**

- Shadow opt-out — `SHADOW_DISABLED_PROP_NAMES` disables cast/receive on small decorative props.
- Far-shadow LOD — props far from table centre drop `castShadow` once at spawn.
- Static mesh merge — eligible static props batch leaf meshes via [`StaticPropMerger.js`](../src/core/StaticPropMerger.js). Merged geometry is baked **relative to the prop root**, which stays the physics anchor; props that animate (`update`) or move (`dynamic`) are excluded.
- Interaction — `afterCreate` registers `registerInteractiveObject` / `registerInteractable` as needed.

**New props** must use [`propKit.js`](../src/environment/propKit.js) (`createProp`, `materials.*`, collider specs via [`StaticColliderBridge.js`](../src/core/StaticColliderBridge.js)). See AGENTS.md “Adding New Environment Props”.

### One prop, two placement paths

Tabletop clutter and named decor are the **same modules**. A prop is authored once
under `src/environment/<Name>.js` with `createProp`; the two spawn paths differ only
in how it is placed:

|           | Decor (`PropRegistry`)                       | Clutter (`RandomClutter`)                          |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| Entry     | `tierDefinitions.js` `factoryEntry`          | `CLUTTER_REGISTRY`                                 |
| Call      | `(scene, physicsWorld, position, rotationY)` | `(scene, physicsWorld, { placement, rng, track })` |
| Placement | authored position                            | seeded slot from `ClutterPlacement.js`             |
| Scale     | 1                                            | tabletop scale via `asClutter(..., { scale })`     |

[`clutter/adaptProp.js`](../src/environment/clutter/adaptProp.js) `asClutter()` bridges
the two: it resolves the seeded slot, converts the legacy tabletop `y`, and reports the
root through `options.track` so the scatter merge and culling systems see it. Anything
still living only in `clutter/*.js` (coins, candle, book, parchment, quill, tarot,
poster, gemstone, potion, d20 holder) has no named twin — give it one under
`src/environment/` rather than adding a second implementation.

`createProp`'s `scale` option scales the group **and** the collider spec
(`scaleColliderSpec` — lengths and offsets by `scale`, mass by `scale³`), because
`StaticColliderBridge` builds shapes straight from the spec and ignores `group.scale`.

## Renderer selection

[`RendererFactory.js`](../src/core/RendererFactory.js):

| Condition                             | Renderer                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| Default (browser has `navigator.gpu`) | `WebGPURenderer` + TSL post (`PostProcessing`)                   |
| WebGPU init failure or no GPU         | Automatic fallback to `WebGLRenderer` + `EffectComposer`         |
| `?webgl`                              | Force `WebGLRenderer` (stable baseline / CI / SwiftShader)       |
| `?webgpu` / `?wgpu`                   | Force WebGPU explicitly (redundant with default)                 |
| `?xr` / `?xr-emulator`                | Force `WebGLRenderer` + no-post for WebXR (see [`XR.md`](XR.md)) |

WebGL context attributes are `{ alpha: false, stencil: false, powerPreference: 'high-performance', xrCompatible: isXr }` (Three r181 does not forward `xrCompatible`, so the factory calls `canvas.getContext('webgl2', …)` itself). Both renderers set `outputColorSpace = SRGBColorSpace`. WebGPU `requestDevice` uses a documented `requiredLimits` floor; a reject falls back to WebGL and logs the short limit under `?renderer-info`.

The Dice Case preview uses a **lazy low-power** WebGL context (not high-performance) and disposes it on collapse so Quest / Intel / SwiftShader do not burn a second high-performance slot.

Post flags (`?no-post`, `?low-post`, `?no-bloom`, `?no-godrays`) apply to both paths where supported.

**God rays** — scene-space moonlight beams in [`TavernWalls.js`](../src/environment/TavernWalls.js): WebGL uses [`GodRayShader.js`](../src/shaders/GodRayShader.js); WebGPU uses [`GodRayNodeMaterial.js`](../src/shaders/GodRayNodeMaterial.js). Both are built from one graph (below). Toggle with `?no-godrays`.

### One shader graph, two backends

`WebGLRenderer` needs GLSL; `WebGPURenderer` needs TSL nodes. `WebGLRenderer` cannot run a `NodeMaterial`, and the WebGL2 node backend of `WebGPURenderer` is the path that breaks under SwiftShader, so `?webgl` / XR / CI stay on GLSL. Rather than hand-writing each effect twice, the maths is written once against [`ShaderKit`](../src/shaders/graph/ShaderKit.js): `createGlslKit()` turns the calls into GLSL source, `createTslKit(TSL)` into nodes (`three/tsl` is passed in, so WebGL never loads it). A term added to a graph lands in both renderers; there is no second copy to forget.

| Graph                                                                                                                             | WebGL (GLSL, generated)                                                                                                         | WebGPU (TSL)                                                                                                                                                             | Parameters                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [`DiceSurfaceGraph.js`](../src/dice/DiceSurfaceGraph.js) — face pick, glyph SDF, engraved/inlaid/painted, inclusions, normal bend | [`DiceFaceMarkingShader.js`](../src/dice/DiceFaceMarkingShader.js) chunks via `onBeforeCompile` in `DiceFaceMarkingMaterial.js` | [`DiceFaceMarkingNodeMaterial.js`](../src/dice/DiceFaceMarkingNodeMaterial.js) slots (`colorNode`, `roughnessNode`, `normalNode`, `clearcoatNormalNode`, `emissiveNode`) | `DiceShadingParams` → `diceUniformValues` |
| [`GodRayGraph.js`](../src/shaders/GodRayGraph.js)                                                                                 | `GodRayShader.js` `ShaderMaterial`                                                                                              | `GodRayNodeMaterial.js` `MeshBasicNodeMaterial`                                                                                                                          | `GOD_RAY_PARAMS`                          |
| `vignette` in [`PostStackParams.js`](../src/shaders/PostStackParams.js)                                                           | `VignetteShader.js` `ShaderPass`                                                                                                | `createWebGpuPostPipeline` in `SceneSetup.js`                                                                                                                            | `VIGNETTE_PARAMS`                         |

Rules that keep it honest:

- The twin modules contain wiring only — which uniform or slot a graph output lands in. No shading maths.
- Branches a graph resolves in JS (marking style, inclusion type, atlas vs baked, draw group) are part of `diceGraphKey`, which is also the WebGL `customProgramCacheKey`; anything that varies at runtime stays a uniform.
- Use the kit's functional `k.mix(a, b, t)`, never TSL's method form: `a.mix(b, t)` is `mix(b, t, a)` (the receiver is the blend factor). The hand-written WebGPU dice twin fell into exactly that trap and shaded every engraved die wrong.
- Add an op to **both** kits (`SHADER_KIT_OPS`); `tests/unit/shaderKit.test.js` fails otherwise.

`npm run verify:shader-parity` renders a grid of die descriptors (every style, every inclusion, baked and atlas glyphs, both draw groups), a beam and a vignette card on both renderers and diffs them. WebGPU is skipped under `DICE_CI_NO_WEBGPU=1`; locally (SwiftShader's WebGPU works headless) it is a hard requirement.

### Post stack mapping

One set of numbers, two pipelines — both read [`PostStackParams.js`](../src/shaders/PostStackParams.js):

| Stage                | WebGL (`EffectComposer`)                 | WebGPU (TSL `PostProcessing`)               | Source of truth          |
| -------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------ |
| Scene                | `RenderPass`                             | `pass(scene, camera)`                       | —                        |
| Bloom                | `UnrealBloomPass` at 1/`resolutionScale` | `bloom()` node, blended by a uniform        | `bloomParams(quality)`   |
| Vignette             | `ShaderPass(VignetteShader)`             | `vignette` graph on `screenUV`              | `VIGNETTE_PARAMS`        |
| Chromatic aberration | —                                        | `chromaticAberration()` (high quality only) | `CHROMATIC_PARAMS`       |
| AA                   | `FXAAPass` when `usePostAA`              | `fxaa()` when `usePostAA`                   | `postConfig.fxaaEnabled` |
| Output               | `OutputPass`                             | implicit                                    | —                        |

`postConfig` (built once in `SceneSetup.js`) decides which stages exist; `PostRuntimeControls.js` blends bloom / chromatic at runtime on either pipeline without rebuilding it.

### Flame lighting

Candle, fireplace and prop flames ([`LightingSystems.js`](../src/core/LightingSystems.js)) flicker from deterministic value noise over `elapsedTime` — no `Math.random()` — and `?test` freezes every flame (`setFlameFlickerFrozen`). Flicker moves intensity only on a shadow-casting light (the table candle key light, the lantern): shadow maps are static between rolls, so a jittering caster would light from somewhere its shadow map was not drawn from. Shadowless floating candles still sway.

## Physics

WASM `DicePhysicsEngine` is the only physics backend — ammo.js was retired. It is
authoritative for dice simulation, drag, and levitation whenever `public/wasm/`
is built and loads successfully. If it isn't (`?no-wasm`, or missing/broken
artifacts), `WasmPhysicsBridge.js`'s existing no-op JS stub takes over,
`isWasmAvailable()` reports `false`, `PhysicsBootstrap.showLoadFailure()` shows
an error banner, and the tavern still loads with zero dice — an honest failure
mode rather than a second, differently-behaving engine.

Bridges: [`WasmPhysicsBridge.js`](../src/wasm/WasmPhysicsBridge.js) (main-thread), [`WorkerPhysicsBridge.ts`](../src/wasm/WorkerPhysicsBridge.ts) (default), selected by [`PhysicsBridge.js`](../src/wasm/PhysicsBridge.js). Flags: `?no-wasm` (forces the no-op stub), `?no-worker` / `?worker-physics=off` (forces the main-thread bridge) — see AGENTS.md and WASM_ENGINE.md.

Declarative static and dynamic colliders go through [`StaticColliderBridge.js`](../src/core/StaticColliderBridge.js), which registers every collider type (box, plane, cylinder/openCylinder, convexHull, compound) directly on the WASM engine — there is no other collider backend. `DicePhysicsEngine::MAX_STATICS` (512, see [`WASM_ENGINE.md`](WASM_ENGINE.md)) caps the WASM static registry; `addStaticBox`/etc. report drops past that cap via `getStaticCapacityDroppedCount()` rather than silently no-op'ing.

## Key directories

```
src/
  core/           Frame loop, renderer, loading, textures, culling, metrics
  environment/    Prop modules + PropRegistry + propKit
  wasm/           C++ engine, bridges, worker
  shaders/        ShaderKit graphs (god rays, vignette, post params) → GLSL + TSL
  roll/           Notation, history, shareable rolls
  ui/             DOM panels beyond core ui.js
tests/            Playwright smoke / a11y scripts (see AGENTS.md)
scripts/          Asset conversion, verify-* harnesses
docs/             ARCHITECTURE.md, WASM_ENGINE.md, MULTIPLAYER.md
```

## Deployment and utilities

- **`deploy.py`** — zips `dist/` and uploads via the Contabo storage manager API (see script header for config). Run `npm run build` first.
- **`git.sh`** — personal convenience script (`git pull`, `git add .`, commit, push). Not part of CI; credentials and commit messages are ad hoc.
