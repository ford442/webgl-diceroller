/**
 * Resolve a public/ asset path against Vite's `base` so deployments in
 * subdirectories (e.g. test.1ink.us/dice-roller/) load correctly.
 *
 * @param relativePath Path relative to public/, e.g. "wasm/dice_physics.js"
 * @returns Absolute URL suitable for fetch/import/loaders
 */
export function publicAssetUrl(relativePath: string): string {
    const base = import.meta.env?.BASE_URL ?? './';
    const locationHref =
        typeof self !== 'undefined' && self.location?.href ? self.location.href : undefined;
    return resolvePublicAssetUrl(relativePath, base, locationHref);
}

/**
 * Pure resolver for tests and `publicAssetUrl`.
 *
 * Path-absolute bases (`/dice-roller/`) join against the page origin so a missing
 * trailing slash on the document URL cannot drop assets to the host root.
 * Relative bases (`./`) treat a last path segment without `.` as a directory.
 */
export function resolvePublicAssetUrl(
    relativePath: string,
    base = './',
    locationHref?: string
): string {
    const normalized = relativePath.replace(/^\//, '');
    const viteBase = base || './';
    const resolvedBase = resolveViteBase(viteBase, locationHref);
    return new URL(normalized, resolvedBase).href;
}

function resolveViteBase(viteBase: string, locationHref?: string): string {
    const dirBase = viteBase.endsWith('/') ? viteBase : `${viteBase}/`;

    if (dirBase.startsWith('/') && !dirBase.startsWith('//')) {
        if (locationHref) {
            return new URL(dirBase, new URL(locationHref).origin).href;
        }
        return dirBase;
    }

    if (locationHref) {
        return new URL(dirBase, directoryHref(locationHref)).href;
    }

    return dirBase;
}

/**
 * Directory URL for relative BASE_URL resolution.
 * `/dice-roller` (no slash, no file extension) is a folder, not a file.
 */
function directoryHref(locationHref: string): string {
    const url = new URL(locationHref);
    const path = url.pathname;
    const last = path.split('/').pop() ?? '';
    if (path && !path.endsWith('/') && !last.includes('.')) {
        url.pathname = `${path}/`;
    } else if (path && !path.endsWith('/') && last.includes('.')) {
        url.pathname = path.replace(/\/[^/]+$/, '/');
    }
    url.search = '';
    url.hash = '';
    return url.href;
}
