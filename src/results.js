/**
 * results.js — Dice Result Display & Roll History
 *
 * Public API:
 *   initResultsUI()          — create DOM elements (call once after page loads)
 *   showResults(diceResults) — animate result overlay; diceResults = [{type, value}]
 *   hideResults()            — hide the overlay (call before each new roll)
 */

const MAX_HISTORY = 20;

let rollHistory   = [];
let resultsOverlay = null;
let historyPanel   = null;
let historyList    = null;

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
    _createResultsOverlay();
    _createHistoryPanel();
}

/**
 * Show animated result cards and record the roll in history.
 * @param {Array<{type: string, value: number|null}>} diceResults
 */
export function showResults(diceResults) {
    if (!resultsOverlay) return;

    const valid = diceResults.filter(r => r.value !== null && r.value !== undefined);
    if (valid.length === 0) return;

    const total = valid.reduce((s, r) => s + r.value, 0);
    _addToHistory(valid, total);

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

function _createResultsOverlay() {
    const container = document.getElementById('canvas-container') || document.body;

    resultsOverlay = document.createElement('div');
    resultsOverlay.id = 'dice-results-overlay';
    resultsOverlay.style.cssText = `
        position: absolute;
        bottom: 65px;
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

function _createHistoryPanel() {
    const container = document.getElementById('canvas-container') || document.body;

    historyPanel = document.createElement('div');
    historyPanel.id = 'dice-history-panel';
    historyPanel.style.cssText = `
        position: absolute;
        top: 10px;
        left: 10px;
        background: ${BG_PANEL};
        border: 1px solid ${GOLD_DARK};
        border-radius: 8px;
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 12px;
        z-index: 1000;
        min-width: 200px;
        max-width: 264px;
        overflow: hidden;
    `;

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 7px 12px;
        background: rgba(139, 105, 20, 0.25);
        border-bottom: 1px solid ${GOLD_DARK};
        cursor: pointer;
        user-select: none;
    `;
    header.innerHTML = `
        <span style="font-weight:bold;letter-spacing:1px;">📜 Roll History</span>
        <span id="hist-toggle" style="font-size:10px;">▼</span>
    `;

    // ── Scrollable content ──
    const content = document.createElement('div');
    content.id = 'hist-content';
    content.style.cssText = `
        max-height: 260px;
        overflow-y: auto;
        padding: 4px 0;
    `;

    historyList = document.createElement('div');
    historyList.id = 'hist-list';
    historyList.innerHTML = _emptyHistoryHTML();
    content.appendChild(historyList);

    historyPanel.appendChild(header);
    historyPanel.appendChild(content);

    // Collapse toggle
    let collapsed = false;
    header.addEventListener('click', () => {
        collapsed = !collapsed;
        content.style.display = collapsed ? 'none' : 'block';
        const toggle = document.getElementById('hist-toggle');
        if (toggle) toggle.textContent = collapsed ? '▶' : '▼';
    });
    header.addEventListener('mousedown', (e) => e.stopPropagation());

    container.appendChild(historyPanel);
}

function _makeResultCard(result) {
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${BG_CARD};
        border: ${BORDER};
        border-radius: 8px;
        padding: 7px 12px;
        text-align: center;
        min-width: 54px;
        font-family: ${FONT};
    `;

    const typeEl = document.createElement('div');
    typeEl.style.cssText = `font-size:10px; color:${GOLD_DARK}; letter-spacing:1px; text-transform:uppercase;`;
    typeEl.textContent = result.type;

    const valueEl = document.createElement('div');
    valueEl.style.cssText = `font-size:27px; font-weight:bold; color:${GOLD}; line-height:1.1;`;
    valueEl.textContent = result.value;

    card.appendChild(typeEl);
    card.appendChild(valueEl);
    return card;
}

// Canonical die type order for consistent history display
const DICE_TYPE_ORDER = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

function _addToHistory(diceResults, total) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Group by die type: { d6: [3,5], d20: [14] }
    const grouped = {};
    diceResults.forEach(r => {
        if (!grouped[r.type]) grouped[r.type] = [];
        grouped[r.type].push(r.value);
    });

    // Sort by canonical order and format: "2d6: 3, 5  •  1d20: 14"
    const rollStr = DICE_TYPE_ORDER
        .filter(type => grouped[type])
        .map(type => `${grouped[type].length}${type}: ${grouped[type].join(', ')}`)
        .join('  •  ');

    rollHistory.unshift({ timeStr, rollStr, total, diceResults: [...diceResults] });
    if (rollHistory.length > MAX_HISTORY) rollHistory.pop();

    _renderHistory();
}

function _renderHistory() {
    if (!historyList) return;

    if (rollHistory.length === 0) {
        historyList.innerHTML = _emptyHistoryHTML();
        return;
    }

    historyList.innerHTML = '';

    rollHistory.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.style.cssText = `
            padding: 5px 12px;
            border-bottom: 1px solid rgba(139,105,20,0.2);
            line-height: 1.45;
            ${idx === 0 ? 'background: rgba(139,105,20,0.12);' : ''}
        `;

        const timeEl = document.createElement('div');
        timeEl.style.cssText = `font-size:10px; color:${GOLD_DARK};`;
        timeEl.textContent = entry.timeStr;

        const rollEl = document.createElement('div');
        rollEl.style.cssText = `font-size:11px; color:${GOLD_DIM};`;
        rollEl.textContent = entry.rollStr;

        const totalEl = document.createElement('div');
        totalEl.style.cssText = `font-size:12px; color:${GOLD}; font-weight:bold;`;
        totalEl.textContent = `Total: ${entry.total}`;

        row.appendChild(timeEl);
        row.appendChild(rollEl);
        row.appendChild(totalEl);
        historyList.appendChild(row);
    });

    // Copy-last-roll button
    const copyBtn = document.createElement('button');
    copyBtn.style.cssText = `
        display: block;
        width: calc(100% - 24px);
        margin: 6px 12px 8px;
        padding: 5px;
        background: rgba(139,105,20,0.25);
        border: 1px solid ${GOLD_DARK};
        border-radius: 4px;
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 11px;
        cursor: pointer;
        letter-spacing: 0.5px;
    `;
    copyBtn.textContent = '📋 Copy Last Roll';
    copyBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    const resetCopyBtn = () => {
        copyBtn.textContent = '📋 Copy Last Roll';
        copyBtn.style.color = GOLD_DIM;
    };

    copyBtn.addEventListener('click', () => {
        if (rollHistory.length === 0) return;
        const latest = rollHistory[0];
        const text = `[${latest.timeStr}] ${latest.rollStr} | Total: ${latest.total}`;
        navigator.clipboard.writeText(text)
            .then(() => {
                copyBtn.textContent = '✓ Copied!';
                copyBtn.style.color = GOLD;
                setTimeout(resetCopyBtn, 1500);
            })
            .catch(() => {
                copyBtn.textContent = '⚠ Copy unavailable';
                setTimeout(resetCopyBtn, 1500);
            });
    });
    historyList.appendChild(copyBtn);

    // Clear-history button
    const clearBtn = document.createElement('button');
    clearBtn.style.cssText = `
        display: block;
        width: calc(100% - 24px);
        margin: 0 12px 8px;
        padding: 5px;
        background: rgba(120,30,30,0.25);
        border: 1px solid ${GOLD_DARK};
        border-radius: 4px;
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 11px;
        cursor: pointer;
        letter-spacing: 0.5px;
    `;
    clearBtn.textContent = '🗑 Clear History';
    clearBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    clearBtn.addEventListener('click', clearHistory);
    historyList.appendChild(clearBtn);
}

/** Clear the roll-history log. */
export function clearHistory() {
    rollHistory = [];
    _renderHistory();
}

function _emptyHistoryHTML() {
    return `<div style="text-align:center;padding:10px 8px;color:${GOLD_DARK};font-style:italic;">No rolls yet…</div>`;
}
