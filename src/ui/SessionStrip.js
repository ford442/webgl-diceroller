/**
 * Desktop session strip — initiative order, current actor, pass turn.
 */

const GOLD = '#e8c882';
const GOLD_DARK = '#8B6914';
const BG = 'rgba(20, 10, 0, 0.55)';

/**
 * @param {{
 *   onPassTurn: () => void,
 *   getCurrentActorLabel: () => string,
 *   getLastExpression: () => string,
 * }} opts
 */
export function createSessionStrip(opts) {
    const root = document.createElement('div');
    root.id = 'session-strip';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Session turn tracker');
    root.style.cssText = `
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 12;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: ${BG};
        border: 1px solid ${GOLD_DARK};
        border-radius: 6px;
        font-size: 12px;
        color: #ddd;
        max-width: min(96vw, 640px);
        pointer-events: auto;
    `;

    const actorEl = document.createElement('span');
    actorEl.style.color = GOLD;
    actorEl.style.fontWeight = 'bold';

    const exprEl = document.createElement('span');
    exprEl.style.color = '#ccc';
    exprEl.style.fontStyle = 'italic';
    exprEl.style.overflow = 'hidden';
    exprEl.style.textOverflow = 'ellipsis';
    exprEl.style.whiteSpace = 'nowrap';
    exprEl.style.maxWidth = '240px';

    const passBtn = document.createElement('button');
    passBtn.type = 'button';
    passBtn.textContent = 'Pass turn';
    passBtn.style.cssText = `
        cursor: pointer;
        padding: 4px 10px;
        background: ${BG};
        border: 1px solid ${GOLD_DARK};
        color: ${GOLD};
        border-radius: 3px;
        font-size: 12px;
    `;
    passBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    passBtn.addEventListener('click', () => opts.onPassTurn());

    root.appendChild(document.createTextNode('Turn: '));
    root.appendChild(actorEl);
    root.appendChild(exprEl);
    root.appendChild(passBtn);

    const container = document.getElementById('canvas-container');
    if (container) container.appendChild(root);

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
