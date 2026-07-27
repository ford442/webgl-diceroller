/**
 * Protocol encode/decode round-trips for multiplayer DataChannel messages.
 */
import assert from 'node:assert/strict';
import {
    PROTOCOL_VERSION,
    MsgType,
    encodeMessage,
    decodeMessage,
    makeRoll,
    makePresence,
    makeTableSync,
    makeHello,
} from '../src/net/Protocol.js';

function test(name, fn) {
    try {
        fn();
        console.log(`ok: ${name}`);
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
}

test('roll round-trip', () => {
    const msg = makeRoll({
        seed: 42424242,
        notation: '3d6+2',
        diceCounts: { d6: 3 },
        presence: { diceAppearance: '', diceAppearanceVersion: 1 },
        throwAt: 12.5,
    });
    const raw = encodeMessage(msg);
    const decoded = decodeMessage(raw);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.msg.type, MsgType.ROLL);
    assert.equal(decoded.msg.v, PROTOCOL_VERSION);
    assert.equal(decoded.msg.seed, 42424242);
    assert.equal(decoded.msg.notation, '3d6+2');
    assert.deepEqual(decoded.msg.diceCounts, { d6: 3 });
});

test('presence round-trip', () => {
    const msg = makePresence({
        peerId: 'abc',
        name: 'Host',
        diceAppearance: 'd6:r:c43c3c:fff8ef',
        diceAppearanceVersion: 1,
    });
    const decoded = decodeMessage(encodeMessage(msg));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.msg.type, MsgType.PRESENCE);
    assert.equal(decoded.msg.diceAppearance, 'd6:r:c43c3c:fff8ef');
});

test('table-sync round-trip', () => {
    const msg = makeTableSync({
        diceCounts: { d20: 1, d6: 2 },
        presence: { diceAppearance: '', diceAppearanceVersion: 1 },
        lastRoll: { seed: 99, notation: '1d20', diceCounts: { d20: 1 } },
    });
    const decoded = decodeMessage(encodeMessage(msg));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.msg.type, MsgType.TABLE_SYNC);
    assert.equal(decoded.msg.lastRoll.seed, 99);
    assert.deepEqual(decoded.msg.diceCounts, { d20: 1, d6: 2 });
});

test('hello includes protocol version', () => {
    const msg = makeHello({ peerId: 'p1', role: 'host', name: null });
    assert.equal(msg.protocolVersion, PROTOCOL_VERSION);
    const decoded = decodeMessage(encodeMessage(msg));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.msg.type, MsgType.HELLO);
});

test('rejects unsupported version', () => {
    const raw = JSON.stringify({ v: 999, type: 'roll', seed: 1 });
    const decoded = decodeMessage(raw);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error, 'unsupported_version');
});

test('rejects invalid json', () => {
    const decoded = decodeMessage('{not-json');
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error, 'invalid_json');
});

console.log('All multiplayer protocol tests passed.');
