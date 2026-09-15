/**
 * Protocol encode/decode round-trips for multiplayer DataChannel messages.
 */
import { describe, expect, it } from 'vitest';
import { createCommit, generateNonce, verifyReveal } from '../../src/net/CommitReveal.js';
import {
    MsgType,
    PROTOCOL_VERSION,
    PROTOCOL_VERSION_V2,
    decodeMessage,
    encodeMessage,
    makeCommit,
    makeHello,
    makePresence,
    makeReveal,
    makeRoll,
    makeTableSync,
} from '../../src/net/Protocol.js';

// decodeMessage's return type is a discriminated union on `ok`; checkJs
// doesn't narrow JSDoc-inferred discriminated unions the way plain .ts does,
// so these tests read through an `any` view after asserting `ok` at runtime.
function decode(raw) {
    return /** @type {any} */ (decodeMessage(raw));
}

describe('multiplayer protocol', () => {
    it('round-trips a roll message', () => {
        const msg = makeRoll({
            seed: 42424242,
            notation: '3d6+2',
            diceCounts: { d6: 3 },
            presence: { diceAppearance: '', diceAppearanceVersion: 1 },
            throwAt: 12.5,
        });
        const decoded = decode(encodeMessage(msg));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.ROLL);
        expect(decoded.msg.v).toBe(PROTOCOL_VERSION);
        expect(decoded.msg.seed).toBe(42424242);
        expect(decoded.msg.notation).toBe('3d6+2');
        expect(decoded.msg.diceCounts).toEqual({ d6: 3 });
    });

    it('round-trips a presence message', () => {
        const msg = makePresence({
            peerId: 'abc',
            name: 'Host',
            diceAppearance: 'd6:r:c43c3c:fff8ef',
            diceAppearanceVersion: 1,
        });
        const decoded = decode(encodeMessage(msg));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.PRESENCE);
        expect(decoded.msg.diceAppearance).toBe('d6:r:c43c3c:fff8ef');
    });

    it('round-trips a table-sync message', () => {
        const msg = makeTableSync({
            diceCounts: { d20: 1, d6: 2 },
            presence: { diceAppearance: '', diceAppearanceVersion: 1 },
            lastRoll: { seed: 99, notation: '1d20', diceCounts: { d20: 1 } },
        });
        const decoded = decode(encodeMessage(msg));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.TABLE_SYNC);
        expect(decoded.msg.lastRoll.seed).toBe(99);
        expect(decoded.msg.diceCounts).toEqual({ d20: 1, d6: 2 });
    });

    it('includes the protocol version in hello', () => {
        const msg = makeHello({ peerId: 'p1', role: 'host', name: null });
        expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
        const decoded = decode(encodeMessage(msg));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.HELLO);
    });

    it('rejects an unsupported version', () => {
        const raw = JSON.stringify({ v: 999, type: 'roll', seed: 1 });
        const decoded = decode(raw);
        expect(decoded.ok).toBe(false);
        expect(decoded.error).toBe('unsupported_version');
    });

    it('rejects invalid JSON', () => {
        const decoded = decode('{not-json');
        expect(decoded.ok).toBe(false);
        expect(decoded.error).toBe('invalid_json');
    });

    it('round-trips a v2 commit message', () => {
        const msg = makeCommit({
            hash: 'abc123',
            notation: '2d6+1',
            dieCount: 2,
            diceCounts: { d6: 2 },
        });
        const decoded = decode(encodeMessage(msg, PROTOCOL_VERSION_V2));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.COMMIT);
        expect(decoded.msg.hash).toBe('abc123');
    });

    it('round-trips a v2 reveal message and verifies the commit', async () => {
        const seed = 0xdeadbeef;
        const nonce = generateNonce();
        const commit = await createCommit(seed, nonce, { dieCount: 1, notation: '1d20' });
        const msg = makeReveal({
            seed,
            nonce,
            notation: '1d20',
            diceCounts: { d20: 1 },
        });
        const decoded = decode(encodeMessage(msg, PROTOCOL_VERSION_V2));
        expect(decoded.ok).toBe(true);
        expect(decoded.msg.type).toBe(MsgType.REVEAL);
        const ok = await verifyReveal(commit.hash, seed, nonce);
        expect(ok).toBe(true);
        const bad = await verifyReveal(commit.hash, seed + 1, nonce);
        expect(bad).toBe(false);
    });
});
