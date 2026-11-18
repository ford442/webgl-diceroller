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

### Commit-reveal fairness (protocol v2, the default)

Every room speaks protocol v2 (`PROTOCOL_VERSION = 2`): commit-reveal instead of broadcasting the raw seed. There is no flag — `?fair-commit` used to opt in and is now ignored.

1. Host publishes `commit { hash: sha256(seed ‖ nonce ‖ source [‖ \0ids=slots]), notation, dieCount, ids? }`.
2. Guests ack (`commit-ack`).
3. Host publishes `reveal { seed, nonce, source, ids? }`.
4. Every client verifies the hash via Web Crypto, then runs `seededPhysicsThrow`.
5. Face values come **only** from the WASM engine buffer (`getDieFaceValue`).

The roll's `source` (throw vs tower drop) and, for a partial throw, its table
slots are part of the preimage: the same seed lands differently through the
tower or over a subset, so a commitment that left either out would let a host
choose after the acks. A whole-table throw adds no slot bytes, so its hash is
what it was before slots were bound.

On the host, the commitment goes out on `AppEvent.ROLL_COMMITTED` and the roll
then starts **once** on `ROLL_STARTED`, carrying the reveal
(`RollWiring.broadcastFairCommit`). Outside a room, or on a guest, nothing is
committed and the roll starts straight away.

**Soak (2026-11-17).** `?fair-commit` never actually soaked: the room
defaulted to v1 and compared _every_ join against it, so a v2 host was turned
away from the room it had just created (`protocol_version_mismatch`), and a
solo `?fair-commit` page never emitted `ROLL_STARTED`. Both are fixed in the
change that made v2 the default. The soak since then is
`npm run test:multiplayer-commit-reveal`: two headless Chromium clients
(SwiftShader, WASM worker physics) in one room on a local `wrangler dev`
Worker. A whole-table throw and a partial throw (one die held in the jail) both
settled the same faces on host and guest in two consecutive runs (different
seeds), and a client that
announces v1 was refused with `protocol_version_mismatch`. That harness also
found that `R` with a die in the jail was announced as a whole-table throw (on
v1 as well), so a guest threw the held die too. `R` now names the dice it moves
(`heldThrowSubset`). The harness is not in CI: the runners have no signaling
Worker.

**Every roll path awaits its own commit/reveal before a single die moves** —
throws, notation rolls and tower drops alike. Starting the local simulation
first would let a host watch the outcome during the ack window and simply never
send the reveal, re-rolling under a fresh seed; the commit it already published
binds nothing if the roll it describes can be abandoned unseen. Guarded by a
test over `RollWiring.ts` (see `tests/unit/seededHopperDrop.test.ts`).

### What is and is not a seeded roll

| Path                                       | Seed        | On the share URL         | Broadcast to guests   |
| ------------------------------------------ | ----------- | ------------------------ | --------------------- |
| Roll button / `?seed=`                     | host-minted | yes (`v=1`)              | yes                   |
| Partial throw (`R` with a die in the jail) | host-minted | yes (`v=3`, `ids=`)      | yes (slots committed) |
| Notation roll                              | host-minted | yes (`v=1`, `expr=`)     | yes                   |
| **Dice tower drop**                        | host-minted | yes (`v=2`, `src=tower`) | yes                   |
| Dice cup pour                              | `null`      | no                       | no                    |

A **cup pour** is driven by where the player physically waves the cup, which no
seed can reproduce, so it stays local by design.

A **tower drop** is not that: every pose, kick and tumble comes from the engine
PRNG (`seededHopperDrop`, see [`WASM_ENGINE.md`](WASM_ENGINE.md)), so it seeds,
replays and broadcasts exactly like a throw. It used to draw from
`Math.random()` and was silently unreproducible — two loads of the same link,
or a guest in a `?room=`, saw different faces.

## Lockstep live table (#366, in progress)

Today a room shares seeds: a throw is committed, revealed and replayed, and
everything between throws (grabs, cup shakes, the jail) stays local. The
lockstep table shares the table itself. Every peer runs the same simulation
over the same tick-stamped input log. There is no host: the solver is
deterministic, so peers that apply the same inputs at the same ticks hold the
same `serializeState()` bytes.

**Slice 1 (landed, headless only, no app behaviour change):** the core in
`dice-core`.

