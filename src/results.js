/**
 * results.js — Dice Result Display
 *
 * Public API:
 *   initResultsUI()          — create DOM elements (call once after page loads)
 *   updateDiceHud(results)   — live heads-up display of current die values
 *   showResults(diceResults) — animate result overlay; diceResults = [{type, value}]
 *   hideResults()            — hide the overlay (call before each new roll)
 */

let resultsOverlay = null;
let diceHudPanel   = null;
let diceHudRow     = null;

// ---------------------------------------------------------------------------
// Tavern theme tokens
// ---------------------------------------------------------------------------
const FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";
const GOLD       = '#ffd700';
const GOLD_DIM   = '#e8c882';
const GOLD_DARK  = '#8B6914';
const BG_PANEL   = 'rgba(20, 10, 0, 0.88)';
const BG_CARD    = 'rgba(20, 10, 0, 0.92)';
const BORDER     = '2px solid #8B6914';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initResultsUI() {
    _createDiceHud();
    _createResultsOverlay();
}

/**
 * Always-visible HUD showing the current value of each die on the table.
 * @param {Array<{type: string, value: number|null}>} diceResults
 * @param {{ rolling?: boolean }} [options]
 */
export function updateDiceHud(diceResults, options = {}) {
    if (!diceHudRow) return;

    const rolling = options.rolling === true;
    diceHudRow.innerHTML = '';

    if (!diceResults?.length) {
        diceHudRow.innerHTML = `<div style="color:${GOLD_DARK};font-style:italic;">No dice on table</div>`;
        return;
    }

    const valid = diceResults.filter((r) => r.value !== null && r.value !== undefined);
    const total = valid.reduce((s, r) => s + r.value, 0);

    diceResults.forEach((result) => {
        const card = _makeResultCard(result, { compact: true, rolling });
        diceHudRow.appendChild(card);
    });

    if (diceResults.length > 1 && valid.length > 0 && !rolling) {
        const totalEl = document.createElement('div');
        totalEl.style.cssText = `
            background: ${BG_CARD};
            border: 1px solid ${GOLD_DARK};
            border-radius: 6px;
            padding: 4px 10px;
            color: ${GOLD_DIM};
            font-family: ${FONT};
            font-size: 12px;
            letter-spacing: 0.5px;
            align-self: center;
        `;
        totalEl.innerHTML = `Total <span style="color:${GOLD};font-size:16px;font-weight:bold;">${total}</span>`;
        diceHudRow.appendChild(totalEl);
    }
}

/**
 * Show animated result cards for a completed roll.
 * @param {Array<{type: string, value: number|null}>} diceResults
 */
export function showResults(diceResults) {
    if (!resultsOverlay) return;

    const valid = diceResults.filter(r => r.value !== null && r.value !== undefined);
    if (valid.length === 0) return;

    const total = valid.reduce((s, r) => s + r.value, 0);

    // Build card row
    resultsOverlay.innerHTML = '';

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        max-width: 540px;
    `;

    valid.forEach((result, i) => {
        const card = _makeResultCard(result);
        card.style.opacity = '0';
        card.style.transform = 'translateY(18px) scale(0.8)';
        card.style.transition = `opacity 0.3s ease ${i * 0.12}s,
                                  transform 0.3s ease ${i * 0.12}s`;
        row.appendChild(card);

        // Stagger the animation trigger
        const delay = i * 120;
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0) scale(1)';
        }, delay + 30);
    });

    resultsOverlay.appendChild(row);

    // Total line (shown only if more than one die)
    if (valid.length > 1) {
        const delay = valid.length * 120 + 80;
        const totalEl = document.createElement('div');
        totalEl.style.cssText = `
            background: ${BG_CARD};
            border: 2px solid ${GOLD_DIM};
            border-radius: 8px;
            padding: 5px 20px;
            color: ${GOLD_DIM};
            font-family: ${FONT};
            font-size: 15px;
            letter-spacing: 1px;
            opacity: 0;
            transform: scale(0.85);
            transition: opacity 0.35s ease ${delay}ms,
                        transform 0.35s ease ${delay}ms;
        `;
        totalEl.innerHTML = `⚔ Total: <span style="color:${GOLD};font-size:20px;">${total}</span>`;
        resultsOverlay.appendChild(totalEl);

        setTimeout(() => {
            totalEl.style.opacity = '1';
            totalEl.style.transform = 'scale(1)';
        }, delay + 30);
    }

    resultsOverlay.style.opacity = '1';
    resultsOverlay.style.pointerEvents = 'none'; // click-through — don't block interaction
}

export function hideResults() {
    if (!resultsOverlay) return;
    resultsOverlay.style.opacity = '0';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _createDiceHud() {
    const container = document.getElementById('canvas-container') || document.body;

    diceHudPanel = document.createElement('div');
    diceHudPanel.id = 'dice-hud-panel';
    diceHudPanel.style.cssText = `
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        z-index: 1001;
        pointer-events: none;
        max-width: min(96vw, 640px);
    `;

    const label = document.createElement('div');
    label.style.cssText = `
        color: ${GOLD_DARK};
        font-family: ${FONT};
        font-size: 10px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        opacity: 0.9;
    `;
    label.textContent = 'Current Roll';

    diceHudRow = document.createElement('div');
    diceHudRow.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
    `;

    diceHudPanel.appendChild(label);
    diceHudPanel.appendChild(diceHudRow);
    container.appendChild(diceHudPanel);
}

function _createResultsOverlay() {
    const container = document.getElementById('canvas-container') || document.body;

    resultsOverlay = document.createElement('div');
    resultsOverlay.id = 'dice-results-overlay';
    resultsOverlay.style.cssText = `
        position: absolute;
        bottom: 88px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        z-index: 1001;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.4s ease;
    `;
    container.appendChild(resultsOverlay);
}

function _makeResultCard(result, { compact = false, rolling = false } = {}) {
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${BG_CARD};
        border: ${compact ? `1px solid ${GOLD_DARK}` : BORDER};
        border-radius: ${compact ? '6px' : '8px'};
        padding: ${compact ? '4px 8px' : '7px 12px'};
        text-align: center;
        min-width: ${compact ? '42px' : '54px'};
        font-family: ${FONT};
    `;

    const typeEl = document.createElement('div');
    typeEl.style.cssText = `font-size:${compact ? '9px' : '10px'}; color:${GOLD_DARK}; letter-spacing:1px; text-transform:uppercase;`;
    typeEl.textContent = result.type;

    const valueEl = document.createElement('div');
    const displayValue = rolling
        ? '…'
        : (result.value !== null && result.value !== undefined ? result.value : '—');
    valueEl.style.cssText = `font-size:${compact ? '20px' : '27px'}; font-weight:bold; color:${rolling ? GOLD_DIM : GOLD}; line-height:1.1;`;
    valueEl.textContent = displayValue;

    card.appendChild(typeEl);
    card.appendChild(valueEl);
    return card;
}
