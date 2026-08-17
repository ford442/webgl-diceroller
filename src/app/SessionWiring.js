/**
 * Session strip wiring — initiative / turn state via AppEvents (not main.js).
 */

import { AppEvent } from '../core/AppEvents.js';
import {
    currentActor,
    loadSessionFromStorage,
    normalizeSessionSnapshot,
    passTurn,
    saveSessionToStorage,
} from '../session/SessionState.js';
import { createSessionStrip } from '../ui/SessionStrip.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function setupSessionWiring(app, deps) {
    const { appEvents, multiplayerRef, getRoomCode } = deps;

    let snapshot = loadSessionFromStorage(getRoomCode?.() ?? null);

    function persist() {
        saveSessionToStorage(getRoomCode?.() ?? null, snapshot);
        multiplayerRef.current?.pushPersistedRoomState?.();
    }

    function emitInitiative() {
        appEvents.emit(AppEvent.SESSION_INITIATIVE, {
            order: snapshot.seats,
            currentIndex: snapshot.currentIndex,
        });
    }

    function emitTurn(direction = 'pass') {
        const actor = currentActor(snapshot);
        appEvents.emit(AppEvent.SESSION_TURN, {
            actorId: actor?.id ?? null,
            actorName: actor?.name ?? null,
            direction,
        });
    }

    function applyRemoteSession(msg) {
        snapshot = normalizeSessionSnapshot(msg);
        persist();
        emitInitiative();
        panel.refresh(snapshot);
    }

    function broadcastIfHost() {
        if (multiplayerRef.current?.isHost?.()) {
            multiplayerRef.current.broadcastSessionSync?.(snapshot);
        }
    }

    const panel = createSessionStrip({
        onPassTurn: () => {
            if (multiplayerRef.current?.isGuest?.()) return;
            snapshot = passTurn(snapshot);
            persist();
            emitTurn('pass');
            emitInitiative();
            broadcastIfHost();
            panel.refresh(snapshot);
        },
        getCurrentActorLabel: () => {
            const actor = currentActor(snapshot);
            return actor?.name ?? '—';
        },
        getLastExpression: () => snapshot.lastExpression ?? '—',
    });

    appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
        const results = /** @type {{ results?: unknown }} */ (payload)?.results;
        if (!results || !Array.isArray(results)) return;
        const total = results.reduce((sum, r) => sum + (Number(r?.value) || 0), 0);
        if (pendingRollMetaExpression()) {
            snapshot = { ...snapshot, lastExpression: `${pendingRollMetaExpression()} → ${total}` };
        } else if (results.length) {
            snapshot = { ...snapshot, lastExpression: `Roll → ${total}` };
        }
        persist();
        panel.refresh(snapshot);
    });

    appEvents.on(AppEvent.ROLL_EVALUATED, (payload) => {
        const result = /** @type {{ result?: { expression?: string, total?: number } }} */ (payload)
            ?.result;
        if (!result) return;
        const expr = result.expression ?? snapshot.lastExpression;
        const total = result.total;
        snapshot = {
            ...snapshot,
            lastExpression: total != null ? `${expr} = ${total}` : String(expr),
        };
        persist();
        panel.refresh(snapshot);
    });

    function pendingRollMetaExpression() {
        return deps.getPendingExpression?.() ?? null;
    }

    panel.refresh(snapshot);
    emitInitiative();

    app.session = {
        getSnapshot: () => ({ ...snapshot }),
        applyRemoteSession,
        setSeats: (seats) => {
            if (multiplayerRef.current?.isGuest?.()) return;
            snapshot = normalizeSessionSnapshot({ ...snapshot, seats });
            persist();
            emitInitiative();
            broadcastIfHost();
            panel.refresh(snapshot);
        },
    };

    return { panel, applyRemoteSession };
}
