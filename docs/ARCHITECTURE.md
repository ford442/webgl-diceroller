# Architecture Overview

High-level map of how the WebGPU Dice Roller is structured. For agent-oriented detail (commands, flags, prop authoring), see [`AGENTS.md`](../AGENTS.md). For the WASM physics engine, see [`WASM_ENGINE.md`](WASM_ENGINE.md). For WebXR (seated VR, AR placement), see [`XR.md`](XR.md).

## Entry point and orchestration

[`src/main.js`](../src/main.js) bootstraps the scene, renderer, physics world, and frame loop. It wires:

- **Renderer** — created via [`RendererFactory.ts`](../src/core/RendererFactory.ts) (see below).
- **Frame scheduler** — [`FrameScheduler.ts`](../src/core/FrameScheduler.ts) runs named phases each frame.
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

[`AppContext.ts`](../src/core/AppContext.ts) is a mutable bag filled during init (`scene`, `camera`, `renderer`, `scheduler`, `physics`, `dice`, `audio`, `ui`, `interactables`, …). Features take services from this object or subscribe to events — they should not reach for `window`.

[`AppEvents.ts`](../src/core/AppEvents.ts) is a tiny synchronous pub/sub. Documented event names (`AppEvent`):

| Event                | Payload (typical)                           | Producers                                                         | Consumers                                                       |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `roll:started`       | `{ seed, expression, diceSet, source? }`    | `beginRoll`, UI roll, cup pour, notation                          | RoomSession host broadcast                                      |
| `roll:settled`       | `{ results, timedOut, reason, simSeconds }` | Camera focus settle (or the settle timeout; see `SettleWatch.ts`) | Results HUD, history / fairness / game-feel / session strip     |
| `roll:evaluated`     | `{ result }`                                | Notation `RollSession` onComplete                                 | XR world HUD, session strip                                     |
| `session:initiative` | `{ order, currentIndex }`                   | SessionWiring                                                     | Session strip, XR chrome                                        |
| `session:turn`       | `{ actorId, actorName, direction }`         | Session strip / XR chrome pass turn                               | Session strip, XR chrome                                        |
| `xr:presenting`      | `{ presenting, mode }`                      | `XrAppWiring` (WebXR enter / exit)                                | Session strip (hides while presenting)                          |
| `dice:collision`     | Enriched collision event                    | `postPhysicsSync` poll                                            | Collision audio, game-feel; optional `__onDiceCollision` bridge |
| `renderer:lost`      | `{ reason, … }`                             | GPU context/device loss                                           | (open)                                                          |
| `layout:rerolled`    | Layout manager result                       | Layout reroll                                                     | (open)                                                          |
| `app:ready`          | `{ ready: true }`                           | Loading tiers finalize                                            | (open)                                                          |

Collision audio and the settled results overlay subscribe via events; the live per-frame dice HUD still updates on the scheduler (60 Hz reads are a poor fit for pub/sub).

### Multiplayer

Host-authoritative WebRTC tables use deterministic WASM seeded replay. See [`MULTIPLAYER.md`](MULTIPLAYER.md) for signaling (Cloudflare Durable Object rooms), `?room=` deep links, commit-reveal (protocol v2, every room), and COOP/COEP constraints.