- [`InputLog.ts`](../packages/dice-core/src/net/InputLog.ts): typed records
  `{ tick, seat, seq, input }`. The input types are `spawn`, `remove`, `grab`,
  `drag`, `release`, `impulse`, `cupScoop`, `cupShake`, `cupPour`, `throw` and
  `towerDrop`.
    - Every peer applies inputs in one total order: `(tick, seat, seq)`. Two
      seats acting on the same tick need no arbitration.
    - `(tick, seat, seq)` names a record. A resend is a `duplicate`; another
      input under the same name is a `conflict` and is ignored.
    - A peer's record is untrusted: `parseTickInput` checks it field by field
      and rebuilds it in one key order. It rejects non-finite or absurd
      numbers (over 1e4), unknown types, a seven-sided die and an oversized
      cup.
- [`applyTableInput.ts`](../packages/dice-core/src/net/applyTableInput.ts):
  the engine calls each input becomes.
    - A `throw` / `towerDrop` is the existing seeded replay
      (`applyReplayThrow`), re-seeded from the record. The RNG is therefore not
      part of the snapshot.
    - A `spawn` takes the shape's preset material and hull.
    - The ids are the engine's own. A spawn's id is fixed by the log order, so
      every peer gets the same one.
- [`RollbackSim.ts`](../packages/dice-core/src/net/RollbackSim.ts): one fixed
  tick (`SIM_FIXED_DT`) at a time. Each tick applies the inputs stamped `t`,
  then runs tick `t`.
    - Every `snapshotEvery` ticks (8) it keeps a `serializeState()` snapshot.
      The ring reaches `maxRollbackTicks` (120 = 1 s) back.
    - A late input rewinds the engine to the newest snapshot at or before its
      tick (`rewindState`, which brings back removed dice and drops
      later-spawned ones). It re-attaches hulls (`getDieSides`) and re-runs the
      log to the present.
    - A batch of late inputs rewinds once, to the earliest of them.
    - An input older than the ring is `tooLate`: the peer needs a resync, not a
      rollback.
    - Collision events reach `onEvents` the first time a tick runs and never
      from a re-simulated tick, so audio does not replay.
- Snapshot format v5 ([`WASM_ENGINE.md`](WASM_ENGINE.md)) carries the
  kinematic flags, materials, next die id and cup walls, so a snapshot is the
  whole table the inputs left.

Tests (`npm run test:core`; the engine ones need `npm run build:wasm`):

- `inputLog.test.ts` covers validation, order, duplicates and conflicts,
  pruning and the engine calls. A `fast-check` property checks that any arrival
  order builds the same log.
- `lockstep.test.ts` uses the three scripted scenarios in
  [`tests/golden/lockstep.json`](../tests/golden/lockstep.json), written by
  `npm run golden:lockstep` (regenerate after a `SOLVER_REVISION` bump, a
  snapshot format change or a re-exported tavern world). The scenarios are:
  throw, then a grab / drag / release of a die and a prop; cup scoop / shake /
  pour; and spawn / remove, jail and tower drop.
    - Each recorded log replays to the golden bytes.
    - `fast-check`: any lateness up to 0.5 s, any arrival order and resends end
      on those bytes.
    - Two peers with random delays end byte-identical.
    - A throw delivered 410 ticks late rewinds across a spawn and two removals.
    - A record older than the window is refused without touching the table.
    - No tick's events are heard twice.

Measured on the tavern world:

- A resting table with no dice snapshots to 361 B; it is about 1.25 KB while
  the props are still settling.
- Each die adds 111 B plus its contacts.
- The scenarios' largest snapshots are 1.8–2.2 KB, against the issue's
  ~1.5 KB estimate. The ring for a 1 s window at N = 8 is ~16 snapshots,
  about 35 KB.
- Re-simulating costs about 0.5 ms per tick with four or five dice in contact
  (Node, on the development box). A 0.5 s rollback is ~30 ms of worker time, which slice 2
  has to spread over frames or cap.

**Still to do (later slices):**

- `WorkerPhysicsBridge.applyInputs(tick, inputs[])`, with the interaction layer
  (drag, cup, jail, tower) writing inputs instead of calling the engine.
- Per-tick room protocol v3 in the Durable Object, behind `?lockstep`, with a
  late joiner starting from a peer's snapshot (`rewindState`).
- Ownership without a host.
- Visual smoothing of corrected poses.
- Late-joiner UI.
- `verify:lockstep-room`.

v1/v2 rooms are unchanged.

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

