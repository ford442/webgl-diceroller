#!/usr/bin/env python3
"""
deploy.py — upload dist/ to a staging or production site through the Contabo
storage manager (https://storage.noahcohn.com).

Usage:
  npm run build                      # full build incl. WASM (see docs/DEPLOYMENT.md)
  export DEPLOY_TOKEN=...            # required; never stored in this file
  python deploy.py --target staging
  python deploy.py --target production --confirm-production

  --target / DEPLOY_TARGET   staging (default) | production
  --force                    upload every file, skipping the content-hash diff
  --dry-run                  print what would upload and exit
  --no-verify                skip the post-deploy header + build-info check

Environments (see TARGETS): staging is the `test` site, https://test.1ink.us/dice-roller/.
Production needs DEPLOY_PRODUCTION_SITE (the storage manager's site name) set
in the environment, plus --confirm-production; there is no baked-in default,
so a mistyped target cannot reach it.

What gets uploaded:
  * dist/ is hashed (sha256). The previous deploy's deploy-manifest.json is read
    back from the live site; a file is skipped only when its size matches the
    remote copy AND its hash matches the manifest. Size alone is never trusted.
  * index.html, sw.js, registerSW.js, manifest.webmanifest, build-info.json and
    workbox-*.js are ALWAYS uploaded: they are what makes a deploy a deploy, and
    a stale or mismatched one breaks the service worker.
  * After upload, build-info.json is read back from the live URL and its commit
    must equal dist/build-info.json's, and the COOP / COEP / CORP headers must
    be present. A mismatch exits non-zero.

Requirements:
  pip install requests
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Dict, Optional

PROJECT_NAME: str = "dice-roller"
BUILD_DIR: str = "dist"
CONTABO_BASE_URL: str = "https://storage.noahcohn.com"
DEPLOY_FOLDER: str = ""  # override remote target folder; empty = use PROJECT_NAME

MANIFEST_NAME = "deploy-manifest.json"

# Files uploaded on every deploy regardless of the diff.
ALWAYS_UPLOAD_NAMES = {
    "index.html",
    "sw.js",
    "registerSW.js",
    "manifest.webmanifest",
    "build-info.json",
    MANIFEST_NAME,
}
ALWAYS_UPLOAD_PATTERNS = (re.compile(r"^workbox-[^/]+\.js$"),)

REQUIRED_HEADERS = {
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
}
# Reported, but only a warning: CORP matters for sub-resources other origins embed.
RECOMMENDED_HEADERS = {"cross-origin-resource-policy": "same-origin"}


def target_config(name: str, env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Resolve a --target to {site, url}. Raises SystemExit on a missing setting."""
    env = os.environ if env is None else env
    if name == "staging":
        return {
            "site": env.get("DEPLOY_STAGING_SITE", "test"),
            "url": env.get("DEPLOY_STAGING_URL", "https://test.1ink.us/dice-roller/"),
        }
    if name == "production":
        site = env.get("DEPLOY_PRODUCTION_SITE", "")
        if not site:
            raise SystemExit(
                "ERROR: production deploys need DEPLOY_PRODUCTION_SITE (the storage "
                "manager's site name) in the environment."
            )
        return {
            "site": site,
            "url": env.get("DEPLOY_PRODUCTION_URL", "https://go.1ink.us/dice-roller/"),
        }
    raise SystemExit(f"ERROR: unknown --target {name!r} (use staging or production).")