A lockstep live table (#366) is being built in slices. It has no host: every peer runs the same tick-stamped input log. Slice 1 is the headless core in `dice-core`: [`InputLog`](../packages/dice-core/src/net/InputLog.ts), [`applyTableInput`](../packages/dice-core/src/net/applyTableInput.ts), and [`RollbackSim`](../packages/dice-core/src/net/RollbackSim.ts), which keeps a ring of snapshots and replays late inputs over the engine's `rewindState` and snapshot format v5. Nothing in the app calls it yet. See [`MULTIPLAYER.md`](MULTIPLAYER.md) (Lockstep live table).

### Session layer

Desktop **initiative / turn strip** and multiplayer session sync live outside `main.js`:

- [`SessionState.ts`](../src/session/SessionState.ts) — seat list, current actor, `lastExpression`; persisted in `localStorage` per room code.
- [`SessionWiring.js`](../src/app/SessionWiring.js) — subscribes to `roll:settled` / `roll:evaluated`; emits `session:initiative` and `session:turn`; host broadcasts `session-sync` via [`RoomSession.ts`](../src/net/RoomSession.ts).
- [`SessionStrip.js`](../src/ui/SessionStrip.js) — DOM strip (pass turn, current actor).
- XR roll totals: [`XrResultsHud.js`](../src/xr/XrResultsHud.js) and the initiative panel [`XrChrome.js`](../src/xr/XrChrome.js) on the rig's `xrTableAnchor`; DOM HUD suppressed while presenting (`setDomResultsSuppressed`), DOM session strip hidden on `xr:presenting`.

State flows through **`AppContext`** (`app.session`, `app.multiplayer`) and **`AppEvents`** — not new `window.*` globals.

### Headless core: the `dice-core` package (`packages/dice-core/`)

Physics loading, worker/in-process bridges, the `SimClock`, notation, shareable dice-set format, commit-reveal, and [`rollHeadless()`](../packages/dice-core/src/rollHeadless.ts) live in an npm workspace package that the app depends on as `dice-core`. The boundary is enforced three ways:

- **Compiler.** [`packages/dice-core/tsconfig.json`](../packages/dice-core/tsconfig.json) is `strict` + `noUncheckedIndexedAccess` with `lib: ["ES2022"]` and **no DOM**; the host APIs the engine does use (module workers, the worker global, `WebAssembly.validate`, Web Crypto) are declared at exactly that width in [`src/host.d.ts`](../packages/dice-core/src/host.d.ts). `npm run typecheck` runs it.
- **Imports.** App code, tests and scripts import `dice-core` / `dice-core/<path>` by package name; ESLint's `no-restricted-imports` rejects a relative path into `packages/dice-core/src` (or the old `core-engine/`), and rejects `three` or an escape back into the app from inside the package. `npm run check:dice-core` additionally greps for `three` / `window.` / `document.` and for re-export barrels in `src/`.
- **Resolution.** The package exports its TS sources under a `source` condition (used by Vite, vitest, `tsc` and `tsx --conditions=source`) and compiled `dist/` for everyone else: `npm run build:core`, then `node -e "import('dice-core').then(m => m.rollHeadless('4d6', 777))"` works from plain Node.

Assets reach the core through one seam, [`AssetSource`](../packages/dice-core/src/assets/AssetSource.ts): `fetchAssetSource()` in pages and workers, `fsAssetSource(publicDir)` in Node (via `process.getBuiltinModule`, so no `node:` import enters the browser graph). Node's `fetch` cannot read `file:` URLs; that used to turn every headless die into a sphere reading face 0. `rollHeadless()` now requires `hulls.json` and throws without it.

`tests/golden/rolls.json` pins 50 `(expression, seed, world) → faces` vectors (every hull and derived face sequence, keep/drop/explode/reroll, opposed rolls, six rolls into the recorded tavern world). The dice-core vitest project asserts it in Node; `npm run verify:headless-parity` asserts the same file in Chromium (`-- --update` rewrites it from the browser, `npm run golden:rolls` from Node). Regenerate after a `SOLVER_REVISION` bump or a re-exported `tests/fixtures/tavern-world.json`. The page still imports [`src/wasm/PhysicsBridge.ts`](../src/wasm/PhysicsBridge.ts) for collider helpers that need `THREE.Object3D`.

### Table games: `GameRules` (`packages/dice-core/src/game/`)

A game is a pure rules module in the headless core, [`GameRules<S, A, V>`](../packages/dice-core/src/game/GameRules.ts): `init(seats, rng)`, `toAct`, `legalActions`, `throwFor(state, action)` (which dice an action throws, by stable die id), `apply(state, action, roll?)`, `view(state, seat)` and `outcome`. Rules never read the scene or a clock: a roller supplies a `SettledRoll` (`faces` index-aligned with the throw request, plus the physics seed), and `apply` returns a new state or throws `IllegalActionError`.

- `playGame({ rules, seats, seed, policies, roller, createRng })` drives a game to its outcome and returns the action log; throw seeds come from the game's own RNG, so `(seats, seed)` plus deterministic policies and roller reproduce the same log. `replayGame(rules, seats, rng, log)` rebuilds the state from the log with no physics.
- Rollers: `createRngRoller(createSeededRng)` (uniform faces, no WASM — unit and property tests) and `createHeadlessRoller()` (each throw is a `rollHeadless()` of the requested dice — the same solver as the table).
- [`Farkle.ts`](../packages/dice-core/src/game/Farkle.ts) is the first game (six d6, held dice + partial re-throws, final round once a seat banks to the target, `maxRounds` hard stop). [`FarkleBot.ts`](../packages/dice-core/src/game/FarkleBot.ts) is a one-step expected-value bot built on the exact bust odds of n dice (`farkleRollStats`).
- Tests: `packages/dice-core/test/farkle.test.ts` (scoring table; `fast-check` properties — the turn score never drops mid-turn, a bust zeroes it, random play terminates and replays from its log) and `farkleHeadless.test.ts` (bot vs bot on `rollHeadless`, under 30 s; `describeWasm`).

#### On the tavern table (solo Farkle against a bot)

The rules never see the scene; four small pieces join them to it.

- **A throw can name its dice.** `throwDice(scene, world, seed, { ids })` ([`DiceThrow.ts`](../src/dice/DiceThrow.ts)) throws exactly the physics ids it is given. With no `ids` it throws every die that is **not kinematic** — the R key, notation rolls and old share links — so a die parked in the jail is never re-posed or kicked. `setDieWasmKinematic` is the one door that sets a die's kinematic flag (`SpawnedDie.kinematic`), and [`selectThrowDice`](../src/dice/DiceThrowSelection.ts) is the pure rule. Seeded draws are made in table order over the _selected_ dice, so the same seed over the same dice set and the same ids lands the same faces on any page.
- **The jail is the kept set.** [`DiceJailController`](../src/interaction/DiceJailController.ts): `hold(ids)` parks dice in stable slots around the cage ([`jailParking.ts`](../src/interaction/jailParking.ts)) and makes them kinematic; `release(ids?)` clears kinematic and leaves the die where it lies; `getState().heldIds` names what is held. No engine method was added. While a game owns the jail (`setLocked`) a click on the cage does not toggle it behind the rules' back. A held d6 (2.08 across) is wider than the cage interior, so the parking ring sits around the jail rather than in it.
- **`GameSession`** ([`src/app/GameSession.ts`](../src/app/GameSession.ts)) owns one `GameRules` state. It offers the person on turn their legal actions, drives bot seats through their `GamePolicy`, and for a throw action draws a seed from the game RNG, throws exactly the dice `throwFor` names, waits for _that_ throw's settle, and `apply`s the faces. After every `apply` it makes the jail hold exactly what the state says is set aside (hot dice, a bust and a bank all fall out of that one sync). A cocked die is a re-throw of the action with a new seed (a person is offered it; a bot does it itself, a few times at most). It talks to the scene only through the small `GameTable` interface, so the unit tests play whole games on a fake table. [`GameWiring.ts`](../src/app/GameWiring.ts) is the real table: it seats six d6 (restoring the player's dice set afterwards) and throws through `RollWiring.throwSubset`.
- **The panel** ([`FarklePanel.ts`](../src/ui/FarklePanel.ts)) is a `createHudPanel`. [`farklePanelModel.ts`](../src/ui/farklePanelModel.ts) derives every number from the rules state; the only arithmetic — what a selection would add — is the rules' own `apply` run on a copy. The turn score therefore changes only through `Farkle.apply`.

`RollWiring.throwSubset(ids, seed)` is a seeded roll like a tower drop, with `source: 'game'`: it resolves on its own `ROLL_SETTLED` (flagging `superseded` if another roll started meanwhile), keeps the generic results overlay out of the game, and records only the dice that moved in roll history and fairness stats. While a game is active R / Roll All / the results re-roll are claimed by the game (`interceptRoll`): they mean "my throw", never "throw the free dice outside the rules".

**Partial throws in share links and messages.** `?ids=1,4` (`v=3`) names the dice a throw moved as **table slots** — positions in the dice set, the order of `readAllDiceValues()` — never physics body ids, which the engine hands out per session. Absent means every die, and a link with no `ids` still writes `v=1`/`v=2`, so older links and clients are unaffected; an older client rejects a `v=3` link rather than replay a subset as a full throw. A replay (link, `roll` message, table sync) throws exactly those slots and first parks the dice it leaves out in the jail, so a fresh spawn's random resting places cannot disturb it. The `commit` / `reveal` messages carry the same optional `ids`, bound into the commitment hash, so a host cannot pick the subset after the acks.

Not yet: a second human seat or a room (the host broadcasts `{ action, seed, ids }` on the `roll` path; games refuse to start inside a room), Liar's Dice (needs hidden dice and protocol v2 as the default), and a parchment score sheet. Test hook: `window.__app.game` (`start`, `stop`, `getSnapshot`, `submit`, `rethrow`). Tests: `tests/unit/gameSession.test.ts`, `rollWiringPartial.test.ts`, `diceJailController.test.ts`, `farklePanel.test.ts` (no WASM); `npm run test:partial-throw` and `npm run test:game-farkle` (real engine).

