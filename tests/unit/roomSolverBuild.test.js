/**
 * A guest on another solver build is turned away at join (#357).
 *
 * Seeded replay needs every peer to run the same engine, so a SOLVER_REVISION
 * bump has to keep a guest on the previous artifact out of the room rather
 * than let it replay throws into a different trajectory. RoomDurableObject
 * makes that call from the build id the host persisted.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { formatSolverBuildId } from 'dice-core/wasm/SolverBuildId';

// A non-literal specifier so the app tsconfig (tests/**/*.js, checkJs) does
// not follow this into the Cloudflare worker, which uses Durable Object globals.
const workerModule = '../../signaling/src/RoomDurableObject.js';
const { RoomDurableObject } = await import(/* @vite-ignore */ workerModule);

const PREVIOUS = formatSolverBuildId({ solver_revision: 10, wasm_sha256: 'a'.repeat(64) });
const CURRENT = formatSolverBuildId({ solver_revision: 11, wasm_sha256: 'b'.repeat(64) });

/** Thrown by the WebSocketPair stub: the join got past every check. */
class Admitted extends Error {}

function roomObject(solverBuildId) {
    const store = new Map([
        [
            'room',
            { code: 'K7Q2M', createdAt: 0, protocolVersion: 1, solverBuildId, hostPeerId: 'host' },
        ],
    ]);
    const state = {
        storage: {
            get: async (key) => store.get(key),
            put: async (key, value) => void store.set(key, value),
        },
        getWebSockets: () => [],
    };
    return new RoomDurableObject(state, {});
}

function join(room, solverBuildId) {
    const url = new URL('https://signal.test/room/K7Q2M/ws');
    url.searchParams.set('role', 'guest');
    url.searchParams.set('peerId', 'guest-1');
    url.searchParams.set('protocolVersion', '1');
    if (solverBuildId) url.searchParams.set('solverBuildId', solverBuildId);
    return room.handleWebSocketUpgrade(new Request(url));
}

describe('RoomDurableObject solver build check', () => {
    const savedPair = globalThis.WebSocketPair;
    afterEach(() => {
        globalThis.WebSocketPair = savedPair;
    });

    it('formats ids that differ across the revision bump', () => {
        expect(PREVIOUS).toBe('10:aaaaaaaaaaaa');
        expect(CURRENT).toBe('11:bbbbbbbbbbbb');
    });

    it('rejects a guest still on the previous solver build', async () => {
        const res = await join(roomObject(CURRENT), PREVIOUS);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'solver_build_mismatch' });
    });

    it('admits a guest on the host build', async () => {
        globalThis.WebSocketPair = class {
            constructor() {
                throw new Admitted();
            }
        };
        await expect(join(roomObject(CURRENT), CURRENT)).rejects.toBeInstanceOf(Admitted);
    });
});
