# WebXR table

Immersive entry for the tavern dice table: **seated VR** (`?xr`) and **AR table placement** (`?ar`). Both run on the classic `WebGLRenderer.xr`, grab dice through the WASM kinematic path (controller squeeze / select, or a tracked-hand pinch), and show the session in world space. It is a custom stack under [`src/xr/`](../src/xr/) — no A-Frame, React-Three-Fiber or `@pmndrs/xr`, and no new dependencies.

Quest Browser is the real target; the Chrome WebXR emulator is the daily driver.

## Flags

| Flag            | Effect                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `?xr`           | Seated `immersive-vr`: force **WebGL**, imply **no-post**, `xrCompatible` context, `QUALITY_PROFILES.xr`; show **Enter VR**           |
| `?xr-emulator`  | Alias of `?xr` (handy for Chrome WebXR emulator bookmarks)                                                                            |
| `?ar`           | `immersive-ar` table placement; implies everything `?xr` does; shows **Enter AR**                                                     |
| `?xr-hands=off` | Do not request `hand-tracking` (controllers only)                                                                                     |
| `?xr-snap=45`   | Snap-turn degrees (clamped 15–90, default 45); VR only                                                                                |
| `?xr-webgpu`    | **Experimental.** Keep `WebGPURenderer` and hand its `renderer.xr` to the session instead of forcing WebGL (see WebGPU + WebXR below) |

Every "is XR on" decision (renderer preference, no-post, quality profile, context profile) goes through `isXrRequested()` in [`XrFlags.js`](../src/xr/XrFlags.js); never `params.has('xr')` by hand, or `?ar` silently misses one of them. Without any of these flags nothing under `src/xr/` is loaded: [`XrBootstrap.js`](../src/app/XrBootstrap.js) is a flag check plus a dynamic import of [`XrAppWiring.js`](../src/xr/XrAppWiring.js).

## Requirements

- **Renderer:** `THREE.WebGLRenderer` with `renderer.xr`. The WebGL2 context is created with `xrCompatible: true` under any XR flag so `requestSession` does not recreate the canvas.
- **Physics:** WASM is the only path (`setDieKinematic` / `setDieVelocity` via [`WasmDieGrab.ts`](../src/interaction/WasmDieGrab.ts)) — a build with `public/wasm/` present is required; there is no fallback physics engine, and no ammo XR path.
- **COOP/COEP:** Already applied by Vite (`same-origin` / `require-corp`) for SharedArrayBuffer worker physics. Quest Browser generally accepts this; if session start fails, check the browser console for isolation errors.
- **Session features** ([`XrSessionOptions.js`](../src/xr/XrSessionOptions.js)): nothing is required beyond the mode. Optional: `local-floor`, `hand-tracking` (unless `?xr-hands=off`), `layers`; VR adds `bounded-floor`, AR adds `hit-test` and `anchors`. A browser that grants none of them still starts a session.

## How to try it

### Chrome WebXR emulator

