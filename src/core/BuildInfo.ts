/**
 * Which build is this? `__BUILD_COMMIT__` / `__BUILD_VERSION__` are replaced by
 * Vite's `define` (vite.config.js, resolved from git at build time). Outside a
 * Vite build (vitest, tsx) they are undefined and read as `dev`.
 *
 * The same commit is written to `dist/build-info.json` next to a build time,
 * which is what deploy.py and the post-deploy check read back from the live site.
 */
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_VERSION__: string | undefined;

export interface BuildInfo {
    version: string;
    commit: string;
    shortCommit: string;
}

export function getBuildInfo(): BuildInfo {
    const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev';
    const version = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : '0.0.0-dev';
    return { version, commit, shortCommit: commit.slice(0, 7) };
}

export const BUILD_INFO: BuildInfo = getBuildInfo();
