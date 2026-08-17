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
} from './Protocol.js';
import { createSignalingClient } from './SignalingClient.js';
import { createPeerMesh } from './PeerMesh.js';

/**
 * @typedef {'idle' | 'hosting' | 'joining' | 'connected' | 'reconnecting' | 'error'} SessionStatus
 */

/**
 * @param {{
 *   signalingUrl: string,
 *   events: import('../types/app').AppEvents,
 *   protocolVersion: number,
 *   solverBuildId: string,
 *   getDiceCounts: () => Record<string, number>,
 *   getPresencePayload: () => { diceAppearance?: string, diceAppearanceVersion?: number },
 *   getSessionSnapshot?: () => object | null,
 *   applyPresencePayload: (payload: object) => void,
 *   isWasmAvailable: () => boolean,
 *   useFairCommit?: boolean,
 *   onRemoteRoll: (msg: {
 *     seed: number,
 *     notation: string | null,
 *     diceCounts: Record<string, number> | null,
 *   }) => void | Promise<void>,
 *   onRemoteTableSync?: (msg: object) => void | Promise<void>,
 *   onRemoteCommit?: (msg: object) => void | Promise<void>,
 *   onRemoteReveal?: (msg: object) => void | Promise<void>,
 *   onRemoteSessionSync?: (msg: object) => void | Promise<void>,
 *   onRoomSnapshot?: (msg: object) => void | Promise<void>,
 *   generatePeerId?: () => string,
 *   displayName?: string,
 * }} deps
 */
export function createRoomSession(deps) {
    const signaling = createSignalingClient(deps.signalingUrl);
    const peerId = deps.generatePeerId?.() ?? crypto.randomUUID();
    const displayName = deps.displayName ?? null;
    const protocolVersion = deps.protocolVersion;
    const useFairCommit = deps.useFairCommit ?? protocolVersion >= PROTOCOL_VERSION_V2;

    /** @type {'host' | 'guest' | null} */
    let role = null;
    /** @type {string | null} */
    let roomCode = null;
    /** @type {SessionStatus} */
    let status = 'idle';
    /** @type {string | null} */
    let statusDetail = null;
    /** @type {ReturnType<typeof createPeerMesh> | null} */
    let mesh = null;
    /** @type {(() => void) | null} */
    let unsubSignal = null;
    /** @type {(() => void) | null} */
    let unsubRollStarted = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let pingTimer = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let suppressBroadcast = false;
    /** @type {{ seed: number, notation: string | null, diceCounts: Record<string, number>, results?: unknown } | null} */
    let lastRoll = null;
    /** @type {unknown} */
    let pendingCommit = null;
    /** @type {unknown} */
    let lastReveal = null;
    /** @type {Set<(state: object) => void>} */
    const statusListeners = new Set();
    /** @type {Set<string>} */
    const commitAckPeers = new Set();

    function getState() {
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

    function setStatus(next, detail = null) {
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

    /**
     * @param {(state: object) => void} fn
     */
    function onStatus(fn) {
        statusListeners.add(fn);
        fn(getState());
        return () => statusListeners.delete(fn);
    }

    function buildPresenceMsg() {
        const presence = deps.getPresencePayload() ?? {};
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

    function sendEncoded(toPeerId, msg) {
        mesh?.sendTo(toPeerId, encodeMessage(msg, protocolVersion));
    }

    function broadcastEncoded(msg) {
        mesh?.broadcast(encodeMessage(msg, protocolVersion));
    }

    function pushPersistedRoomState() {
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

    function sendTableSync(toPeerId) {
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

    /**
     * @param {object} msg
     */
    async function applyRoomSnapshot(msg) {
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

    /**
     * @param {string} fromPeerId
     * @param {string} raw
     */
    async function onChannelMessage(fromPeerId, raw) {
        const decoded = decodeMessage(raw);
        if (decoded.ok === false) {
            if (decoded.error === 'unsupported_version') {
                setStatus('error', `Protocol mismatch (peer v${decoded.version})`);
            }
            return;
        }
        const msg = decoded.msg;

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
                    });
                    lastRoll = {
                        seed: msg.seed >>> 0,
                        notation: msg.notation ?? null,
                        diceCounts: msg.diceCounts ?? deps.getDiceCounts(),
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

    function attachMesh() {
        mesh?.close();
        mesh = createPeerMesh({
            localPeerId: peerId,
            role: /** @type {'host' | 'guest'} */ (role),
            sendSignal: (to, data) => signaling.sendSignal(to, data),
            onChannelMessage,
            onPeerConnected: (remoteId) => {
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

    function wireSignalingHandlers() {
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

    function startPing() {
        stopPing();
        pingTimer = setInterval(() => {
            broadcastEncoded(makePing(undefined, protocolVersion));
        }, 15000);
    }

    function stopPing() {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    }

    function scheduleReconnect() {
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

    async function reconnect() {
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

    async function connectSignaling(code, connectRole) {
        await signaling.connectRoom(code, {
            peerId,
            role: connectRole,
            solverBuildId: deps.solverBuildId,
            protocolVersion,
        });
    }

    function bindHostRollBroadcast() {
        unsubRollStarted?.();
        unsubRollStarted = deps.events.on(AppEvent.ROLL_STARTED, (payload) => {
            if (role !== 'host' || suppressBroadcast) return;
            const p =
                /** @type {{ seed?: number | null, expression?: string | null, diceSet?: Record<string, number>, source?: string, commit?: object, reveal?: object }} */ (
                    payload ?? {}
                );
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
                            },
                            protocolVersion
                        )
                    );
                    lastRoll = {
                        seed: p.reveal.seed >>> 0,
                        notation: p.reveal.notation ?? p.expression ?? null,
                        diceCounts,
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
                },
                protocolVersion
            );
            lastRoll = {
                seed: p.seed >>> 0,
                notation: p.expression ?? null,
                diceCounts,
            };
            broadcastEncoded(msg);
            broadcastEncoded(buildPresenceMsg());
            pushPersistedRoomState();
        });
    }

    /**
     * @returns {Promise<{ code: string }>}
     */
    async function createAndHost() {
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

    /**
     * @param {string} code
     */
    async function joinRoom(code) {
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

    function syncRoomToUrl(code) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('room', code);
            url.searchParams.delete('seed');
            window.history.replaceState({}, '', url.toString());
        } catch {
            /* ignore */
        }
    }

    function broadcastPresence() {
        if (role !== 'host' || !mesh) return;
        broadcastEncoded(buildPresenceMsg());
    }

    function broadcastSessionSync(snapshot) {
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

    function recordSettledResults(results) {
        if (lastRoll) {
            lastRoll = { ...lastRoll, results };
            pushPersistedRoomState();
        }
    }

    function leave() {
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

    function isGuest() {
        return role === 'guest';
    }

    function isHost() {
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
 * @param {URLSearchParams} [searchParams]
 * @returns {string}
 */
export function resolveSignalingUrl(searchParams = new URLSearchParams(window.location.search)) {
    const fromQuery = searchParams.get('signal');
    if (fromQuery) return fromQuery;
    try {
        return String(import.meta.env.VITE_SIGNALING_URL || '');
    } catch {
        return '';
    }
}
