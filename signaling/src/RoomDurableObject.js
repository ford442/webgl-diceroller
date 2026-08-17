/**
 * One Durable Object per room code — persists table state and hibernating WebSockets.
 */

import {
    broadcastToPeers,
    corsHeaders,
    findPeerSocket,
    listConnectedPeers,
    normalizeCode,
} from './shared.js';

const STORAGE_KEY = 'room';

/**
 * @typedef {{
 *   code: string,
 *   createdAt: number,
 *   protocolVersion: number,
 *   solverBuildId: string | null,
 *   hostPeerId: string | null,
 *   diceCounts: Record<string, number> | null,
 *   presence: unknown,
 *   lastRoll: unknown,
 *   layoutSeed: number | null,
 *   session: unknown,
 *   pendingCommit: unknown,
 *   lastReveal: unknown,
 * }} RoomState
 */

export class RoomDurableObject {
    /**
     * @param {DurableObjectState} state
     * @param {object} _env
     */
    constructor(state, _env) {
        this.state = state;
        /** @type {RoomState | null} */
        this.room = null;
    }

    /**
     * @returns {Promise<RoomState>}
     */
    async loadRoom() {
        if (this.room) return this.room;
        const stored = await this.state.storage.get(STORAGE_KEY);
        if (stored && typeof stored === 'object') {
            this.room = stored;
            return this.room;
        }
        this.room = {
            code: '',
            createdAt: Date.now(),
            protocolVersion: 1,
            solverBuildId: null,
            hostPeerId: null,
            diceCounts: null,
            presence: null,
            lastRoll: null,
            layoutSeed: null,
            session: null,
            pendingCommit: null,
            lastReveal: null,
        };
        return this.room;
    }

