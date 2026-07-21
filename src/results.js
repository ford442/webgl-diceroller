/**
 * results.js — Dice Result Display
 *
 * Public API:
 *   initResultsUI()          — create DOM elements (call once after page loads)
 *   updateDiceHud(results)   — live heads-up display of current die values
 *   showResults(diceResults) — animate result overlay; diceResults = [{type, value}]
 *   showNotationResults(evaluatedRoll) — breakdown with keep/drop highlighting
 *   hideResults()            — hide the overlay (call before each new roll)
 */

import { formatDieLabel } from './roll/Notation.js';
import { prefersReducedMotion, resultCardStaggerMs, resultCardTransitionSec } from './core/AccessibilityPrefs.js';

const MAX_HISTORY = 20;

let rollHistory   = [];
let resultsOverlay = null;
let diceHudPanel   = null;
let diceHudRow     = null;
let liveRegion     = null;
let lastLiveAnnouncement = '';

// ---------------------------------------------------------------------------
// Tavern theme tokens
// ---------------------------------------------------------------------------
const FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";
const GOLD       = '#ffd700';
const GOLD_DIM   = '#e8c882';
const GOLD_DARK  = '#8B6914';
const BG_PANEL   = 'rgba(20, 10, 0, 0.88)';
const BG_CARD    = 'rgba(20, 10, 0, 0.92)';
const BG_SCRIM   = 'rgba(8, 4, 0, 0.82)';
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
        _announceIfChanged('No dice on table');
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

    if (rolling) {
        _announceIfChanged(`Rolling ${diceResults.length} dice…`);
    } else if (valid.length > 0) {
        _announceIfChanged(`Current roll: ${_formatDiceSummary(valid, total)}`);
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
    const reducedMotion = prefersReducedMotion();
    const staggerMs = resultCardStaggerMs();
    const transitionSec = resultCardTransitionSec();

    _announceIfChanged(`Rolled ${valid.length} dice: ${_formatDiceList(valid)}. Total ${total}.`, { force: true });

    // Build card row
    resultsOverlay.innerHTML = '';

    const scrim = _createScrim();
    resultsOverlay.appendChild(scrim);

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
        if (!reducedMotion) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(18px) scale(0.8)';
            card.style.transition = `opacity ${transitionSec}s ease ${i * staggerMs / 1000}s,
                                  transform ${transitionSec}s ease ${i * staggerMs / 1000}s`;
        }
        row.appendChild(card);

        if (!reducedMotion) {
            const delay = i * staggerMs;
            setTimeout(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0) scale(1)';
            }, delay + 30);
        }
    });

    scrim.appendChild(row);

    // Total line (shown only if more than one die)
    if (valid.length > 1) {
        const delay = reducedMotion ? 0 : valid.length * staggerMs + 80;
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
            ${reducedMotion ? '' : `
            opacity: 0;
            transform: scale(0.85);
            transition: opacity 0.35s ease ${delay}ms,
                        transform 0.35s ease ${delay}ms;`}
        `;
        totalEl.innerHTML = `⚔ Total: <span style="color:${GOLD};font-size:20px;">${total}</span>`;
        scrim.appendChild(totalEl);

        if (!reducedMotion) {
            setTimeout(() => {
                totalEl.style.opacity = '1';
                totalEl.style.transform = 'scale(1)';
            }, delay + 30);
        }
    }

    resultsOverlay.style.opacity = '1';
    resultsOverlay.style.pointerEvents = 'none'; // click-through — don't block interaction
}

/**
 * Show notation roll breakdown with kept/dropped highlighting.
 * @param {import('./roll/Notation.js').EvaluatedRoll} evaluated
 */
export function showNotationResults(evaluated) {
    if (!resultsOverlay || !evaluated) return;

    const displayDice = evaluated.dice.filter((d) => !d.exploded);
    if (!displayDice.length) return;

    const reducedMotion = prefersReducedMotion();
    const staggerMs = resultCardStaggerMs();
    const transitionSec = resultCardTransitionSec();

    _addNotationToHistory(evaluated);

    resultsOverlay.innerHTML = '';

    const scrim = _createScrim();
    resultsOverlay.appendChild(scrim);

    const header = document.createElement('div');
    header.style.cssText = `
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 13px;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
    `;
    header.textContent = evaluated.expression;
    scrim.appendChild(header);

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        max-width: 540px;
    `;

    displayDice.forEach((die, i) => {
        const card = _makeResultCard({
            type: formatDieLabel(die.type, die.role),
            value: die.displayValue ?? die.value
        }, {
            kept: die.kept !== false,
            dropped: die.dropped === true
        });
        if (!reducedMotion) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(18px) scale(0.8)';
            card.style.transition = `opacity ${transitionSec}s ease ${i * staggerMs / 1000}s, transform ${transitionSec}s ease ${i * staggerMs / 1000}s`;
        }
        row.appendChild(card);
        if (!reducedMotion) {
            setTimeout(() => {
                card.style.opacity = die.dropped ? '0.45' : '1';
                card.style.transform = 'translateY(0) scale(1)';
            }, i * staggerMs + 30);
        }
    });

    scrim.appendChild(row);

    const delay = reducedMotion ? 0 : displayDice.length * staggerMs + 80;
    const breakdown = document.createElement('div');
    breakdown.style.cssText = `
        background: ${BG_CARD};
        border: 2px solid ${GOLD_DIM};
        border-radius: 8px;
        padding: 6px 16px;
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 13px;
        letter-spacing: 0.5px;
        text-align: center;
        ${reducedMotion ? '' : `
        opacity: 0;
        transform: scale(0.85);
        transition: opacity 0.35s ease ${delay}ms, transform 0.35s ease ${delay}ms;`}
    `;

    const groupLines = evaluated.groupSubtotals.map((g) => `${g.label}: ${g.subtotal}`).join(' · ');
    let totalLine = groupLines;
    if (evaluated.modifier) {
        const sign = evaluated.modifier > 0 ? '+' : '';
        totalLine += ` ${sign}${evaluated.modifier}`;
    }
    totalLine += ` = ${evaluated.total}`;

    if (evaluated.opposed) {
        const m = evaluated.opposed.margin;
        const mSign = m > 0 ? '+' : '';
        totalLine += `  vs ${evaluated.opposed.expression} = ${evaluated.opposed.total}  (margin ${mSign}${m})`;
    }

    const flagBits = [];
    if (evaluated.flags?.crit) flagBits.push('CRIT');
    if (evaluated.flags?.fumble) flagBits.push('FUMBLE');
    if (evaluated.flags?.advantage) flagBits.push('ADV');
    if (evaluated.flags?.disadvantage) flagBits.push('DIS');
    if (evaluated.flags?.strongHit) flagBits.push('STRONG');
    if (evaluated.flags?.weakHit) flagBits.push('WEAK');
    if (evaluated.flags?.miss) flagBits.push('MISS');
    if (flagBits.length) totalLine += `  ·  ${flagBits.join(' ')}`;

    breakdown.innerHTML = totalLine.replace(String(evaluated.total), `<span style="color:${GOLD};font-size:18px;font-weight:bold;">${evaluated.total}</span>`);
    scrim.appendChild(breakdown);

    if (!reducedMotion) {
        setTimeout(() => {
            breakdown.style.opacity = '1';
            breakdown.style.transform = 'scale(1)';
        }, delay + 30);
    }

    const diceList = displayDice.map((d) => `${formatDieLabel(d.type, d.role)} = ${d.displayValue ?? d.value}`).join(', ');
    let announce = `Rolled ${evaluated.expression}: ${diceList}. Total ${evaluated.total}.`;
    if (evaluated.opposed) {
        announce += ` Opposed ${evaluated.opposed.expression} total ${evaluated.opposed.total}, margin ${evaluated.opposed.margin}.`;
    }
    if (evaluated.flags?.crit) announce += ' Critical!';
    if (evaluated.flags?.fumble) announce += ' Fumble!';
    _announceIfChanged(announce, { force: true });

    resultsOverlay.style.opacity = '1';
    resultsOverlay.style.pointerEvents = 'none';
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
    diceHudPanel.setAttribute('role', 'region');
    diceHudPanel.setAttribute('aria-label', 'Current dice values');
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
        background: ${BG_SCRIM};
        border: 1px solid rgba(139, 105, 20, 0.55);
        border-radius: 10px;
        padding: 8px 12px 10px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
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

    liveRegion = document.createElement('div');
    liveRegion.id = 'dice-results-live';
    liveRegion.className = 'visually-hidden';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.setAttribute('role', 'status');
    container.appendChild(liveRegion);

    resultsOverlay = document.createElement('div');
    resultsOverlay.id = 'dice-results-overlay';
    resultsOverlay.setAttribute('aria-hidden', 'true');
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
        transition: opacity ${prefersReducedMotion() ? '0.05s' : '0.4s'} ease;
    `;
    container.appendChild(resultsOverlay);
}

function _createScrim() {
    const scrim = document.createElement('div');
    scrim.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        background: ${BG_SCRIM};
        border: 1px solid rgba(139, 105, 20, 0.55);
        border-radius: 12px;
        padding: 10px 14px;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
    `;
    return scrim;
}

