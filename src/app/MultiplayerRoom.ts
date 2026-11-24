/**
 * Optional multiplayer room session + panel. This is the heavy half (RoomSession,
 * PeerMesh, the signaling client, the panel): `MultiplayerWiring.ts` imports it
 * dynamically, only once a signaling URL resolves, so a session with no
 * multiplayer never downloads it. Remote roll/table-sync handling is delegated
 * back to RollWiring, which owns roll state.
 */

import {
    getSpawnedDiceCounts,
    applyDicePresencePayload,
    buildDicePresencePayload,
} from '../dice.js';
import { getWorldHash, isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { createRoomSession } from '../net/RoomSession.js';
import type { RoomSession } from '../net/RoomSession.js';
import { createMultiplayerPanel } from '../ui/MultiplayerPanel.js';
import { isTouchPrimaryDevice } from '../core/DeviceCapabilities.js';
import { loadSolverBuildId } from 'dice-core/wasm/SolverBuildId';
import { PROTOCOL_VERSION } from '../net/Protocol.js';
import type { AppContext, AppEvents } from '../types/app';
import type { createRollWiring } from './RollWiring.js';

export interface MultiplayerWiringDeps {
    searchParams: URLSearchParams;
    appEvents: AppEvents;
    multiplayerRef: { current: RoomSession | null };
    rollWiring: ReturnType<typeof createRollWiring>;
}

export async function startMultiplayer(
    app: AppContext,
    deps: MultiplayerWiringDeps,
    signalingUrl: string
): Promise<{ roomParam: string | null }> {
    const { searchParams, appEvents, multiplayerRef, rollWiring } = deps;
    const roomParam = searchParams.get('room');

    const solverBuildId = await loadSolverBuildId(searchParams);

    const session = createRoomSession({
        signalingUrl,
        events: appEvents,
        // Commit-reveal (v2) for every room; there is no cleartext-seed mode.
        protocolVersion: PROTOCOL_VERSION,
        solverBuildId,
        getWorldHash,
        getDiceCounts: () => getSpawnedDiceCounts(),
        getPresencePayload: () => buildDicePresencePayload(),
        getSessionSnapshot: () => app.session?.getSnapshot?.() ?? null,
        applyPresencePayload: (payload) => {
            applyDicePresencePayload(payload);
        },
        isWasmAvailable,
        onRemoteRoll: rollWiring.handleRemoteRoll,
        onRemoteTableSync: rollWiring.handleRemoteTableSync,
        onRemoteCommit: rollWiring.handleRemoteCommit,
        onRemoteReveal: rollWiring.handleRemoteReveal,
        onRemoteSessionSync: (msg) => app.session?.applyRemoteSession?.(msg),
        onRoomSnapshot: rollWiring.handleRemoteTableSync,
    });
    multiplayerRef.current = session;
    app.multiplayer = session;

    const panelParent = document.getElementById('dice-controls-panel');
    if (panelParent) {
        const mpPanel = createMultiplayerPanel({
            parent: panelParent,
            touchUi: isTouchPrimaryDevice(),
            onCreate: () => session.createAndHost(),
            onJoin: (code: string) => session.joinRoom(code),
            onLeave: () => session.leave(),
        });
        session.onStatus((state) => mpPanel.updateStatus(state));
        if (roomParam) {
            mpPanel.setJoinCode(roomParam);
            session.joinRoom(roomParam).catch((err) => {
                console.warn('[Multiplayer] auto-join failed', err);
            });
        }
    } else if (roomParam) {
        session.joinRoom(roomParam).catch((err) => {
            console.warn('[Multiplayer] auto-join failed', err);
        });
    }

    return { roomParam };
}
