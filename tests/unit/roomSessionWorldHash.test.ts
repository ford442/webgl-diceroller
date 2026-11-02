/**
 * Client side of the world-hash join check (#369): a guest compares its own
 * table with the one the host recorded in the room before it opens a channel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomSession } from '../../src/net/RoomSession.js';
import type { RoomSessionDeps } from '../../src/net/RoomSession.js';

const SOLVER = '11:bbbbbbbbbbbb';

function session(getWorldHash: () => string | null) {
    const deps = {
        signalingUrl: 'https://signal.test',
        events: { on: () => () => {}, emit: () => {} },
        protocolVersion: 1,
        solverBuildId: SOLVER,
        getWorldHash,
        getDiceCounts: () => ({}),
        getPresencePayload: () => ({}),
        applyPresencePayload: () => {},
        isWasmAvailable: () => true,
        onRemoteRoll: () => {},
    } as unknown as RoomSessionDeps;
    return createRoomSession(deps);
}

function hostReports(info: { solverBuildId: string; worldHash: string | null }) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ exists: true, peerCount: 1, ...info })))
    );
}

afterEach(() => vi.unstubAllGlobals());

describe('RoomSession.joinRoom world hash', () => {
    it('refuses to join a room whose host built a different table', async () => {
        hostReports({ solverBuildId: SOLVER, worldHash: '6c4bd4797b1abbf6' });
        const guest = session(() => '0123456789abcdef');
        await expect(guest.joinRoom('K7Q2M')).rejects.toThrow('world_hash_mismatch');
        expect(guest.getState().status).toBe('error');
        expect(guest.getState().statusDetail).toMatch(/Table mismatch/);
    });

    it('does not mistake a solver mismatch for a table mismatch', async () => {
        hostReports({ solverBuildId: '10:aaaaaaaaaaaa', worldHash: '6c4bd4797b1abbf6' });
        const guest = session(() => '0123456789abcdef');
        await expect(guest.joinRoom('K7Q2M')).rejects.toThrow('solver_build_mismatch');
    });
});
