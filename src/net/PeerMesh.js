/**
 * Star-topology WebRTC mesh: host opens a DataChannel to each guest;
 * guests create an offer toward the host.
 */

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * @typedef {{
 *   peerId: string,
 *   pc: RTCPeerConnection,
 *   channel: RTCDataChannel | null,
 *   polite: boolean,
 * }} PeerLink
 */

/**
 * @param {{
 *   localPeerId: string,
 *   role: 'host' | 'guest',
 *   sendSignal: (toPeerId: string, data: unknown) => void,
 *   onChannelMessage: (fromPeerId: string, raw: string) => void,
 *   onPeerConnected?: (peerId: string) => void,
 *   onPeerDisconnected?: (peerId: string) => void,
 *   iceServers?: RTCIceServer[],
 * }} opts
 */
export function createPeerMesh(opts) {
    const iceServers = opts.iceServers ?? DEFAULT_ICE;
    /** @type {Map<string, PeerLink>} */
    const peers = new Map();
    let closed = false;

    /**
     * @param {string} peerId
     * @returns {PeerLink}
     */
    function ensurePeer(peerId) {
        let link = peers.get(peerId);
        if (link) return link;

        const pc = new RTCPeerConnection({ iceServers });
        link = {
            peerId,
            pc,
            channel: null,
            polite: opts.role === 'guest',
        };
        peers.set(peerId, link);

        pc.onicecandidate = (ev) => {
            if (ev.candidate) {
                opts.sendSignal(peerId, { kind: 'ice', candidate: ev.candidate.toJSON() });
            }
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'failed' || state === 'closed' || state === 'disconnected') {
                if (state === 'failed' || state === 'closed') {
                    teardownPeer(peerId, /* notify */ true);
                } else {
                    opts.onPeerDisconnected?.(peerId);
                }
            }
        };

        pc.ondatachannel = (ev) => {
            bindChannel(link, ev.channel);
        };

        return link;
    }

    /**
     * @param {PeerLink} link
     * @param {RTCDataChannel} channel
     */
    function bindChannel(link, channel) {
        link.channel = channel;
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => {
            opts.onPeerConnected?.(link.peerId);
        };
        channel.onclose = () => {
            opts.onPeerDisconnected?.(link.peerId);
        };
        channel.onerror = () => {
            opts.onPeerDisconnected?.(link.peerId);
        };
        channel.onmessage = (ev) => {
            const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
            opts.onChannelMessage(link.peerId, raw);
        };
    }

    /**
     * Host initiates: create offer + data channel toward guest.
     * @param {string} remotePeerId
     */
    async function connectToGuest(remotePeerId) {
        if (closed || opts.role !== 'host') return;
        const link = ensurePeer(remotePeerId);
        if (link.channel && link.channel.readyState === 'open') return;

        const channel = link.pc.createDataChannel('dice', { ordered: true });
        bindChannel(link, channel);

        const offer = await link.pc.createOffer();
        await link.pc.setLocalDescription(offer);
        opts.sendSignal(remotePeerId, {
            kind: 'sdp',
            sdp: link.pc.localDescription,
        });
    }

    /**
     * Guest initiates: create offer toward host (host answers; host creates the channel? )
     * Star: host creates the DataChannel. Guest waits for ondatachannel OR guest creates channel.
     * Simpler: whoever is host always creates the channel when they learn of a guest.
     * Guest only answers offers. Guest can also send offers if host missed peer-joined —
     * then host answers and still creates channel on negotiation.
     *
     * Flow used here:
     * - Host on peer-joined(guest) → connectToGuest (offer + channel)
     * - Guest on signal(sdp offer) → setRemote, createAnswer
     * - Guest never creates channel; waits for host's channel
     */

    /**
     * @param {string} fromPeerId
     * @param {any} data
     */
    async function handleSignal(fromPeerId, data) {
        if (closed || !data?.kind) return;
        const link = ensurePeer(fromPeerId);

        if (data.kind === 'ice' && data.candidate) {
            try {
                await link.pc.addIceCandidate(data.candidate);
            } catch (err) {
                console.warn('[PeerMesh] addIceCandidate failed', err);
            }
            return;
        }

        if (data.kind === 'sdp' && data.sdp) {
            const desc = data.sdp;
            try {
                await link.pc.setRemoteDescription(desc);
                if (desc.type === 'offer') {
                    // Guest (or host answering a guest-initiated offer) answers.
                    if (opts.role === 'host' && !link.channel) {
                        const channel = link.pc.createDataChannel('dice', { ordered: true });
                        bindChannel(link, channel);
                    }
                    const answer = await link.pc.createAnswer();
                    await link.pc.setLocalDescription(answer);
                    opts.sendSignal(fromPeerId, {
                        kind: 'sdp',
                        sdp: link.pc.localDescription,
                    });
                }
            } catch (err) {
                console.warn('[PeerMesh] SDP handling failed', err);
            }
        }
    }

    /**
     * @param {string} peerId
     * @param {string} raw
     * @returns {boolean}
     */
    function sendTo(peerId, raw) {
        const link = peers.get(peerId);
        if (!link?.channel || link.channel.readyState !== 'open') return false;
        try {
            link.channel.send(raw);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @param {string} raw
     * @returns {number} how many peers received it
     */
    function broadcast(raw) {
        let n = 0;
        for (const id of peers.keys()) {
            if (sendTo(id, raw)) n += 1;
        }
        return n;
    }

    /**
     * @param {string} peerId
     * @param {boolean} [notify]
     */
    function teardownPeer(peerId, notify = false) {
        const link = peers.get(peerId);
        if (!link) return;
        peers.delete(peerId);
        try {
            link.channel?.close();
        } catch {
            /* ignore */
        }
        try {
            link.pc.close();
        } catch {
            /* ignore */
        }
        if (notify) opts.onPeerDisconnected?.(peerId);
    }

    function getConnectedPeerIds() {
        return [...peers.entries()]
            .filter(([, link]) => link.channel?.readyState === 'open')
            .map(([id]) => id);
    }

    function close() {
        closed = true;
        for (const id of [...peers.keys()]) {
            teardownPeer(id, false);
        }
    }

    return {
        connectToGuest,
        handleSignal,
        sendTo,
        broadcast,
        teardownPeer,
        getConnectedPeerIds,
        close,
        get size() {
            return peers.size;
        },
    };
}
