/**
 * Protocol v2 (commit-reveal) is the default, and the room is pinned to its
 * host's protocol version.
 *
 * - A v2 host has to be able to open a room at all. The room used to default
 *   to v1 and compare *every* join against it, so a `?fair-commit` host was
 *   turned away from the room it had just created.
 * - A guest on another version is refused with a reason it can read: over an
 *   accepted socket, because a browser hides the body of a refused upgrade.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// A non-literal specifier so the app tsconfig (tests/**/*.js, checkJs) does
// not follow this into the Cloudflare worker, which uses Durable Object globals.
const workerModule = '../../signaling/src/RoomDurableObject.js';
const { RoomDurableObject } = await import(/* @vite-ignore */ workerModule);

class FakeSocket {
    constructor() {
        /** @type {any[]} */
        this.sent = [];
        this.attachment = null;
    }
    send(raw) {
        this.sent.push(JSON.parse(raw));
    }
    serializeAttachment(value) {
        this.attachment = value;
    }
    deserializeAttachment() {
        return this.attachment;
    }
}

/** Node's Response refuses status 101; the Worker runtime does not. */
class FakeResponse {
    constructor(body, init = {}) {
        this.body = body;
        this.status = init.status ?? 200;
        this.webSocket = init.webSocket ?? null;
    }
    async json() {
        return JSON.parse(this.body);
    }
}

/** @param {Record<string, unknown> | null} stored */
function roomObject(stored) {
    const store = new Map(stored ? [['room', stored]] : []);
    /** @type {FakeSocket[]} */
    const sockets = [];
    const state = {
        storage: {
            get: async (key) => store.get(key),
            put: async (key, value) => void store.set(key, structuredClone(value)),
        },
        getWebSockets: () => sockets,
        acceptWebSocket: (ws) => void sockets.push(ws),
    };
    return { room: new RoomDurableObject(state, {}), store, sockets };
}

/**
 * @param {any} room
 * @param {{ role?: string, peerId?: string, version?: number | null }} [options]
 */
function join(room, { role = 'guest', peerId = `${role}-1`, version = 2 } = {}) {
    const url = new URL('https://signal.test/room/K7Q2M/ws');
    url.searchParams.set('role', role);
    url.searchParams.set('peerId', peerId);
    url.searchParams.set('solverBuildId', '11:bbbbbbbbbbbb');
    if (version != null) url.searchParams.set('protocolVersion', String(version));
    return room.handleWebSocketUpgrade(new Request(url));
}

const CREATED = { code: 'K7Q2M', createdAt: 0, protocolVersion: null, hostPeerId: null };

describe('RoomDurableObject protocol version', () => {
    const saved = { pair: globalThis.WebSocketPair, response: globalThis.Response };
    beforeEach(() => {
        globalThis.WebSocketPair = /** @type {any} */ (
            class {
                constructor() {
                    this[0] = new FakeSocket();
                    this[1] = new FakeSocket();
                }
            }
        );
        globalThis.Response = /** @type {any} */ (FakeResponse);
    });
    afterEach(() => {
        globalThis.WebSocketPair = saved.pair;
        globalThis.Response = saved.response;
    });

    it('lets a v2 host open the room it just created', async () => {
        const { room, store, sockets } = roomObject(null);
        await room.fetch(new Request('https://internal/create?code=K7Q2M', { method: 'POST' }));
        expect(store.get('room').protocolVersion).toBeNull();

        const res = await join(room, { role: 'host', version: 2 });
        expect(res.status).toBe(101);
        expect(sockets[0].sent[0]).toMatchObject({ type: 'joined', role: 'host' });
        expect(store.get('room').protocolVersion).toBe(2);
    });

    it('admits a v2 guest into a v2 room', async () => {
        const { room, sockets } = roomObject({ ...CREATED, protocolVersion: 2 });
        await join(room, { version: 2 });
        expect(sockets[0].attachment).toMatchObject({ peerId: 'guest-1', protocolVersion: 2 });
        expect(sockets[0].sent[0]).toMatchObject({ type: 'joined' });
    });

    it('refuses a v1 guest with a reason it can read, and does not count it as a peer', async () => {
        const { room, sockets } = roomObject({ ...CREATED, protocolVersion: 2 });
        const res = await join(room, { version: 1 });

        expect(res.status).toBe(101);
        expect(sockets).toHaveLength(1);
        expect(sockets[0].sent).toEqual([
            { type: 'error', error: 'protocol_version_mismatch', expected: 2, received: 1 },
        ]);
        // No peerId: peer lists, broadcasts and message handling all skip it.
        expect(sockets[0].attachment).toEqual({ refused: 'protocol_version_mismatch' });
        const status = await room.fetch(new Request('https://internal/status'));
        expect((await status.json()).peerCount).toBe(0);
    });

    it('treats a guest that sends no version as v1 (every build before it was sent)', async () => {
        const { room, sockets } = roomObject({ ...CREATED, protocolVersion: 2 });
        await join(room, { version: null });
        expect(sockets[0].sent[0]).toMatchObject({ error: 'protocol_version_mismatch' });
    });

    it('refuses a v2 guest in a room a v1 host still holds', async () => {
        const { room, sockets } = roomObject({ ...CREATED, protocolVersion: 1 });
        await join(room, { version: 2 });
        expect(sockets[0].sent[0]).toMatchObject({ error: 'protocol_version_mismatch' });
    });

    it('moves a room forward when its host comes back on v2, and refuses the v1 guests left in it', async () => {
        const { room, store, sockets } = roomObject({ ...CREATED, protocolVersion: 1 });
        await join(room, { role: 'guest', peerId: 'old-guest', version: 1 });
        expect(sockets[0].attachment.peerId).toBe('old-guest');

        await join(room, { role: 'host', version: 2 });
        expect(store.get('room').protocolVersion).toBe(2);
        expect(sockets[0].sent.at(-1)).toMatchObject({
            type: 'error',
            error: 'protocol_version_mismatch',
            expected: 2,
        });
        expect(sockets[0].attachment).toEqual({ refused: 'protocol_version_mismatch' });
        // Refused before the host's peer list was built: it is not offered a channel.
        expect(sockets[1].sent[0]).toMatchObject({ type: 'joined', role: 'host', peers: [] });
    });
});
