/**
 * Negative/adversarial coverage for the commit-reveal fairness helpers.
 * tests/unit/multiplayer-protocol.test.js already covers a single happy-path
 * commit/reveal round trip; these tests focus on tampering and edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
    canonicalRollSource,
    commitHash,
    createCommit,
    generateNonce,
    verifyReveal,
} from '../../src/net/CommitReveal.js';

describe('CommitReveal', () => {
    describe('verifyReveal tampering', () => {
        it('returns false (not throw) when the seed is tampered', async () => {
            const seed = 111;
            const nonce = generateNonce();
            const commit = await createCommit(seed, nonce, { dieCount: 1 });
            const ok = await verifyReveal(commit.hash, seed + 1, nonce);
            expect(ok).toBe(false);
        });

        it('returns false when the nonce is tampered', async () => {
            const seed = 222;
            const nonce = generateNonce();
            const otherNonce = generateNonce();
            const commit = await createCommit(seed, nonce, { dieCount: 1 });
            const ok = await verifyReveal(commit.hash, seed, otherNonce);
            expect(ok).toBe(false);
        });

        it('returns false when the hash itself is tampered', async () => {
            const seed = 333;
            const nonce = generateNonce();
            const commit = await createCommit(seed, nonce, { dieCount: 1 });
            // Flip a single hex character.
            const flippedChar = commit.hash[0] === '0' ? '1' : '0';
            const tamperedHash = flippedChar + commit.hash.slice(1);
            const ok = await verifyReveal(tamperedHash, seed, nonce);
            expect(ok).toBe(false);
        });

        it('returns true for a genuine, correct commit/reveal pair', async () => {
            const seed = 444;
            const nonce = generateNonce();
            const commit = await createCommit(seed, nonce, { dieCount: 2, notation: '2d6' });
            const ok = await verifyReveal(commit.hash, seed, nonce);
            expect(ok).toBe(true);
        });
    });

    describe('commitHash determinism', () => {
        it('is deterministic for the same seed and nonce', async () => {
            const nonce = generateNonce();
            const a = await commitHash(555, nonce);
            const b = await commitHash(555, nonce);
            expect(a).toBe(b);
        });

        it('differs for different seeds with the same nonce', async () => {
            const nonce = generateNonce();
            const a = await commitHash(1, nonce);
            const b = await commitHash(2, nonce);
            expect(a).not.toBe(b);
        });

        it('differs for different nonces with the same seed', async () => {
            const nonceA = generateNonce();
            const nonceB = generateNonce();
            const a = await commitHash(1, nonceA);
            const b = await commitHash(1, nonceB);
            expect(a).not.toBe(b);
        });

        it('rejects an invalid/malformed base64 nonce', async () => {
            // Contains characters outside the base64 alphabet and invalid
            // padding, so atob() throws and commitHash surfaces 'invalid_nonce'.
            await expect(commitHash(1, 'not-valid-base64!!!')).rejects.toThrow('invalid_nonce');
        });
    });

    describe('generateNonce', () => {
        it('produces different values across calls', () => {
            const nonces = new Set<string>();
            for (let i = 0; i < 50; i++) nonces.add(generateNonce());
            expect(nonces.size).toBe(50);
        });

        it('is valid base64 that decodes to exactly 16 bytes', () => {
            const nonce = generateNonce();
            const binary = atob(nonce);
            expect(binary.length).toBe(16);
        });
    });

    describe('createCommit defaults', () => {
        it('defaults notation, diceCounts, and throwAt to null when omitted', async () => {
            const nonce = generateNonce();
            const commit = await createCommit(1, nonce, { dieCount: 3 });
            expect(commit.notation).toBeNull();
            expect(commit.diceCounts).toBeNull();
            expect(commit.throwAt).toBeNull();
            expect(commit.dieCount).toBe(3);
        });

        it('passes dieCount through as given', async () => {
            const nonce = generateNonce();
            const commit = await createCommit(1, nonce, { dieCount: 7 });
            expect(commit.dieCount).toBe(7);
        });
    });

    describe('seed edge cases', () => {
        it('handles a seed of 0 without throwing', async () => {
            const nonce = generateNonce();
            const commit = await createCommit(0, nonce, { dieCount: 1 });
            const ok = await verifyReveal(commit.hash, 0, nonce);
            expect(ok).toBe(true);
        });

        it('handles the full unsigned 32-bit range without throwing', async () => {
            const seed = 0xffffffff;
            const nonce = generateNonce();
            const commit = await createCommit(seed, nonce, { dieCount: 1 });
            const ok = await verifyReveal(commit.hash, seed, nonce);
            expect(ok).toBe(true);
        });
    });

    describe('the roll source is bound into the commitment', () => {
        // A seed does not pin the trajectory: the same number poses a thrown
        // roll and a dice-tower drop completely differently. If only
        // `seed ‖ nonce` were hashed, a host could publish its commitment,
        // wait for the acks, and only then pick the outcome it liked — guests
        // would verify the hash happily and replay the late choice.
        it('gives a different hash for the same seed and nonce', async () => {
            const nonce = generateNonce();
            const thrown = await commitHash(42, nonce, 'throw');
            const tower = await commitHash(42, nonce, 'tower');
            expect(thrown).not.toBe(tower);
        });

        it('rejects a reveal that switches the source after committing', async () => {
            const nonce = generateNonce();
            const commit = await createCommit(42, nonce, { dieCount: 3, source: 'throw' });

            expect(await verifyReveal(commit.hash, 42, nonce, 'throw')).toBe(true);
            // The attack: same seed, same nonce, different trajectory.
            expect(await verifyReveal(commit.hash, 42, nonce, 'tower')).toBe(false);
        });

        it('rejects it in the other direction too', async () => {
            const nonce = generateNonce();
            const commit = await createCommit(7, nonce, { dieCount: 1, source: 'tower' });

            expect(await verifyReveal(commit.hash, 7, nonce, 'tower')).toBe(true);
            expect(await verifyReveal(commit.hash, 7, nonce, 'throw')).toBe(false);
            expect(await verifyReveal(commit.hash, 7, nonce)).toBe(false);
        });

        it('canonicalises anything that is not a tower drop to a throw', async () => {
            const nonce = generateNonce();
            // 'ui' and 'notation' are both throws as far as the trajectory goes.
            const base = await commitHash(9, nonce, 'throw');
            expect(await commitHash(9, nonce, 'ui')).toBe(base);
            expect(await commitHash(9, nonce, 'notation')).toBe(base);
            expect(await commitHash(9, nonce, null)).toBe(base);
            expect(await commitHash(9, nonce)).toBe(base);

            expect(canonicalRollSource('tower')).toBe('tower');
            expect(canonicalRollSource('ui')).toBe('throw');
            expect(canonicalRollSource(undefined)).toBe('throw');
        });

        it('a commit announces the canonical source it bound', async () => {
            const nonce = generateNonce();
            expect((await createCommit(1, nonce, { dieCount: 1, source: 'tower' })).source).toBe(
                'tower'
            );
            expect((await createCommit(1, nonce, { dieCount: 1, source: 'ui' })).source).toBe(
                'throw'
            );
        });
    });
});
