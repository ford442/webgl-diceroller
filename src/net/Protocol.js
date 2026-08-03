/**
 * Versioned DataChannel message helpers for multiplayer deterministic replay.
 */

export const PROTOCOL_VERSION = 1;

export const MsgType = Object.freeze({
    HELLO: 'hello',
    WELCOME: 'welcome',
    TABLE_SYNC: 'table-sync',
    ROLL: 'roll',
    PRESENCE: 'presence',
    PING: 'ping',
    PONG: 'pong',
    ERROR: 'error',
});

/**
 * @param {object} msg
 * @returns {string}
 */
export function encodeMessage(msg) {
    return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

/**
 * @param {string} raw
 * @returns {{ ok: true, msg: object } | { ok: false, error: string, version?: number }}
 */
export function decodeMessage(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'invalid_json' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'invalid_message' };
    }
    const v = parsed.v ?? parsed.protocolVersion;
    if (v != null && Number(v) !== PROTOCOL_VERSION) {
        return { ok: false, error: 'unsupported_version', version: v };
    }
    return { ok: true, msg: parsed };
}

/**
 * @param {object} fields
 */
export function makeHello(fields) {
    return {
        type: MsgType.HELLO,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: PROTOCOL_VERSION,
    };
}

/**
 * @param {object} fields
 */
export function makeWelcome(fields) {
    return {
        type: MsgType.WELCOME,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: PROTOCOL_VERSION,
    };
}

/**
 * @param {object} fields
 */
export function makeTableSync(fields) {
    return {
        type: MsgType.TABLE_SYNC,
        diceCounts: fields.diceCounts ?? {},
        presence: fields.presence ?? null,
        lastRoll: fields.lastRoll ?? null,
    };
}

/**
 * @param {object} fields
 */
export function makeRoll(fields) {
    return {
        type: MsgType.ROLL,
        seed: fields.seed >>> 0,
        notation: fields.notation ?? null,
        diceCounts: fields.diceCounts ?? null,
        presence: fields.presence ?? null,
        throwAt: fields.throwAt ?? null,
    };
}

/**
 * @param {object} fields
 */
export function makePresence(fields) {
    return {
        type: MsgType.PRESENCE,
        peerId: fields.peerId ?? null,
        name: fields.name ?? null,
        diceAppearance: fields.diceAppearance ?? '',
        diceAppearanceVersion: fields.diceAppearanceVersion ?? 1,
    };
}

/**
 * @param {number} [t]
 */
export function makePing(t = Date.now()) {
    return { type: MsgType.PING, t };
}

/**
 * @param {number} [t]
 */
export function makePong(t = Date.now()) {
    return { type: MsgType.PONG, t };
}
