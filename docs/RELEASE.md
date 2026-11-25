# Release procedure and rollback runbook

How a version is cut, promoted from staging to production, verified live, and rolled
back. Deploy mechanics (token, targets, headers) are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Hosts

| Environment | URL                                                                    | `deploy.py`                                |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| Staging     | `https://test.1ink.us/dice-roller/` (site `test`)                      | `--target staging`                         |
| Production  | `https://go.1ink.us/dice-roller/` (site from `DEPLOY_PRODUCTION_SITE`) | `--target production --confirm-production` |

> The owner must confirm this mapping at the start of each release; if it changes,
> update this table and `DEPLOYMENT.md` together.

## 1. Gate

- `main` is green on CI at the release commit (every required job, or a written
  owner-approved exception per job).
- Prior release-sequence issues are closed with their reports.

## 2. Build the release candidate (once)

From a clean clone at the release commit, with an EMSDK:

```bash
git clone https://github.com/ford442/webgl-diceroller && cd webgl-diceroller
git checkout <release-commit>
rm -rf node_modules dist && npm ci && npm run build && npm run gates && npm run test:unit
npm version X.Y.Z --no-git-tag-version   # only if package.json is not already X.Y.Z (commit it first, then rebuild)
scripts/package-release.sh vX.Y.Z-rc.1   # release/…-dist.zip + .sha256
git tag -a vX.Y.Z-rc.1 -m "vX.Y.Z-rc.1" && git push origin vX.Y.Z-rc.1
```

`dist/build-info.json` must show `dirty: false` and the release commit.
Attach the zip and `.sha256` to a GitHub pre-release for the RC tag.

## 3. Staging

```bash
export DEPLOY_TOKEN=...          # env only
python3 deploy.py --target staging
curl -s "https://test.1ink.us/dice-roller/build-info.json?cb=$(date +%s)"
npm run verify:production-isolation -- https://test.1ink.us/dice-roller/
npm run verify:cache-headers -- https://test.1ink.us/dice-roller/
# smoke: no URL-targeted smoke script exists yet (#381); load the URL with ?test and check __app.ready + console
```

Open the page with a tab already holding the previous release: the "A new version is
ready" notice appears, Reload shows the new SHA, the console has 0 errors.

## 4. Promote the same artifact to production (no rebuild)

```bash
mkdir -p /tmp/rel && cd /tmp/rel
# download the RC zip + .sha256 from the RC GitHub Release, then:
sha256sum -c webgl-diceroller-vX.Y.Z-rc.1-dist.zip.sha256
rm -rf dist && unzip -q webgl-diceroller-vX.Y.Z-rc.1-dist.zip -d dist
# run deploy.py from a checkout of the same commit, pointing at this dist/
python3 deploy.py --target production --confirm-production
```

Then repeat every check in step 3 against `https://go.1ink.us/dice-roller/`, plus
`curl -sI` for COOP/COEP/CORP and screenshots (loaded scene, settled roll, mobile
viewport, `?renderer-info` on WebGPU and `?webgl`).

Finally tag the release on the same commit and publish it:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z" <release-commit> && git push origin vX.Y.Z
```

GitHub Release `vX.Y.Z`: notes from `CHANGELOG.md`, the zip (renamed or re-uploaded,
same SHA-256) and its checksum.

## 5. Signaling

`signaling/` deploys separately (`npm run signal:deploy`). Each release states either
"signaling unchanged — compatible with protocol v2, solverBuildId <id>" or the new
Worker version deployed. A client/server mismatch is refused at join
(`protocol_version_mismatch`, `solverBuildId`, `world_hash_mismatch`), never silently
desynced, so deploy signaling **before** a client that changes protocol or solver.

## 6. Post-release watch

A named owner watches for 24 h (console-error reports, issue tracker) and records an
explicit **go / roll back** decision on the release issue.

## Rollback runbook

Expected time to recovery: ~5 min upload + one page load per client.

```bash
# previous good release's asset from GitHub Releases
sha256sum -c webgl-diceroller-vPREV-dist.zip.sha256
rm -rf dist && unzip -q webgl-diceroller-vPREV-dist.zip -d dist
python3 deploy.py --target production --confirm-production --force
curl -s "https://go.1ink.us/dice-roller/build-info.json?cb=$(date +%s)"   # must equal vPREV's commit
```

`--force` re-uploads everything, since the live `deploy-manifest.json` belongs to the bad
build. Rehearse on staging first each release (deploy vN, roll back to vN-1, check SHA and
the update notice) and record SHAs and elapsed time in the release report.

### Clients holding a bad service worker

The worker is `registerType: 'autoUpdate'` with `skipWaiting` + `clientsClaim` +
`cleanupOutdatedCaches`, and `sw.js` is never long-cached, so any redeploy (forward fix
or rollback) is picked up on the next navigation; open tabs get the "A new version is
ready" notice. A rolled-back build has a different precache manifest, so it installs as
a new worker even though its version is older. If a bad build breaks before the notice
can render, stale-chunk recovery reloads once and then offers **Clear cache & reload**.
Prefer shipping a corrective build as `vX.Y.Z+1` over leaving a rollback in place.
