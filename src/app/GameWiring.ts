/**
 * The Farkle panel and `window.__app.game`, the one place a game is started.
 *
 * This file is only the facade: the panel, a handful of guards, and the
 * handle to the running session. Everything that plays the game — the rules,
 * the bot, GameSession, the adapter that seats dice on the real table — lives
 * in `GameTable.ts`, fetched on the first "Play Farkle" and never for a person
 * who does not open a game. Types come from there too (erased at build time).
 */

import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { isTouchPrimaryDevice } from '../core/DeviceCapabilities.js';
import { createFarklePanel, type FarklePanel } from '../ui/FarklePanel.js';
import type { AppContext } from '../types/app';
import type { SubmitResult } from './GameSession.js';
import type { FarkleAction } from 'dice-core/game/Farkle';
import type {
    FarkleSession,
    FarkleSnapshot,
    FarkleStartOptions,
    GameWiringDeps,
} from './GameTable.js';

export type { FarkleSession, FarkleSnapshot, FarkleStartOptions, GameWiringDeps };

export function setupGameWiring(app: AppContext, deps: GameWiringDeps) {
    const touchUi = isTouchPrimaryDevice();
    let session: FarkleSession | null = null;
    let unsubscribe: (() => void) | null = null;

    const panel: FarklePanel = createFarklePanel({
        touchUi,
        actions: {
            onStart: () => void start(),
            onClose: () => void close(),
            onThrow: () => session?.submit({ type: 'roll' }),
            onKeep: (dice) => session?.submit({ type: 'keep', dice }),
            onBank: () => session?.submit({ type: 'bank' }),
            onRethrow: () => session?.rethrow(),
        },
    });

    function unavailable(): string | null {
        if (!isWasmAvailable()) return 'Farkle needs the physics engine, which did not load.';
        if (deps.multiplayerRef.current?.isHost?.() || deps.multiplayerRef.current?.isGuest?.()) {
            return 'Farkle is solo for now — leave the room to play.';
        }
        if (!deps.getDiceJailController()) {
            return 'Farkle sets dice aside in the dice jail, which is not on the table yet.';
        }
        if (deps.rollWiring.getRollState().phase === 'rolling') {
            return 'Wait for the dice to settle first.';
        }
        return null;
    }

    async function close(): Promise<void> {
        const ending = session;
        session = null;
        unsubscribe?.();
        unsubscribe = null;
        await ending?.stop();
        panel.render(null);
    }

    async function start(options: FarkleStartOptions = {}): Promise<FarkleSession | null> {
        // A finished or abandoned game is cleared first, which also puts the
        // table back the way the player had it.
        if (session) await close();
        const blocked = unavailable();
        if (blocked) {
            panel.showMessage(blocked);
            return null;
        }

        let next: FarkleSession;
        try {
            const { createFarkleTableSession } = await import('./GameTable.js');
            next = createFarkleTableSession({ deps, options });
        } catch (err) {
            // A stale or unreachable chunk must read as a message, not a dead button.
            console.error('[Game] could not load the game', err);
            panel.showMessage('Farkle could not load. Check your connection and try again.');
            return null;
        }
        session = next;
        unsubscribe = next.subscribe((snapshot) => {
            if (session === next) panel.render(snapshot, next.preview);
        });
        panel.render(next.getSnapshot(), next.preview);
        void next.start().catch((err) => console.error('[Game] session failed', err));
        return next;
    }

    /**
     * R / "Roll All" / the results re-roll while a game owns the table: they
     * would throw the free dice outside the rules, so during a game they mean
     * "my throw" — if a throw is what the rules are waiting for.
     */
    function interceptRoll(): boolean {
        // Only a game in progress: once it is over (or stopped) R means R again.
        if (!session?.isActive()) return false;
        const snapshot = session.getSnapshot();
        if (snapshot.legal.some((a) => a.type === 'roll')) session.submit({ type: 'roll' });
        return true;
    }

    const api = {
        start,
        stop: close,
        interceptRoll,
        isActive: () => session?.isActive() ?? false,
        getSession: () => session,
        getSnapshot: (): FarkleSnapshot | null => session?.getSnapshot() ?? null,
        submit: (action: FarkleAction): SubmitResult =>
            session?.submit(action) ?? { ok: false, error: 'No game is running.' },
        rethrow: (): SubmitResult =>
            session?.rethrow() ?? { ok: false, error: 'No game is running.' },
        panel,
    };
    app.game = api;
    return api;
}

export type GameWiring = ReturnType<typeof setupGameWiring>;
