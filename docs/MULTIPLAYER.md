# Multiplayer (deterministic replay MVP)

Two-to-six players share a table code. The **host** is the roll authority. Guests run the same WASM seeded throw locally. No transform streaming.

Rooms are backed by a **Cloudflare Durable Object** per code — table state survives Worker isolate sleep; signaling uses **hibernating WebSockets**.

## Quick start (local)

```bash
# Terminal 1 — signaling Worker (Durable Objects)
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

Requires WASM on both clients (`npm run build:wasm` / artifacts in `public/wasm/`). Guests without WASM see an error and will not apply remote rolls — there is no fallback engine to diverge on any more.

Override signaling at runtime with `?signal=http://127.0.0.1:8787` (useful without rebuilding).

### Commit-reveal fairness (`?fair-commit`)

Protocol v2 (`PROTOCOL_VERSION = 2`) uses commit-reveal instead of broadcasting the raw seed:

1. Host publishes `commit { hash: sha256(seed ‖ nonce), notation, dieCount }`.
2. Guests ack (`commit-ack`).
3. Host publishes `reveal { seed, nonce }`.
4. Every client verifies the hash via Web Crypto, then runs `seededPhysicsThrow`.
5. Face values come **only** from the WASM engine buffer (`getDieFaceValue`).

Add `?fair-commit` to the URL until v2 is the default. Cup pours (`seed == null`) stay local and are not broadcast.

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

The Worker routes each room code to a Durable Object (`RoomDurableObject`). Persisted fields include `protocolVersion`, `solverBuildId` (`{solver_revision}:{git_sha}` from `public/wasm/build-info.json`), dice counts, `lastRoll`, optional layout seed, and session snapshot.

Rebuild-required UX: any behavioural solver change bumps `SOLVER_REVISION` in `dice_contacts.hpp` (and therefore `solver_revision` in `build-info.json`). Clients send that identity at join; a guest on an older WASM build is rejected with `solver_build_mismatch` until they load a matching `npm run build:wasm` artifact. That is the intended safety net for seeded replay — do not work around it by clearing the room id.

### Solver revision history

