/**
 * Lightweight WebRTC signaling Worker.
 * Relays SDP/ICE between peers in a short-lived room. No game payloads.
 *
 * In-memory Map — fine for single-isolate / wrangler dev. Multi-isolate
 * production traffic should move rooms into a Durable Object later.
 */

/** Crockford base32 alphabet (no I, L, O, U). */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {{ peerId: string, role: 'host' | 'guest', ws: WebSocket }} Peer
 * @typedef {{ code: string, peers: Map<string, Peer>, createdAt: number }} Room
 */

/**
 * @param {number} [len]
 * @returns {string}
 */
function generateRoomCode(len = 5) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
}

/**
 * @param {string} code
 * @returns {string}
 */
function normalizeCode(code) {
    return String(code || '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/[ILOU]/g, '');
}

/**
 * @param {Room} room
 */
function pruneRoomIfEmpty(room) {
    if (room.peers.size === 0) {
        rooms.delete(room.code);
    }
}

/**
 * Drop rooms older than 2 hours with no peers (safety).
 */
function sweepStaleRooms() {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [code, room] of rooms) {
        if (room.peers.size === 0 && room.createdAt < cutoff) {
            rooms.delete(code);
        }
    }
}

/**
 * @param {Room} room
 * @param {object} msg
 * @param {string} [exceptPeerId]
 */
function broadcast(room, msg, exceptPeerId) {
    const raw = JSON.stringify(msg);
    for (const [id, peer] of room.peers) {
        if (exceptPeerId && id === exceptPeerId) continue;
        try {
            peer.ws.send(raw);
        } catch {
            /* ignore closed sockets */
        }
    }
}

/**
 * @param {Request} request
 * @param {string} code
 * @returns {Response}
 */
function handleWebSocket(request, code) {
    const url = new URL(request.url);
    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const roleParam = url.searchParams.get('role');
    const role = roleParam === 'host' ? 'host' : 'guest';

    const room = rooms.get(code);
    if (!room) {
        return new Response(JSON.stringify({ error: 'room_not_found' }), {
            status: 404,
            headers: corsHeaders(),
        });
    }

    if (role === 'host') {
        for (const peer of room.peers.values()) {
            if (peer.role === 'host' && peer.peerId !== peerId) {
                return new Response(JSON.stringify({ error: 'host_already_present' }), {
                    status: 409,
                    headers: corsHeaders(),
                });
            }
        }
    }

    if (room.peers.size >= 6 && !room.peers.has(peerId)) {
        return new Response(JSON.stringify({ error: 'room_full' }), {
            status: 403,
            headers: corsHeaders(),
        });
    }

    const pair = new WebSocketPair();
    /** @type {WebSocket} */
    const client = pair[0];
    /** @type {WebSocket} */
    const server = pair[1];
    server.accept();

    const peer = { peerId, role, ws: server };
    room.peers.set(peerId, peer);

    server.send(
        JSON.stringify({
            type: 'joined',
            code,
            peerId,
            role,
            peers: [...room.peers.values()]
                .filter((p) => p.peerId !== peerId)
                .map((p) => ({ peerId: p.peerId, role: p.role })),
        })
    );

    broadcast(room, { type: 'peer-joined', peerId, role }, peerId);

    server.addEventListener('message', (event) => {
        let msg;
        try {
            msg = JSON.parse(String(event.data));
        } catch {
            return;
        }

        if (msg?.type === 'signal' && msg.to) {
            const target = room.peers.get(msg.to);
            if (!target) return;
            try {
                target.ws.send(
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
                server.send(JSON.stringify({ type: 'pong', t: msg.t ?? Date.now() }));
            } catch {
                /* ignore */
            }
        }
    });

    const cleanup = () => {
        room.peers.delete(peerId);
        broadcast(room, { type: 'peer-left', peerId, role });
        pruneRoomIfEmpty(room);
    };

    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, {
        status: 101,
        webSocket: client,
        headers: corsHeaders(),
    });
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

export default {
    /**
     * @param {Request} request
     * @returns {Promise<Response> | Response}
     */
    async fetch(request) {
        sweepStaleRooms();

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        if (request.method === 'POST' && path === '/rooms') {
            let code = generateRoomCode(5);
            while (rooms.has(code)) code = generateRoomCode(5);
            rooms.set(code, { code, peers: new Map(), createdAt: Date.now() });
            return new Response(JSON.stringify({ code }), {
                status: 201,
                headers: corsHeaders(),
            });
        }

        const roomMatch = path.match(/^\/rooms\/([0-9A-Za-z]+)$/);
        if (roomMatch) {
            const code = normalizeCode(roomMatch[1]);
            if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
                if (!rooms.has(code)) {
                    // Guests need an existing room; hosts may create via POST first.
                    return new Response(JSON.stringify({ error: 'room_not_found' }), {
                        status: 404,
                        headers: corsHeaders(),
                    });
                }
                return handleWebSocket(request, code);
            }

            if (request.method === 'GET') {
                const room = rooms.get(code);
                return new Response(
                    JSON.stringify({
                        exists: Boolean(room),
                        peerCount: room?.peers.size ?? 0,
                    }),
                    { status: 200, headers: corsHeaders() }
                );
            }
        }

        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({ ok: true, rooms: rooms.size }), {
                headers: corsHeaders(),
            });
        }

        return new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: corsHeaders(),
        });
    },
};
