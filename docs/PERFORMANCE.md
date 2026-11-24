# Performance: budgets, soak, device baselines

Release 4/5 (#383, tracked under #378). What is measured, what the gates are, and
where the numbers still have to be filled in by someone with the hardware.

> **Status of the numbers.** Everything under "Measured" below was taken in a
> headless, software-rendered container with **no Emscripten and therefore no
> WASM physics**: bundle sizes and cache behaviour are real; frame times with
> dice, the 200-roll soak and every row of the device table are **not recorded
> yet**. They are marked as such rather than estimated.

## Gates

| Gate                                         | Where                        | Limit                                                                                                                               |
| -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Per-chunk gzip                               | `npm run check:bundle-size`  | `index` 175 kB, `three` 240 kB, `three.webgpu` 190 kB, LTC 104 kB, `MultiplayerRoom` 8 kB, `GameTable` 5.5 kB, `RenderStats` 3.5 kB |
| Eager JS gzip (what every session downloads) | same                         | 430 kB                                                                                                                              |
| All chunks gzip                              | same                         | 750 kB                                                                                                                              |
| `dist/` raw bytes                            | `npm run check:deploy-size`  | 8.5 MiB (full build measures 7.78 MiB)                                                                                              |
| Main-thread task before `ready`              | `npm run verify:boot-budget` | 2 s (report-only on SwiftShader; see ARCHITECTURE.md, Boot budget)                                                                  |
| Growth over 200 rolls of 20 dice             | `npm run verify:perf-soak`   | see "Soak" below                                                                                                                    |

## Measured: bundle (this change)

`index` is the entry chunk. Before is the tree at the start of #383 (budget had been
raised to 190 kB for #380); after is this branch, with the error boundary included
(about 3 kB gzip of `index`). gzip bytes from `check-bundle-size`; `index` has
2,650 B (1.5%) of headroom under its 175,000 B gate.

| Chunk                             |  Before |   After | Note                                                                     |
| --------------------------------- | ------: | ------: | ------------------------------------------------------------------------ |
| `index`                           | 182,194 | 172,350 | room stack, Farkle session and debug HUD moved out; error boundary added |
| `three`                           | 235,460 | 235,460 | unchanged                                                                |
| `three.webgpu` (lazy)             | 185,475 | 185,475 | unchanged                                                                |
| `RectAreaLightTexturesLib` (lazy) | 101,077 | 101,077 | unchanged                                                                |
| `MultiplayerRoom` (lazy, new)     |       - |   7,346 | only with a signaling URL                                                |
| `GameTable` (lazy, new)           |       - |   4,941 | first "Play Farkle"                                                      |
| `RenderStats` (lazy, new)         |       - |   2,670 | `?debug`                                                                 |
| **Eager total**                   | 429,203 | 419,359 | −9,844 B                                                                 |
| **All chunks**                    | 730,639 | 735,751 | +5,112 B: the new lazy chunks and the error boundary                     |

`dist/` of a **full build** (Emscripten 3.1.61, SIMD + scalar profiles): 8,161,736 B =
7.78 MiB (was 8.05 MiB without WASM at the start of #383; 7.37 MiB without WASM now).
The drop is the asm.js Draco decoder (719 kB), an unreferenced lamp texture, a `.url`
shortcut and the dev-only WASM test page moved out of `public/`. Each profile is a
~175 kB `.wasm` plus a 55 kB loader. The PWA precache is now 72 entries / 5,752 KiB (it was
44 entries / 4,210 KiB without WASM, and 56 / 3,971 KiB with WASM before this change):
the KTX2 textures and the lamp/dice GLBs moved into it so the first visit works offline
(see DEPLOYMENT.md). It downloads once, in the background, after the page is already drawing.

Fallback JPGs stay: they are the documented path when KTX2 decoding fails (~2.1 MB,
quality 80, never precached, requested only on failure).

## Soak: `npm run verify:perf-soak`

`scripts/verify-perf-soak.mjs` plays 200 rolls of a 20-die set (3 d4, 4 d6, 3 d8,
3 d10, 3 d12, 4 d20) on a production build after 5 warm-up rolls, swapping to a
second 20-die set every 10 rolls so `updateDiceSet` teardown is exercised, and
samples (after two forced GCs) at the same point every 20 rolls:

- JS heap (`performance.memory.usedJSHeapSize`, `--enable-precise-memory-info`)
- `renderer.info.memory.geometries` / `.textures` and `renderer.info.programs.length`
  (programs: WebGL only; the WebGPU renderer does not report them)
- scene object count and die-mesh count
- audio: `activeVoices` and the worklet engine counters (`started`, `dropped`,
  `stolen`, `peakActive`)
- frame intervals (a `requestAnimationFrame` sampler, independent of the app)
  for every roll: p50 / p95 / p99 overall and for the first versus last 20 rolls

It fails (exit 1) when:

| Check                                                     | Rule                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Heap                                                      | last-quarter median − first-quarter median > **15 MB** and an upward least-squares trend (`--heap-tolerance-mb`) |
| Geometries, textures, programs, scene objects, die meshes | any growth (tolerance 0) with an upward trend                                                                    |
| Frame time                                                | last-window p95 > **1.35×** the first-window p95 (`--max-p95-ratio`)                                             |
| Audio                                                     | more than 4 voices still active 2.5 s after the table settled, or `peakActive` above `maxVoices`                 |
| Rolls                                                     | any roll hits the 12 s settle timeout                                                                            |
| Errors                                                    | the error boundary recorded a new failure, or a console error appeared                                           |
| Absolute target (optional)                                | p95 above `--target-p95-ms` for the device being tested                                                          |

Exit 2 means it could not run (no WASM in the build). `--report-only` records
without failing; `--url <https://…/dice-roller/>` soaks a deployed build.
The analysis (`scripts/lib/soakAnalysis.mjs`) is unit-tested (`tests/unit/soakAnalysis.test.ts`)
so the pass/fail rules are checked even where the soak itself cannot run.
`report.json` (default `soak/`) holds the samples, the verdicts, the boot-trace
summary and the environment.

Run results are recorded in `docs/release/383-state-of-the-app.md`.

## Targets per device class (proposed, to be confirmed by the table below)

| Class                      | `ready` (cold, cached repeat) | Idle fps | 20-die roll p95 frame | Quality profile expected |
| -------------------------- | ----------------------------- | -------- | --------------------- | ------------------------ |
| Desktop, discrete GPU      | ≤ 4 s, ≤ 2 s                  | 60       | ≤ 20 ms               | `desktop`                |
| Integrated GPU laptop      | ≤ 6 s, ≤ 3 s                  | ≥ 45     | ≤ 33 ms               | `desktop` → step-down    |
| Mid-range Android (Chrome) | ≤ 10 s, ≤ 5 s                 | ≥ 30     | ≤ 50 ms               | `mobile`                 |
| iPhone (Safari)            | ≤ 10 s, ≤ 5 s                 | ≥ 30     | ≤ 50 ms               | `mobile`                 |

If a class misses its target, lower it **in the table below with the reason**
(do not widen a gate to make a run pass).

## Device baselines (to record)

Not recorded: no physical devices were available to the session that wrote this.
Fill one row per run; keep the raw JSON next to it (`docs/perf/<device>.json`).

| Device (model, OS, browser, build SHA) | Renderer / profile | `ready` cold | `ready` warm | Idle fps | 20-die p50 / p95 / p99 (ms) | Heap start → end | Date |
| -------------------------------------- | ------------------ | -----------: | -----------: | -------: | --------------------------- | ---------------- | ---- |
| Desktop GPU — _not recorded_           |                    |              |              |          |                             |                  |      |
| Integrated GPU — _not recorded_        |                    |              |              |          |                             |                  |      |
| Mid-range Android — _not recorded_     |                    |              |              |          |                             |                  |      |
| iPhone Safari — _not recorded_         |                    |              |              |          |                             |                  |      |

**Desktop / laptop:** `npm run verify:perf-soak -- --url <live url> --viewport 1920x1080 --query "test&debug-perf" --out soak/<device>`
with the machine's real GPU (drop `--use-angle=swiftshader` by running
Chrome yourself, or remove it from `CHROMIUM_ARGS` in the script for the run).

**Phone, no desktop tooling.** Open `<url>?test&debug-perf` (the HUD shows fps,
frame ms, draws and the renderer; `window.__app.bootTrace()` is the boot
breakdown). Attach a remote inspector (Chrome `chrome://inspect` for Android,
Safari → Develop for iPhone) and paste:

```js
// 20-die roll: frame intervals + boot summary, printed as JSON to copy into the table.
(async () => {
    const app = window.__app;
    for (const t of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
        const i = document.getElementById(`dice-count-${t}`);
        i.value = { d4: 3, d6: 4, d8: 3, d10: 3, d12: 3, d20: 4 }[t];
        i.dispatchEvent(new Event('change'));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const dts = [];
    let last = performance.now();
    let on = true;
    const tick = (t) => {
        dts.push(t - last);
        last = t;
        if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const n = app.getRollState().settledCount;
    app.replayRoll(12345);
    while (app.getRollState().settledCount <= n) await new Promise((r) => setTimeout(r, 100));
    on = false;
    dts.sort((a, b) => a - b);
    const q = (p) => dts[Math.min(dts.length - 1, Math.floor((p / 100) * dts.length))];
    const trace = app.bootTrace();
    console.log(
        JSON.stringify({
            ua: navigator.userAgent,
            renderer: app.rendererType,
            profile: app.qualityProfile,
            build: app.buildInfo?.shortCommit,
            frames: dts.length,
            p50: q(50),
            p95: q(95),
            p99: q(99),
            ready: trace.ready,
            heapMB: performance.memory && performance.memory.usedJSHeapSize / 1048576,
        })
    );
})();
```

## Worker physics without `crossOriginIsolated`

Without COOP/COEP the worker backend falls back to copy-out snapshots instead of the
SharedArrayBuffer fast path. The cost in frame time on the live host has **not been
measured**; `npm run verify:production-isolation -- <url>` reports whether a host is
isolated, and the soak's `report.json` records `crossOriginIsolated` beside its frame
times, so running it once against an isolated and once against a non-isolated URL gives
the number.
