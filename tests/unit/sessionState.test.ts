/**
 * Unit tests for turn-order session state (SessionState.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createDefaultSessionSnapshot,
    currentActor,
    loadSessionFromStorage,
    normalizeSessionSnapshot,
    passTurn,
    saveSessionToStorage,
    sessionStorageKey,
} from '../../src/session/SessionState.js';

beforeEach(() => {
    localStorage.clear();
});

describe('createDefaultSessionSnapshot', () => {
    it('returns two default seats, currentIndex 0, and lastExpression null', () => {
        const snapshot = createDefaultSessionSnapshot();
        expect(snapshot.seats).toEqual([
            { id: 'seat-1', name: 'Player 1' },
            { id: 'seat-2', name: 'Player 2' },
        ]);
        expect(snapshot.currentIndex).toBe(0);
        expect(snapshot.lastExpression).toBeNull();
    });
});

describe('normalizeSessionSnapshot', () => {
    it('returns the default snapshot for null/undefined/non-object input', () => {
        expect(normalizeSessionSnapshot(null)).toEqual(createDefaultSessionSnapshot());
        expect(normalizeSessionSnapshot(undefined)).toEqual(createDefaultSessionSnapshot());
        // @ts-expect-error intentional bad type
        expect(normalizeSessionSnapshot('nope')).toEqual(createDefaultSessionSnapshot());
        // @ts-expect-error intentional bad type
        expect(normalizeSessionSnapshot(42)).toEqual(createDefaultSessionSnapshot());
    });

    it('filters out seats missing a string id or name', () => {
        const result = normalizeSessionSnapshot({
            seats: [
                { id: 'a', name: 'Alice' },
                { id: 'b' } as any,
                { name: 'NoId' } as any,
                { id: 3, name: 'BadId' } as any,
                { id: 'c', name: 5 } as any,
            ],
            currentIndex: 0,
            lastExpression: null,
        });
        expect(result.seats).toEqual([{ id: 'a', name: 'Alice', initiative: null }]);
    });

    it('defaults a seat initiative to null when absent, preserves it when present', () => {
        const result = normalizeSessionSnapshot({
            seats: [
                { id: 'a', name: 'Alice' },
                { id: 'b', name: 'Bob', initiative: 15 },
            ],
            currentIndex: 0,
            lastExpression: null,
        });
        expect(result.seats[0].initiative).toBeNull();
        expect(result.seats[1].initiative).toBe(15);
    });

    it('clamps a negative currentIndex to 0', () => {
        const result = normalizeSessionSnapshot({
            seats: [
                { id: 'a', name: 'Alice' },
                { id: 'b', name: 'Bob' },
            ],
            currentIndex: -5,
            lastExpression: null,
        });
        expect(result.currentIndex).toBe(0);
    });

    it('clamps a too-large currentIndex to seats.length - 1', () => {
        const result = normalizeSessionSnapshot({
            seats: [
                { id: 'a', name: 'Alice' },
                { id: 'b', name: 'Bob' },
            ],
            currentIndex: 99,
            lastExpression: null,
        });
        expect(result.currentIndex).toBe(1);
    });

    it('falls back to 0 for a non-numeric currentIndex', () => {
        const result = normalizeSessionSnapshot({
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 'two' as any,
            lastExpression: null,
        });
        expect(result.currentIndex).toBe(0);
    });

    it('falls back to the default seats array when raw.seats is not an array', () => {
        const result = normalizeSessionSnapshot({
            seats: 'not-an-array' as any,
            currentIndex: 0,
            lastExpression: null,
        });
        expect(result.seats).toEqual(createDefaultSessionSnapshot().seats);
    });

    it('preserves lastExpression when present, defaults to null otherwise', () => {
        const withExpr = normalizeSessionSnapshot({
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 0,
            lastExpression: '3d6+2',
        });
        expect(withExpr.lastExpression).toBe('3d6+2');

        const withoutExpr = normalizeSessionSnapshot({
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 0,
        } as any);
        expect(withoutExpr.lastExpression).toBeNull();
    });
});

describe('passTurn', () => {
    it('advances currentIndex by 1', () => {
        const snapshot = createDefaultSessionSnapshot();
        const next = passTurn(snapshot);
        expect(next.currentIndex).toBe(1);
    });

    it('wraps around to 0 after the last seat', () => {
        const snapshot = { ...createDefaultSessionSnapshot(), currentIndex: 1 };
        const next = passTurn(snapshot);
        expect(next.currentIndex).toBe(0);
    });

    it('returns the snapshot unchanged without throwing when seats is empty', () => {
        const snapshot = { seats: [], currentIndex: 0, lastExpression: null };
        expect(() => passTurn(snapshot)).not.toThrow();
        const result = passTurn(snapshot);
        expect(result).toBe(snapshot);
        expect(result.seats).toEqual([]);
    });
});

describe('currentActor', () => {
    it('returns the seat at currentIndex', () => {
        const snapshot = createDefaultSessionSnapshot();
        expect(currentActor(snapshot)).toEqual({ id: 'seat-1', name: 'Player 1' });

        const next = passTurn(snapshot);
        expect(currentActor(next)).toEqual({ id: 'seat-2', name: 'Player 2' });
    });

    it('returns null when currentIndex is out of range', () => {
        const snapshot = {
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 5,
            lastExpression: null,
        };
        expect(currentActor(snapshot)).toBeNull();
    });

    it('returns null when seats is empty', () => {
        const snapshot = { seats: [], currentIndex: 0, lastExpression: null };
        expect(currentActor(snapshot)).toBeNull();
    });
});

describe('sessionStorageKey', () => {
    it('returns "dice-session:local" for a null room code', () => {
        expect(sessionStorageKey(null)).toBe('dice-session:local');
    });

    it('returns a namespaced key for a room code', () => {
        expect(sessionStorageKey('ABCD')).toBe('dice-session:ABCD');
    });
});

describe('loadSessionFromStorage / saveSessionToStorage', () => {
    it('round-trips a snapshot through localStorage for a given room code', () => {
        const roomCode = 'ROOM1';
        const snapshot = normalizeSessionSnapshot({
            seats: [
                { id: 'a', name: 'Alice', initiative: 10 },
                { id: 'b', name: 'Bob', initiative: 5 },
            ],
            currentIndex: 1,
            lastExpression: '1d20',
        });
        saveSessionToStorage(roomCode, snapshot);
        const loaded = loadSessionFromStorage(roomCode);
        expect(loaded).toEqual(snapshot);
    });

    it('round-trips a snapshot for a null room code (the local key)', () => {
        const snapshot = normalizeSessionSnapshot({
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 0,
            lastExpression: 'foo',
        });
        saveSessionToStorage(null, snapshot);
        const loaded = loadSessionFromStorage(null);
        expect(loaded).toEqual(snapshot);
        expect(localStorage.getItem('dice-session:local')).not.toBeNull();
    });

    it('returns the default snapshot when localStorage has nothing for that key', () => {
        const loaded = loadSessionFromStorage('EMPTY-ROOM');
        expect(loaded).toEqual(createDefaultSessionSnapshot());
    });

    it('returns the default snapshot when localStorage has malformed JSON', () => {
        const roomCode = 'BADROOM';
        localStorage.setItem(sessionStorageKey(roomCode), 'not json');
        const loaded = loadSessionFromStorage(roomCode);
        expect(loaded).toEqual(createDefaultSessionSnapshot());
    });

    it('keeps different room codes isolated from each other and from the local key', () => {
        const snapshotA = normalizeSessionSnapshot({
            seats: [{ id: 'a', name: 'Alice' }],
            currentIndex: 0,
            lastExpression: 'A',
        });
        const snapshotB = normalizeSessionSnapshot({
            seats: [{ id: 'b', name: 'Bob' }],
            currentIndex: 0,
            lastExpression: 'B',
        });
        saveSessionToStorage('ROOM-A', snapshotA);
        saveSessionToStorage('ROOM-B', snapshotB);

        expect(loadSessionFromStorage('ROOM-A').lastExpression).toBe('A');
        expect(loadSessionFromStorage('ROOM-B').lastExpression).toBe('B');
        expect(loadSessionFromStorage(null)).toEqual(createDefaultSessionSnapshot());
    });
});
