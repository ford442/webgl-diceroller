/**
 * Host-authoritative multiplayer session: WebRTC star + deterministic roll replay.
 */

import { AppEvent } from '../core/AppEvents.js';
import {
    MsgType,
    PROTOCOL_VERSION_V2,
    decodeMessage,
    encodeMessage,
    makeHello,
    makeWelcome,
    makeTableSync,
    makeRoll,
    makeCommit,
    makeCommitAck,
    makeReveal,
    makeSessionSync,
    makePresence,
    makePing,
    makePong,
    type CommitFields,
    type ProtocolMessage,
} from './Protocol.js';
import { createSignalingClient } from './SignalingClient.js';
import type { SignalingMessage } from './SignalingClient.js';
import { createPeerMesh } from './PeerMesh.js';
import type { AppEvents } from '../types/app';

export type SessionRole = 'host' | 'guest';

export type SessionStatus = 'idle' | 'hosting' | 'joining' | 'connected' | 'reconnecting' | 'error';

export interface RoomSessionState {
    status: SessionStatus;
    statusDetail: string | null;
    role: SessionRole | null;
    roomCode: string | null;
    peerId: string;
    connectedPeers: string[];
    signalingConfigured: boolean;
    protocolVersion: number;
    solverBuildId: string;
    useFairCommit: boolean;
}

export interface RemoteRollMessage {
    seed: number;
    notation: string | null;
    diceCounts: Record<string, number> | null;
    /** `'tower'` replays as a dice-tower drop; anything else is a throw. */
    source?: string | null;
}

export interface RemoteCommitMessage {
    hash: string;
    notation?: string | null;
}

export interface RemoteRevealMessage {
    hash?: string;
    seed: number;
    nonce: string;
    notation?: string | null;
    diceCounts?: Record<string, number> | null;
    /** See `RemoteRollMessage.source`. */
    source?: string | null;
}

export interface RemoteTableSyncMessage {
    diceCounts?: Record<string, number> | null;
    presence?: unknown;
    lastRoll?: unknown;
}

export interface SessionSnapshot {
    seats?: Array<{ id: string; name: string; initiative?: number | null }>;
    currentIndex?: number;
    lastExpression?: string | null;
}

export interface PresencePayload {
    diceAppearance?: string;
    diceAppearanceVersion?: number;
}

export interface RoomSessionDeps {
    signalingUrl: string;
    events: AppEvents;
    protocolVersion: number;
    solverBuildId: string;
    getDiceCounts: () => Record<string, number>;
    /** Opaque presence payload — shape is owned by the dice-appearance/dice-set subsystem. */
    getPresencePayload: () => unknown;
    getSessionSnapshot?: () => SessionSnapshot | null;
    applyPresencePayload: (payload: unknown) => void;
    isWasmAvailable: () => boolean;
    useFairCommit?: boolean;
    onRemoteRoll: (msg: RemoteRollMessage) => void | Promise<void>;
    onRemoteTableSync?: (msg: RemoteTableSyncMessage) => void | Promise<void>;
    onRemoteCommit?: (msg: RemoteCommitMessage) => void | Promise<void>;
    onRemoteReveal?: (msg: RemoteRevealMessage) => void | Promise<void>;
    onRemoteSessionSync?: (msg: unknown) => void | Promise<void>;
    onRoomSnapshot?: (msg: RemoteTableSyncMessage) => void | Promise<void>;
    generatePeerId?: () => string;
    displayName?: string;
}

export interface RoomSession {
    peerId: string;
    getState: () => RoomSessionState;
    onStatus: (fn: (state: RoomSessionState) => void) => () => void;
    createAndHost: () => Promise<{ code: string }>;
    joinRoom: (code: string) => Promise<void>;
    leave: () => void;
    broadcastPresence: () => void;
    broadcastSessionSync: (snapshot: SessionSnapshot | null | undefined) => void;
    recordSettledResults: (results: unknown) => void;
    pushPersistedRoomState: () => void;
    isGuest: () => boolean;
    isHost: () => boolean;
    signalingConfigured: boolean;
    useFairCommit: boolean;
}

interface LastRoll {
    seed: number;
    notation: string | null;
    diceCounts: Record<string, number>;
    /** See `RemoteRollMessage.source` — persisted so a late joiner's table
     *  sync replays the host's last roll the way the host rolled it. */
    source?: string | null;
    results?: unknown;
}

