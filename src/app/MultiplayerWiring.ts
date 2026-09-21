/**
 * Optional multiplayer room session + panel, wired up only when a signaling
 * URL resolves from the page's search params. Remote roll/table-sync
 * handling is delegated back to RollWiring, which owns roll state.
 */

import {
    getSpawnedDiceCounts,
    applyDicePresencePayload,
    buildDicePresencePayload,
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { createRoomSession, resolveSignalingUrl } from '../net/RoomSession.js';
import type { RoomSession } from '../net/RoomSession.js';
import { createMultiplayerPanel } from '../ui/MultiplayerPanel.js';
import { isTouchPrimaryDevice } from '../core/DeviceCapabilities.js';
import { loadSolverBuildId } from '../wasm/SolverBuildId.js';
import { resolveNegotiatedProtocolVersion, isFairCommitEnabled } from '../net/protocolFlags.js';
import type { AppContext, AppEvents } from '../types/app';
import type { createRollWiring } from './RollWiring.js';

export interface MultiplayerWiringDeps {
    searchParams: URLSearchParams;
    appEvents: AppEvents;
    multiplayerRef: { current: RoomSession | null };
    rollWiring: ReturnType<typeof createRollWiring>;
}

export async function setupMultiplayer(
    app: AppContext,
    deps: MultiplayerWiringDeps
): Promise<{ roomParam: string | null }> {
    const { searchParams, appEvents, multiplayerRef, rollWiring } = deps;

    const signalingUrl = resolveSignalingUrl(searchParams);
    const roomParam = searchParams.get('room');
    if (!signalingUrl) return { roomParam };

    const solverBuildId = await loadSolverBuildId(searchParams);
    const protocolVersion = resolveNegotiatedProtocolVersion(searchParams);
    const useFairCommit = isFairCommitEnabled(searchParams);

    const session = createRoomSession({
        signalingUrl,
        events: appEvents,
        protocolVersion,
        solverBuildId,
        useFairCommit,
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
