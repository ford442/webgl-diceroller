/**
 * Host-authoritative multiplayer session: WebRTC star + deterministic roll replay.
 */

import { AppEvent } from '../core/AppEvents.js';
import {
    MsgType,
    PROTOCOL_VERSION,
    decodeMessage,
    encodeMessage,
    makeHello,
    makeWelcome,
    makeTableSync,
    makeRoll,
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
 *   getDiceCounts: () => Record<string, number>,
 *   getPresencePayload: () => { diceAppearance?: string, diceAppearanceVersion?: number },
 *   applyPresencePayload: (payload: object) => void,
 *   isWasmAvailable: () => boolean,
 *   onRemoteRoll: (msg: {
 *     seed: number,
 *     notation: string | null,
 *     diceCounts: Record<string, number> | null,
 *   }) => void | Promise<void>,
 *   onRemoteTableSync?: (msg: object) => void | Promise<void>,
 *   generatePeerId?: () => string,
 *   displayName?: string,
 * }} deps
 */
export function createRoomSession(deps) {
    const signaling = createSignalingClient(deps.signalingUrl);
    const peerId = deps.generatePeerId?.() ?? crypto.randomUUID();
    const displayName = deps.displayName ?? null;

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
    /** @type {Set<(state: object) => void>} */
    const statusListeners = new Set();

    function getState() {
        return {
            status,
            statusDetail,
            role,
            roomCode,
            peerId,
            connectedPeers: mesh?.getConnectedPeerIds() ?? [],
            signalingConfigured: Boolean(signaling.httpBase),
            protocolVersion: PROTOCOL_VERSION,
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
        return makePresence({
            peerId,
            name: displayName,
            diceAppearance: presence.diceAppearance ?? '',
            diceAppearanceVersion: presence.diceAppearanceVersion ?? 1,
        });
    }

    function sendEncoded(toPeerId, msg) {
        mesh?.sendTo(toPeerId, encodeMessage(msg));
    }

    function broadcastEncoded(msg) {
        mesh?.broadcast(encodeMessage(msg));
    }

    function sendTableSync(toPeerId) {
        sendEncoded(
            toPeerId,
            makeTableSync({
                diceCounts: deps.getDiceCounts(),
                presence: deps.getPresencePayload(),
                lastRoll,
            })
        );
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
                    makeWelcome({ peerId, role: role ?? 'guest', name: displayName })
                );
                if (role === 'host') {
                    sendTableSync(fromPeerId);
                    broadcastEncoded(buildPresenceMsg());
                }
                break;

            case MsgType.WELCOME:
                // Host answered; request sync by waiting for table-sync from host.
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
                if (role !== 'guest') break;
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

            case MsgType.PRESENCE:
                if (role === 'guest' || fromPeerId !== peerId) {
                    // v1: guests apply host presence; host ignores guest skins.
                    if (role === 'guest') {
                        try {
                            deps.applyPresencePayload(msg);
                        } catch (err) {
                            console.warn('[RoomSession] presence apply failed', err);
                        }
                    }
                }
                break;

            case MsgType.PING:
                sendEncoded(fromPeerId, makePong(msg.t));
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
                    makeHello({ peerId, role: role ?? 'guest', name: displayName })
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
            broadcastEncoded(makePing());
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
        const joined = await signaling.connectRoom(roomCode, { peerId, role });
        if (role === 'host') {
            for (const p of joined.peers) {
                if (p.role === 'guest') mesh?.connectToGuest(p.peerId);
            }
            setStatus('connected', `Host · ${mesh?.getConnectedPeerIds().length ?? 0} connected`);
        } else {
            // Guest waits for host offer / channel.
            setStatus('joining', `Guest · waiting for host`);
        }
        startPing();
    }

    function bindHostRollBroadcast() {
        unsubRollStarted?.();
        unsubRollStarted = deps.events.on(AppEvent.ROLL_STARTED, (payload) => {
            if (role !== 'host' || suppressBroadcast) return;
            const p =
                /** @type {{ seed?: number | null, expression?: string | null, diceSet?: Record<string, number>, source?: string }} */ (
                    payload ?? {}
                );
            if (p.seed == null) return; // cup pours / unseeded
            if (!deps.isWasmAvailable()) return;

            const diceCounts = p.diceSet ?? deps.getDiceCounts();
            const msg = makeRoll({
                seed: p.seed,
                notation: p.expression ?? null,
                diceCounts,
                presence: deps.getPresencePayload(),
                throwAt: performance.now(),
            });
            lastRoll = {
                seed: p.seed >>> 0,
                notation: p.expression ?? null,
                diceCounts,
            };
            broadcastEncoded(msg);
            broadcastEncoded(buildPresenceMsg());
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
        await signaling.connectRoom(code, { peerId, role: 'host' });
        bindHostRollBroadcast();
        startPing();
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

        attachMesh();
        wireSignalingHandlers();
        await signaling.connectRoom(normalized, { peerId, role: 'guest' });
        startPing();
        syncRoomToUrl(normalized);
        setStatus('joining', `Guest · waiting for host`);
    }

    function syncRoomToUrl(code) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('room', code);
            // Room wins over one-shot shareable seed replay.
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

    function recordSettledResults(results) {
        if (lastRoll) {
            lastRoll = { ...lastRoll, results };
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
        recordSettledResults,
        isGuest,
        isHost,
        signalingConfigured: Boolean(signaling.httpBase),
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