### Roll theatre: seek, slow replay, crit cam

The replay of a roll is the throw, not its pixels: `(seed, dice, kind)` plus the world the throw started from. Seeking re-simulates it on the engine that runs the table — no second engine, no second integrator, no transform buffer per tick.

- **Recording.** Every seeded throw (R / Roll All, notation, share replays, game throws, tower drops) goes through [`throwAndRecord`](../src/dice/ThrowRecord.ts), which asks the engine to apply the throw (`recordSeededThrow`) and to hand back a `serializeState()` snapshot taken **in the same handler, before the throw** — no tick can fall between them. The throw draws through [`applyReplayThrow`](../packages/dice-core/src/wasm/replayThrow.ts), the one function the live throw, the worker and a seek all call. A cup pour or a flick clears the record (no seed reproduces a hand).
- **Seeking.** `replaySeek(base, spec, N)` = `restoreMotionState(base)` → `applyReplayThrow(spec)` → step exactly N fixed ticks. [`restoreMotionState`](../src/wasm/dice_physics/dice_engine_step.cpp) rewinds poses, velocities, sleep and contact manifolds in place and keeps hulls, face tables, materials and kinematic flags; `deserializeState` would drop every hull, so it cannot rewind a live table. It refuses (and changes nothing) when the snapshot names a different dice set. `replayEnter` parks the worker's step loop and stashes the live world; `replayStep(n)` plays on; `replayExit` restores the stash byte for byte and resumes the loop. Collision events raised during a scrub are dropped (the audio must not hear a second roll). The in-process bridge implements the same five calls, and `SchedulerSetup` stops stepping while a replay holds the table.
- **One writer.** A seek is refused while a roll is in flight (`getRollState().phase === 'rolling'`) or when the dice / held set changed since the throw. Any live input — a throw, a click into the scene, a pour — calls `returnTableToLive()` first; the exit is posted before the input, so the worker restores the live world before it sees it.
- **The controller and the UI.** [`RollTheatre.ts`](../src/app/RollTheatre.ts) owns seek / play (1× and ¼×, frame-driven fixed ticks) / live for the last settled roll; [`rollTheatreModel.ts`](../src/app/rollTheatreModel.ts) holds the pure rules. [`RollTimelinePanel.ts`](../src/ui/RollTimelinePanel.ts) is a `createHudPanel` strip at the top centre (slider in ticks, ▶, ¼×, Live); the roll history's latest entry offers "⏪ Scrub this roll".
- **Crit cam.** When a settled roll has a natural max or min on a die it moved (not cocked, not a percentile digit), `CameraController` enters `CRIT_REPLAY` after its focus fly-to: the theatre seeks to 1.5 s before the settle and plays to the settle at ¼× while the camera sits low beside the die and tracks it, then the existing `HOLDING → RETURNING` path finishes. Skip with the panel's Skip button, Esc, or a click into the scene; the results HUD is already up. Reduced motion and XR skip it with the rest of the fly-to.
- **Not yet:** clip export (WebCodecs + a lazily imported `mediabunny` muxer, rendering offscreen frames rather than recording the live canvas) and a timeline over a whole Farkle hand. Both are consumers of `seek`.
- Test hook: `window.__app.theatre` (`getState`, `seek`, `play`, `pause`, `live`, `skip`) and `__app.seekRoll(tick)` → `{ tick, ids, transforms }` or null. Tests: `packages/dice-core/test/replaySeek.test.ts` (seek twice is identical, a seek to the settle is the live roll, exit restores the world; WASM), the native `restoreMotionState` cases in `solver_tests.cpp`, `tests/unit/rollTheatre.test.ts`, and `npm run test:roll-theatre` (browser: crit cam + skip, seek twice, play then live, refused mid-roll).

### Test / debug hooks

Under `?test`, `?debug`, or `?debug-perf`, [`AppTestHooks.js`](../src/core/AppTestHooks.js) installs **`window.__app`** — the stable documented API for Playwright and manual debugging.

Minimum `__app` surface:

