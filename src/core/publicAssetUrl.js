/**
 * Resolve a public/ asset path against Vite's `base` so deployments in
 * subdirectories (e.g. test.1ink.us/dice-roller/) load correctly.
 *
 * @param {string} relativePath - Path relative to public/, e.g. "wasm/dice_physics.js"
 * @returns {string} Absolute or base-relative URL suitable for fetch/import
 */
export function publicAssetUrl(relativePath) {
    const normalized = relativePath.replace(/^\//, '');
    const base = import.meta.env?.BASE_URL ?? './';
    // Relative bases (e.g. "./") are invalid for `new URL()` on their own; resolve
    // against the current page/worker script URL so module workers can fetch assets.
    const resolvedBase = (typeof self !== 'undefined' && self.location?.href)
        ? new URL(base, self.location.href).href
        : base;
    return new URL(normalized, resolvedBase).href;
}