def require_token(env: Optional[Dict[str, str]] = None) -> str:
    """The deploy token comes from DEPLOY_TOKEN only. Fail loudly when unset."""
    env = os.environ if env is None else env
    token = (env.get("DEPLOY_TOKEN") or "").strip()
    if not token:
        raise SystemExit(
            "ERROR: DEPLOY_TOKEN is not set. Export it (it is not stored in this repo):\n"
            "  export DEPLOY_TOKEN=<token from the storage manager's environment>"
        )
    return token


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_always_upload(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if "/" not in rel and (name in ALWAYS_UPLOAD_NAMES or any(p.match(name) for p in ALWAYS_UPLOAD_PATTERNS)):
        return True
    return False


def local_files(build_path: Path) -> Dict[str, Path]:
    out: Dict[str, Path] = {}
    for file in sorted(build_path.rglob("*")):
        if file.is_dir():
            continue
        rel = file.relative_to(build_path)
        if any(p in (".git", "node_modules", "__pycache__") for p in rel.parts):
            continue
        out[str(rel).replace("\\", "/")] = file
    return out


def select_uploads(
    files: Dict[str, Path],
    remote_sizes: Dict[str, int],
    remote_hashes: Dict[str, str],
    force: bool = False,
):
    """Return ({rel: sha256} for every local file, [rel to upload], [rel skipped])."""
    hashes = {rel: sha256_file(path) for rel, path in files.items()}
    upload, skipped = [], []
    for rel, path in files.items():
        unchanged = (
            not force
            and not is_always_upload(rel)
            and remote_sizes.get(rel) == path.stat().st_size
            and remote_hashes.get(rel) == hashes[rel]
        )
        (skipped if unchanged else upload).append(rel)
    return hashes, upload, skipped


def build_zip(files: Dict[str, Path], upload, manifest_bytes: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in upload:
            if rel == MANIFEST_NAME:
                continue
            zf.write(files[rel], rel)
        zf.writestr(MANIFEST_NAME, manifest_bytes)
    return buf.getvalue()


def read_build_info(build_path: Path) -> dict:
    path = build_path / "build-info.json"
    if not path.is_file():
        raise SystemExit(
            f"ERROR: {path} is missing. Build with `npm run build` (vite emits build-info.json)."
        )
    return json.loads(path.read_text())


# ----------------------------------------------------------------------------
# Network
# ----------------------------------------------------------------------------


def _requests():
    try:
        import requests  # noqa: WPS433
    except ImportError:
        raise SystemExit("ERROR: `pip install requests` first.")
    return requests


def fetch_remote_sizes(token: str, site: str, target_folder: str) -> Dict[str, int]:
    requests = _requests()
    url = f"{CONTABO_BASE_URL.rstrip('/')}/api/deploy/{PROJECT_NAME}/sizes"
    params = {"target_site": site}
    if target_folder:
        params["target_folder"] = target_folder
    try:
        response = requests.get(url, params=params, headers={"X-Deploy-Token": token}, timeout=60)
    except Exception as exc:
        print(f"  ! Could not fetch remote sizes ({exc}); uploading all files")
        return {}
    if response.status_code == 200:
        files = response.json().get("files") or {}
        print(f"Remote size map: {len(files)} file(s)")
        return {str(k).replace("\\", "/"): int(v) for k, v in files.items()}
    if response.status_code in (401, 403):
        raise SystemExit(f"ERROR: the storage manager rejected DEPLOY_TOKEN (HTTP {response.status_code}).")
    print(f"  ! sizes HTTP {response.status_code}; uploading all files")
    return {}


def fetch_remote_manifest(site_url: str) -> Dict[str, str]:
    requests = _requests()
    try:
        response = requests.get(
            site_url.rstrip("/") + "/" + MANIFEST_NAME,
            headers={"Cache-Control": "no-cache"},
            timeout=30,
        )
        if response.status_code == 200:
            return {str(k): str(v) for k, v in (response.json().get("files") or {}).items()}
    except Exception:
        pass
    print("  (no previous deploy-manifest.json on the site: uploading everything)")
    return {}


def upload_bundle(token: str, site: str, target_folder: str, zip_bytes: bytes) -> bool:
    requests = _requests()
    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder, "target_site": site},
            headers={"X-Deploy-Token": token},
            timeout=300,
        )
    except Exception as exc:
        print(f"  ✗ Upload exception: {exc}")
        return False
    if response.status_code != 200:
        print(f"  ✗ {response.status_code}: {response.text[:400]}")
        return False
    data = response.json()
    print(f"  ✓ {data.get('uploaded', 0)} files uploaded")
    for f in data.get("failed") or []:
        print(f"    ✗ {f['path']}: {f['error']}")
    return not data.get("failed")


