/**
 * The client side of protocol v2 as the default: a guest whose app speaks a
 * different protocol from the room's host is stopped with a readable reason —
 * before it opens a socket when the room says so up front, and from the
 * Worker's refusal frame otherwise — and does not fall into a reconnect loop
 * that would replace that reason with "Reconnecting…".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoomSession } from '../../src/net/RoomSession.js';
import type { RoomSessionDeps } from '../../src/net/RoomSession.js';
import { PROTOCOL_VERSION, PROTOCOL_VERSION_V2 } from '../../src/net/Protocol.js';

const SOLVER = '11:bbbbbbbbbbbb';

function session() {
    const deps = {
        signalingUrl: 'https://signal.test',
        events: { on: () => () => {}, emit: () => {} },
        protocolVersion: PROTOCOL_VERSION,
        solverBuildId: SOLVER,
        getWorldHash: () => null,
        getDiceCounts: () => ({}),
        getPresencePayload: () => ({}),
        applyPresencePayload: () => {},
        isWasmAvailable: () => true,
        onRemoteRoll: () => {},
    } as unknown as RoomSessionDeps;
    return createRoomSession(deps);
}

function roomReports(info: Record<string, unknown>) {
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({ exists: true, peerCount: 1, solverBuildId: SOLVER, ...info })
                )
        )
    );
}

/** A WebSocket the Worker answers with one frame, then leaves open. */
function workerAnswers(frame: Record<string, unknown>) {
    const opened: string[] = [];
    class FakeWebSocket extends EventTarget {
        static OPEN = 1;
        readyState = 1;
        constructor(url: string) {
            super();
            opened.push(url);
            queueMicrotask(() => {
                this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
            });
        }
        send() {}
        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);
    return opened;
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('protocol v2 is the default', () => {
    it('is commit-reveal, with no flag to opt in', () => {
        expect(PROTOCOL_VERSION).toBe(PROTOCOL_VERSION_V2);
        expect(session().useFairCommit).toBe(true);
        expect(session().getState().protocolVersion).toBe(2);
    });
});

describe('RoomSession.joinRoom protocol version', () => {
    it('refuses a room whose host speaks another version before opening a socket', async () => {
        roomReports({ protocolVersion: 1 });
        const opened = workerAnswers({ type: 'joined' });
        const guest = session();
        await expect(guest.joinRoom('K7Q2M')).rejects.toThrow(/Protocol version mismatch/);
        expect(guest.getState().status).toBe('error');
        expect(guest.getState().statusDetail).toMatch(/different app version/);
        expect(opened).toHaveLength(0);
    });

    it('joins a room no host has opened yet (no version recorded)', async () => {
        roomReports({ protocolVersion: null });
        const opened = workerAnswers({ type: 'joined', peerId: 'guest-1', role: 'guest' });
        const guest = session();
        await guest.joinRoom('K7Q2M');
        expect(opened[0]).toContain('protocolVersion=2');
        expect(guest.getState().status).toBe('joining');
        guest.leave();
    });

    it("stops on the Worker's refusal frame instead of reconnecting", async () => {
        vi.useFakeTimers();
        roomReports({ protocolVersion: 2 });
        const opened = workerAnswers({
            type: 'error',
            error: 'protocol_version_mismatch',
            expected: 2,
            received: 1,
        });
        const guest = session();
        await expect(guest.joinRoom('K7Q2M')).rejects.toThrow(/Protocol version mismatch/);
        expect(guest.getState().status).toBe('error');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(opened).toHaveLength(1);
        expect(guest.getState().status).toBe('error');
        expect(guest.getState().statusDetail).toMatch(/Protocol version mismatch/);
    });
});