    /**
     * @param {Partial<RoomState>} patch
     */
    async persistRoom(patch) {
        const room = await this.loadRoom();
        Object.assign(room, patch);
        await this.state.storage.put(STORAGE_KEY, room);
    }

    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === '/create' && request.method === 'POST') {
            const code = normalizeCode(url.searchParams.get('code') || '');
            if (!code) {
                return new Response(JSON.stringify({ error: 'invalid_code' }), {
                    status: 400,
                    headers: corsHeaders(),
                });
            }
            const room = await this.loadRoom();
            if (!room.code) {
                room.code = code;
                room.createdAt = Date.now();
                await this.persistRoom(room);
            }
            return new Response(JSON.stringify({ code: room.code }), {
                status: 201,
                headers: corsHeaders(),
            });
        }

        if (url.pathname === '/status' && request.method === 'GET') {
            const room = await this.loadRoom();
            const peers = listConnectedPeers(this.state);
            return new Response(
                JSON.stringify({
                    exists: Boolean(room.code),
                    peerCount: peers.length,
                    protocolVersion: room.protocolVersion,
                    solverBuildId: room.solverBuildId,
                }),
                { status: 200, headers: corsHeaders() }
            );
        }

        if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
            return this.handleWebSocketUpgrade(request);
        }

        return new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: corsHeaders(),
        });
    }

    /**
     * @param {Request} request
     * @returns {Promise<Response>}
     */
    async handleWebSocketUpgrade(request) {
        const url = new URL(request.url);
        const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
        const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
        const solverBuildId = String(url.searchParams.get('solverBuildId') || '').trim();
        const protocolVersion = Number(url.searchParams.get('protocolVersion') || 1);

        const room = await this.loadRoom();
        if (!room.code) {
            return new Response(JSON.stringify({ error: 'room_not_found' }), {
                status: 404,
                headers: corsHeaders(),
            });
        }

        if (room.protocolVersion && protocolVersion !== room.protocolVersion) {
            return new Response(
                JSON.stringify({
                    error: 'protocol_version_mismatch',
                    expected: room.protocolVersion,
                }),
                { status: 403, headers: corsHeaders() }
            );
        }

        if (
            role === 'guest' &&
            room.solverBuildId &&
            solverBuildId &&
            room.solverBuildId !== solverBuildId
        ) {
            return new Response(JSON.stringify({ error: 'solver_build_mismatch' }), {
                status: 403,
                headers: corsHeaders(),
            });
        }

        if (role === 'host') {
            const connectedHosts = listConnectedPeers(this.state).filter(
                (p) => p.role === 'host' && p.peerId !== peerId
            );
            if (connectedHosts.length > 0) {
                return new Response(JSON.stringify({ error: 'host_already_present' }), {
                    status: 409,
                    headers: corsHeaders(),
                });
            }
            if (solverBuildId) {
                if (room.solverBuildId && room.solverBuildId !== solverBuildId) {
                    return new Response(JSON.stringify({ error: 'solver_build_mismatch' }), {
                        status: 403,
                        headers: corsHeaders(),
                    });
                }
                if (!room.solverBuildId) {
                    await this.persistRoom({ solverBuildId });
                }
            }
            await this.persistRoom({ hostPeerId: peerId, protocolVersion });
        }

        const peers = listConnectedPeers(this.state);
        if (peers.length >= 6 && !peers.some((p) => p.peerId === peerId)) {
            return new Response(JSON.stringify({ error: 'room_full' }), {
                status: 403,
                headers: corsHeaders(),
            });
        }

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        this.state.acceptWebSocket(server);
        server.serializeAttachment({ peerId, role });

        const peerList = listConnectedPeers(this.state)
            .filter((p) => p.peerId !== peerId)
            .map((p) => ({ peerId: p.peerId, role: p.role }));

        server.send(
            JSON.stringify({
                type: 'joined',
                code: room.code,
                peerId,
                role,
                peers: peerList,
            })
        );

        this.sendRoomSnapshot(server, room);

        broadcastToPeers(this.state, { type: 'peer-joined', peerId, role }, peerId);

        return new Response(null, {
            status: 101,
            webSocket: client,
            headers: corsHeaders(),
        });
    }

    /**
     * @param {WebSocket} ws
     * @param {RoomState} room
     */
    sendRoomSnapshot(ws, room) {
        if (!room.diceCounts && !room.lastRoll && !room.session) return;
        try {
            ws.send(
                JSON.stringify({
                    type: 'room-snapshot',
                    diceCounts: room.diceCounts,
                    presence: room.presence,
                    lastRoll: room.lastRoll,
                    layoutSeed: room.layoutSeed,
                    session: room.session,
                    pendingCommit: room.pendingCommit,
                    lastReveal: room.lastReveal,
                    protocolVersion: room.protocolVersion,
                    solverBuildId: room.solverBuildId,
                })
            );
        } catch {
            /* ignore */
        }
    }

    /**
     * @param {WebSocket} ws
     * @param {string | ArrayBuffer} message
     */
    async webSocketMessage(ws, message) {
        const att = ws.deserializeAttachment();
        const peerId = att?.peerId;
        const role = att?.role ?? 'guest';
        if (!peerId) return;

        let msg;
        try {
            msg = JSON.parse(String(message));
        } catch {
            return;
        }

        if (msg?.type === 'signal' && msg.to) {
            const target = findPeerSocket(this.state, msg.to);
            if (!target) return;
            try {
                target.send(
                    JSON.stringify({
                        type: 'signal',
                        from: peerId,
                        to: msg.to,
                        data: msg.data,
                    })
                );
            } catch {
                /* ignore */
            }
            return;
        }

        if (msg?.type === 'ping') {
            try {
                ws.send(JSON.stringify({ type: 'pong', t: msg.t ?? Date.now() }));
            } catch {
                /* ignore */
            }
            return;
        }

        if (msg?.type === 'room-state' && role === 'host') {
            const room = await this.loadRoom();
            const patch = {
                diceCounts: msg.diceCounts ?? room.diceCounts,
                presence: msg.presence ?? room.presence,
                lastRoll: msg.lastRoll ?? room.lastRoll,
                layoutSeed: msg.layoutSeed ?? room.layoutSeed,
                session: msg.session ?? room.session,
                pendingCommit: msg.pendingCommit ?? room.pendingCommit,
                lastReveal: msg.lastReveal ?? room.lastReveal,
            };
            await this.persistRoom(patch);
            return;
        }
    }

    /**
     * @param {WebSocket} ws
     * @param {number} _code
     * @param {string} _reason
     * @param {boolean} _wasClean
     */
    async webSocketClose(ws, _code, _reason, _wasClean) {
        const att = ws.deserializeAttachment();
        const peerId = att?.peerId;
        const role = att?.role ?? 'guest';
        if (!peerId) return;
        broadcastToPeers(this.state, { type: 'peer-left', peerId, role }, peerId);
        const room = await this.loadRoom();
        if (room.hostPeerId === peerId) {
            await this.persistRoom({ hostPeerId: null });
        }
    }

    /**
     * @param {WebSocket} ws
     * @param {unknown} error
     */
    async webSocketError(ws, error) {
        console.error('[RoomDO] webSocketError', error);
        try {
            ws.close(1011, 'websocket error');
        } catch {
            /* ignore */
        }
    }
}
