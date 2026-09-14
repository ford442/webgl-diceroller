/**
 * Shared vite dev/preview server harness for tests/ and scripts/.
 *
 * Two things every harness in this repo needs and kept re-implementing subtly
 * differently:
 *
 * 1. **Bind explicitly to 127.0.0.1.** `vite`/`vite preview` with no `--host`
 *    binds to whatever `localhost` resolves to on the box. On GitHub-hosted
 *    runners that is `[::1]`, so a probe against `http://127.0.0.1:PORT` can
 *    never connect and the job dies before its test ever runs. Passing
 *    `--host 127.0.0.1` and probing the same literal makes it deterministic
 *    everywhere.
 *
 * 2. **Kill the whole process group.** Spawning through `npx` gives you an
 *    `npx -> sh -> node -> esbuild` chain; `proc.kill()` reaps only the head
 *    and the surviving grandchildren keep the harness's event loop alive
 *    forever (this is what burned two 6-hour CI jobs per run). We spawn the
 *    local vite binary directly, `detached`, and signal the negative pid.
 *
 * CommonJS on purpose: `tests/*.js` are CJS (like `tests/helpers/browser.js`)
 * and the ESM `scripts/*.mjs` can still `import { startDev } from '...js'`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

/** Literal every harness must bind to and probe. See note 1 above. */
const HOST = '127.0.0.1';

/** Port `npm run preview` (and the CI shared-preview job) uses. */
const PREVIEW_PORT = 4173;

/**
 * Base URL for harnesses that talk to an externally started preview server
 * (the `verify-tests` CI job). Override with DICE_BASE_URL to point a test at
 * an already-running server on another port.
 */
const BASE = process.env.DICE_BASE_URL || `http://${HOST}:${PREVIEW_PORT}`;

/** `${BASE}` joined with a root-relative path or query string. */
function url(pathOrQuery = '/') {
    if (!pathOrQuery) return BASE;
    return `${BASE}${pathOrQuery.startsWith('/') ? '' : '/'}${pathOrQuery}`;
}

const VITE_BIN = path.resolve(__dirname, '../../node_modules/.bin/vite');

async function probe(base, timeoutMs) {
    try {
        const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Boot a vite server bound to 127.0.0.1 and resolve once it answers.
 *
 * @param {object} [options]
 * @param {'dev' | 'preview'} [options.mode]  `vite` vs `vite preview`.
 * @param {number} [options.port]
 * @param {number} [options.readyTimeoutMs]   Total wait for the first 2xx.
 * @param {boolean} [options.verbose]         Pipe server stdout/stderr through.
 * @returns {Promise<{
 *   base: string,
 *   port: number,
 *   url: (pathOrQuery?: string) => string,
 *   close: () => Promise<void>,
 * }>}
 */
async function startServer({
    mode = 'dev',
    port = mode === 'preview' ? PREVIEW_PORT : 5173,
    readyTimeoutMs = 60000,
    verbose = false,
} = {}) {
    const base = `http://${HOST}:${port}`;
    const args = [
        ...(mode === 'preview' ? ['preview'] : []),
        '--host',
        HOST,
        '--port',
        String(port),
        '--strictPort',
    ];

    const proc = spawn(VITE_BIN, args, {
        cwd: path.resolve(__dirname, '../..'),
        // Own process group so close() can reap vite's esbuild children too.
        detached: true,
        stdio: ['ignore', verbose ? 'inherit' : 'ignore', verbose ? 'inherit' : 'pipe'],
        env: { ...process.env, BROWSER: 'none' },
    });

    let exited = false;
    proc.on('exit', () => {
        exited = true;
    });

    const close = async () => {
        if (exited || proc.pid == null) return;
        try {
            process.kill(-proc.pid, 'SIGTERM');
        } catch {
            /* already gone */
        }
        // Give it a beat to unwind, then insist.
        for (let i = 0; i < 20 && !exited; i++) {
            await new Promise((r) => setTimeout(r, 100));
        }
        if (!exited) {
            try {
                process.kill(-proc.pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
        }
    };

    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
        if (exited) {
            throw new Error(`vite ${mode} on ${base} exited before becoming ready`);
        }
        if (await probe(base, 2000)) {
            return {
                base,
                port,
                url: (p = '/') => `${base}${p.startsWith('/') ? '' : '/'}${p}`,
                close,
            };
        }
        await new Promise((r) => setTimeout(r, 250));
    }

    await close();
    throw new Error(`vite ${mode} did not answer on ${base} within ${readyTimeoutMs} ms`);
}

/** `vite` dev server on `port` (default 5173), bound to 127.0.0.1. */
function startDev(options = {}) {
    return startServer({ ...options, mode: 'dev' });
}

/** `vite preview` on `port` (default 4173), bound to 127.0.0.1. */
function startPreview(options = {}) {
    return startServer({ ...options, mode: 'preview' });
}

module.exports = { HOST, PREVIEW_PORT, BASE, url, startServer, startDev, startPreview };
