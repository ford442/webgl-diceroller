# WebXR seated-table spike

Immersive VR entry for the tavern dice table. This is an experimental spike: **WebGL only**, seated play, controller grab via the WASM kinematic path.

## Flags

| Flag | Effect |
|------|--------|
| `?xr` | Enable XR path: force **WebGL**, imply **no-post**, show Enter VR when `immersive-vr` is supported |
| `?xr-emulator` | Alias of `?xr` (handy for Chrome WebXR emulator bookmarks) |
| `?xr-snap=45` | Snap-turn degrees (clamped 15–90, default 45) |

Canonical URL:

```
https://host/path/?xr
```

`?webgl&no-post` remain valid for non-XR debugging; `?xr` implies both.

## Requirements

- **Renderer:** `THREE.WebGLRenderer` with `renderer.xr`. WebGPU + WebXR is deferred.
- **Physics:** Default WASM path (`driveDieWasmTransform` / `setDieWasmKinematic`). Prefer a build with `public/wasm/` present; `?ammo-drag` is not used for XR grab.
- **COOP/COEP:** Already applied by Vite (`same-origin` / `require-corp`) for SharedArrayBuffer worker physics. Quest Browser generally accepts this; if session start fails, check the browser console for isolation errors.

## How to try it

### Chrome WebXR emulator

1. Install the [WebXR API Emulator](https://chromewebstore.google.com/detail/webxr-api-emulator) extension (or Immersive Web Emulator).
2. Run the app: `npm run dev` → open `http://localhost:5173/?xr`.
3. Click **Enter VR**, then use the emulator’s headset/controller panel.
4. Aim a controller ray at a die, **squeeze** or **select** to grab, release to throw.

### Meta Quest Browser

1. Deploy or tunnel a HTTPS origin (Quest requires secure context).
2. Open `https://…/?xr` in Quest Browser.
3. Tap **Enter VR**, grant session permission.
4. Squeeze to grab; thumbstick X snap-turns; face buttons (X/A style) reset seating yaw.

## Seated calibration

The authored scene is **not** meters. [`XrRig.js`](../src/xr/XrRig.js) wraps content in `xrWorld`:

| Constant | Default | Meaning |
|----------|---------|---------|
| `XR_WORLD_SCALE` | `0.05` | Scene unit → meters (table ~1.8 m wide; velvet ~0.8 m) |
| `XR_TABLE_HEIGHT_M` | `0.75` | Table surface height under `local-floor` |
| `XR_SEAT_OFFSET_SCENE` | `1.5` | Extra distance past velvet edge for seating |

Transforms apply **only while presenting**; exiting VR restores identity on the world group.

## Module map

| File | Role |
|------|------|
| [`src/xr/XrFlags.js`](../src/xr/XrFlags.js) | `?xr` / snap parsing |
| [`src/xr/XrSession.js`](../src/xr/XrSession.js) | Session enter/exit, `renderer.xr` |
| [`src/xr/XrRig.js`](../src/xr/XrRig.js) | Scale + seat + snap dolly |
| [`src/xr/XrControllers.js`](../src/xr/XrControllers.js) | Rays, squeeze, snap-turn |
| [`src/xr/XrGrab.js`](../src/xr/XrGrab.js) | Controller → WASM grab |
| [`src/xr/XrUi.js`](../src/xr/XrUi.js) | Enter VR button |
| [`src/interaction/WasmDieGrab.js`](../src/interaction/WasmDieGrab.js) | Shared mouse + XR grab |

## Acceptance (manual)

- [ ] Emulator or Quest: enter session
- [ ] Grab one die, throw, read result (DOM HUD is fine for the spike)
- [ ] Exit session restores desktop controls
- [ ] Without `?xr`, desktop WebGPU/WebGL path unchanged

## Production follow-ups (out of spike scope)

- Hand tracking grab
- World-space result holograms (`ROLL_SETTLED` / `readAllDiceValues`)
- Dedicated AdaptiveQuality `xr` profile
- `immersive-ar` table placement
- WebGPU + WebXR when headset support is reliable
