/**
 * Desktop session strip — initiative order, current actor, pass turn.
 */
import { createHudPanel, hudButton } from './hudPanel.js';

/**
 * @param {{
 *   onPassTurn: () => void,
 *   getCurrentActorLabel: () => string,
 *   getLastExpression: () => string,
 * }} opts
 */
export function createSessionStrip(opts) {
    const hudPanel = createHudPanel({
        id: 'session-strip',
        ariaLabel: 'Session turn tracker',
        anchor: 'bottom-center',
        className: 'hud-panel--session-strip',
    });
    const { el: root, body } = hudPanel;
    body.className += ' hud-row';

    const actorEl = document.createElement('span');
    actorEl.className = 'hud-panel--session-strip__actor';

    const exprEl = document.createElement('span');
    exprEl.className = 'hud-panel--session-strip__expr';

    const passBtn = hudButton('Pass turn');
    passBtn.addEventListener('click', () => opts.onPassTurn());

    body.appendChild(document.createTextNode('Turn: '));
    body.appendChild(actorEl);
    body.appendChild(exprEl);
    body.appendChild(passBtn);

    function refresh(snapshot) {
        actorEl.textContent = opts.getCurrentActorLabel();
        const seats = snapshot?.seats ?? [];
        const order = seats.map((s) => s.name).join(' → ');
        root.title = order ? `Initiative: ${order}` : 'Session';
        exprEl.textContent = snapshot?.lastExpression ? ` · ${snapshot.lastExpression}` : '';
    }

    return {
        root,
        refresh,
        destroy() {
            root.remove();
        },
    };
}
