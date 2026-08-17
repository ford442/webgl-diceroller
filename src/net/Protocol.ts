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
} as const);

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType];

export interface ProtocolEnvelope {
    v?: number;
    protocolVersion?: number;
    type?: MsgTypeValue | string;
    [key: string]: unknown;
}

export type DecodeMessageResult =
    | { ok: true; msg: ProtocolEnvelope }
    | { ok: false; error: string; version?: number };

export interface HelloFields {
    peerId: string;
    role: string;
    name?: string | null;
}

export interface WelcomeFields {
    peerId: string;
    role: string;
    name?: string | null;
}

export interface TableSyncFields {
    diceCounts?: Record<string, number>;
    presence?: unknown;
    lastRoll?: unknown;
}

export interface RollFields {
    seed: number;
    notation?: string | null;
    diceCounts?: Record<string, number> | null;
    presence?: unknown;
    throwAt?: number | null;
}

export interface PresenceFields {
    peerId?: string | null;
    name?: string | null;
    diceAppearance?: string;
    diceAppearanceVersion?: number;
}

export interface HelloMessage extends ProtocolEnvelope {
    type: typeof MsgType.HELLO;
    peerId: string;
    role: string;
    name: string | null;
    protocolVersion: number;
}

export interface WelcomeMessage extends ProtocolEnvelope {
    type: typeof MsgType.WELCOME;
    peerId: string;
    role: string;
    name: string | null;
    protocolVersion: number;
}

export interface TableSyncMessage extends ProtocolEnvelope {
    type: typeof MsgType.TABLE_SYNC;
    diceCounts: Record<string, number>;
    presence: unknown;
    lastRoll: unknown;
}

export interface RollMessage extends ProtocolEnvelope {
    type: typeof MsgType.ROLL;
    seed: number;
    notation: string | null;
    diceCounts: Record<string, number> | null;
    presence: unknown;
    throwAt: number | null;
}

export interface PresenceMessage extends ProtocolEnvelope {
    type: typeof MsgType.PRESENCE;
    peerId: string | null;
    name: string | null;
    diceAppearance: string;
    diceAppearanceVersion: number;
}

export interface PingMessage extends ProtocolEnvelope {
    type: typeof MsgType.PING;
    t: number;
}

export interface PongMessage extends ProtocolEnvelope {
    type: typeof MsgType.PONG;
    t: number;
}

export type ProtocolMessage =
    | HelloMessage
    | WelcomeMessage
    | TableSyncMessage
    | RollMessage
    | PresenceMessage
    | PingMessage
    | PongMessage;

export function encodeMessage(msg: ProtocolEnvelope): string {
    return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

export function decodeMessage(raw: string): DecodeMessageResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'invalid_json' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'invalid_message' };
    }
    const envelope = parsed as ProtocolEnvelope;
    const v = envelope.v ?? envelope.protocolVersion;
    if (v != null && Number(v) !== PROTOCOL_VERSION) {
        return { ok: false, error: 'unsupported_version', version: Number(v) };
    }
    return { ok: true, msg: envelope };
}

export function makeHello(fields: HelloFields): HelloMessage {
    return {
        type: MsgType.HELLO,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: PROTOCOL_VERSION,
    };
}

export function makeWelcome(fields: WelcomeFields): WelcomeMessage {
    return {
        type: MsgType.WELCOME,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: PROTOCOL_VERSION,
    };
}

export function makeTableSync(fields: TableSyncFields): TableSyncMessage {
    return {
        type: MsgType.TABLE_SYNC,
        diceCounts: fields.diceCounts ?? {},
        presence: fields.presence ?? null,
        lastRoll: fields.lastRoll ?? null,
    };
}

export function makeRoll(fields: RollFields): RollMessage {
    return {
        type: MsgType.ROLL,
        seed: fields.seed >>> 0,
        notation: fields.notation ?? null,
        diceCounts: fields.diceCounts ?? null,
        presence: fields.presence ?? null,
        throwAt: fields.throwAt ?? null,
    };
}

export function makePresence(fields: PresenceFields): PresenceMessage {
    return {
        type: MsgType.PRESENCE,
        peerId: fields.peerId ?? null,
        name: fields.name ?? null,
        diceAppearance: fields.diceAppearance ?? '',
        diceAppearanceVersion: fields.diceAppearanceVersion ?? 1,
    };
}

export function makePing(t: number = Date.now()): PingMessage {
    return { type: MsgType.PING, t };
}

export function makePong(t: number = Date.now()): PongMessage {
    return { type: MsgType.PONG, t };
}
