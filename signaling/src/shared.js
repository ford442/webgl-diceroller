/** Crockford base32 alphabet (no I, L, O, U). */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * @param {number} [len]
 * @returns {string}
 */
export function generateRoomCode(len = 5) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
}

/**
 * @param {string} code
 * @returns {string}
 */
export function normalizeCode(code) {
    return String(code || '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/[ILOU]/g, '');
}

export function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

/**
 * @param {DurableObjectState} doState
 * @returns {Array<{ peerId: string, role: string }>}
 */
export function listConnectedPeers(doState) {
    const peers = [];
    for (const ws of doState.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att?.peerId) {
            peers.push({ peerId: att.peerId, role: att.role ?? 'guest' });
        }
    }
    return peers;
}

/**
 * @param {DurableObjectState} doState
 * @param {string} peerId
 * @returns {WebSocket | undefined}
 */
export function findPeerSocket(doState, peerId) {
    for (const ws of doState.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att?.peerId === peerId) return ws;
    }
    return undefined;
}

/**
 * @param {DurableObjectState} doState
 * @param {string} exceptPeerId
 * @param {object} msg
 */
export function broadcastToPeers(doState, msg, exceptPeerId) {
    const raw = JSON.stringify(msg);
    for (const ws of doState.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (!att?.peerId || att.peerId === exceptPeerId) continue;
        try {
            ws.send(raw);
        } catch {
            /* ignore closed sockets */
        }
    }
}