| Revision | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7        | `BodyView::applyInvInertiaWorld` (the sequential-impulse solver's hot path, called up to ~3x per contact point per velocity iteration) now multiplies by a `Mat3` precomputed once per `BodyView` instead of doing two quaternion rotates on every call. Mathematically equivalent (verified against the old formula across 5000 random rotations/vectors in a dedicated doctest), but a different floating-point operation order — golden hashes moved even though no scenario's _physical_ outcome should differ meaningfully. `RigidBody`/`DynamicBody`'s own `applyInvInertiaWorld` (used only by `applyTorqueImpulse`, not a hot loop) is unchanged.                          |
| 6        | die×dynamic and dynamic×dynamic contact pairs moved off brute force onto the die uniform grid (`forEachDieDynamicPair`, `forEachDynamicPair`); `MAX_DYNAMICS` raised 64 → 256. Brute force previously ran unconditionally for these pairs regardless of the (die-only) broadphase toggle, in a fixed nested-loop order; production now visits them in grid-cell order instead. A sequential-impulse solver is iteration-order-sensitive, so any scene with dynamic props and more than one simultaneous new contact can settle into a measurably different (still physically valid) trajectory than before. Golden hashes are unaffected (neither fixture scenario uses dynamics). |
| 5        | `seedRNG` bound directly as `uint64_t` via Embind (`-s WASM_BIGINT=1`) instead of a `uint32_t` shim that silently truncated (`seed >>> 0`) every seed crossing the JS↔WASM boundary. The RNG algorithm and native engine (already `uint64_t`-seeded) are unchanged, so golden _hashes_ are unchanged — only how far a seed's bits survive the trip into WASM. Bumped so a guest still on a pre-WASM_BIGINT build (which would silently re-truncate a wide seed) gets `solver_build_mismatch` instead of quietly diverging. See "Seed width" below.                                                                                                                                 |
| 4        | `WARM_START_FACTOR` enabled (0.0 → 0.85): manifold points now carry forward 85% of the prior substep's accumulated normal/friction impulse instead of solving cold every substep. Settle time and stack behaviour changed; goldens regenerated (`tests/fixtures/solver-golden.json`, `solver_tests.cpp`).                                                                                                                                                                                                                                                                                                                                                                          |
| 3        | Solver v2: persistent contact manifolds, islands, speculative contacts (pre-dates this table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Seed width (`seedRNG`)

`seedRNG` takes a `uint64_t` on the native/WASM engine side (`-s WASM_BIGINT=1`; the Embind binding no longer narrows to `uint32_t`). The public `seedPhysicsRNG()`/worker bridge entry points still accept a JS `number`; `seedUtil.ts`'s `toRngSeedBigInt()` widens it losslessly to a `BigInt` right before the WASM call — the `seed >>> 0` truncation that used to happen at (or before) the WASM boundary is gone. The commit-reveal wire format (`CommitReveal.ts`) and `RoomSession`/`Protocol.ts` seed field are unchanged for this revision (still a 32-bit `number`): widening what multiplayer peers negotiate as "the seed" is a protocol-version change, not a solver-engine one, and is tracked separately.

## Protocol (DataChannel JSON)

Default wire version: `PROTOCOL_VERSION = 1` ([`src/net/Protocol.ts`](src/net/Protocol.ts)). With `?fair-commit`, clients negotiate v2.

| type                               | direction     | purpose                                          |
| ---------------------------------- | ------------- | ------------------------------------------------ |
| `hello` / `welcome`                | both          | identity, `protocolVersion`, `solverBuildId`     |
| `table-sync`                       | host → guest  | dice counts, presence, optional `lastRoll`       |
| `roll`                             | host → guests | v1: cleartext `seed`, notation, diceCounts       |
| `commit` / `commit-ack` / `reveal` | host ↔ guests | v2 commit-reveal (see above)                     |
| `session-sync`                     | host → guests | initiative seats, current actor, last expression |
| `presence`                         | host → guests | `buildDicePresencePayload` fields                |
| `ping` / `pong`                    | both          | liveness                                         |
| `error`                            | both          | `commit_mismatch`, version/build mismatch        |

Signaling Worker relays SDP/ICE (`signal`), peer join/leave, and `room-snapshot` on reconnect. Host pushes `room-state` over the signaling WebSocket for DO persistence.

### Mismatch errors

| Error                       | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `solver_build_mismatch`     | `solver_revision:git_sha` differs — rebuild WASM (`npm run build:wasm`) on all clients |
| `protocol_version_mismatch` | Mixed v1/v2 or different app builds                                                    |

## COOP / COEP

The Vite app serves:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

so SharedArrayBuffer / worker physics stay available ([`vite.config.js`](vite.config.js)).

Implications:

- Do **not** load third-party signaling **scripts** unless they send `Cross-Origin-Resource-Policy: cross-origin`.
- Fetch / WebSocket to the Worker is fine (not an embedded cross-origin resource).
- Multiplayer itself does **not** require SAB; the postMessage worker path is enough. Isolation headers remain for physics performance.
- Production static hosts must send the same COOP/COEP headers (see `verify:pwa-isolation`).

## Fairness

- **v1:** Host entropy (`generateRollSeed`) broadcast in cleartext — fine for friends.
- **v2 (`?fair-commit`):** Commit-reveal with SHA-256 verification before throw.

Cup pours (`seed == null`) are not broadcast. Guests cannot roll (UI hint: “Only the host can roll”).

## Manual checklist

- [ ] Two browsers: host rolls `3d6+2`, guest settle values match
- [ ] Host changes dice appearance → guest applies presence
- [ ] Kill guest network briefly → status shows reconnecting → sync resumes without crashing the frame loop
- [ ] `?room=CODE` auto-joins when `VITE_SIGNALING_URL` (or `?signal=`) is set
- [ ] Without signaling URL, multiplayer panel is absent; single-player unchanged
- [ ] Restart signaling Worker → refresh host + guest → dice counts + last roll replay from DO
- [ ] `?fair-commit`: commit-reveal roll settles identically on two clients

## Code map

| Path                                                         | Role                                    |
| ------------------------------------------------------------ | --------------------------------------- |
| [`signaling/`](signaling/)                                   | Cloudflare Worker + `RoomDurableObject` |
| [`src/net/Protocol.ts`](src/net/Protocol.ts)                 | Message codec                           |
| [`src/net/CommitReveal.ts`](src/net/CommitReveal.ts)         | SHA-256 commit-reveal                   |
| [`src/net/SignalingClient.ts`](src/net/SignalingClient.ts)   | HTTP/WS to Worker                       |
| [`src/net/PeerMesh.js`](src/net/PeerMesh.js)                 | Star WebRTC + DataChannels              |
| [`src/net/RoomSession.js`](src/net/RoomSession.js)           | Host/guest session                      |
| [`src/session/SessionState.ts`](src/session/SessionState.ts) | Initiative / turn snapshot              |
| [`src/app/SessionWiring.js`](src/app/SessionWiring.js)       | Session strip + `AppEvents`             |
| [`src/ui/MultiplayerPanel.js`](src/ui/MultiplayerPanel.js)   | Create / join UI                        |
| [`src/ui/SessionStrip.js`](src/ui/SessionStrip.js)           | Desktop turn strip                      |
