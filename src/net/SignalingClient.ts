/**
 * HTTP + WebSocket client for the Cloudflare signaling Worker.
 */

export interface SignalingUrlParts {
    httpBase: string;
    wsBase: string;
}

export interface SignalingMessage {
    type: string;
    peerId?: string;
    role?: string;
    peers?: Array<{ peerId: string; role: string }>;
    error?: string;
    to?: string;
    data?: unknown;
    diceCounts?: Record<string, number> | null;
    presence?: unknown;
    lastRoll?: unknown;
    layoutSeed?: number | null;
    session?: unknown;
    pendingCommit?: unknown;
    lastReveal?: unknown;
    protocolVersion?: number;
    solverBuildId?: string | null;
    [key: string]: unknown;
}

export type SignalingMessageHandler = (msg: SignalingMessage) => void;

export interface CreateRoomResult {
    code: string;
}

export interface RoomExistsResult {
    exists: boolean;
    peerCount: number;
    protocolVersion?: number;
    solverBuildId?: string | null;
}

export interface ConnectRoomOptions {
    peerId: string;
    role: 'host' | 'guest';
    solverBuildId?: string;
    protocolVersion?: number;
}

export interface ConnectRoomResult {
    peerId: string;
    role: string;
    peers: Array<{ peerId: string; role: string }>;
}

export interface RoomStatePayload {
    diceCounts?: Record<string, number> | null;
    presence?: unknown;
    lastRoll?: unknown;
    layoutSeed?: number | null;
    session?: unknown;
    pendingCommit?: unknown;
    lastReveal?: unknown;
}

export interface SignalingClient {
    httpBase: string;
    wsBase: string;
    createRoom: () => Promise<CreateRoomResult>;
    roomExists: (code: string) => Promise<RoomExistsResult>;
    connectRoom: (code: string, opts: ConnectRoomOptions) => Promise<ConnectRoomResult>;
    send: (msg: SignalingMessage) => boolean;
    sendSignal: (toPeerId: string, data: unknown) => boolean;
    pushRoomState: (payload: RoomStatePayload) => boolean;
    onMessage: (fn: SignalingMessageHandler) => () => void;
    disconnect: () => void;
    isConnected: () => boolean;
}

const SIGNALING_ERROR_MESSAGES: Record<string, string> = {
    solver_build_mismatch:
        'Solver build mismatch — rebuild WASM on all clients (npm run build:wasm) and refresh.',
    protocol_version_mismatch: 'Protocol version mismatch — use the same app build on all clients.',
    host_already_present: 'Another host is already connected to this room.',
    room_not_found: 'Room not found.',
    room_full: 'Room is full (max 6 players).',
};

function signalingErrorMessage(errorCode: string): string {
    return SIGNALING_ERROR_MESSAGES[errorCode] ?? errorCode;
}

/**
 * @param baseUrl  e.g. https://dice-signal.example.workers.dev or http://127.0.0.1:8787
 */
export function normalizeSignalingUrl(baseUrl: string): SignalingUrlParts {
    const trimmed = String(baseUrl || '').replace(/\/+$/, '');
    if (!trimmed) return { httpBase: '', wsBase: '' };
    let httpBase = trimmed;
    if (httpBase.startsWith('ws://')) httpBase = 'http://' + httpBase.slice(5);
    if (httpBase.startsWith('wss://')) httpBase = 'https://' + httpBase.slice(6);
    const wsBase = httpBase.replace(/^http/, 'ws');
    return { httpBase, wsBase };
}

export function createSignalingClient(signalingUrl: string): SignalingClient {
    const { httpBase, wsBase } = normalizeSignalingUrl(signalingUrl);
    let ws: WebSocket | null = null;
    const listeners = new Set<SignalingMessageHandler>();

    function onMessage(fn: SignalingMessageHandler): () => void {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function emit(msg: SignalingMessage): void {
        for (const fn of [...listeners]) {
            try {
                fn(msg);
            } catch (err) {
                console.error('[SignalingClient] listener error', err);
            }
        }
    }

    async function createRoom(): Promise<CreateRoomResult> {
        if (!httpBase) throw new Error('signaling_url_missing');
        const res = await fetch(`${httpBase}/rooms`, { method: 'POST' });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`create_room_failed:${res.status}:${body}`);
        }
        return (await res.json()) as CreateRoomResult;
    }

    async function roomExists(code: string): Promise<RoomExistsResult> {
        if (!httpBase) throw new Error('signaling_url_missing');
        const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error(`room_lookup_failed:${res.status}`);
        return (await res.json()) as RoomExistsResult;
    }

    function connectRoom(code: string, opts: ConnectRoomOptions): Promise<ConnectRoomResult> {
        if (!wsBase) return Promise.reject(new Error('signaling_url_missing'));

        disconnect();

        const params = new URLSearchParams();
        params.set('peerId', opts.peerId);
        params.set('role', opts.role);
        if (opts.solverBuildId) params.set('solverBuildId', opts.solverBuildId);
        if (opts.protocolVersion != null)
            params.set('protocolVersion', String(opts.protocolVersion));

        const url = `${wsBase}/rooms/${encodeURIComponent(code)}?${params.toString()}`;

        return new Promise((resolve, reject) => {
            let settled = false;
            const socket = new WebSocket(url);
            ws = socket;

            const fail = (err: unknown): void => {
                if (settled) return;
                settled = true;
                reject(err instanceof Error ? err : new Error(String(err)));
            };

            socket.addEventListener('open', () => {
                /* wait for joined */
            });

            socket.addEventListener('message', (event: MessageEvent) => {
                let msg: SignalingMessage;
                try {
                    msg = JSON.parse(String(event.data)) as SignalingMessage;
                } catch {
                    return;
                }
                emit(msg);
                if (!settled && msg?.type === 'joined') {
                    settled = true;
                    resolve({
                        peerId: msg.peerId ?? opts.peerId,
                        role: msg.role ?? opts.role,
                        peers: msg.peers ?? [],
                    });
                }
                if (!settled && msg?.error) {
                    fail(new Error(signalingErrorMessage(String(msg.error))));
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

    function send(msg: SignalingMessage): boolean {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
    }

    function sendSignal(toPeerId: string, data: unknown): boolean {
        return send({ type: 'signal', to: toPeerId, data });
    }

    function pushRoomState(payload: RoomStatePayload): boolean {
        return send({ type: 'room-state', ...payload });
    }

    function disconnect(): void {
        if (ws) {
            try {
                ws.close();
            } catch {
                /* ignore */
            }
            ws = null;
        }
    }

    function isConnected(): boolean {
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
        pushRoomState,
        onMessage,
        disconnect,
        isConnected,
    };
}
