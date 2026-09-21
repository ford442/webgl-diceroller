#!/usr/bin/env bash
# emsdk-flag-experiment.sh — Measure which of the flags emcc_flags.inc.sh
# currently disables can be re-enabled, on whatever EMSDK is active.
#
# Background: emcc_flags.inc.sh documents four omissions, all justified against
# EMSDK 3.1.61 and Embind + EXPORT_ES6 glue:
#     --closure 1      link-time JS minification of the glue
#     -s STRICT=1      drops deprecated/unsupported runtime shims
#     -fno-rtti        Embind's type registry needed RTTI on 3.1.61
#     -fno-exceptions  Embind error paths can throw
# "Re-evaluate when upgrading EMSDK" is only actionable if someone actually
# measures it, which is what this does. It never touches the shipped build:
# every variant links into a scratch directory, and emcc_flags.inc.sh is read,
# never modified.
#
# A variant PASSES only if it links AND loads AND produces the same physics as
# the baseline. Compiling is not evidence -- closure in particular mangles
# Embind glue in ways that only surface at load time.
#
# Usage (from repo root, with an EMSDK active):
#   bash scripts/emsdk-flag-experiment.sh
#   DICE_EXPERIMENT_VARIANTS="baseline closure" bash scripts/emsdk-flag-experiment.sh
#
# Output: a markdown table on stdout, and appended to $GITHUB_STEP_SUMMARY when
# running in Actions. Always exits 0 -- a failing variant is the *result*, not
# an error.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_DIR="${REPO_ROOT}/src/wasm"

if ! command -v em++ >/dev/null 2>&1 && [ -f /root/emsdk/emsdk_env.sh ]; then
    # shellcheck source=/dev/null
    source /root/emsdk/emsdk_env.sh
fi
if ! command -v em++ >/dev/null 2>&1; then
    echo "FAIL: em++ not on PATH (and no /root/emsdk). This experiment needs an EMSDK." >&2
    exit 1
fi

# shellcheck source=../src/wasm/emcc_flags.inc.sh
source "${WASM_DIR}/emcc_flags.inc.sh"