function _formatDiceList(diceResults) {
    return diceResults.map((r) => `${r.type} = ${r.value}`).join(', ');
}

function _formatDiceSummary(diceResults, total) {
    const list = _formatDiceList(diceResults);
    return diceResults.length > 1 ? `${list}. Total ${total}` : list;
}

function _announceIfChanged(text, { force = false } = {}) {
    if (!liveRegion || (!force && text === lastLiveAnnouncement)) return;
    lastLiveAnnouncement = text;
    liveRegion.textContent = text;
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

function _makeResultCard(result, { compact = false, rolling = false, kept = true, dropped = false } = {}) {
    const card = document.createElement('div');
    const borderColor = dropped ? 'rgba(139,105,20,0.35)' : (kept ? GOLD_DARK : 'rgba(139,105,20,0.35)');
    const valueColor = dropped ? 'rgba(232,200,130,0.45)' : (rolling ? GOLD_DIM : GOLD);
    card.style.cssText = `
        background: ${dropped ? 'rgba(20, 10, 0, 0.55)' : BG_CARD};
        border: ${compact ? `1px solid ${borderColor}` : BORDER};
        border-radius: ${compact ? '6px' : '8px'};
        padding: ${compact ? '4px 8px' : '7px 12px'};
        text-align: center;
        min-width: ${compact ? '42px' : '54px'};
        font-family: ${FONT};
        ${dropped ? 'text-decoration: line-through; opacity: 0.55;' : ''}
        ${kept && !compact && !rolling ? `box-shadow: 0 0 8px rgba(255,215,0,0.25);` : ''}
    `;

    const typeEl = document.createElement('div');
    typeEl.style.cssText = `font-size:${compact ? '9px' : '10px'}; color:${GOLD_DARK}; letter-spacing:1px; text-transform:uppercase;`;
    typeEl.textContent = result.type;

    const valueEl = document.createElement('div');
    const displayValue = rolling
        ? '…'
        : (result.value !== null && result.value !== undefined ? result.value : '—');
    valueEl.style.cssText = `font-size:${compact ? '20px' : '27px'}; font-weight:bold; color:${valueColor}; line-height:1.1;`;
    valueEl.textContent = displayValue;

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

    rollHistory.unshift({ timeStr, rollStr, total, diceResults: [...diceResults], expression: null });
    if (rollHistory.length > MAX_HISTORY) rollHistory.pop();

    _renderHistory();
}

function _addNotationToHistory(evaluated) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const groupParts = evaluated.groupSubtotals.map((g) => `${g.label}: ${g.subtotal}`);
    let rollStr = evaluated.expression;
    if (groupParts.length) {
        rollStr += `  (${groupParts.join(' · ')})`;
    }
    if (evaluated.modifier) {
        const sign = evaluated.modifier > 0 ? '+' : '';
        rollStr += ` ${sign}${evaluated.modifier}`;
    }

    rollHistory.unshift({
        timeStr,
        rollStr,
        total: evaluated.total,
        diceResults: evaluated.dice.map((d) => ({
            type: formatDieLabel(d.type, d.role),
            value: d.displayValue ?? d.value,
            kept: d.kept,
            dropped: d.dropped
        })),
        expression: evaluated.expression,
        seed: evaluated.seed ?? null,
        flags: evaluated.flags ?? null,
        opposed: evaluated.opposed
            ? { total: evaluated.opposed.total, margin: evaluated.opposed.margin }
            : null
    });
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
