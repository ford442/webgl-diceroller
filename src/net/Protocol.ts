/**
 * Versioned DataChannel message helpers for multiplayer deterministic replay.
 */

export const PROTOCOL_VERSION_V1 = 1;
export const PROTOCOL_VERSION_V2 = 2;
/** Default encode version — v1 until fair-commit / v2 soak completes. */
export const PROTOCOL_VERSION = PROTOCOL_VERSION_V1;

export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION_V1, PROTOCOL_VERSION_V2] as const;

export const MsgType = Object.freeze({
    HELLO: 'hello',
    WELCOME: 'welcome',
    TABLE_SYNC: 'table-sync',
    ROLL: 'roll',
    COMMIT: 'commit',
    COMMIT_ACK: 'commit-ack',
    REVEAL: 'reveal',
    SESSION_SYNC: 'session-sync',
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
    { ok: true; msg: ProtocolEnvelope } | { ok: false; error: string; version?: number };

export interface HelloFields {
    peerId: string;
    role: string;
    name?: string | null;
    solverBuildId?: string | null;
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

export interface CommitFields {
    hash: string;
    notation?: string | null;
    dieCount: number;
    diceCounts?: Record<string, number> | null;
    throwAt?: number | null;
}

export interface CommitAckFields {
    peerId?: string | null;
}

export interface RevealFields {
    seed: number;
    nonce: string;
    notation?: string | null;
    diceCounts?: Record<string, number> | null;
    presence?: unknown;
    throwAt?: number | null;
}

export interface SessionSyncFields {
    seats?: Array<{ id: string; name: string; initiative?: number | null }>;
    currentIndex?: number;
    lastExpression?: string | null;
}

export interface PresenceFields {
    peerId?: string | null;
    name?: string | null;
    diceAppearance?: string;
    diceAppearanceVersion?: number;
}

export interface ErrorFields {
    code: string;
    detail?: string | null;
}

export interface HelloMessage extends ProtocolEnvelope {
    type: typeof MsgType.HELLO;
    peerId: string;
    role: string;
    name: string | null;
    protocolVersion: number;
    solverBuildId?: string | null;
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

export interface CommitMessage extends ProtocolEnvelope {
    type: typeof MsgType.COMMIT;
    hash: string;
    notation: string | null;
    dieCount: number;
    diceCounts: Record<string, number> | null;
    throwAt: number | null;
}

export interface CommitAckMessage extends ProtocolEnvelope {
    type: typeof MsgType.COMMIT_ACK;
    peerId: string | null;
}

export interface RevealMessage extends ProtocolEnvelope {
    type: typeof MsgType.REVEAL;
    seed: number;
    nonce: string;
    notation: string | null;
    diceCounts: Record<string, number> | null;
    presence: unknown;
    throwAt: number | null;
}

export interface SessionSyncMessage extends ProtocolEnvelope {
    type: typeof MsgType.SESSION_SYNC;
    seats: Array<{ id: string; name: string; initiative?: number | null }>;
    currentIndex: number;
    lastExpression: string | null;
}

export interface PresenceMessage extends ProtocolEnvelope {
    type: typeof MsgType.PRESENCE;
    peerId: string | null;
    name: string | null;
    diceAppearance: string;
    diceAppearanceVersion: number;
}

export interface ErrorMessage extends ProtocolEnvelope {
    type: typeof MsgType.ERROR;
    code: string;
    detail: string | null;
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
    | CommitMessage
    | CommitAckMessage
    | RevealMessage
    | SessionSyncMessage
    | PresenceMessage
    | ErrorMessage
    | PingMessage
    | PongMessage;

export function encodeMessage(msg: ProtocolEnvelope, version: number = PROTOCOL_VERSION): string {
    return JSON.stringify({ v: version, ...msg });
}

export function decodeMessage(
    raw: string,
    options: { acceptVersions?: readonly number[] } = {}
): DecodeMessageResult {
    const accept = options.acceptVersions ?? SUPPORTED_PROTOCOL_VERSIONS;
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
    if (v != null && !accept.includes(Number(v))) {
        return { ok: false, error: 'unsupported_version', version: Number(v) };
    }
    return { ok: true, msg: envelope };
}

export function makeHello(fields: HelloFields, version: number = PROTOCOL_VERSION): HelloMessage {
    return {
        type: MsgType.HELLO,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: version,
        solverBuildId: fields.solverBuildId ?? null,
    };
}

export function makeWelcome(
    fields: WelcomeFields,
    version: number = PROTOCOL_VERSION
): WelcomeMessage {
    return {
        type: MsgType.WELCOME,
        peerId: fields.peerId,
        role: fields.role,
        name: fields.name ?? null,
        protocolVersion: version,
    };
}

export function makeTableSync(
    fields: TableSyncFields,
    _version: number = PROTOCOL_VERSION
): TableSyncMessage {
    return {
        type: MsgType.TABLE_SYNC,
        diceCounts: fields.diceCounts ?? {},
        presence: fields.presence ?? null,
        lastRoll: fields.lastRoll ?? null,
    };
}

export function makeRoll(fields: RollFields, _version: number = PROTOCOL_VERSION): RollMessage {
    return {
        type: MsgType.ROLL,
        seed: fields.seed >>> 0,
        notation: fields.notation ?? null,
        diceCounts: fields.diceCounts ?? null,
        presence: fields.presence ?? null,
        throwAt: fields.throwAt ?? null,
    };
}

export function makeCommit(
    fields: CommitFields,
    _version: number = PROTOCOL_VERSION_V2
): CommitMessage {
    return {
        type: MsgType.COMMIT,
        hash: fields.hash,
        notation: fields.notation ?? null,
        dieCount: fields.dieCount,
        diceCounts: fields.diceCounts ?? null,
        throwAt: fields.throwAt ?? null,
    };
}

export function makeCommitAck(
    fields: CommitAckFields,
    _version: number = PROTOCOL_VERSION_V2
): CommitAckMessage {
    return {
        type: MsgType.COMMIT_ACK,
        peerId: fields.peerId ?? null,
    };
}

export function makeReveal(
    fields: RevealFields,
    _version: number = PROTOCOL_VERSION_V2
): RevealMessage {
    return {
        type: MsgType.REVEAL,
        seed: fields.seed >>> 0,
        nonce: fields.nonce,
        notation: fields.notation ?? null,
        diceCounts: fields.diceCounts ?? null,
        presence: fields.presence ?? null,
        throwAt: fields.throwAt ?? null,
    };
}

export function makeSessionSync(
    fields: SessionSyncFields,
    _version: number = PROTOCOL_VERSION_V2
): SessionSyncMessage {
    return {
        type: MsgType.SESSION_SYNC,
        seats: fields.seats ?? [],
        currentIndex: fields.currentIndex ?? 0,
        lastExpression: fields.lastExpression ?? null,
    };
}

export function makePresence(
    fields: PresenceFields,
    _version: number = PROTOCOL_VERSION
): PresenceMessage {
    return {
        type: MsgType.PRESENCE,
        peerId: fields.peerId ?? null,
        name: fields.name ?? null,
        diceAppearance: fields.diceAppearance ?? '',
        diceAppearanceVersion: fields.diceAppearanceVersion ?? 1,
    };
}

export function makeError(fields: ErrorFields, _version: number = PROTOCOL_VERSION): ErrorMessage {
    return {
        type: MsgType.ERROR,
        code: fields.code,
        detail: fields.detail ?? null,
    };
}

export function makePing(t: number = Date.now(), _version: number = PROTOCOL_VERSION): PingMessage {
    return { type: MsgType.PING, t };
}

export function makePong(t: number = Date.now(), _version: number = PROTOCOL_VERSION): PongMessage {
    return { type: MsgType.PONG, t };
}