ENGINE_SOURCES=()
while IFS= read -r rel; do
    [[ -z "${rel}" || "${rel}" == \#* ]] && continue
    ENGINE_SOURCES+=("${WASM_DIR}/${rel}")
done < "${WASM_DIR}/engine_sources.txt"

# name -> extra flags. Keep "baseline" first: it is the control every other
# variant's physics fingerprint is compared against.
declare -A VARIANT_FLAGS=(
    [baseline]=""
    [strict]="-sSTRICT=1"
    [closure]="--closure 1"
    [no-rtti]="-fno-rtti"
    [all]="-sSTRICT=1 --closure 1 -fno-rtti"
)
VARIANTS=(${DICE_EXPERIMENT_VARIANTS:-baseline strict closure no-rtti all})

EMSDK_FULL="$(em++ --version 2>/dev/null | head -n1)"
EMSDK_SEMVER="$(echo "${EMSDK_FULL}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "${SCRATCH}"' EXIT

echo "[emsdk-experiment] emcc: ${EMSDK_FULL}"
echo "[emsdk-experiment] variants: ${VARIANTS[*]}"
echo ""

BASELINE_FINGERPRINT=""
ROWS=()
NOTES=()

for variant in "${VARIANTS[@]}"; do
    extra="${VARIANT_FLAGS[${variant}]:-__missing__}"
    if [[ "${extra}" == "__missing__" ]]; then
        echo "[emsdk-experiment] unknown variant '${variant}' — skipping." >&2
        continue
    fi

    out_dir="${SCRATCH}/${variant}"
    mkdir -p "${out_dir}"
    log="${SCRATCH}/${variant}.log"

    emcc_build_flags release
    read -r -a extra_arr <<< "${extra}"

    printf '[emsdk-experiment] %-9s linking ... ' "${variant}"
    if ! em++ "${WASM_DIR}/dice_physics.cpp" "${ENGINE_SOURCES[@]}" \
            "${EMCC_FLAGS[@]}" "${extra_arr[@]}" \
            -o "${out_dir}/dice_physics.js" >"${log}" 2>&1; then
        echo "LINK FAILED"
        ROWS+=("| \`${variant}\` | ${extra:-—} | ❌ link error | — | — | — |")
        NOTES+=("### \`${variant}\` — link error"$'\n\n```\n'"$(tail -n 25 "${log}")"$'\n```\n')
        continue
    fi

    js_bytes="$(wc -c < "${out_dir}/dice_physics.js" | tr -d ' ')"
    wasm_bytes="$(wc -c < "${out_dir}/dice_physics.wasm" | tr -d ' ')"

    printf 'ok, probing ... '
    if ! fingerprint="$(node "${SCRIPT_DIR}/emsdk-variant-probe.mjs" "${out_dir}" 2>"${log}.probe")"; then
        echo "LOAD/RUN FAILED"
        ROWS+=("| \`${variant}\` | ${extra:-—} | ❌ runtime error | ${js_bytes} | ${wasm_bytes} | — |")
        NOTES+=("### \`${variant}\` — links, but fails at load/run"$'\n\n```\n'"$(tail -n 25 "${log}.probe")"$'\n```\n')
        continue
    fi

    if [[ "${variant}" == "baseline" ]]; then
        BASELINE_FINGERPRINT="${fingerprint}"
        echo "ok (control)"
        ROWS+=("| \`${variant}\` | — | ✅ control | ${js_bytes} | ${wasm_bytes} | baseline |")
        continue
    fi

    if [[ -z "${BASELINE_FINGERPRINT}" ]]; then
        echo "ok (no control to compare)"
        ROWS+=("| \`${variant}\` | ${extra} | ✅ runs | ${js_bytes} | ${wasm_bytes} | not compared |")
    elif [[ "${fingerprint}" == "${BASELINE_FINGERPRINT}" ]]; then
        echo "ok, physics identical"
        ROWS+=("| \`${variant}\` | ${extra} | ✅ pass | ${js_bytes} | ${wasm_bytes} | identical |")
    else
        echo "RUNS BUT PHYSICS DIVERGED"
        ROWS+=("| \`${variant}\` | ${extra} | ⚠️ diverged | ${js_bytes} | ${wasm_bytes} | **differs** |")
        NOTES+=("### \`${variant}\` — runs, but changes physics output"$'\n\n'"Replay determinism is the whole point of the IEEE-754 flag policy, so this is a blocker, not a nit."$'\n\n```\nbaseline: '"${BASELINE_FINGERPRINT:0:120}"$'...\nvariant : '"${fingerprint:0:120}"$'...\n```\n')
    fi
done

SUMMARY="$(
    echo "## EMSDK flag experiment"
    echo ""
    echo "- emcc: \`${EMSDK_FULL}\`"
    echo "- CI pin (\`EMSDK_VERSION\` in ci.yml): see workflow; this run used \`${EMSDK_SEMVER}\`"
    echo "- Baseline = today's \`emcc_flags.inc.sh\` release profile, unmodified."
    echo ""
    echo "| variant | extra flags | result | glue JS bytes | wasm bytes | physics vs baseline |"
    echo "| --- | --- | --- | ---: | ---: | --- |"
    printf '%s\n' "${ROWS[@]}"
    echo ""
    if [[ ${#NOTES[@]} -gt 0 ]]; then
        echo "## Failures"
        echo ""
        printf '%s\n' "${NOTES[@]}"
    else
        echo "_No failures._"
    fi
    echo ""
    echo "A variant only passes if it links, loads, and reproduces the baseline's"
    echo "serialize fingerprint. Record the outcome in \`docs/WASM_ENGINE.md\` next to"
    echo "the flag-omission rationale before changing \`emcc_flags.inc.sh\`."
)"

echo ""
echo "${SUMMARY}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "${SUMMARY}" >> "${GITHUB_STEP_SUMMARY}"
fi