| Field / method                                                                      | Notes                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ready`                                                                             | Scene fully loaded                                         |
| `scene`, `camera`, `renderer`, `THREE`                                              | Three.js handles                                           |
| `physicsWorld`, `physics.getWasmEngine`, `physics.isWasmAvailable`                  | Physics                                                    |
| `rendererType`, `usingWebGPU`, `usingWebGL`, `rendererFallbackReason`, `postConfig` | Renderer                                                   |
| `qualityProfile`, `touchInputEnabled`, `isTouchPrimaryDevice`                       | Device / quality                                           |
| `stats`                                                                             | Scheduler timings (was `__renderStats`)                    |
| `interactables`                                                                     | Named prop hooks                                           |
| `replayRoll`, `areDiceSettled`, `readAllDiceValues`                                 | Dice / replay                                              |
| `getRollState`, `physics.getSleepDiagnostics`, `physics.forceNoSettle`              | Roll lifecycle / "why is it awake?" (#341)                 |
| `physics.exportWorld`, `physics.getDieLog` (`?test` only)                           | Recorded collider world / die add-remove log               |
| `physics.worldHash()`                                                               | Hash of the recorded collider world (#369)                 |
| `events`                                                                            | Subscribe to `AppEvent` names                              |
| `game`                                                                              | Table game (Farkle) controls; null w/o WASM                |
| `theatre`, `seekRoll(tick)`                                                         | Roll theatre: seek / play / live (see above)               |
| `bootTrace()`                                                                       | Boot spans, tiers, compiles, first frame (see Boot budget) |

Playwright URLs should include `&test`, e.g. `?webgl&no-post&fair-dice&test`.

## Frame scheduler phases

[`FrameScheduler`](../src/core/FrameScheduler.ts) executes systems in a fixed order with optional priorities within each phase:

| Phase             | Typical work                                                |
| ----------------- | ----------------------------------------------------------- |
| `preStep`         | Input, camera prep                                          |
| `physicsStep`     | Hands elapsed time to the WASM engine (see below)           |
| `postPhysicsSync` | `updateDiceVisuals()`, collision event polling              |
| `updates`         | Prop animations, interaction, dice-case preview, atmosphere |
| `preRender`       | Culling, shadow-map refresh hooks                           |
| `render`          | Composer / TSL post stack                                   |
| `postRender`      | Debug overlays, adaptive quality                            |

The engine owns the physics clock: `step(dt)` banks `dt` and runs fixed 1/120 s ticks (4 substeps each, at most 8 ticks per call). One JS [`SimClock`](../packages/dice-core/src/wasm/SimClock.ts) feeds it everywhere — the worker (wall time since the previous wakeup, so a throttled timer catches up instead of slowing the dice), `?no-worker` (FrameScheduler's 1/60 chunks → 2 ticks each) and `rollHeadless()` — so all three integrate identically. `stepIndex` (the engine tick counter, published in the SAB header as `H_TICKS`) is how settle timeouts and replays refer to time. The worker parks its timer when the world is asleep or the page is hidden and resumes without replaying a backlog. The pipping centre-of-mass bias is applied inside each substep, not from the render loop. See "Fixed clock" and "Pipping bias" in [`WASM_ENGINE.md`](WASM_ENGINE.md).

The scheduler also exposes two boot primitives. `holdPhase(phase, reason)` returns a hold: while any hold on a phase is live its systems do not run (the other phases do, so the loading bar keeps moving) and the frame counts in `stats.heldFrames`. `nextFrame()` resolves when the frame now running finishes — the scheduler's own clock, which is what [`SpawnBudget`](../src/core/SpawnBudget.ts) pays boot work against (see [Boot budget](#boot-budget)).

Systems register via `scheduler.register(phase, name, fn, { priority })`. Prop `update` callbacks and interactables hook into `updates` through [`LoadingTiers.js`](../src/core/LoadingTiers.js) and [`PropRegistry.js`](../src/environment/PropRegistry.js) `afterCreate` handlers — avoid ad-hoc per-frame calls in `main.js`.

## Tiered loading

[`loadTiers()`](../src/core/LoadingTiers.js) drives the loading overlay progress bar and yields to the main thread between heavy steps (`yieldToMain`). _What_ it spawns is the loaded [scene document](#scenes) (`orchestrator.sceneDocument`, the tavern by default); the stages below name the tavern's contents.

| Stage             | Progress | Contents                                                                                     |
| ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| Textures + Tier 0 | ~10–40%  | Physics init, shared KTX2 preload, walls, room, table, clutter, dice models, UI, interaction |
| Tier 1            | ~55–70%  | Furniture: bookshelf, chairs, chest, rug, atmosphere, lamp, floating candles, runecircle     |
| Decorative pool   | ~85%     | Random subset of the scene's tier 2 + 3 props (`compileScene(doc).decorative`; layout seed)  |
| Finalizing        | 100%     | Overlay fade, `app.ready = true` (and `app:ready` event)                                     |

Table layout (decor count, clutter, theme) comes from [`TableLayoutConfig.js`](../src/core/TableLayoutConfig.js) and [`RandomLayout.js`](../src/core/RandomLayout.js).

Shared KTX2/JPG textures, dice GLBs, Draco/Basis transcoders, and other files under `public/` must be loaded through [`publicAssetUrl.js`](../src/core/publicAssetUrl.js) (`import.meta.env.BASE_URL`) — not raw `./images/…` strings — so subdirectory deploys (e.g. `go.1ink.us/dice-roller/`) do not request host-root `/images/`.

### Boot budget

The boot path is measured, not just typed (#365). Four pieces, all of which can be switched off for an A/B (`?spawn-budget=0`, `?no-precompile`):

- **Boot trace** ([`BootTrace.ts`](../src/core/BootTrace.ts)). `performance.mark/measure` around each phase (`renderer-setup`, `physics`, `textures`, `dice-models`, `dice-appearance`, `ui`), tier (`tier0`, `tier1`, `decor`), prop and shader compile, plus the first frames and, where the browser has `longtask`, the long tasks attributed to whichever spans overlap them. `window.__app.bootTrace()` (under `?test` / `?debug`) returns `{ ready, tiers[], spans[], compile, firstFrame, frames[], longTasks[], counters, notes }`; the same measures sit on the `blink.user_timing` track of a Chromium trace beside the tasks they lengthen. `?debug` / `?boot-trace` also print it under the loading bar, and `[BootTrace]` is logged once at `ready`. A prop span is wall time (it includes anything the factory awaits), so a slow prop reads as `longestProp` per tier.
- **Budgeted spawning** ([`SpawnBudget.ts`](../src/core/SpawnBudget.ts)). A factory is synchronous, so every `await` between props of a tier resolved as a microtask and the main thread never reached the event loop until the whole tier was built; a cached second visit has no network waits to break the chain. `spawnTier` / `spawnTierWithRandomPool` now call `checkpoint()` between props: inside the slice's budget it is free, past it the continuation waits for the scheduler's **next frame** (so the work lands in a rendering opportunity and the overlay can paint) and a new slice starts. Budgets are ms of work per frame: 16 for tier 0 (so `ready` is not held up by yields), 6 for tier 1 and the decorative pool; `?spawn-budget=<ms>` sets them all, `0` never yields. Two escape hatches keep a boot from stalling: a hidden tab (rAF is paused) does not wait, and a watchdog (1 s) bounds the wait for a frame that never comes. It can only yield _between_ props — one prop is as long as its factory.
- **Shader precompile and the render hold** ([`ShaderPrecompile.ts`](../src/core/ShaderPrecompile.ts)). three links a WebGL program lazily: the first draw with it calls `getProgramInfoLog`, a synchronous round trip to the GPU process. Whatever frame first shows a prop therefore blocks on every new program in it — on SwiftShader one program is 1–4 s of link time and the tavern has 80–90 of them, so the unmodified boot blocked the main thread for about 57 s cold, in tasks of up to 25 s (see the measurements below). `renderer.compileAsync` is no cure on its own: without `KHR_parallel_shader_compile` (SwiftShader has none) three reports every program "ready" at once and the stall stays at first use. So the boot does it by hand, in three steps, each behind the loading overlay:
    1. **`precompileScene`, after each tier, one scene child at a time**: `renderer.compile(child, camera, scene)` (with the composer's `readBuffer` bound, because a program's key depends on the target it renders into, and restored before any `await`), then `program.getUniforms()` on the programs that child brought, then a budget checkpoint. The unit size is the point: `compile(scene)` queues every link first and the first `getUniforms()` then waits for all of them (measured: one "program" of 24 s, fifteen instant), so a tier-sized batch is one tier-sized task. Two exceptions are handled on purpose: a child that holds a light is compiled with the whole scene after the others (three's `compile(unit, camera, scene)` counts a light inside an in-scene unit twice, which changes the program key, so those programs would never be the ones a frame draws), and where the extension exists the children are queued, polled with the non-blocking `isReady()`, and only then read.
    2. **`precompilePostChain`, after the last tier**: each EffectComposer pass's own `render()`, one pass per turn, against the composer's real buffers (the last enabled pass to the canvas, the others to the buffers, buffers swapped where a pass asks and the parity restored). It runs the pass rather than compiling its materials because passes set their `defines` inside `render()` — `OutputPass` builds `SRGB_TRANSFER` / the tone-mapping define there, so a program compiled beforehand has a different key and the real one links again in the first frame (measured: `OutputShader`). The scene's own `RenderPass` is skipped.
    3. **`warmFirstRender`, last**: one real render of the scene pass. What is left after steps 1–2 is what three builds only _inside_ `render()` — the shadow-depth / distance programs (`WebGLShadowMap` makes them from the casters, and `setProgram` needs a render state that exists only during a render) and the first upload of every texture and buffer. Left to the first real frame they were 4 programs and 8–18 s the player saw as a freeze right after the overlay fades. It re-arms `shadowMap.needsUpdate` afterwards, because it consumed the pending update and finalizing still changes which props cast.

    WebGPU compiles pipelines off the main thread; its node-material build is JS, so it compiles one scene child at a time (`compileAsync(child, camera, scene)`, light-bearing children with the whole scene) with the same checkpoints, and steps 2–3 do nothing there (no `passes`, and `warmFirstRender` skips `WebGPURenderer`). While all of this runs, `main.js` holds the `render` phase from the first frame until `loadTiers` releases it just before the overlay fades — the overlay is opaque, so nobody sees the missing frames, and no frame ever draws a half-linked scene. The trace's `firstFrame.newPrograms` is the check: a first real frame that still creates programs is a regression, and shows as a number. **What this does not do:** it moves the stall rather than removing it. On SwiftShader one program is 1–4 s of link time and the warm-up render is a single task (16.9 s of which four programs and the first uploads are nearly all) — three gives no way to link a shadow-depth program on its own, so that step cannot be sliced further. It sits behind the loading overlay with the text "Warming up the first frame…", but the main thread is blocked for it, and the 2 s gate below measures main-thread tasks, not what the player sees.

- **The gate** (`npm run verify:boot-budget`, CI job `boot-budget`). Cold load, then a warm re-navigation of the same page, on SwiftShader; records `longtask` entries and a Chromium trace, and fails if any main-thread task passes `BOOT_TASK_BUDGET_MS` (2000) before `ready`, or `load` takes longer than `BOOT_LOAD_BUDGET_MS`. Between the visits it calls `leaveAndWaitForGpuQuiet` (see _Revisiting on a software rasterizer_) and prints the wait on its own line. See AGENTS.md, CI notes.

**Measured** (SwiftShader, headless Chromium, `/?test`, the same harness on a baseline build and the final one; the whole trace window, from navigation to one second past `ready`). The box is shared and its load swung between 3 and 40 over the session, and the two builds were not measured at the same moment, so treat the magnitudes as indicative and the _shape_ as the finding:

|                                        | baseline cold              | final cold            | baseline warm              | final warm            |
| -------------------------------------- | -------------------------- | --------------------- | -------------------------- | --------------------- |
| main thread blocked (tasks > 50 ms)    | 57.0 s                     | 33.3 s                | 59.9 s                     | 25.7 s                |
| tasks over 2 s                         | 6.3, 3.1, 18.9, **25.5 s** | 3.4, 16.9 s           | 6.2, 2.8, 11.1, **37.0 s** | 20.4 s                |
| of those, after `ready` (overlay gone) | **25.5 s**                 | none                  | **37.0 s**                 | none                  |
| first real frame                       | the 25.5 s task            | 54 ms, 0 new programs | the 37.0 s task            | 1.3 s, 8 new programs |

The baseline's worst task is the first real frame, which starts right at `ready`: the page looked loaded and then froze for 25–37 s. (The harness's long-task window ends at `ready`, so a before-`ready` measurement alone _understates_ the baseline; the final build's first real frame is cheap, so there is nothing to miss.) Everything the final build still blocks on is behind the opaque loading overlay, cut into per-prop and per-pass units with a frame between them wherever three allows, and named in `__app.bootTrace()` and the Chromium trace. **The 2 s budget is still not met on this runner class**: one program is 1–4 s of link time on a CPU rasterizer, so even per-program slicing cannot get every task under it, and the last step three does not let us slice — the warm-up render (shadow-depth programs and first uploads) — is the longest task in both visits (16.9 s, 20.4 s). On the warm visit the first real frame still links 8 programs (1.3 s, programs already in ANGLE's in-process cache); which ones was not chased. The gate fails on this runner class until a link is under the budget or a cache makes it so, so the CI job runs `BOOT_BUDGET_REPORT_ONLY=1` (traces still uploaded) until it is calibrated there; the script fails by default, and the budget was not raised to hide that.

**Revisiting on a software rasterizer.** A same-page re-navigation (a reload, or the second visit in `test:share-roll-replay`) used to block for 40–300 s before the new document ran anything. That is not boot work: a blank page's first `getContext('webgl2')` after a visit waits just as long, and then the next one takes 20 ms. The GPU process is still tearing down the abandoned context (97 s after the unmodified baseline build, 103 s after the final one, 130–296 s on a more loaded box); waiting 150 s on `about:blank` first makes the first context instant. What was tried to avoid it from the app, none of which worked for a real navigation: `renderer.setAnimationLoop(null)` before leaving (no effect, 296 s); an explicit `forceContextLoss()` on a live page followed by a hop to `about:blank` (44–67 ms, which looked like the answer) — but the same call at `pagehide` (verified: `persisted: false`, `isContextLost() === true` by the end of the event), in the same task as the navigation, or 20 ms before it, still left the next real document waiting 147–272 s to _commit_. A `pagehide` release was written, tested and removed again for that reason; do not re-add one without a measurement that it helps. The harness and `test:share-roll-replay` therefore call `leaveAndWaitForGpuQuiet`, which leaves for `about:blank` and waits until a fresh context is created in under a second, twice running, and returns the wait so it is printed and not hidden. On a machine with a GPU, context teardown is quick and the wait is ~0.

Not in scope here, on purpose: nothing about tier 0 moved into the service worker or behind a `modulepreload` to hide the task — the point is to see it. The `software` context profile's MSAA / shadow values are untouched (the render baselines pin them, see `ContextProfile.ts`).

The physics artifact `wasm/dice_physics.wasm` is fetched once per load, by whichever thread instantiates it (the worker, or the page under `?no-worker`). It used to be fetched twice because `vite.config.js` also emitted a document `<link rel=preload>`, which a Worker cannot consume; `verify:bundle-loading` asserts the request count.

## Scenes

A dice table can be set in more than one place. A **scene document** ([`src/scenes/SceneDocument.ts`](../src/scenes/SceneDocument.ts)) is the data for one place: an `id`, the physics numbers (`gravity`, `table: { y, halfW, halfD }`), a `lighting` preset id, and a `props` list — each line a factory name, a tier (0–3), a pose, and optional `randomPool` / `cull` / `scale` / `id`. Nothing in it imports Three or the DOM.

| Scene        | File                                         | What it is                                                                                                                |
| ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tavern`     | [`tavern.ts`](../src/scenes/tavern.ts)       | The default: velvet zone, window, moonlight, the full catalogue (`tavern-night` lighting)                                 |
| `chart-room` | [`chartRoom.ts`](../src/scenes/chartRoom.ts) | Windowless brick room, one lantern (`lantern-dim`): table, cup, tower, tray, jail, charting instruments. No new geometry. |