The Worker routes each room code to a Durable Object (`RoomDurableObject`). Persisted fields include `protocolVersion`, `solverBuildId` (`{solver_revision}:{sha256(dice_physics.wasm)[0..12]}` from the loaded artifact's `build-info.json` — content-addressed, so identical solver builds match across deploys and a different compiler or SIMD/scalar artifact does not), dice counts, `lastRoll`, optional layout seed, and session snapshot.

`worldHash` (the `hashWorld` of the collider world the page built) is sent beside `solverBuildId` at join and persisted on the room. The host refreshes it with each `room-state` push (a layout re-roll changes the table), and a guest whose own hash differs is turned away with `world_hash_mismatch` — same engine is not enough for a seeded replay; the guest must also have built the host's table. A client that sends no hash, or a room that recorded none, is admitted.

Rebuild-required UX: any behavioural solver change bumps `SOLVER_REVISION` in `dice_contacts.hpp` (and therefore `solver_revision` in `build-info.json`). Clients send that identity at join; a guest on an older WASM build is rejected with `solver_build_mismatch` until they load a matching `npm run build:wasm` artifact. That is the intended safety net for seeded replay — do not work around it by clearing the room id.

### Solver revision history

| Revision | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11       | One canonical solve order. Warm start, the velocity iterations and the position pass all walk the manifolds sorted on the full key (rank, `idA`, kind, `idB`, aux). Previously the velocity pass sorted on (rank, `idA`) alone with an unstable `std::sort`, so equal-keyed manifolds (one die against two others) were ordered however the standard library broke ties, and warm start / position walked `manifolds_` in creation order. The dynamic×dynamic walker visits each pair once (it revisited a pair from every neighbouring cell both bodies covered, re-committing the manifold and compounding `WARM_START_FACTOR`), and a static plane no longer rewrites its manifold's `aux` after the lookup, which cost it its warm start every substep and could alias an open cylinder's radial plane. The solve order is now a function of body ids alone. Golden hashes regenerated; all 50 `rolls.json` vectors keep their faces (one settles two steps later). |
| 10       | Tavern-world settle fixes (#341): SAT per-vertex exit separation, face axes preferred over edge axes with normal hysteresis, speculative contacts that allow approach up to `sep/dt`, edge-edge contact on the smaller hull's support, no post-solve centre-of-mass velocity projection, die/dynamic pairs no longer resetting each other's sleep timer, open cylinders solid from outside. Golden hashes regenerated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 9        | One physics clock. `step(dt)` now banks `dt` and runs fixed 1/120 s ticks of 4 substeps (at most 8 per call) instead of splitting whatever `dt` it is handed into 4, so the worker, `?no-worker` and `rollHeadless()` integrate identically (previously the in-process path ran 1/240 s substeps against the worker's 1/480). The pipping centre-of-mass bias moved into the engine: derived from each die's value-1 face normal and applied every substep, instead of a render-thread `applyTorqueImpulse` scaled by the frame delta (which also woke every die every frame). Golden hashes regenerated. `build.sh` also now records the real `solver_revision` in `build-info.json` — it previously matched a comment and always wrote `0`, so `solverBuildId` only ever distinguished builds by git sha.                                                                                                                                                             |
| 8        | Swept (continuous) die-vs-static contacts. A substep whose linear motion exceeds `CCD_MOTION_FRACTION` of the body's inscribed-sphere proxy is now swept against static boxes/hulls and clipped at first touch before `generateContacts` runs, instead of being handed to the discrete SAT pass as two poses that may straddle a collider. Golden hashes are unchanged (neither fixture scenario reaches the gate), and at the app's fixed 1/60 step nothing that previously blocked now behaves differently — but a caller stepping at a large `dt` gets a different (correct) trajectory where it previously tunnelled, so a guest on a pre-sweep build must be rejected rather than left to diverge. See "Swept contacts" in [`WASM_ENGINE.md`](WASM_ENGINE.md).                                                                                                                                                                                                     |
| 7        | `BodyView::applyInvInertiaWorld` (the sequential-impulse solver's hot path, called up to ~3x per contact point per velocity iteration) now multiplies by a `Mat3` precomputed once per `BodyView` instead of doing two quaternion rotates on every call. Mathematically equivalent (verified against the old formula across 5000 random rotations/vectors in a dedicated doctest), but a different floating-point operation order — golden hashes moved even though no scenario's _physical_ outcome should differ meaningfully. `RigidBody`/`DynamicBody`'s own `applyInvInertiaWorld` (used only by `applyTorqueImpulse`, not a hot loop) is unchanged.                                                                                                                                                                                                                                                                                                               |
| 6        | die×dynamic and dynamic×dynamic contact pairs moved off brute force onto the die uniform grid (`forEachDieDynamicPair`, `forEachDynamicPair`); `MAX_DYNAMICS` raised 64 → 256. Brute force previously ran unconditionally for these pairs regardless of the (die-only) broadphase toggle, in a fixed nested-loop order; production now visits them in grid-cell order instead. A sequential-impulse solver is iteration-order-sensitive, so any scene with dynamic props and more than one simultaneous new contact can settle into a measurably different (still physically valid) trajectory than before. Golden hashes are unaffected (neither fixture scenario uses dynamics).                                                                                                                                                                                                                                                                                      |
| 5        | `seedRNG` bound directly as `uint64_t` via Embind (`-s WASM_BIGINT=1`) instead of a `uint32_t` shim that silently truncated (`seed >>> 0`) every seed crossing the JS↔WASM boundary. The RNG algorithm and native engine (already `uint64_t`-seeded) are unchanged, so golden _hashes_ are unchanged — only how far a seed's bits survive the trip into WASM. Bumped so a guest still on a pre-WASM_BIGINT build (which would silently re-truncate a wide seed) gets `solver_build_mismatch` instead of quietly diverging. See "Seed width" below.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4        | `WARM_START_FACTOR` enabled (0.0 → 0.85): manifold points now carry forward 85% of the prior substep's accumulated normal/friction impulse instead of solving cold every substep. Settle time and stack behaviour changed; goldens regenerated (`tests/fixtures/solver-golden.json`, `solver_tests.cpp`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3        | Solver v2: persistent contact manifolds, islands, speculative contacts (pre-dates this table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Seed width (`seedRNG`)

`seedRNG` takes a `uint64_t` on the native/WASM engine side (`-s WASM_BIGINT=1`; the Embind binding no longer narrows to `uint32_t`). The public `seedPhysicsRNG()`/worker bridge entry points still accept a JS `number`; `seedUtil.ts`'s `toRngSeedBigInt()` widens it losslessly to a `BigInt` right before the WASM call — the `seed >>> 0` truncation that used to happen at (or before) the WASM boundary is gone. The commit-reveal wire format (`CommitReveal.ts`) and `RoomSession`/`Protocol.ts` seed field are unchanged for this revision (still a 32-bit `number`): widening what multiplayer peers negotiate as "the seed" is a protocol-version change, not a solver-engine one, and is tracked separately.

## Protocol (DataChannel JSON)

Wire version: `PROTOCOL_VERSION = 2` ([`src/net/Protocol.ts`](../src/net/Protocol.ts)). `decodeMessage` still reads v1 for one release, only so a v1 peer that reaches a channel gets an `error` it displays (see Mismatch errors); remove `PROTOCOL_VERSION_V1` from `SUPPORTED_PROTOCOL_VERSIONS` after that.

| type                               | direction     | purpose                                                     |
| ---------------------------------- | ------------- | ----------------------------------------------------------- |
| `hello` / `welcome`                | both          | identity, `protocolVersion`, `solverBuildId`, `worldHash`   |
| `table-sync`                       | host → guest  | dice counts, presence, optional `lastRoll`                  |
| `roll`                             | host → guests | v1 only: cleartext `seed` — a v2 guest ignores it           |
| `commit` / `commit-ack` / `reveal` | host ↔ guests | commit-reveal (see above); `reveal` carries `source`, `ids` |
| `session-sync`                     | host → guests | initiative seats, current actor, last expression            |
| `presence`                         | host → guests | `buildDicePresencePayload` fields                           |
| `ping` / `pong`                    | both          | liveness                                                    |
| `error`                            | both          | `commit_mismatch`, version/build mismatch                   |

`source` on `roll` / `reveal` (and on the persisted `lastRoll`) names the
gameplay path: absent or `null` for a throw, `'tower'` for a dice-tower drop.
A guest replays it through its own tower rather than throwing — the same seed
poses dice completely differently through the chute, so a guest that ignored
the field would diverge on every die. It is not a protocol-version bump: a
build that predates the field is already rejected at join on `solverBuildId`,
which moved with `SOLVER_REVISION` in the same change. A guest whose scene has
no tower (low tier) skips the replay with a console warning rather than falling
back to a throw.

`ids` on `roll` (and on the persisted `lastRoll`) names the **table slots** a
partial throw moved — a game re-throwing the dice it did not set aside. Absent
means every die, which is what every roll before the field meant, so an ordinary
roll is byte-identical on the wire. A guest throws exactly those slots (after
parking the others in its jail) with the same seed. Slots, not physics ids: the
engine numbers bodies per session. Under commit-reveal the same `ids` ride
`commit` and `reveal` and are bound into the hash, so a guest refuses a reveal
that names a different subset (`commit_mismatch`). A game's own throws
(`source: 'game'`) commit nothing and are not broadcast — games refuse to start
inside a room until a table-game slice sends `{ action, seed, ids }`.

Signaling Worker relays SDP/ICE (`signal`), peer join/leave, and `room-snapshot` on reconnect. Host pushes `room-state` over the signaling WebSocket for DO persistence.

### Mismatch errors

| Error                       | Meaning                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solver_build_mismatch`     | `solver_revision:wasm-hash` differs — rebuild WASM (`npm run build:wasm`) with the same toolchain on all clients                                                                    |
| `world_hash_mismatch`       | The guest's collider-world hash (`hashWorld`, see ARCHITECTURE "Deterministic table") differs from the host's — open the host's link so the layout matches, on the same app version |
| `protocol_version_mismatch` | The guest speaks another protocol version than the room's host — an older app build (v1) in a v2 room, or the reverse. Reload so everyone is on the same build                      |

The room is pinned to its **host's** protocol version (recorded when the host
connects; `null` until then, so a guest can wait in a room nobody has opened).
A host on a newer version moves the room forward and parks any guest still on
the old one. A refused guest gets the reason as an `{ type: 'error', error }`
frame on an accepted socket, which the Worker then leaves parked (no `peerId`,
so it is not a peer): a browser never shows page script the body of a refused
upgrade, and closing the socket would send an older client straight into its
reconnect loop, replacing the reason with "Reconnecting…". Current clients also
read the room's version from `GET /rooms/:code` and refuse before opening a
socket, stop on any refusal without reconnecting, and check `hello.protocolVersion`
on the peer channel (a host answers a mismatched guest with an `error` message
that v1 clients already show as their status).

`solver_build_mismatch` / `world_hash_mismatch` are still a plain 403 on the
upgrade; current guests check both up front from `GET /rooms/:code`.

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

## Fairness

- **v2 (every room):** Commit-reveal with SHA-256 verification before throw; the seed is never on the wire before the dice move.
- **v1 (retired):** Host entropy broadcast in cleartext. A v1 client is refused at join rather than handed a cleartext seed.

Cup pours (`seed == null`) are not broadcast. Guests cannot roll (UI hint: “Only the host can roll”).

## Manual checklist

- [ ] Two browsers: host rolls `3d6+2`, guest settle values match
- [ ] Host changes dice appearance → guest applies presence
- [ ] Kill guest network briefly → status shows reconnecting → sync resumes without crashing the frame loop
- [ ] `?room=CODE` auto-joins when `VITE_SIGNALING_URL` (or `?signal=`) is set
- [ ] Without signaling URL, multiplayer panel is absent; single-player unchanged
- [ ] Restart signaling Worker → refresh host + guest → dice counts + last roll replay from DO
- [x] Commit-reveal roll settles identically on two clients, whole-table and partial (`npm run test:multiplayer-commit-reveal`, needs `npm run signal:dev`)

## Code map

| Path                                                                                          | Role                                    |
| --------------------------------------------------------------------------------------------- | --------------------------------------- |
| [`signaling/`](../signaling/)                                                                 | Cloudflare Worker + `RoomDurableObject` |
| [`src/net/Protocol.ts`](../src/net/Protocol.ts)                                               | Message codec                           |
| [`packages/dice-core/src/net/CommitReveal.ts`](../packages/dice-core/src/net/CommitReveal.ts) | SHA-256 commit-reveal                   |
| [`packages/dice-core/src/net/InputLog.ts`](../packages/dice-core/src/net/InputLog.ts)         | Lockstep input records + order          |
| [`packages/dice-core/src/net/RollbackSim.ts`](../packages/dice-core/src/net/RollbackSim.ts)   | Snapshot ring + rollback                |
| [`src/net/SignalingClient.ts`](../src/net/SignalingClient.ts)                                 | HTTP/WS to Worker                       |
| [`src/net/PeerMesh.js`](../src/net/PeerMesh.js)                                               | Star WebRTC + DataChannels              |
| [`src/net/RoomSession.ts`](../src/net/RoomSession.ts)                                         | Host/guest session                      |
| [`src/session/SessionState.ts`](../src/session/SessionState.ts)                               | Initiative / turn snapshot              |
| [`src/app/SessionWiring.js`](../src/app/SessionWiring.js)                                     | Session strip + `AppEvents`             |
| [`src/ui/MultiplayerPanel.js`](../src/ui/MultiplayerPanel.js)                                 | Create / join UI                        |
| [`src/ui/SessionStrip.js`](../src/ui/SessionStrip.js)                                         | Desktop turn strip                      |
