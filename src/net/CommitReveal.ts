/**
 * Commit-reveal fairness helpers (Web Crypto SHA-256).
 */

const NONCE_BYTES = 16;

export interface CommitPayload {
    hash: string;
    notation: string | null;
    dieCount: number;
    diceCounts?: Record<string, number> | null;
    throwAt?: number | null;
}

export interface RevealPayload {
    seed: number;
    nonce: string;
    notation?: string | null;
    diceCounts?: Record<string, number> | null;
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
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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
 * @param {number} seed
 * @param {string} nonceBase64
 * @returns {Promise<string>} hex SHA-256
 */
export async function commitHash(seed: number, nonceBase64: string): Promise<string> {
    const nonceBytes = base64ToBytes(nonceBase64);
    if (!nonceBytes) throw new Error('invalid_nonce');
    const payload = new Uint8Array(seedToBytes(seed).length + nonceBytes.length);
    payload.set(seedToBytes(seed), 0);
    payload.set(nonceBytes, 4);
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
    nonceBase64: string
): Promise<boolean> {
    const actual = await commitHash(seed, nonceBase64);
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
    }
): Promise<CommitPayload> {
    const hash = await commitHash(seed, nonce);
    return {
        hash,
        notation: fields.notation ?? null,
        dieCount: fields.dieCount,
        diceCounts: fields.diceCounts ?? null,
        throwAt: fields.throwAt ?? null,
    };
}
