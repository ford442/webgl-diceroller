/**
 * Where the signaling server is, if there is one. Lives apart from RoomSession
 * so the always-loaded entry can ask "is multiplayer configured?" without
 * pulling the whole room stack (RoomSession, PeerMesh, SignalingClient) into
 * the entry chunk: a session with no signaling URL never fetches it.
 */
export function resolveSignalingUrl(
    searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): string {
    const fromQuery = searchParams.get('signal');
    if (fromQuery) return fromQuery;
    try {
        return String(import.meta.env.VITE_SIGNALING_URL || '');
    } catch {
        return '';
    }
}