**Choosing one.** `?scene=<id>` (see [`scenes/index.ts`](../src/scenes/index.ts)); an unknown id logs and loads the tavern. `main.js` resolves it once into `app.sceneDocument` (`window.__app.sceneDocument` under `?test`) and hands it to the three places that used to hard-code the tavern: `setupScene(container, { lighting })`, `bootstrapPhysics(app, sceneDocument)` (`engine.init(gravity, table.y, table.halfW, table.halfD)`), and `loadTiers(…, { sceneDocument })`. A share link starts from the current URL, so it carries `scene=` with it; `w=` (the collider-world hash) differs between scenes, so a receiver on the wrong scene gets the usual mismatch notice.

**Documents are data; behaviour is a named hook.** [`sceneCompile.ts`](../src/environment/propRegistry/sceneCompile.ts) validates a document (`validateSceneDocument`: known factories and lighting preset, unique ids, one `Table`, finite poses, `randomPool` only on tiers 2/3) and compiles it into the `tier0…tier3` + `decorative` entries `spawnProp` takes. Anything that is not "a factory at a pose" — the table registering WASM bounds, the lamp hung from the ceiling, `update` registration, click handlers, the dice cup/tower/tray/jail controllers — is a hook in [`propHooks.js`](../src/environment/propRegistry/propHooks.js), keyed by **factory name**, so every scene that places a prop gets the same wiring and a document never carries a branch. Adding a prop to a room is a line in its document plus an existing factory; do not fork a factory per scene.

