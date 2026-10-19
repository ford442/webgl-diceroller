/** DOM-free accessors so core-engine never names `window` / `document`. */

export function getGlobalLocation(): { href?: string; search?: string } | undefined {
    const g = globalThis as { location?: { href?: string; search?: string } };
    return g.location;
}

export function getSubtleCrypto(): Crypto | undefined {
    const g = globalThis as { crypto?: Crypto };
    return g.crypto;
}