def verify_live(site_url: str, expected_commit: str, retries: int = 6) -> bool:
    """Read build-info.json and the isolation headers back from the live URL."""
    requests = _requests()
    base = site_url.rstrip("/") + "/"
    ok = True

    live = None
    for attempt in range(retries):
        try:
            r = requests.get(base + f"build-info.json?cb={int(time.time())}", headers={"Cache-Control": "no-cache"}, timeout=30)
            if r.status_code == 200:
                live = r.json()
                if live.get("commit") == expected_commit:
                    break
        except Exception as exc:
            print(f"  ! build-info.json fetch failed ({exc})")
        time.sleep(2 * (attempt + 1))
    if live is None:
        print("  ✗ live build-info.json could not be read")
        ok = False
    elif live.get("commit") != expected_commit:
        print(f"  ✗ live commit {live.get('commit')} != deployed {expected_commit}")
        ok = False
    else:
        print(f"  ✓ live build-info.json: commit {live['commit']} ({live.get('buildTime')})")

    try:
        head = requests.head(base, allow_redirects=True, timeout=30)
        headers = {k.lower(): v.strip().lower() for k, v in head.headers.items()}
    except Exception as exc:
        print(f"  ✗ HEAD {base} failed ({exc})")
        return False
    for name, want in REQUIRED_HEADERS.items():
        got = headers.get(name)
        if got == want:
            print(f"  ✓ {name}: {got}")
        else:
            print(f"  ✗ {name}: {got!r} (want {want}). See docs/DEPLOYMENT.md for host config.")
            ok = False
    for name, want in RECOMMENDED_HEADERS.items():
        got = headers.get(name)
        print(f"  {'✓' if got == want else '!'} {name}: {got!r} (recommended {want})")
    return ok


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Deploy dist/ to staging or production.")
    parser.add_argument("--target", default=os.environ.get("DEPLOY_TARGET", "staging"))
    parser.add_argument("--confirm-production", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args(argv)

    token = require_token()
    cfg = target_config(args.target)
    if args.target == "production" and not args.confirm_production:
        raise SystemExit("ERROR: pass --confirm-production to deploy to production.")

    build_path = Path(BUILD_DIR)
    if not build_path.is_dir():
        raise SystemExit(f"ERROR: build directory '{BUILD_DIR}/' does not exist; run `npm run build`.")
    info = read_build_info(build_path)
    target_folder = DEPLOY_FOLDER or PROJECT_NAME

    print(f"\n=== Deploying '{PROJECT_NAME}' -> {args.target} ({cfg['site']}, {cfg['url']}) ===")
    print(
        f"    build: commit {info['commit']} (short {info.get('shortCommit')}), "
        f"v{info.get('version')}, built {info.get('buildTime')}"
        + ("  [DIRTY WORKING TREE]" if info.get("dirty") else "")
    )
    if info.get("dirty") and args.target == "production":
        raise SystemExit("ERROR: refusing to deploy a build from a dirty working tree to production.")

    files = local_files(build_path)
    remote_sizes = {} if args.force else fetch_remote_sizes(token, cfg["site"], target_folder)
    remote_hashes = {} if args.force else fetch_remote_manifest(cfg["url"])
    hashes, upload, skipped = select_uploads(files, remote_sizes, remote_hashes, args.force)
    for rel in upload:
        print(f"  + {rel}")
    print(f"{len(upload)} to upload, {len(skipped)} unchanged (size and sha256 match)")

    manifest = json.dumps({"commit": info["commit"], "files": hashes}, indent=2, sort_keys=True).encode()
    zip_bytes = build_zip(files, upload, manifest)
    print(f"Archive size: {len(zip_bytes) / 1024:.1f} KB")
    if args.dry_run:
        print("--dry-run: nothing uploaded.")
        return 0

    print("Uploading bundle...")
    if not upload_bundle(token, cfg["site"], target_folder, zip_bytes):
        print("\n=== Deployment finished with errors ===")
        return 1

    if not args.no_verify:
        print("Verifying live site...")
        if not verify_live(cfg["url"], info["commit"]):
            print("\n=== Uploaded, but live verification FAILED ===")
            return 2
    print(f"\n=== Deployment complete: {cfg['url']} @ {info['commit']} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
