#!/usr/bin/env bash
# ensure_emsdk.sh — Make `em++` on PATH be the pinned Emscripten, installing it if needed.
#
# Sourced by build.sh and scripts/verify-cmake-wasm-parity.sh. The pin lives in
# src/wasm/EMSDK_VERSION and nowhere else that a human edits: CI's EMSDK_VERSION and
# emsdk-experiment.yml's PINNED_EMSDK_VERSION must equal it (tests/unit/emsdkPin.test.ts).
#
# Why pinned: seeded rolls replay the same physics only if the WASM is built by a
# toolchain the golden traces and native<->WASM parity checks have been run on.
#
# What it does, in order:
#   1. `em++` already on PATH at the pinned version -> nothing to do.
#   2. A repo-local emsdk in <repo>/.emsdk (git-ignored) or the legacy /root/emsdk
#      already has the pinned version activated -> put it first on PATH.
#   3. Otherwise clone emsdk into <repo>/.emsdk, `emsdk install` + `emsdk activate`
#      the pinned version there, and put it first on PATH. Your own emsdk is never
#      touched: only the repo-local copy is installed into or activated.
#
# Environment:
#   EMSDK_AUTO_INSTALL=0     never download; fail with instructions instead (CI sets this)
#   EMSDK_ALLOW_MISMATCH=1   build with whatever em++ is on PATH, with a warning
#                            (used to evaluate a candidate toolchain on purpose)
#
# Needs git, python3 and network access for step 3 only. Requires SCRIPT_DIR to be
# the src/wasm directory and REPO_ROOT the repository root.

emsdk_pinned_version() {
    local v
    v="$(tr -d '[:space:]' <"${SCRIPT_DIR}/EMSDK_VERSION" 2>/dev/null || true)"
    if ! [[ "${v}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "ensure_emsdk: ${SCRIPT_DIR}/EMSDK_VERSION must hold one version like 3.1.61 (got '${v}')" >&2
        return 1
    fi
    printf '%s' "${v}"
}

emsdk_current_version() {
    command -v em++ >/dev/null 2>&1 || return 0
    em++ --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true
}

# Source an emsdk's environment, then make sure its compiler really wins on PATH even
# if another emsdk was activated in this shell first.
emsdk_use_dir() {
    local dir="$1"
    [ -f "${dir}/emsdk_env.sh" ] || return 1
    # emsdk_env.sh is not written for `set -u`, and an EM_CONFIG left by another
    # emsdk would point the pinned compiler at the wrong sysroot.
    unset EM_CONFIG
    set +u
    # shellcheck source=/dev/null
    EMSDK_QUIET=1 source "${dir}/emsdk_env.sh" >/dev/null 2>&1 || true
    set -u
    if [ -d "${dir}/upstream/emscripten" ]; then
        export PATH="${dir}/upstream/emscripten:${PATH}"
    fi
    hash -r
}

ensure_pinned_emsdk() {
    local pin cur local_dir
    pin="$(emsdk_pinned_version)" || return 1
    local_dir="${REPO_ROOT}/.emsdk"
    cur="$(emsdk_current_version)"

    [ "${cur}" = "${pin}" ] && return 0

    # An already-activated pinned emsdk needs no network.
    local d
    for d in "${local_dir}" /root/emsdk; do
        [ -f "${d}/emsdk_env.sh" ] || continue
        (emsdk_use_dir "${d}" && [ "$(emsdk_current_version)" = "${pin}" ]) 2>/dev/null || continue
        emsdk_use_dir "${d}"
        echo "[emsdk] using ${d} (Emscripten ${pin})"
        return 0
    done

    if [ "${EMSDK_ALLOW_MISMATCH:-0}" = "1" ] && [ -n "${cur}" ]; then
        echo "[emsdk] WARNING: building with Emscripten ${cur}, not the pinned ${pin} (EMSDK_ALLOW_MISMATCH=1)." >&2
        echo "[emsdk]          Golden traces and parity checks are only guaranteed on ${pin}." >&2
        return 0
    fi

    if [ "${EMSDK_AUTO_INSTALL:-1}" = "0" ]; then
        _emsdk_fail "${pin}" "${cur}" "automatic install is off (EMSDK_AUTO_INSTALL=0)"
        return 1
    fi

    echo "[emsdk] Emscripten ${pin} is pinned; found '${cur:-none}'. Installing it into ${local_dir} ..."
    local need
    for need in git python3; do
        command -v "${need}" >/dev/null 2>&1 || {
            _emsdk_fail "${pin}" "${cur}" "${need} is required to install emsdk and was not found"
            return 1
        }
    done

    if [ ! -f "${local_dir}/emsdk" ]; then
        git clone --depth 1 https://github.com/emscripten-core/emsdk.git "${local_dir}" || {
            _emsdk_fail "${pin}" "${cur}" "could not clone emsdk (offline?)"
            return 1
        }
    fi
    (cd "${local_dir}" && ./emsdk install "${pin}" && ./emsdk activate "${pin}") || {
        _emsdk_fail "${pin}" "${cur}" "emsdk install/activate ${pin} failed (offline?)"
        return 1
    }
    emsdk_use_dir "${local_dir}"

    cur="$(emsdk_current_version)"
    if [ "${cur}" != "${pin}" ]; then
        _emsdk_fail "${pin}" "${cur}" "installed ${pin} but em++ on PATH still reports '${cur:-none}'"
        return 1
    fi
    echo "[emsdk] Emscripten ${pin} ready ($(command -v em++))"
}

_emsdk_fail() {
    cat >&2 <<MSG
[emsdk] ERROR: this project builds its WASM with Emscripten $1 (src/wasm/EMSDK_VERSION); em++ on PATH is '${2:-none}'.
[emsdk]        Reason: $3
[emsdk]        Fix one of:
[emsdk]          - let the build install it:   unset EMSDK_AUTO_INSTALL (needs git, python3, network)
[emsdk]          - do it by hand:              git clone https://github.com/emscripten-core/emsdk.git .emsdk &&
[emsdk]                                        (cd .emsdk && ./emsdk install $1 && ./emsdk activate $1)
[emsdk]          - build with what you have anyway:  EMSDK_ALLOW_MISMATCH=1 npm run build:wasm
MSG
}
