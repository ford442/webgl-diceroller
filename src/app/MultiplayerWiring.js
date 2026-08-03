/**
 * Optional multiplayer room session + panel, wired up only when a signaling
 * URL resolves from the page's search params. Remote roll/table-sync
 * handling is delegated back to RollWiring, which owns roll state.
 */

import {
    getSpawnedDiceCounts,
    getDiceAppearanceConfig,
    applyDicePresencePayload,
    buildDicePresencePayload,
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { createRoomSession, resolveSignalingUrl } from '../net/RoomSession.js';
import { createMultiplayerPanel } from '../ui/MultiplayerPanel.js';
import { isTouchPrimaryDevice } from '../core/DeviceCapabilities.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function setupMultiplayer(app, deps) {
    const { searchParams, appEvents, multiplayerRef, rollWiring } = deps;

    const signalingUrl = resolveSignalingUrl(searchParams);
    const roomParam = searchParams.get('room');
    if (!signalingUrl) return { roomParam };

    const session = createRoomSession({
        signalingUrl,
        events: appEvents,
        getDiceCounts: () => getSpawnedDiceCounts(),
        getPresencePayload: () => buildDicePresencePayload(getDiceAppearanceConfig()),
        applyPresencePayload: (payload) => {
            applyDicePresencePayload(payload);
        },
        isWasmAvailable,
        onRemoteRoll: rollWiring.handleRemoteRoll,
        onRemoteTableSync: rollWiring.handleRemoteTableSync,
    });
    multiplayerRef.current = session;
    app.multiplayer = session;

    const panelParent = document.getElementById('dice-controls-panel');
    if (panelParent) {
        const mpPanel = createMultiplayerPanel({
            parent: panelParent,
            touchUi: isTouchPrimaryDevice(),
            onCreate: () => session.createAndHost(),
            onJoin: (code) => session.joinRoom(code),
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
