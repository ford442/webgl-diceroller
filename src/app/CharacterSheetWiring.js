/**
 * Binds the character sheet prop's texture to the current session actor —
 * no fabricated stats, just name + last roll expression. Mirrors the shape
 * of SessionWiring.js but only reacts to session/roll events, it doesn't own
 * any state itself.
 */

import { AppEvent } from '../core/AppEvents.js';
import { currentActor } from '../session/SessionState.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 * @property {ReturnType<import('../environment/CharacterSheet.js').createCharacterSheet>} deps.characterSheetProp
 */
export function setupCharacterSheetWiring(app, deps) {
    const { appEvents, characterSheetProp } = deps;
    if (!characterSheetProp?.update) return;

    const redraw = () => {
        const snapshot = app.session?.getSnapshot?.();
        if (!snapshot) return;
        const actor = currentActor(snapshot);
        characterSheetProp.update({
            actorName: actor?.name ?? null,
            lastExpression: snapshot.lastExpression ?? null,
        });
    };

    appEvents.on(AppEvent.SESSION_INITIATIVE, redraw);
    appEvents.on(AppEvent.SESSION_TURN, redraw);
    appEvents.on(AppEvent.ROLL_EVALUATED, redraw);
    appEvents.on(AppEvent.ROLL_SETTLED, redraw);

    redraw();
}