1. Install the [WebXR API Emulator](https://chromewebstore.google.com/detail/webxr-api-emulator) extension (or Immersive Web Emulator).
2. Run the app: `npm run dev` → open `http://localhost:5173/?xr` (or `?ar`).
3. Click **Enter VR** / **Enter AR**, then use the emulator's headset/controller panel.
4. Aim a controller ray at a die, **squeeze** or **select** to grab, release to throw. Aim at the side panel's buttons and select to press them.

### Meta Quest Browser

1. Deploy or tunnel a HTTPS origin (Quest requires secure context).
2. Open `https://…/?xr` (or `?ar` for passthrough) in Quest Browser.
3. Tap **Enter VR** / **Enter AR**, grant session permission.
4. Controllers: squeeze to grab; thumbstick X snap-turns; face buttons (X/A style) recenter.
5. Hands (put the controllers down): pinch near a die to pick it up, open the pinch to throw. Pinch while pointing at a panel button to press it.

## Input

[`XrControllers.js`](../src/xr/XrControllers.js) routes every press in one order:

1. **AR, table not placed yet** → place the table on the reticle.
2. **Ray on a chrome button** → press it.
3. Otherwise **grab**: a pinch takes the die nearest the fingertips (within 7 cm of the thumb/index midpoint, counting the die's own radius), falling back to the hand's target ray; a controller takes the die under its ray.

Squeeze only ever grabs. A tracked hand's own `select` events are ignored — the pinch arrives through [`XrHands.js`](../src/xr/XrHands.js) with a real fingertip position. Pinch uses hysteresis (start at 1.8 cm, release at 3.2 cm; [`XrPinch.js`](../src/xr/XrPinch.js)), and losing hand tracking mid-pinch releases the die. Both hands and controllers drive the same [`XrGrab.js`](../src/xr/XrGrab.js) → `WasmDieGrab` state, so one die is held at a time and a throw keeps the hand's velocity.

**Seated recenter** (face button, or the panel's **Recenter**) puts the dolly under the head and turns it to the head's heading, so the table is in front of where the player looks now. It never touches height — `local-floor` owns Y — and snap turns pivot about the head rather than the reference-space origin, so turning never slides the table past the player. Teleport is out of scope (seated table).

## World-space chrome

The DOM HUD, crosshair and session strip are desktop-only: `setDomResultsSuppressed(true)` and the `xr:presenting` event hide them while presenting. In their place, hanging off the rig's `xrTableAnchor`:

- [`XrResultsHud.js`](../src/xr/XrResultsHud.js) — engine totals / last expression above the far edge of the velvet.
- [`XrChrome.js`](../src/xr/XrChrome.js) — a canvas-texture panel (the CharacterSheet technique) left of the table: initiative order with the current actor, last expression, and buttons **Pass turn** (disabled for a room guest, same rule as the strip), **Tower drop** (when the scene has a dice tower: `interactables.diceTower.drop()`, a seeded, shareable roll), and **Recenter** / **Move table** (AR). It reads `app.session` — the same `SessionState` the desktop strip shows — and redraws on `session:*` / `roll:*` events, not every frame. Layout and hit-testing are pure ([`XrChromeLayout.js`](../src/xr/XrChromeLayout.js)).

## Seated calibration (VR)

The authored scene is **not** meters. [`XrRig.js`](../src/xr/XrRig.js) builds:

```
scene
└─ xrDolly          reference-space pose of the table (yaw, floor position)
   ├─ xrWorld       the tavern, scaled scene units → meters
   └─ xrTableAnchor meters, at the velvet centre on the table surface (chrome hangs here)
```

| Constant               | Default | Meaning                                                |
| ---------------------- | ------- | ------------------------------------------------------ |
| `XR_WORLD_SCALE`       | `0.05`  | Scene unit → meters (table ~1.8 m wide; velvet ~0.8 m) |
| `XR_TABLE_HEIGHT_M`    | `0.75`  | Table surface height under `local-floor`               |
| `XR_SEAT_OFFSET_SCENE` | `1.5`   | Extra distance past velvet edge for seating            |

Scene children are adopted into `xrWorld` with `add` (not `attach`) every presenting frame, so dice spawned mid-session keep their scene-unit transforms. Controllers, grips, hands, the AR reticle and anything else named `xr*` stay in reference space. Transforms apply **only while presenting**; exiting restores identity on the dolly and world group, so the desktop camera sees the tavern exactly as before.

## AR placement (`?ar`)

[`XrArPlacement.js`](../src/xr/XrArPlacement.js) requests a hit-test source from the `viewer` space and shows a reticle (ring + velvet-zone outline, 0.8 m) on detected surfaces. Select or pinch places the table: the velvet centre lands on the hit point with the table surface on the hit plane, turned so the seat edge faces the player. With `anchors` granted the placement is pinned to an `XRAnchor` and follows tracking refinements. **Move table** drops the anchor and shows the reticle again. Without `hit-test` (emulators, some browsers) the reticle falls back to a fixed spot 0.6 m ahead of and 0.45 m below the head.

[`XrArScene.js`](../src/xr/XrArScene.js) dresses the scene for passthrough while presenting: `scene.background` and fog are cleared, the clear alpha goes to 0, a hemisphere fill light is added, and the room is hidden. The keep/hide test is geometric, not a name list — anything reaching the floor, floating above the felt (the hanging lamp, floating candles) or extending past the table edge is room; the `Table` (by its `userData.sceneFactory`), lights, dice, and tabletop props (including the tall dice tower) stay. A new scene-document prop needs no AR entry. All of it is restored on exit.

`XR_WORLD_SCALE = 0.05` stays the authored-unit conversion in AR too, so the virtual table keeps its 1.8 m size.

## Quality: framebuffer scale + foveation

`QUALITY_PROFILES.xr` (in [`AdaptiveQuality.ts`](../src/core/AdaptiveQuality.ts)) drives the XR layer, not just the desktop canvas:

| Field                  | Default | Meaning                                                  |
| ---------------------- | ------- | -------------------------------------------------------- |
| `framebufferScale`     | `1.0`   | `renderer.xr.setFramebufferScaleFactor` at session start |
| `framebufferScaleMin`  | `0.6`   | Floor for step-downs                                     |
| `framebufferScaleStep` | `0.1`   | One step-down                                            |
| `foveation`            | `1`     | `renderer.xr.setFoveation` (where the layer exposes it)  |

WebXR fixes the layer size for the session (three warns and ignores a resize while presenting), so [`XrFramebufferScale.js`](../src/xr/XrFramebufferScale.js) works like the desktop pixel-ratio monitor one step removed: frames are sampled in 90-frame windows; two consecutive windows averaging over 21 ms (a frame and a half at Quest's 72 Hz) lower the **next** session's scale by one step. `?debug-perf` / `?debug` show it on the stats overlay (`xr … fb 1.00 → next 0.90 fov 1`), and `window.__app.xr.getStats()` returns `framebufferScale`, `nextFramebufferScale`, `foveation`, `lastWindowAvgMs` and `stepDowns`.

## WebGPU + WebXR (`?xr-webgpu`, experimental)

Three r181's `WebGPURenderer` has an `XRManager`, but its `setSession` throws for a WebGPU backend ("XR is currently not supported with a WebGPU backend"), and the only backend it accepts is the WebGL2 node backend this app deliberately never runs. So the default XR path stays the classic `WebGLRenderer`. `?xr-webgpu` keeps the normal WebGPU-first renderer choice and tries anyway: where WebGPU actually starts, the session ends immediately today and the reason is logged and shown as the Enter button's tooltip (`getStats().lastError`); where it falls back to the classic `WebGLRenderer` (no `navigator.gpu`, software adapter), XR works as with `?xr`. When three's XRManager accepts a WebGPU backend this flag is the place to try it; do not block on it.

## Automation

Under `?test` / `?debug`: `window.__app.xr` (`getStats()`, `recenter()`, `rig`, `placement`, `controllers`), `window.__app.xrChrome` (`press(id)`, `getLayout()`), `window.__app.xrResultsHud`. The Enter button keeps the id `#xr-enter-vr` in both modes (`data-xr-mode` says which). Pure logic (flags, session init, framebuffer monitor, recenter / pivot / facing math, pinch, chrome layout, AR keep/hide, rig calibration) is covered by `tests/unit/xr.test.js` in `npm run test:unit`.

Headless Chromium has no XR device: a browser-level check needs a mocked `navigator.xr` (session, `XRWebGLLayer`, frames with a viewer pose) and a resolving `makeXRCompatible`, since the real one rejects without a device.

## Acceptance (manual)

- [ ] Quest or emulator: hand pinch grabs a die, throw, engine totals in world space
- [ ] `?ar`: table aligns to a hit-tested surface; exit restores the desktop camera
- [ ] World-space initiative visible while presenting; DOM strip hidden
- [ ] Without `?xr` / `?ar`, desktop WebGPU/WebGL path unchanged
- [ ] `?debug-perf`: `xr … fb` line reflects `QUALITY_PROFILES.xr`; slow sessions step the next one down

## Open follow-ups

- WebGPU + WebXR once three's `XRManager` accepts a WebGPU backend (`?xr-webgpu` is the hook).
- `XRView.requestViewportScale` (dynamic resolution within a session) — three does not use it yet; the monitor only changes the next session.
- A hand-mesh model (three's `XRHandModelFactory` fetches profile meshes from a CDN, so only fingertip markers are drawn today).
