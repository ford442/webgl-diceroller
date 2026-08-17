/**
 * Cloudflare Worker — routes each room to a Durable Object with hibernating WebSockets.
 */

import { RoomDurableObject } from './RoomDurableObject.js';
import { corsHeaders, generateRoomCode, normalizeCode } from './shared.js';

export { RoomDurableObject };

/**
 * @param {string} code
 * @param {object} env
 * @returns {DurableObjectStub}
 */
function roomStub(code, env) {
    const normalized = normalizeCode(code);
    const id = env.ROOM.idFromName(normalized);
    return env.ROOM.get(id);
}

export default {
    /**
     * @param {Request} request
     * @param {object} env
     * @returns {Promise<Response> | Response}
     */
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        if (request.method === 'POST' && path === '/rooms') {
            for (let attempt = 0; attempt < 8; attempt++) {
                const code = generateRoomCode(5);
                const stub = roomStub(code, env);
                const res = await stub.fetch(
                    new Request(`http://internal/create?code=${encodeURIComponent(code)}`, {
                        method: 'POST',
                    })
                );
                if (res.ok) {
                    const body = await res.text();
                    return new Response(body, { status: 201, headers: corsHeaders() });
                }
            }
            return new Response(JSON.stringify({ error: 'create_failed' }), {
                status: 500,
                headers: corsHeaders(),
            });
        }

        const roomMatch = path.match(/^\/rooms\/([0-9A-Za-z]+)$/);
        if (roomMatch) {
            const code = normalizeCode(roomMatch[1]);
            const stub = roomStub(code, env);

            if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
                const internalUrl = new URL('http://internal/websocket');
                internalUrl.search = url.search;
                return stub.fetch(
                    new Request(internalUrl.toString(), {
                        method: 'GET',
                        headers: request.headers,
                    })
                );
            }

            if (request.method === 'GET') {
                return stub.fetch(new Request('http://internal/status'));
            }
        }

        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({ ok: true, durableObjects: true }), {
                headers: corsHeaders(),
            });
        }

        return new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: corsHeaders(),
        });
    },
};