**Slots are part of the contract.** A prop's seeded RNG stream is keyed by `(layout seed, id, slot)`, where the slot is its index in the decor list (tiers 2 + 3, document order). Reordering or inserting lines in a document moves other props' scatter and that scene's collider-world hash, so append unless that is the point. `tests/golden/tavern-entries.json` pins the tavern's entry list, order and derived tags; `tests/unit/scenes.test.js` compares against it.

**What the layout seed still does** — scatter clutter and draw the decor subset, now from the loaded document's own decor list (`selectDecorPoolEntries(entries, …)` / `getRandomProps({ entries })`, and `createLayoutManager({ decorEntries })` for a re-roll). `PROP_INDEX` and `TIER_PROP_DEFINITIONS` remain the _tavern catalogue's_ view (tags, categories).

**Lighting** is a preset id into [`LightingPresets.ts`](../src/core/LightingPresets.ts): numbers for the rig `setupScene` already builds (dice-zone pool, ambient, hemisphere, fill, candle, moon, fog). `tavern-night` is the original rig verbatim; `lantern-dim` hides the moon spot. A preset retunes lights; it does not duplicate the candle flicker (`LightingSystems.js`) or the god-ray beam, which belongs to the `TavernWalls` factory — a scene that does not list it simply has no beams.

**Physics numbers.** The tavern reads `dice-core`'s `PHYSICS_GRAVITY` / `PHYSICS_TABLE_Y` / `PHYSICS_TABLE_HALF`, the same constants `rollHeadless` and the seeded throw parameters assume, so the browser and Node cannot drift. A scene with _different_ numbers is a different simulation from the headless core's until that core reads the document too; `chart-room` keeps the same numbers (it uses the same 36×36 `Table`).

