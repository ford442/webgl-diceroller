# Changelog

All notable changes are recorded here. Versions follow [SemVer](https://semver.org/);
the release procedure is [`docs/RELEASE.md`](docs/RELEASE.md).

## [Unreleased]

## [0.1.0] — first tagged release (pending)

First tagged release of the Three.js + Vite rewrite (release sequence #378).

### Highlights

- WebGPU renderer by default with automatic WebGL fallback (`?webgl` forces it).
- Custom WASM rigid-body solver (SAT polyhedral), worker-hosted, deterministic seeded
  rolls and share links (`seed`, `layout-seed`, `w=` world hash, partial throws `ids=`).
- Tavern and chart-room scenes as scene documents; ~95 procedural props.
- Procedural AudioWorklet audio with room reverb.
- Dice cup, tower, tray and jail; roll theatre crit replay; solo Farkle vs bot.
- Optional multiplayer (protocol v2 commit-reveal) via the `signaling/` Worker.
- Seated WebXR (`?xr`) and AR table placement (`?ar`) — experimental.
- Error boundary, stale-chunk recovery and service-worker update notice.

### Supported browsers

Current Chrome/Edge (WebGPU), Firefox and Safari (WebGL fallback). Cross-origin
isolation (COOP/COEP) is required on the host for the worker-physics fast path.

### Known issues

To be filled from open issues at RC time; each shipped known issue must link a ticket.
