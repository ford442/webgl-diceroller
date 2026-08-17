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

| Event             | Payload (typical)                        | Producers                                | Consumers                                                       |
| ----------------- | ---------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `roll:started`    | `{ seed, expression, diceSet, source? }` | `beginRoll`, UI roll, cup pour, notation | RoomSession host broadcast                                      |
| `roll:settled`    | `{ results }`                            | Camera focus settle                      | Results HUD, history / fairness / game-feel / session strip     |
| `roll:evaluated`  | `{ result }`                             | Notation `RollSession` onComplete        | XR world HUD, session strip                                     |
| `session:initiative` | `{ order, currentIndex }`              | SessionWiring                            | Session strip                                                   |
| `session:turn`    | `{ actorId, actorName, direction }`    | Session strip pass turn                  | Session strip                                                   |
| `dice:collision`  | Enriched collision event                 | `postPhysicsSync` poll                   | Collision audio, game-feel; optional `__onDiceCollision` bridge |
| `renderer:lost`   | `{ reason, … }`                          | GPU context/device loss                  | (open)                                                          |
| `layout:rerolled` | Layout manager result                    | Layout reroll                            | (open)                                                          |
| `app:ready`       | `{ ready: true }`                        | Loading tiers finalize                   | (open)                                                          |

Collision audio and the settled results overlay subscribe via events; the live per-frame dice HUD still updates on the scheduler (60 Hz reads are a poor fit for pub/sub).

### Multiplayer

Host-authoritative WebRTC tables use deterministic WASM seeded replay. See [`MULTIPLAYER.md`](MULTIPLAYER.md) for signaling (Cloudflare Durable Object rooms), `?room=` deep links, `?fair-commit` (protocol v2), and COOP/COEP constraints.

### Session layer

Desktop **initiative / turn strip** and multiplayer session sync live outside `main.js`:

- [`SessionState.ts`](src/session/SessionState.ts) — seat list, current actor, `lastExpression`; persisted in `localStorage` per room code.
- [`SessionWiring.js`](src/app/SessionWiring.js) — subscribes to `roll:settled` / `roll:evaluated`; emits `session:initiative` and `session:turn`; host broadcasts `session-sync` via [`RoomSession.js`](src/net/RoomSession.js).
- [`SessionStrip.js`](src/ui/SessionStrip.js) — DOM strip (pass turn, current actor).
- XR roll totals: [`XrResultsHud.js`](src/xr/XrResultsHud.js) on `xrWorld`; DOM HUD suppressed while presenting (`setDomResultsSuppressed`).

State flows through **`AppContext`** (`app.session`, `app.multiplayer`) and **`AppEvents`** — not new `window.*` globals.

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

| Phase             | Typical work                                                   |
| ----------------- | -------------------------------------------------------------- |
| `preStep`         | Input, camera prep                                             |
| `physicsStep`     | Fixed 1/60 s WASM and/or ammo step (may run multiple substeps) |
| `postPhysicsSync` | `updateDiceVisuals()`, collision event polling                 |
| `updates`         | Prop animations, interaction, dice-case preview, atmosphere    |
| `preRender`       | Culling, shadow-map refresh hooks                              |
| `render`          | Composer / TSL post stack                                      |
| `postRender`      | Debug overlays, adaptive quality                               |

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

## Prop registry

[`PropRegistry.js`](../src/environment/PropRegistry.js) is the catalogue and spawn pipeline for environment props.

**Factory discovery** — `import.meta.glob('./*.js')` collects every `createXxx` export into `PROP_FACTORIES`.

**Spawn** — `spawnProp(entry, context)` either calls `entry.call(context)` or invokes the factory with `(scene, physicsWorld, position, rotation)`. Positions with legacy tabletop `y ≈ -2.75` are adjusted via `toCurrentTabletopY()` from [`SceneMetrics.js`](../src/core/SceneMetrics.js).

**Post-spawn policy (registry-owned, not per-prop):**

- Shadow opt-out — `SHADOW_DISABLED_PROP_NAMES` disables cast/receive on small decorative props.
- Far-shadow LOD — props far from table centre drop `castShadow` once at spawn.
- Static mesh merge — eligible static props batch leaf meshes via [`StaticPropMerger.js`](../src/core/StaticPropMerger.js).
- Interaction — `afterCreate` registers `registerInteractiveObject` / `registerInteractable` as needed.

**New props** must use [`propKit.js`](../src/environment/propKit.js) (`createProp`, `materials.*`, collider specs via [`StaticColliderBridge.js`](../src/core/StaticColliderBridge.js)). See AGENTS.md “Adding New Environment Props”.

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

**God rays** — scene-space moonlight beams in [`TavernWalls.js`](../src/environment/TavernWalls.js): WebGL uses [`GodRayShader.js`](../src/shaders/GodRayShader.js); WebGPU uses [`GodRayNodeMaterial.js`](../src/shaders/GodRayNodeMaterial.js). Toggle with `?no-godrays`.

## Physics (dual backend)

| Backend                      | Role                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WASM `DicePhysicsEngine`** | Authoritative dice simulation when `public/wasm/` is built and `?no-wasm` is absent                                                                                          |
| **ammo.js**                  | Full fallback when WASM is unavailable (`?no-wasm`): dice bodies, drag, levitation. Also backs hand-built static prop colliders via `environment/PropPhysics.js` when loaded |

Bridges: [`WasmPhysicsBridge.js`](../src/wasm/WasmPhysicsBridge.js), [`WorkerPhysicsBridge.js`](../src/wasm/WorkerPhysicsBridge.js). Dice ammo helpers: [`AmmoDiceBackend.js`](../src/dice/AmmoDiceBackend.js) (lazy-loaded). Flags: `?no-wasm` (sole physics escape hatch), `?worker-physics` — see AGENTS.md and WASM_ENGINE.md.

Declarative static colliders go through `StaticColliderBridge` (WASM when available, ammo otherwise); the remaining hand-built prop shapes go through `environment/PropPhysics.js` and exist only when ammo is loaded. Moving them into WASM is tracked in [issue #237](https://github.com/ford442/webgl-diceroller/issues/237).

## Key directories

```
src/
  core/           Frame loop, renderer, loading, textures, culling, metrics
  environment/    Prop modules + PropRegistry + propKit
  wasm/           C++ engine, bridges, worker
  shaders/        GLSL (WebGL god rays, vignette) + TSL node materials
  roll/           Notation, history, shareable rolls
  ui/             DOM panels beyond core ui.js
tests/            Playwright smoke / a11y scripts (see AGENTS.md)
scripts/          Asset conversion, verify-* harnesses
docs/             ARCHITECTURE.md, WASM_ENGINE.md, MULTIPLAYER.md
```

## Deployment and utilities

- **`deploy.py`** — zips `dist/` and uploads via the Contabo storage manager API (see script header for config). Run `npm run build` first.
- **`git.sh`** — personal convenience script (`git pull`, `git add .`, commit, push). Not part of CI; credentials and commit messages are ad hoc.
