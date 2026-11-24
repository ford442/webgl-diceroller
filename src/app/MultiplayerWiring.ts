/**
 * Optional multiplayer room session + panel, wired up only when a signaling
 * URL resolves from the page's search params.
 *
 * This file is the gate and nothing else: the room stack (RoomSession, PeerMesh,
 * the signaling client, the panel) is its own chunk, imported here only when
 * there is somewhere to connect to. The entry chunk keeps the `RoomSession`
 * *types* only (erased at build time).
 */

import { resolveSignalingUrl } from '../net/signalingUrl.js';
import type { AppContext } from '../types/app';
import type { MultiplayerWiringDeps } from './MultiplayerRoom.js';

export type { MultiplayerWiringDeps } from './MultiplayerRoom.js';

export async function setupMultiplayer(
    app: AppContext,
    deps: MultiplayerWiringDeps
): Promise<{ roomParam: string | null }> {
    const signalingUrl = resolveSignalingUrl(deps.searchParams);
    if (!signalingUrl) return { roomParam: deps.searchParams.get('room') };

    const { startMultiplayer } = await import('./MultiplayerRoom.js');
    return startMultiplayer(app, deps, signalingUrl);
}
