/**
 * URL flags and negotiated protocol version for multiplayer.
 */

import { PROTOCOL_VERSION_V1, PROTOCOL_VERSION_V2 } from './Protocol.js';

/**
 * @param {URLSearchParams} [searchParams]
 */
export function isFairCommitEnabled(searchParams?: URLSearchParams): boolean {
    const params = searchParams ?? new URLSearchParams(window.location.search);
    return params.has('fair-commit');
}

/**
 * @param {URLSearchParams} [searchParams]
 */
export function resolveNegotiatedProtocolVersion(searchParams?: URLSearchParams): number {
    return isFairCommitEnabled(searchParams) ? PROTOCOL_VERSION_V2 : PROTOCOL_VERSION_V1;
}
