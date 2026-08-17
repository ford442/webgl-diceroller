/**
 * Initiative / turn state for the session strip (desktop + multiplayer sync).
 */

export interface SessionSeat {
    id: string;
    name: string;
    initiative?: number | null;
}

export interface SessionSnapshot {
    seats: SessionSeat[];
    currentIndex: number;
    lastExpression: string | null;
}

export function createDefaultSessionSnapshot(): SessionSnapshot {
    return {
        seats: [
            { id: 'seat-1', name: 'Player 1' },
            { id: 'seat-2', name: 'Player 2' },
        ],
        currentIndex: 0,
        lastExpression: null,
    };
}

export function normalizeSessionSnapshot(
    raw: Partial<SessionSnapshot> | null | undefined
): SessionSnapshot {
    if (!raw || typeof raw !== 'object') return createDefaultSessionSnapshot();
    const seats = Array.isArray(raw.seats)
        ? raw.seats
              .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
              .map((s) => ({
                  id: s.id,
                  name: s.name,
                  initiative: s.initiative ?? null,
              }))
        : createDefaultSessionSnapshot().seats;
    const currentIndex =
        typeof raw.currentIndex === 'number' && seats.length > 0
            ? Math.max(0, Math.min(seats.length - 1, raw.currentIndex))
            : 0;
    return {
        seats,
        currentIndex,
        lastExpression: raw.lastExpression ?? null,
    };
}

export function passTurn(snapshot: SessionSnapshot): SessionSnapshot {
    if (!snapshot.seats.length) return snapshot;
    return {
        ...snapshot,
        currentIndex: (snapshot.currentIndex + 1) % snapshot.seats.length,
    };
}

export function currentActor(snapshot: SessionSnapshot): SessionSeat | null {
    return snapshot.seats[snapshot.currentIndex] ?? null;
}

export function sessionStorageKey(roomCode: string | null): string {
    return roomCode ? `dice-session:${roomCode}` : 'dice-session:local';
}

export function loadSessionFromStorage(roomCode: string | null): SessionSnapshot {
    try {
        const raw = localStorage.getItem(sessionStorageKey(roomCode));
        if (!raw) return createDefaultSessionSnapshot();
        return normalizeSessionSnapshot(JSON.parse(raw));
    } catch {
        return createDefaultSessionSnapshot();
    }
}

export function saveSessionToStorage(roomCode: string | null, snapshot: SessionSnapshot): void {
    try {
        localStorage.setItem(sessionStorageKey(roomCode), JSON.stringify(snapshot));
    } catch {
        /* ignore quota */
    }
}
