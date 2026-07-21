# Render regression baselines

Checked-in golden frames for the CI `render-regression` job.

| File | Query profile | Enforcement |
|------|---------------|-------------|
| `render-regression-webgl-nopost.png` | `?webgl&no-post&fair-dice&layout-seed=4242&pr=1` | **Required** — CI fails on missing file or pixel delta |
| `render-regression-webgl.png` | `?webgl&fair-dice&layout-seed=4242&pr=1` | **Required** — catches bloom / vignette / material shifts |
| `render-regression-webgpu.png` | `?webgpu&…` (optional) | Soft-fail until CI GPUs capture WebGPU reliably |

Capture freezes the frame scheduler (hides dice / particles, disables candle
flicker systems), strips DOM UI, stops the animation loop, then grabs a CDP
screenshot so SwiftShader runs stay within the pixel-diff budget.

## Regenerate baselines

From the repo root (needs Playwright Chromium + `npm ci`):

```bash
# Capture + write required baselines into this directory
UPDATE_BASELINES=1 npm run verify:render-regression

# Or capture only, then promote:
node scripts/render-regression.mjs --update-baselines
node scripts/compare-render-baseline.mjs
```

Optional WebGPU baseline (not required for CI green):

```bash
UPDATE_BASELINES=1 node scripts/render-regression.mjs --update-baselines --include-webgpu-baseline
```

Commit the updated PNGs in the same PR as intentional visual changes. Diff
threshold defaults live in `scripts/compare-render-baseline.mjs`
(`DIFF_THRESHOLD` / `TOLERANCE`).
