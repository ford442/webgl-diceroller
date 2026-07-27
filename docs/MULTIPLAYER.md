# Multiplayer (deterministic replay MVP)

Two-to-six players share a table code. The **host** is the sole roll authority and broadcasts `{seed, notation|diceCounts, appearance}`; guests run the same WASM seeded throw locally. No transform streaming.

## Quick start (local)

```bash
# Terminal 1 — signaling Worker
cd signaling
npm install
npx wrangler dev --port 8787

# Terminal 2 — app (point at the Worker)
cd ..
VITE_SIGNALING_URL=http://127.0.0.1:8787 npm run dev
```

Open two browsers:

1. Host: **Create table** in the multiplayer panel → copy invite URL (`?room=CODE`).
2. Guest: open the invite URL (or paste the code and **Join**).
3. Host rolls `3d6+2` (notation) or **Roll All** — guest should settle to the same face values.

Requires WASM on both clients (`npm run build:wasm` / artifacts in `public/wasm/`). Guests without WASM see an error and will not apply remote rolls (ammo would diverge).

Override signaling at runtime with `?signal=http://127.0.0.1:8787` (useful without rebuilding).

## Deploy signaling

```bash
cd signaling
npm install
npx wrangler deploy
```

Set the production app build env:

```bash
VITE_SIGNALING_URL=https://<your-worker>.workers.dev npm run build:js
```

Rooms are **in-memory** on a single Worker isolate. Fine for demos; multi-isolate production should move room state into a Durable Object (follow-up).

## Protocol (DataChannel JSON)

`PROTOCOL_VERSION = 1` ([`src/net/Protocol.js`](../src/net/Protocol.js)):

| type | direction | purpose |
| ---- | --------- | ------- |
| `hello` / `welcome` | both | identity + version |
| `table-sync` | host → guest | dice counts, presence, optional `lastRoll` |
| `roll` | host → guests | `seed`, optional `notation`, `diceCounts`, `presence`, `throwAt` |
| `presence` | host → guests | `buildDicePresencePayload` fields |
| `ping` / `pong` | both | liveness |

Signaling Worker only relays SDP/ICE (`signal`) and peer join/leave — never game payloads.

## COOP / COEP

The Vite app serves:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

so SharedArrayBuffer / worker physics stay available ([`vite.config.js`](../vite.config.js)).

Implications:

- Do **not** load third-party signaling **scripts** unless they send `Cross-Origin-Resource-Policy: cross-origin`.
- Fetch / WebSocket to the Worker is fine (not an embedded cross-origin resource).
- Multiplayer itself does **not** require SAB; the postMessage worker path is enough. Isolation headers remain for physics performance.
- Production static hosts must send the same COOP/COEP headers (see `verify:pwa-isolation`).

## Fairness (v1)

Host entropy only (`generateRollSeed`). Commit-reveal seeds are a future upgrade.

Cup pours (`seed == null`) are not broadcast. Guests cannot roll (UI hint: “Only the host can roll”).

## Manual checklist

- [ ] Two browsers: host rolls `3d6+2`, guest settle values match
- [ ] Host changes dice appearance → guest applies presence
- [ ] Kill guest network briefly → status shows reconnecting → sync resumes without crashing the frame loop
- [ ] `?room=CODE` auto-joins when `VITE_SIGNALING_URL` (or `?signal=`) is set
- [ ] Without signaling URL, multiplayer panel is absent; single-player unchanged

## Code map

| Path | Role |
| ---- | ---- |
| [`signaling/`](../signaling/) | Cloudflare Worker |
| [`src/net/Protocol.js`](../src/net/Protocol.js) | Message codec |
| [`src/net/SignalingClient.js`](../src/net/SignalingClient.js) | HTTP/WS to Worker |
| [`src/net/PeerMesh.js`](../src/net/PeerMesh.js) | Star WebRTC + DataChannels |
| [`src/net/RoomSession.js`](../src/net/RoomSession.js) | Host/guest session |
| [`src/ui/MultiplayerPanel.js`](../src/ui/MultiplayerPanel.js) | Create / join UI |