Tests: `tests/unit/scenes.test.js` (golden tavern, validator, `?scene=` resolution, engine init from the document, decor draw from the scene's own list) and `npm run test:scene-select` (browser, needs WASM: `?scene=chart-room` reaches ready, builds its own props, initialises the engine from its document, replays a seeded throw to the same faces on two cold loads; an unknown id falls back to the tavern).

## Prop registry

[`PropRegistry.js`](../src/environment/PropRegistry.js) is the catalogue and spawn pipeline for environment props.

**Factory discovery** — `import.meta.glob` in [`factories.js`](../src/environment/propRegistry/factories.js) collects every `createXxx` export from `src/environment/*.js` into `PROP_FACTORIES`, excluding the `PropRegistry.js` barrel and helper modules (`propKit`, `PropLifecycle`).

**Spawn** — `spawnProp(entry, context)` either calls `entry.call(context)` (a `create` hook, see [Scenes](#scenes)) or invokes the factory with `(scene, physicsWorld, position, rotation, { scale }?)`. Positions with legacy tabletop `y ≈ -2.75` are adjusted via `toCurrentTabletopY()` from [`SceneMetrics.js`](../src/core/SceneMetrics.js).

**Post-spawn policy (registry-owned, not per-prop):**

- Shadow opt-out — `SHADOW_DISABLED_PROP_NAMES` disables cast/receive on small decorative props.
- Far-shadow LOD — props far from table centre drop `castShadow` once at spawn.
- Static mesh merge — eligible static props batch leaf meshes via [`StaticPropMerger.js`](../src/core/StaticPropMerger.js). Merged geometry is baked **relative to the prop root**, which stays the physics anchor; props that animate (`update`) or move (`dynamic`) are excluded.
- Interaction — `afterCreate` registers `registerInteractiveObject` / `registerInteractable` as needed.

**New props** must use [`propKit.js`](../src/environment/propKit.js) (`createProp`, `materials.*`, collider specs via [`StaticColliderBridge.ts`](../src/core/StaticColliderBridge.ts)). See AGENTS.md “Adding New Environment Props”.

### One prop, two placement paths

Tabletop clutter and named decor are the **same modules**. A prop is authored once
under `src/environment/<Name>.js` with `createProp`; the two spawn paths differ only
in how it is placed:

|           | Decor (`PropRegistry`)                       | Clutter (`RandomClutter`)                          |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| Entry     | a line in a scene document (`src/scenes/`)   | `CLUTTER_REGISTRY`                                 |
| Call      | `(scene, physicsWorld, position, rotationY)` | `(scene, physicsWorld, { placement, rng, track })` |
| Placement | authored position                            | seeded slot from `ClutterPlacement.js`             |
| Scale     | 1                                            | tabletop scale via `asClutter(..., { scale })`     |

[`clutter/adaptProp.js`](../src/environment/clutter/adaptProp.js) `asClutter()` bridges
the two: it resolves the seeded slot, converts the legacy tabletop `y`, and reports the
root through `options.track` so the scatter merge and culling systems see it. Anything
still living only in `clutter/*.js` (coins, candle, book, parchment, quill, tarot,
poster, gemstone, potion, d20 holder) has no named twin — give it one under
`src/environment/` rather than adding a second implementation.

### Deterministic table: prop RNG and the world hash (#369)

A share link carries `layout-seed`; replaying it is only honest if the receiver rebuilds the **same collider world**. Two mechanisms make that true and provable.

**One RNG per prop.** No module under `src/environment/` draws from `Math.random` (or `Date.now`) — ESLint's `no-restricted-properties` rejects it, and also rejects it in `packages/dice-core/src`. Instead [`propRng.js`](../src/environment/propRng.js) derives a seeded stream for each spawned prop from

```
(layoutSeed, registry key, slot, ordinal) → fnv1a32 → createSeededRng
```

- the spawn paths open a scope around the factory call (`withPropScope`): `spawnProp` uses the table's `layout-seed`, the entry's `name` as the key and its index in the tier list as the slot; `RandomClutter` uses the same seed, the clutter id and the scatter slot (`clutter:3`). Two instances of one prop therefore never share a scatter, even at one position, and which other props the seeded draw picked never changes this one.
- `createProp` claims the stream from the open scope and passes it to `build({ group, materials, mesh, rng })`; `colliders` may be a function `({ group, rng }) => spec[]`. A factory that needs numbers before it can declare colliders calls `propRng('Name')` itself (synchronously, before any `await`) and hands the result back as `createProp({ rng })`. `ordinal` counts claims inside one factory call, so a meal's tankard and plate get separate streams.
- Canvas-texture noise uses `createSeededRng(CONSTANT)` per generator, so a cached texture never depends on which instance built it first. Per-frame `update` code captures the prop's `rng` in its closure.
- A factory called outside any scope (a unit test) still gets a deterministic stream (layout seed 0, slot 0).
- `createProp` names the group after the registry entry (`Mug`, not `EnhancedMug`) when the author gives no name, so `SHADOW_DISABLED_PROP_NAMES`, the culling set and the tests match on one name.

**A collider-world hash.** [`WorldRecorder.ts`](../packages/dice-core/src/wasm/WorldRecorder.ts) wraps the engine's structural methods in every session (not only `?test`) and keeps the live set of colliders. `hashWorld()` is FNV-1a/64 over a canonical text — shape, pose and material of each collider, **without ids and in sorted order**, because ids come from a global counter a layout re-roll does not reset. Two clients that registered the same colliders (to the 1e-5 the recorder rounds to) report the same 16-hex hash, however their tiers happened to interleave. It is only meaningful once every tier has loaded.

| Where                                    | What happens on a mismatch                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Share link `…&w=<hash>`                  | `replayShareableRoll` skips the replay and shows a dismissible "different table" badge. A link with no `w=` (older links) replays as before.     |
| `?room=` join (`roomExists`, WS upgrade) | Guest status goes to `error` ("Table mismatch…"); the Durable Object answers `403 world_hash_mismatch`. The host's hash replaces the stored one. |
| `hello` message                          | Carries `worldHash` next to `solverBuildId` (informational).                                                                                     |

`tests/fixtures/tavern-world.json` is `{ hash, world }`; `npm run check:world-fixture` compares the hash first and says whether the _world_ changed or only ids / registration order did. `tests/unit/propDeterminism.test.js` spawns every tabletop tier entry and the clutter pass under two different `Math.random` sequences and requires identical colliders.

`createProp`'s `scale` option scales the group **and** the collider spec
(`scaleColliderSpec` — lengths and offsets by `scale`, mass by `scale³`), because
`StaticColliderBridge` builds shapes straight from the spec and ignores `group.scale`.

## Renderer selection

[`RendererFactory.ts`](../src/core/RendererFactory.ts) is the thin factory (`createRenderer`, `recoverRenderer`) and re-exports everything it used to export. The pieces it composes, each with one reason to change:

| File                                                     | Owns                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`PixelRatioPolicy.ts`](../src/core/PixelRatioPolicy.ts) | `?pr=` / DPR cap, MSAA-vs-FXAA choice, `applyRendererSize`, the sustained-slow-frame pixel-ratio monitor            |
| [`WebGlContext.ts`](../src/core/WebGlContext.ts)         | Software-rasterizer detection and probe, WebGL context attributes, `createWebGlRenderer`                            |
| [`WebGpuDevice.ts`](../src/core/WebGpuDevice.ts)         | Required limits / features, curated `requestAdapter` + `requestDevice`, adapter description, `createWebGpuRenderer` |
| [`RendererConfig.ts`](../src/core/RendererConfig.ts)     | Config both backends share (shadow map type, tone mapping, colour space)                                            |
| [`RendererRecovery.ts`](../src/core/RendererRecovery.ts) | Context / device-loss handlers (`installRendererRecoveryHandlers`)                                                  |

| Condition                                                                  | Renderer                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Default (browser has `navigator.gpu`)                                      | `WebGPURenderer` + TSL post (`PostProcessing`)                                           |
| WebGPU init failure or no GPU                                              | Automatic fallback to `WebGLRenderer` + `EffectComposer`                                 |
| No adapter, or a software / fallback adapter (SwiftShader, lavapipe, WARP) | Classic `WebGLRenderer`, chosen by the factory itself — never Three's WebGL2 TSL backend |
| `?webgl`                                                                   | Force `WebGLRenderer` (stable baseline / CI / SwiftShader)                               |
| `?webgpu` / `?wgpu`                                                        | Force WebGPU explicitly (redundant with default)                                         |
| `?xr` / `?xr-emulator` / `?ar`                                             | Force `WebGLRenderer` + no-post for WebXR (see [`XR.md`](XR.md))                         |

### Device session (context attributes)

[`DeviceSession.ts`](../src/core/DeviceSession.ts) is resolved once at boot, before any canvas or `AudioContext` exists, because `powerPreference` and `sampleRate` cannot change after creation:

| Field               | Rule                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `glPowerPreference` | `low-power` for `?xr`, touch/coarse pointer, or `hardwareConcurrency <= 4`; a software rasterizer lowers it too; otherwise `high-performance` |
| `wantWebGlProbe`    | `false` when `navigator.gpu` exists and WebGPU is preferred — the WebGPU path reads software-ness from `adapter.info` instead                 |
| `audio`             | `{ latencyHint: 'interactive', sampleRate: 48000 }` (always, so `?test` is stable across 44.1/48 kHz machines)                                |

- **Software probe** (`probeSoftwareWebGL`) only runs on the WebGL path (`?webgl`, `?xr`, no `navigator.gpu`, or a WebGPU fallback). It asks for a `low-power` WebGL2 context with `failIfMajorPerformanceCaveat` on a never-attached canvas, always calls `loseContext()`, and the tavern context is created only after its `webglcontextlost` (or a 250 ms timeout). Renderer recovery passes the known `isSoftwareRenderer` and never re-probes.
- **Curated WebGPU device**: `requestCuratedWebGpuDevice` makes one `requestAdapter` call. If it returns no device (no adapter, `requestDevice` rejected), `createRenderer` falls back to WebGL and records the reason plus the limit note from that same adapter — it never constructs a device-less `WebGPURenderer` (which would request every adapter feature).
- **One attribute bag**: `getWebGlContextAttributes` / `getWebGlRendererParameters` / `getWebGpuRendererParameters` take `alpha` and `powerPreference`. The tavern stays `{ alpha: false, stencil: false, xrCompatible: isXr }` (Three r181 does not forward `xrCompatible`, so the factory calls `canvas.getContext('webgl2', …)` itself). Secondary canvases use a profile (`PREVIEW_WEBGL_CONTEXT`) on the same helper rather than their own object; the #315 overlay should be another profile there. No `desynchronized: true` without a screenshot test (it fights `capturePng()`).
- **Adapter-aware fallback**: on the default route, `requestCuratedWebGpuDevice` refuses a software or fallback adapter (`isFallbackAdapter`, or `adapter.info` naming SwiftShader / llvmpipe / lavapipe) _before_ any device exists, and `createRenderer` takes the classic WebGL path with `isSoftwareRenderer` already known (no second probe). `?webgpu` keeps such an adapter, which is how you test it. So a headless SwiftShader load of `/` reaches `ready` without `?webgl` (`npm run test:default-route`).
- `rendererState` reports `glPowerPreference`, `powerReasons`, `softwareProbe` (`null` when the probe did not run), `contextProfile` / `contextProfileReason`, `adapterDescription` and `sampleCount`; `?renderer-info` logs them and the badge shows profile · pixel ratio · AA, with adapter, power reasons and fallback reason on hover.

### Context profiles

[`ContextProfile.ts`](../src/core/ContextProfile.ts) is the one table every context reads (`getProfileContextOptions` feeds the attribute helpers above; `PREVIEW_WEBGL_CONTEXT` is its `preview` row):

| Profile    | alpha   | AA                       | powerPreference (ceiling) | shadows  | post | Notes                                                                                                                        |
| ---------- | ------- | ------------------------ | ------------------------- | -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `desktop`  | no      | MSAA at pr=1, FXAA above | high-performance          | PCF soft | full | default                                                                                                                      |
| `mobile`   | no      | FXAA                     | low-power                 | PCF      | low  | touch / coarse pointer                                                                                                       |
| `xr`       | no      | MSAA                     | low-power                 | basic    | none | `?xr`; `xrCompatible`; classic WebGL only                                                                                    |
| `software` | no      | MSAA at pr=1, FXAA above | low-power                 | PCF soft | low  | SwiftShader / llvmpipe; classic WebGL only. AA and shadows stay desktop until the SwiftShader render baselines are refreshed |
| `overlay`  | **yes** | MSAA                     | low-power                 | off      | none | `?overlay` (#315): alpha-0 clear, no `scene.background`                                                                      |
| `preview`  | yes     | none                     | low-power                 | off      | none | the dice-case canvas; never picked for the tavern                                                                            |

- Selection: `?context=<profile>` forces a row (a classic-WebGL-only row skips WebGPU entirely); otherwise `xr` → `?overlay` → software rasterizer → touch → `desktop`.
- `powerPreference` is a ceiling: the DeviceSession (touch, low cores, XR, software) may already have lowered it, and a profile can only lower it further.
- `post` is a floor SceneSetup applies before the URL flags: `none` disables the composer, `low` forces low-quality bloom.

Both renderers set `outputColorSpace = SRGBColorSpace`. WebGPU `requestDevice` uses a documented `requiredLimits` floor.

The Dice Case preview uses a **lazy low-power** WebGL context (`PREVIEW_WEBGL_CONTEXT`, not high-performance) and disposes it on collapse so Quest / Intel / SwiftShader do not burn a second high-performance slot. It is WebGL on purpose and never shares the tavern's `GPUDevice`.

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
artifacts), `WasmPhysicsBridge.ts`'s existing no-op JS stub takes over,
`isWasmAvailable()` reports `false`, `PhysicsBootstrap.showLoadFailure()` shows
an error banner, and the tavern still loads with zero dice — an honest failure
mode rather than a second, differently-behaving engine.

Bridges: [`WasmPhysicsBridge.ts`](../packages/dice-core/src/wasm/WasmPhysicsBridge.ts) (main-thread), [`WorkerPhysicsBridge.ts`](../packages/dice-core/src/wasm/WorkerPhysicsBridge.ts) (default), selected by [`PhysicsBridge.ts`](../src/wasm/PhysicsBridge.ts). Flags: `?no-wasm` (forces the no-op stub), `?no-worker` / `?worker-physics=off` (forces the main-thread bridge) — see AGENTS.md and WASM_ENGINE.md.

Declarative static and dynamic colliders go through [`StaticColliderBridge.ts`](../src/core/StaticColliderBridge.ts), which registers every collider type (box, plane, cylinder/openCylinder, convexHull, compound) directly on the WASM engine — there is no other collider backend. `DicePhysicsEngine::MAX_STATICS` (512, see [`WASM_ENGINE.md`](WASM_ENGINE.md)) caps the WASM static registry; `addStaticBox`/etc. report drops past that cap via `getStaticCapacityDroppedCount()` rather than silently no-op'ing.

## Key directories

```
src/
  core/           Frame loop, renderer, loading, textures, culling, metrics
  environment/    Prop modules + PropRegistry + propKit
  (packages/dice-core/ — Three-free headless core: WASM bridges + worker, notation, rolls, dice-set format)
  wasm/           C++ engine, page-facing PhysicsBridge facade, collider registration
  shaders/        ShaderKit graphs (god rays, vignette, post params) → GLSL + TSL
  ui/             DOM panels beyond core ui.js
tests/            Playwright smoke / a11y scripts (see AGENTS.md)
scripts/          Asset conversion, verify-* harnesses
docs/             ARCHITECTURE.md, WASM_ENGINE.md, MULTIPLAYER.md
```

## Deployment and utilities

- **`deploy.py`** — zips `dist/` and uploads via the Contabo storage manager API (see script header for config). Run `npm run build` first.
- **`git.sh`** — personal convenience script (`git pull`, `git add .`, commit, push). Not part of CI; credentials and commit messages are ad hoc.
