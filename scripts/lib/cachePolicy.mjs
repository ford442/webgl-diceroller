/**
 * The cache policy per path class (docs/DEPLOYMENT.md, "Cache policy"), as data
 * plus a pure checker, so `verify-cache-headers.mjs` and its unit test agree.
 */

const YEAR = 31536000;

/** Parse a `Cache-Control` value into `{ directives: Set, maxAge, sMaxAge }`. */
export function parseCacheControl(value) {
    const directives = new Set();
    let maxAge = null;
    let swr = null;
    for (const part of String(value ?? '')
        .toLowerCase()
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)) {
        const [name, arg] = part.split('=');
        directives.add(name);
        if (name === 'max-age') maxAge = Number(arg);
        if (name === 'stale-while-revalidate') swr = Number(arg);
    }
    return { directives, maxAge, swr };
}

/** True when a cache must ask the origin before reusing the response. */
function revalidates(cc) {
    return (
        cc.directives.has('no-cache') ||
        cc.directives.has('no-store') ||
        cc.maxAge === 0 ||
        cc.directives.has('must-revalidate')
    );
}

/**
 * Each class: how to recognise a path, and what its Cache-Control must satisfy.
 * `check(cc)` returns an error string, or null when the header is acceptable.
 */
export const CACHE_CLASSES = [
    {
        id: 'shell',
        label: 'HTML + service-worker shell (must always revalidate)',
        match: (p) =>
            p === '' ||
            p === '/' ||
            /(^|\/)(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(p) ||
            /(^|\/)workbox-[^/]+\.js$/.test(p),
        expect: 'no-cache (or no-store / max-age=0)',
        check(cc) {
            if (cc.directives.has('no-cache') || cc.directives.has('no-store')) return null;
            if (cc.maxAge === 0) return null;
            return 'a stale copy of this file pins visitors (and their service worker) to an old deploy';
        },
    },
    {
        id: 'build-info',
        label: 'build-info.json (read to learn which commit is live)',
        match: (p) => /(^|\/)build-info\.json$/.test(p),
        expect: 'no-cache or no-store',
        check(cc) {
            return cc.directives.has('no-cache') || cc.directives.has('no-store') || cc.maxAge === 0
                ? null
                : 'a cached copy reports the previous deploy';
        },
    },
    {
        id: 'hashed',
        label: 'content-hashed bundles under assets/ (never change)',
        match: (p) => /(^|\/)assets\/.+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|png|svg)$/.test(p),
        expect: `public, max-age>=${YEAR}, immutable`,
        check(cc) {
            if (!cc.directives.has('immutable')) return 'missing `immutable`';
            if (cc.maxAge == null || cc.maxAge < YEAR) return `max-age ${cc.maxAge} < ${YEAR}`;
            return null;
        },
    },
    {
        id: 'wasm',
        label: 'physics WASM + loader (un-hashed; tied to the build)',
        match: (p) => /(^|\/)wasm(-scalar)?\//.test(p),
        expect: 'no-cache (revalidate; a 304 is cheap)',
        check(cc) {
            return revalidates(cc) && !cc.directives.has('immutable')
                ? null
                : 'a stale engine next to a new bundle fails the solver-build check';
        },
    },
    {
        id: 'static',
        label: 'un-hashed textures, models, decoders (rarely change)',
        match: (p) => /(^|\/)(images|draco|basis)\//.test(p),
        expect: 'public with max-age (not immutable: these names are not hashed)',
        check(cc) {
            if (cc.directives.has('immutable'))
                return '`immutable` on an un-hashed name never updates';
            if (
                !cc.directives.has('no-cache') &&
                !cc.directives.has('no-store') &&
                cc.maxAge == null
            ) {
                return 'no max-age: heuristic caching decides';
            }
            return null;
        },
    },
];

/** Which class a URL path (relative to the app base) belongs to, or null. */
export function classify(path) {
    return CACHE_CLASSES.find((c) => c.match(path)) ?? null;
}

/** `application/wasm` is required for streaming compile; a wrong type falls back to a slow path or fails. */
export function wasmTypeError(contentType) {
    return /^application\/wasm\b/i.test(String(contentType ?? ''))
        ? null
        : `content-type is ${JSON.stringify(contentType)}, expected application/wasm`;
}
