/**
 * HTTP + WebSocket client for the Cloudflare signaling Worker.
 */

/**
 * @param {string} baseUrl  e.g. https://dice-signal.example.workers.dev or http://127.0.0.1:8787
 * @returns {{ httpBase: string, wsBase: string }}
 */
export function normalizeSignalingUrl(baseUrl) {
    const trimmed = String(baseUrl || '').replace(/\/+$/, '');
    if (!trimmed) return { httpBase: '', wsBase: '' };
    let httpBase = trimmed;
    if (httpBase.startsWith('ws://')) httpBase = 'http://' + httpBase.slice(5);
    if (httpBase.startsWith('wss://')) httpBase = 'https://' + httpBase.slice(6);
    const wsBase = httpBase.replace(/^http/, 'ws');
    return { httpBase, wsBase };
}

/**
 * @param {string} signalingUrl
 */
export function createSignalingClient(signalingUrl) {
    const { httpBase, wsBase } = normalizeSignalingUrl(signalingUrl);
    /** @type {WebSocket | null} */
    let ws = null;
    /** @type {Set<(msg: object) => void>} */
    const listeners = new Set();

    /**
     * @param {(msg: object) => void} fn
     * @returns {() => void}
     */
    function onMessage(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    /**
     * @param {object} msg
     */
    function emit(msg) {
        for (const fn of [...listeners]) {
            try {
                fn(msg);
            } catch (err) {
                console.error('[SignalingClient] listener error', err);
            }
        }
    }

    /**
     * @returns {Promise<{ code: string }>}
     */
    async function createRoom() {
        if (!httpBase) throw new Error('signaling_url_missing');
        const res = await fetch(`${httpBase}/rooms`, { method: 'POST' });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`create_room_failed:${res.status}:${body}`);
        }
        return /** @type {{ code: string }} */ (await res.json());
    }

    /**
     * @param {string} code
     * @returns {Promise<{ exists: boolean, peerCount: number }>}
     */
    async function roomExists(code) {
        if (!httpBase) throw new Error('signaling_url_missing');
        const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error(`room_lookup_failed:${res.status}`);
        return /** @type {{ exists: boolean, peerCount: number }} */ (await res.json());
    }

    /**
     * @param {string} code
     * @param {{ peerId: string, role: 'host' | 'guest' }} opts
     * @returns {Promise<{ peerId: string, role: string, peers: Array<{ peerId: string, role: string }> }>}
     */
    function connectRoom(code, opts) {
        if (!wsBase) return Promise.reject(new Error('signaling_url_missing'));

        disconnect();

        const url =
            `${wsBase}/rooms/${encodeURIComponent(code)}` +
            `?peerId=${encodeURIComponent(opts.peerId)}` +
            `&role=${encodeURIComponent(opts.role)}`;

        return new Promise((resolve, reject) => {
            let settled = false;
            const socket = new WebSocket(url);
            ws = socket;

            const fail = (err) => {
                if (settled) return;
                settled = true;
                reject(err instanceof Error ? err : new Error(String(err)));
            };

            socket.addEventListener('open', () => {
                /* wait for joined */
            });

            socket.addEventListener('message', (event) => {
                let msg;
                try {
                    msg = JSON.parse(String(event.data));
                } catch {
                    return;
                }
                emit(msg);
                if (!settled && msg?.type === 'joined') {
                    settled = true;
                    resolve({
                        peerId: msg.peerId,
                        role: msg.role,
                        peers: msg.peers ?? [],
                    });
                }
                if (!settled && msg?.error) {
                    fail(new Error(msg.error));
                }
            });

            socket.addEventListener('error', () => fail(new Error('signaling_ws_error')));
            socket.addEventListener('close', () => {
                emit({ type: 'signaling-closed' });
                if (!settled) fail(new Error('signaling_ws_closed'));
                if (ws === socket) ws = null;
            });
        });
    }

    /**
     * @param {object} msg
     */
    function send(msg) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
    }

    /**
     * Relay SDP/ICE to a peer via the Worker.
     * @param {string} toPeerId
     * @param {unknown} data
     */
    function sendSignal(toPeerId, data) {
        return send({ type: 'signal', to: toPeerId, data });
    }

    function disconnect() {
        if (ws) {
            try {
                ws.close();
            } catch {
                /* ignore */
            }
            ws = null;
        }
    }

    function isConnected() {
        return ws != null && ws.readyState === WebSocket.OPEN;
    }

    return {
        httpBase,
        wsBase,
        createRoom,
        roomExists,
        connectRoom,
        send,
        sendSignal,
        onMessage,
        disconnect,
        isConnected,
    };
}
