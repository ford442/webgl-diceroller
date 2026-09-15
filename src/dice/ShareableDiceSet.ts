/**
 * Transport for `DiceSet`: URL token, localStorage, and multiplayer presence.
 *
 * The encoding is base64url over the canonical JSON form, so a set round-trips
 * byte-for-byte and keeps its content hash across every hop. Dependency-free
 * for the same reason as `DiceSetFormat` — this is headless-safe.
 */

import {
    DICE_SET_VERSION,
    canonicalizeDiceSet,
    computeDiceSetId,
    createDefaultDiceSet,
    migrateLegacyAppearanceConfig,
    normalizeDiceSet,
    type DiceSet,
} from './DiceSetFormat.js';

/** Query parameter carrying an encoded set. */
export const DICE_SET_PARAM = 'dice-set';

/** localStorage key for the active set. The v0 key is read once, then migrated. */
export const DICE_SET_STORAGE_KEY = 'dice-roller-dice-set';
export const LEGACY_APPEARANCE_STORAGE_KEY = 'dice-roller-appearance';

/** Refuse absurd payloads rather than parsing them. */
const MAX_ENCODED_LENGTH = 8192;

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 =
        typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array | null {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    try {
        if (typeof atob === 'function') {
            const binary = atob(padded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        }
        return new Uint8Array(Buffer.from(padded, 'base64'));
    } catch {
        return null;
    }
}

/** Encode a set into a compact, URL-safe token. */
export function encodeDiceSet(set: DiceSet): string {
    return toBase64Url(new TextEncoder().encode(canonicalizeDiceSet(set)));
}

/**
 * Decode a token back into a normalized set, recomputing the content hash.
 * Returns `null` for anything that is not a decodable set.
 */
export function decodeDiceSet(encoded: string | null | undefined): DiceSet | null {
    if (!encoded?.trim()) return null;
    if (encoded.length > MAX_ENCODED_LENGTH) return null;

    const bytes = fromBase64Url(encoded.trim());
    if (!bytes) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    const version = (parsed as { version?: unknown }).version;
    if (version !== DICE_SET_VERSION) return null;

    return normalizeDiceSet(parsed);
}

/** Add (or clear) the set token on a URL. */
export function buildDiceSetShareUrl(set: DiceSet | null, baseUrl?: string): string {
    const url = new URL(
        baseUrl ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
    );
    if (set) url.searchParams.set(DICE_SET_PARAM, encodeDiceSet(set));
    else url.searchParams.delete(DICE_SET_PARAM);
    return url.toString();
}

export function parseDiceSetFromParams(searchParams: URLSearchParams): DiceSet | null {
    return decodeDiceSet(searchParams.get(DICE_SET_PARAM));
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

function readStorage(key: string): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Load the stored set, migrating a v0 appearance config when that is all the
 * browser has. Returns `null` when nothing is stored.
 */
export function loadStoredDiceSet(): DiceSet | null {
    const raw = readStorage(DICE_SET_STORAGE_KEY);
    if (raw) {
        try {
            return normalizeDiceSet(JSON.parse(raw));
        } catch {
            // fall through to the v0 path
        }
    }

    const legacyRaw = readStorage(LEGACY_APPEARANCE_STORAGE_KEY);
    if (!legacyRaw) return null;
    try {
        const legacy = JSON.parse(legacyRaw) as { types?: Record<string, never> };
        return migrateLegacyAppearanceConfig(legacy?.types ?? null);
    } catch {
        return null;
    }
}

export function persistDiceSet(set: DiceSet): DiceSet {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(DICE_SET_STORAGE_KEY, canonicalizeDiceSet(set));
        }
    } catch {
        // quota / private mode — the URL token is still authoritative
    }
    return set;
}

/**
 * Resolve the active set: URL token wins over storage, storage over defaults.
 */
export function resolveDiceSet(searchParams?: URLSearchParams | null): DiceSet {
    const params =
        searchParams ??
        new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return parseDiceSetFromParams(params) ?? loadStoredDiceSet() ?? createDefaultDiceSet();
}

// ---------------------------------------------------------------------------
// multiplayer presence
// ---------------------------------------------------------------------------

export interface DiceSetPresencePayload {
    diceSet: string;
    diceSetId: string;
    diceSetVersion: number;
}

export function buildDiceSetPresencePayload(set: DiceSet): DiceSetPresencePayload {
    return {
        diceSet: encodeDiceSet(set),
        diceSetId: computeDiceSetId(set),
        diceSetVersion: DICE_SET_VERSION,
    };
}

/** Decode a peer's advertised set, ignoring a payload whose id does not match. */
export function parseDiceSetPresencePayload(
    presence: Partial<DiceSetPresencePayload> | null | undefined
): DiceSet | null {
    if (!presence?.diceSet) return null;
    const set = decodeDiceSet(presence.diceSet);
    if (!set) return null;
    if (presence.diceSetId && presence.diceSetId !== set.id) return null;
    return set;
}