export function createRoomSession(deps: RoomSessionDeps): RoomSession {
    const signaling = createSignalingClient(deps.signalingUrl);
    const peerId = deps.generatePeerId?.() ?? crypto.randomUUID();
    const displayName = deps.displayName ?? null;
    const protocolVersion = deps.protocolVersion;
    const useFairCommit = deps.useFairCommit ?? protocolVersion >= PROTOCOL_VERSION_V2;

    let role: SessionRole | null = null;
    let roomCode: string | null = null;
    let status: SessionStatus = 'idle';
    let statusDetail: string | null = null;
    let mesh: ReturnType<typeof createPeerMesh> | null = null;
    let unsubSignal: (() => void) | null = null;
    let unsubRollStarted: (() => void) | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let suppressBroadcast = false;
    let lastRoll: LastRoll | null = null;
    let pendingCommit: unknown = null;
    let lastReveal: unknown = null;
    const statusListeners = new Set<(state: RoomSessionState) => void>();
    const commitAckPeers = new Set<string>();

    function getState(): RoomSessionState {
        return {
            status,
            statusDetail,
            role,
            roomCode,
            peerId,
            connectedPeers: mesh?.getConnectedPeerIds() ?? [],
            signalingConfigured: Boolean(signaling.httpBase),
            protocolVersion,
            solverBuildId: deps.solverBuildId,
            useFairCommit,
        };
    }

    function setStatus(next: SessionStatus, detail: string | null = null): void {
        status = next;
        statusDetail = detail;
        const snap = getState();
        for (const fn of [...statusListeners]) {
            try {
                fn(snap);
            } catch (err) {
                console.error('[RoomSession] status listener', err);
            }
        }
    }

    function onStatus(fn: (state: RoomSessionState) => void): () => void {
        statusListeners.add(fn);
        fn(getState());
        return () => statusListeners.delete(fn);
    }

    function buildPresenceMsg() {
        const presence = (deps.getPresencePayload() ?? {}) as PresencePayload;
        return makePresence(
            {
                peerId,
                name: displayName,
                diceAppearance: presence.diceAppearance ?? '',
                diceAppearanceVersion: presence.diceAppearanceVersion ?? 1,
            },
            protocolVersion
        );
    }

    function sendEncoded(toPeerId: string, msg: ProtocolMessage): void {
        mesh?.sendTo(toPeerId, encodeMessage(msg, protocolVersion));
    }

    function broadcastEncoded(msg: ProtocolMessage): void {
        mesh?.broadcast(encodeMessage(msg, protocolVersion));
    }

    function pushPersistedRoomState(): void {
        if (role !== 'host') return;
        signaling.pushRoomState({
            diceCounts: deps.getDiceCounts(),
            presence: deps.getPresencePayload(),
            lastRoll,
            session: deps.getSessionSnapshot?.() ?? null,
            pendingCommit,
            lastReveal,
        });
    }

    function sendTableSync(toPeerId: string): void {
        sendEncoded(
            toPeerId,
            makeTableSync(
                {
                    diceCounts: deps.getDiceCounts(),
                    presence: deps.getPresencePayload(),
                    lastRoll,
                },
                protocolVersion
            )
        );
    }

    async function applyRoomSnapshot(msg: SignalingMessage): Promise<void> {
        if (msg.diceCounts || msg.lastRoll || msg.session) {
            try {
                await deps.onRoomSnapshot?.(msg);
            } catch (err) {
                console.warn('[RoomSession] room-snapshot apply failed', err);
            }
        }
        if (msg.session) {
            try {
                await deps.onRemoteSessionSync?.(msg.session);
            } catch (err) {
                console.warn('[RoomSession] session snapshot apply failed', err);
            }
        }
        if (msg.diceCounts || msg.lastRoll) {
            try {
                await deps.onRemoteTableSync?.({
                    diceCounts: msg.diceCounts,
                    lastRoll: msg.lastRoll,
                    presence: msg.presence,
                });
            } catch (err) {
                console.warn('[RoomSession] table snapshot apply failed', err);
            }
        }
        pendingCommit = msg.pendingCommit ?? pendingCommit;
        lastReveal = msg.lastReveal ?? lastReveal;
    }

    async function onChannelMessage(fromPeerId: string, raw: string): Promise<void> {
        const decoded = decodeMessage(raw);
        if (decoded.ok === false) {
            if (decoded.error === 'unsupported_version') {
                setStatus('error', `Protocol mismatch (peer v${decoded.version})`);
            }
            return;
        }
        const msg = decoded.msg as ProtocolMessage;

        switch (msg.type) {
            case MsgType.HELLO:
                sendEncoded(
                    fromPeerId,
                    makeWelcome(
                        { peerId, role: role ?? 'guest', name: displayName },
                        protocolVersion
                    )
                );
                if (role === 'host') {
                    sendTableSync(fromPeerId);
                    broadcastEncoded(buildPresenceMsg());
                    const session = deps.getSessionSnapshot?.();
                    if (session) {
                        sendEncoded(
                            fromPeerId,
                            makeSessionSync(
                                {
                                    seats: session.seats,
                                    currentIndex: session.currentIndex,
                                    lastExpression: session.lastExpression,
                                },
                                protocolVersion
                            )
                        );
                    }
                }
                break;

            case MsgType.WELCOME:
                break;

            case MsgType.TABLE_SYNC:
                if (role === 'guest') {
                    if (msg.presence) {
                        try {
                            deps.applyPresencePayload(msg.presence);
                        } catch (err) {
                            console.warn('[RoomSession] presence apply failed', err);
                        }
                    }
                    try {
                        await deps.onRemoteTableSync?.(msg);
                    } catch (err) {
                        console.warn('[RoomSession] table-sync apply failed', err);
                    }
                    setStatus('connected', roomCode ? `Guest · room ${roomCode}` : null);
                }
                break;

            case MsgType.ROLL:
                if (role !== 'guest' || useFairCommit) break;
                if (!deps.isWasmAvailable()) {
                    setStatus('error', 'Enable WASM for multiplayer');
                    break;
                }
                suppressBroadcast = true;
                try {
                    await deps.onRemoteRoll({
                        seed: msg.seed >>> 0,
                        notation: msg.notation ?? null,
                        diceCounts: msg.diceCounts ?? null,
                        source: msg.source ?? null,
                    });
                    lastRoll = {
                        seed: msg.seed >>> 0,
                        notation: msg.notation ?? null,
                        diceCounts: msg.diceCounts ?? deps.getDiceCounts(),
                        source: msg.source ?? null,
                    };
                } catch (err) {
                    console.warn('[RoomSession] remote roll failed', err);
                    setStatus('error', 'Remote roll failed');
                } finally {
                    suppressBroadcast = false;
                }
                break;

            case MsgType.COMMIT:
                if (role !== 'guest' || !useFairCommit) break;
                pendingCommit = msg;
                pushPersistedRoomState();
                sendEncoded(fromPeerId, makeCommitAck({ peerId }, protocolVersion));
                try {
                    await deps.onRemoteCommit?.(msg);
                } catch (err) {
                    console.warn('[RoomSession] remote commit failed', err);
                }
                break;

            case MsgType.COMMIT_ACK:
                if (role !== 'host' || !useFairCommit) break;
                if (fromPeerId) commitAckPeers.add(fromPeerId);
                break;

            case MsgType.REVEAL:
                if (role !== 'guest' || !useFairCommit) break;
                if (!deps.isWasmAvailable()) {
                    setStatus('error', 'Enable WASM for multiplayer');
                    break;
                }
                lastReveal = msg;
                pendingCommit = null;
                suppressBroadcast = true;
                try {
                    await deps.onRemoteReveal?.(msg);
                    lastRoll = {
                        seed: msg.seed >>> 0,
                        notation: msg.notation ?? null,
                        diceCounts: msg.diceCounts ?? deps.getDiceCounts(),
                        source: msg.source ?? null,
                    };
                    pushPersistedRoomState();
                } catch (err) {
                    console.warn('[RoomSession] remote reveal failed', err);
                    setStatus('error', 'Commit-reveal verification failed');
                } finally {
                    suppressBroadcast = false;
                }
                break;

            case MsgType.SESSION_SYNC:
                if (role === 'guest') {
                    try {
                        await deps.onRemoteSessionSync?.(msg);
                    } catch (err) {
                        console.warn('[RoomSession] session-sync apply failed', err);
                    }
                }
                break;

            case MsgType.PRESENCE:
                if (role === 'guest') {
                    try {
                        deps.applyPresencePayload(msg);
                    } catch (err) {
                        console.warn('[RoomSession] presence apply failed', err);
                    }
                }
                break;

            case MsgType.ERROR:
                setStatus('error', msg.detail ?? msg.code ?? 'Protocol error');
                break;

            case MsgType.PING:
                sendEncoded(fromPeerId, makePong(msg.t, protocolVersion));
                break;

            case MsgType.PONG:
                break;

            default:
                break;
        }
    }

    function attachMesh(): void {
        mesh?.close();
        mesh = createPeerMesh({
            localPeerId: peerId,
            role: role as 'host' | 'guest',
            sendSignal: (to: string, data: unknown) => signaling.sendSignal(to, data),
            onChannelMessage,
            onPeerConnected: (remoteId: string) => {
                reconnectAttempts = 0;
                sendEncoded(
                    remoteId,
                    makeHello(
                        {
                            peerId,
                            role: role ?? 'guest',
                            name: displayName,
                            solverBuildId: deps.solverBuildId,
                        },
                        protocolVersion
                    )
                );
                if (role === 'host') {
                    sendTableSync(remoteId);
                }
                setStatus(
                    'connected',
                    role === 'host'
                        ? `Host · ${mesh?.getConnectedPeerIds().length ?? 0} connected`
                        : `Guest · synced`
                );
            },
            onPeerDisconnected: () => {
                const n = mesh?.getConnectedPeerIds().length ?? 0;
                if (role === 'host') {
                    setStatus('connected', `Host · ${n} connected`);
                } else if (n === 0) {
                    scheduleReconnect();
                }
            },
        });
    }

    function wireSignalingHandlers(): void {
        unsubSignal?.();
        unsubSignal = signaling.onMessage((msg) => {
            if (msg.type === 'room-snapshot') {
                applyRoomSnapshot(msg).catch((err) => {
                    console.warn('[RoomSession] room-snapshot failed', err);
                });
                return;
            }
            if (msg.type === 'signal' && msg.from && msg.data) {
                mesh?.handleSignal(msg.from, msg.data);
                return;
            }
            if (msg.type === 'peer-joined' && role === 'host' && msg.peerId) {
                mesh?.connectToGuest(msg.peerId);
                return;
            }
            if (msg.type === 'peer-left' && msg.peerId) {
                mesh?.teardownPeer(msg.peerId, true);
                return;
            }
            if (msg.type === 'signaling-closed') {
                if (status === 'hosting' || status === 'connected' || status === 'joining') {
                    scheduleReconnect();
                }
            }
        });
    }

    function startPing(): void {
        stopPing();
        pingTimer = setInterval(() => {
            broadcastEncoded(makePing(undefined, protocolVersion));
        }, 15000);
    }

    function stopPing(): void {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    }

    function scheduleReconnect(): void {
        if (reconnectTimer || !roomCode || !role) return;
        setStatus('reconnecting', 'Reconnecting…');
        const delay = Math.min(10000, 1000 * 2 ** reconnectAttempts);
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            try {
                await reconnect();
            } catch (err) {
                console.warn('[RoomSession] reconnect failed', err);
                scheduleReconnect();
            }
        }, delay);
    }

    async function reconnect(): Promise<void> {
        if (!roomCode || !role) return;
        signaling.disconnect();
        attachMesh();
        wireSignalingHandlers();
        await connectSignaling(roomCode, role);
        if (role === 'host') {
            // Peers re-offer via peer-joined after reconnect.
            setStatus('connected', `Host · ${mesh?.getConnectedPeerIds().length ?? 0} connected`);
        } else {
            setStatus('joining', `Guest · waiting for host`);
        }
        startPing();
    }

    async function connectSignaling(code: string, connectRole: SessionRole): Promise<void> {
        await signaling.connectRoom(code, {
            peerId,
            role: connectRole,
            solverBuildId: deps.solverBuildId,
            protocolVersion,
        });
    }

    function bindHostRollBroadcast(): void {
        unsubRollStarted?.();
        unsubRollStarted = deps.events.on(AppEvent.ROLL_STARTED, (payload) => {
            if (role !== 'host' || suppressBroadcast) return;
            const p = (payload ?? {}) as {
                seed?: number | null;
                expression?: string | null;
                diceSet?: Record<string, number>;
                source?: string;
                commit?: CommitFields;
                reveal?: {
                    seed: number;
                    nonce: string;
                    notation?: string | null;
                    throwAt?: number;
                };
            };
            if (p.seed == null) return;
            if (!deps.isWasmAvailable()) return;

            const diceCounts = p.diceSet ?? deps.getDiceCounts();
            if (useFairCommit) {
                if (p.commit) {
                    pendingCommit = p.commit;
                    broadcastEncoded(makeCommit(p.commit, protocolVersion));
                    pushPersistedRoomState();
                }
                if (p.reveal) {
                    lastReveal = p.reveal;
                    pendingCommit = null;
                    broadcastEncoded(
                        makeReveal(
                            {
                                seed: p.reveal.seed,
                                nonce: p.reveal.nonce,
                                notation: p.reveal.notation ?? p.expression ?? null,
                                diceCounts,
                                presence: deps.getPresencePayload(),
                                throwAt: p.reveal.throwAt ?? performance.now(),
                                source: p.source ?? null,
                            },
                            protocolVersion
                        )
                    );
                    lastRoll = {
                        seed: p.reveal.seed >>> 0,
                        notation: p.reveal.notation ?? p.expression ?? null,
                        diceCounts,
                        source: p.source ?? null,
                    };
                    pushPersistedRoomState();
                    broadcastEncoded(buildPresenceMsg());
                }
                return;
            }

            const msg = makeRoll(
                {
                    seed: p.seed,
                    notation: p.expression ?? null,
                    diceCounts,
                    presence: deps.getPresencePayload(),
                    throwAt: performance.now(),
                    source: p.source ?? null,
                },
                protocolVersion
            );
            lastRoll = {
                seed: p.seed >>> 0,
                notation: p.expression ?? null,
                diceCounts,
                source: p.source ?? null,
            };
            broadcastEncoded(msg);
            broadcastEncoded(buildPresenceMsg());
            pushPersistedRoomState();
        });
    }

    async function createAndHost(): Promise<{ code: string }> {
        leave();
        role = 'host';
        setStatus('hosting', 'Creating room…');
        const { code } = await signaling.createRoom();
        roomCode = code;
        attachMesh();
        wireSignalingHandlers();
        await connectSignaling(code, 'host');
        bindHostRollBroadcast();
        startPing();
        pushPersistedRoomState();
        setStatus('connected', `Host · room ${code}`);
        syncRoomToUrl(code);
        return { code };
    }

    async function joinRoom(code: string): Promise<void> {
        const normalized = String(code || '')
            .toUpperCase()
            .replace(/[^0-9A-Z]/g, '');
        if (!normalized) throw new Error('invalid_room_code');

        if (!deps.isWasmAvailable()) {
            setStatus('error', 'Enable WASM for multiplayer');
            throw new Error('wasm_required');
        }

        leave();
        role = 'guest';
        roomCode = normalized;
        setStatus('joining', `Joining ${normalized}…`);

        const info = await signaling.roomExists(normalized);
        if (!info.exists) {
            setStatus('error', 'Room not found');
            throw new Error('room_not_found');
        }
        if (
            info.solverBuildId &&
            info.solverBuildId !== deps.solverBuildId &&
            deps.solverBuildId !== 'unknown'
        ) {
            setStatus('error', 'Solver build mismatch — rebuild WASM on all clients');
            throw new Error('solver_build_mismatch');
        }

        attachMesh();
        wireSignalingHandlers();
        await connectSignaling(normalized, 'guest');
        startPing();
        syncRoomToUrl(normalized);
        setStatus('joining', `Guest · waiting for host`);
    }

    function syncRoomToUrl(code: string): void {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('room', code);
            url.searchParams.delete('seed');
            window.history.replaceState({}, '', url.toString());
        } catch {
            /* ignore */
        }
    }

    function broadcastPresence(): void {
        if (role !== 'host' || !mesh) return;
        broadcastEncoded(buildPresenceMsg());
    }

    function broadcastSessionSync(snapshot: SessionSnapshot | null | undefined): void {
        if (role !== 'host' || !mesh || !snapshot) return;
        broadcastEncoded(
            makeSessionSync(
                {
                    seats: snapshot.seats,
                    currentIndex: snapshot.currentIndex,
                    lastExpression: snapshot.lastExpression,
                },
                protocolVersion
            )
        );
        pushPersistedRoomState();
    }

    function recordSettledResults(results: unknown): void {
        if (lastRoll) {
            lastRoll = { ...lastRoll, results };
            pushPersistedRoomState();
        }
    }

    function leave(): void {
        stopPing();
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        unsubRollStarted?.();
        unsubRollStarted = null;
        unsubSignal?.();
        unsubSignal = null;
        mesh?.close();
        mesh = null;
        signaling.disconnect();
        role = null;
        roomCode = null;
        reconnectAttempts = 0;
        pendingCommit = null;
        lastReveal = null;
        commitAckPeers.clear();
        setStatus('idle');
    }

    function isGuest(): boolean {
        return role === 'guest';
    }

    function isHost(): boolean {
        return role === 'host';
    }

    return {
        peerId,
        getState,
        onStatus,
        createAndHost,
        joinRoom,
        leave,
        broadcastPresence,
        broadcastSessionSync,
        recordSettledResults,
        pushPersistedRoomState,
        isGuest,
        isHost,
        signalingConfigured: Boolean(signaling.httpBase),
        useFairCommit,
    };
}

/**
 * Resolve signaling base URL from Vite env or query override.
 */
export function resolveSignalingUrl(
    searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): string {
    const fromQuery = searchParams.get('signal');
    if (fromQuery) return fromQuery;
    try {
        return String(import.meta.env.VITE_SIGNALING_URL || '');
    } catch {
        return '';
    }
}
