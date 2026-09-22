/**
 * Commit-reveal fairness helpers (Web Crypto SHA-256).
 */

const NONCE_BYTES = 16;

/**
 * The gameplay path a committed roll will take, folded into the commitment.
 *
 * A seed alone does not determine the dice: the same number poses a thrown
 * roll and a dice-tower drop completely differently. Binding only
 * `seed ‖ nonce` would let a host publish a commitment, wait for the acks, and
 * *then* pick whichever trajectory it preferred — guests would verify the hash
 * happily and replay the host's late choice. So the source is part of the
 * preimage, and a reveal that names a different one fails verification.
 *
 * Absent/unknown canonicalises to `throw`, which is what every pre-`source`
 * commitment meant.
 */
export type CommitRollSource = 'throw' | 'tower';

export function canonicalRollSource(source: string | null | undefined): CommitRollSource {
    return source === 'tower' ? 'tower' : 'throw';
}

export interface CommitPayload {
    hash: string;
    notation: string | null;
    dieCount: number;
    diceCounts?: Record<string, number> | null;
    throwAt?: number | null;
    /** Announced alongside the hash, and bound into it. */
    source?: CommitRollSource;
}

export interface RevealPayload {
    seed: number;
    nonce: string;
    notation?: string | null;
    diceCounts?: Record<string, number> | null;
    source?: string | null;
}

function seedToBytes(seed: number): Uint8Array {
    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setUint32(0, seed >>> 0, true);
    return buf;
}

function base64ToBytes(base64: string): Uint8Array | null {
    try {
        const binary = atob(base64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
    return btoa(binary);
}

/**
 * @returns {string} base64 nonce (16 bytes)
 */
export function generateNonce(): string {
    const bytes = new Uint8Array(NONCE_BYTES);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
}

/**
 * SHA-256 over `seed ‖ nonce ‖ source`.
 *
 * @param {number} seed
 * @param {string} nonceBase64
 * @param {string | null} [source] see `CommitRollSource`; absent means `throw`
 * @returns {Promise<string>} hex SHA-256
 */
export async function commitHash(
    seed: number,
    nonceBase64: string,
    source?: string | null
): Promise<string> {
    const nonceBytes = base64ToBytes(nonceBase64);
    if (!nonceBytes) throw new Error('invalid_nonce');
    const seedBytes = seedToBytes(seed);
    const sourceBytes = new TextEncoder().encode(canonicalRollSource(source));
    const payload = new Uint8Array(seedBytes.length + nonceBytes.length + sourceBytes.length);
    payload.set(seedBytes, 0);
    payload.set(nonceBytes, seedBytes.length);
    payload.set(sourceBytes, seedBytes.length + nonceBytes.length);
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} expectedHash hex
 * @param {number} seed
 * @param {string} nonceBase64
 */
export async function verifyReveal(
    expectedHash: string,
    seed: number,
    nonceBase64: string,
    source?: string | null
): Promise<boolean> {
    const actual = await commitHash(seed, nonceBase64, source);
    return actual === expectedHash;
}

export async function createCommit(
    seed: number,
    nonce: string,
    fields: {
        notation?: string | null;
        dieCount: number;
        diceCounts?: Record<string, number> | null;
        throwAt?: number | null;
        source?: string | null;
    }
): Promise<CommitPayload> {
    const source = canonicalRollSource(fields.source);
    const hash = await commitHash(seed, nonce, source);
    return {
        hash,
        notation: fields.notation ?? null,
        dieCount: fields.dieCount,
        diceCounts: fields.diceCounts ?? null,
        throwAt: fields.throwAt ?? null,
        source,
    };
}
