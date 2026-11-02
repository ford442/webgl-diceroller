/**
 * A guest whose table differs from the host's is turned away at join (#369).
 *
 * `solverBuildId` proves the guest runs the same engine; the world hash proves
 * it built the same table. RoomDurableObject makes the call from the hash the
 * host persisted, exactly as it does for the solver build.
 */
import { afterEach, describe, expect, it } from 'vitest';

// A non-literal specifier so the app tsconfig (tests/**/*.js, checkJs) does
// not follow this into the Cloudflare worker, which uses Durable Object globals.
const workerModule = '../../signaling/src/RoomDurableObject.js';
const { RoomDurableObject } = await import(/* @vite-ignore */ workerModule);

const HOST_WORLD = '6c4bd4797b1abbf6';
const OTHER_WORLD = '0123456789abcdef';

/** Thrown by the WebSocketPair stub: the join got past every check. */
class Admitted extends Error {}

function roomObject(worldHash) {
    const store = new Map([
        [
            'room',
            {
                code: 'K7Q2M',
                createdAt: 0,
                protocolVersion: 1,
                solverBuildId: '11:bbbbbbbbbbbb',
                worldHash,
                hostPeerId: 'host',
            },
        ],
    ]);
    const state = {
        storage: {
            get: async (key) => store.get(key),
            put: async (key, value) => void store.set(key, value),
        },
        getWebSockets: () => [],
    };
    return { room: new RoomDurableObject(state, {}), store };
}

/**
 * @param {any} room
 * @param {{ role?: string, worldHash?: string }} [options]
 */
function join(room, { role = 'guest', worldHash } = {}) {
    const url = new URL('https://signal.test/room/K7Q2M/ws');
    url.searchParams.set('role', role);
    url.searchParams.set('peerId', `${role}-1`);
    url.searchParams.set('protocolVersion', '1');
    url.searchParams.set('solverBuildId', '11:bbbbbbbbbbbb');
    if (worldHash) url.searchParams.set('worldHash', worldHash);
    return room.handleWebSocketUpgrade(new Request(url));
}

describe('RoomDurableObject world hash check', () => {
    const savedPair = globalThis.WebSocketPair;
    afterEach(() => {
        globalThis.WebSocketPair = savedPair;
    });

    function admitEveryone() {
        globalThis.WebSocketPair = class {
            constructor() {
                throw new Admitted();
            }
        };
    }

    it('rejects a guest whose table hash differs from the host', async () => {
        const { room } = roomObject(HOST_WORLD);
        const res = await join(room, { worldHash: OTHER_WORLD });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'world_hash_mismatch' });
    });

    it('admits a guest on the host table', async () => {
        admitEveryone();
        const { room } = roomObject(HOST_WORLD);
        await expect(join(room, { worldHash: HOST_WORLD })).rejects.toBeInstanceOf(Admitted);
    });

    it('admits a guest that sends no hash, or a room that recorded none', async () => {
        admitEveryone();
        await expect(join(roomObject(HOST_WORLD).room)).rejects.toBeInstanceOf(Admitted);
        await expect(
            join(roomObject(null).room, { worldHash: OTHER_WORLD })
        ).rejects.toBeInstanceOf(Admitted);
    });

    it('lets the host replace the stored hash (its table can be re-rolled)', async () => {
        admitEveryone();
        const { room, store } = roomObject(HOST_WORLD);
        await expect(join(room, { role: 'host', worldHash: OTHER_WORLD })).rejects.toBeInstanceOf(
            Admitted
        );
        expect(store.get('room').worldHash).toBe(OTHER_WORLD);
        // ...and a guest is now compared against the new table.
        const stale = await join(room, { worldHash: HOST_WORLD });
        expect(stale.status).toBe(403);
    });
});
