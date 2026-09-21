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

/** @typedef {import('./types/dice').DiceReadValue} DiceReadValue */

import { formatDieLabel } from './roll/Notation.js';
import {
    prefersReducedMotion,
    resultCardStaggerMs,
    resultCardTransitionSec,
} from './core/AccessibilityPrefs.js';
import { createHudPanel } from './ui/hudPanel.js';

let resultsOverlay = null;
let diceHudPanel = null;
let diceHudRow = null;
let liveRegion = null;
let lastLiveAnnouncement = '';
let domResultsSuppressed = false;

export function setDomResultsSuppressed(suppressed) {
    domResultsSuppressed = suppressed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initResultsUI() {
    _createDiceHud();
    _createResultsOverlay();
}

/**
 * Always-visible HUD showing the current value of each die on the table.
 * @param {DiceReadValue[]} diceResults
 * @param {{ rolling?: boolean }} [options]
 */
export function updateDiceHud(diceResults, options = {}) {
    if (!diceHudRow) return;
    if (options.hidden && diceHudPanel) {
        diceHudPanel.style.display = 'none';
        return;
    }
    if (diceHudPanel) diceHudPanel.style.display = '';

    const rolling = options.rolling === true;
    const debugRows = options.debugRows ?? null;
    diceHudRow.innerHTML = '';

    if (!diceResults?.length) {
        diceHudRow.innerHTML = `<div class="hud-panel--dice-hud__empty">No dice on table</div>`;
        _announceIfChanged('No dice on table');
        return;
    }

    const valid = diceResults.filter(
        (r) => r.value !== null && r.value !== undefined && r.value > 0
    );
    const total = valid.reduce((s, r) => s + r.value, 0);

    diceResults.forEach((result, index) => {
        const card = _makeResultCard(result, {
            compact: true,
            rolling,
            debug: debugRows?.[index] ?? null,
        });
        diceHudRow.appendChild(card);
    });

    if (diceResults.length > 1 && valid.length > 0 && !rolling) {
        const totalEl = document.createElement('div');
        totalEl.className = 'hud-result-total hud-result-total--compact';
        totalEl.innerHTML = `Total <span class="hud-result-total__value">${total}</span>`;
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
 * @param {DiceReadValue[]} diceResults
 */
export function showResults(diceResults) {
    if (domResultsSuppressed) return;
    if (!resultsOverlay) return;

    const valid = diceResults.filter((r) => r.value !== null && r.value !== undefined);
    if (valid.length === 0) return;

    const total = valid.reduce((s, r) => s + r.value, 0);
    const reducedMotion = prefersReducedMotion();
    const staggerMs = resultCardStaggerMs();
    const transitionSec = resultCardTransitionSec();

    _announceIfChanged(`Rolled ${valid.length} dice: ${_formatDiceList(valid)}. Total ${total}.`, {
        force: true,
    });

    // Build card row
    resultsOverlay.innerHTML = '';

    const scrim = _createScrim();
    resultsOverlay.appendChild(scrim);

    const row = document.createElement('div');
    row.className = 'hud-result-row';

    valid.forEach((result, i) => {
        const card = _makeResultCard(result);
        if (!reducedMotion) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(18px) scale(0.8)';
            card.style.transition = `opacity ${transitionSec}s ease ${(i * staggerMs) / 1000}s,
                                  transform ${transitionSec}s ease ${(i * staggerMs) / 1000}s`;
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
        totalEl.className = 'hud-result-total';
        if (!reducedMotion) {
            totalEl.style.opacity = '0';
            totalEl.style.transform = 'scale(0.85)';
            totalEl.style.transition = `opacity 0.35s ease ${delay}ms, transform 0.35s ease ${delay}ms`;
        }
        totalEl.innerHTML = `⚔ Total: <span class="hud-result-total__value hud-result-total__value--lg">${total}</span>`;
        scrim.appendChild(totalEl);

        if (!reducedMotion) {
            setTimeout(() => {
                totalEl.style.opacity = '1';
                totalEl.style.transform = 'scale(1)';
            }, delay + 30);
        }
    }

    resultsOverlay.style.opacity = '1';
}

/**
 * Show notation roll breakdown with kept/dropped highlighting.
 * @param {import('./roll/Notation.js').EvaluatedRoll} evaluated
 */
export function showNotationResults(evaluated) {
    if (domResultsSuppressed) return;
    if (!resultsOverlay || !evaluated) return;

    const displayDice = evaluated.dice.filter((d) => !d.exploded);
    if (!displayDice.length) return;

    const reducedMotion = prefersReducedMotion();
    const staggerMs = resultCardStaggerMs();
    const transitionSec = resultCardTransitionSec();

    resultsOverlay.innerHTML = '';

    const scrim = _createScrim();
    resultsOverlay.appendChild(scrim);

    const header = document.createElement('div');
    header.className = 'hud-result-expression';
    header.textContent = evaluated.expression;
    scrim.appendChild(header);

    const row = document.createElement('div');
    row.className = 'hud-result-row';

    displayDice.forEach((die, i) => {
        const card = _makeResultCard(
            {
                type: formatDieLabel(die.type, die.role),
                value: die.displayValue ?? die.value,
            },
            {
                kept: die.kept !== false,
                dropped: die.dropped === true,
            }
        );
        if (!reducedMotion) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(18px) scale(0.8)';
            card.style.transition = `opacity ${transitionSec}s ease ${(i * staggerMs) / 1000}s, transform ${transitionSec}s ease ${(i * staggerMs) / 1000}s`;
        }
        row.appendChild(card);
        if (!reducedMotion) {
            setTimeout(
                () => {
                    card.style.opacity = die.dropped ? '0.45' : '1';
                    card.style.transform = 'translateY(0) scale(1)';
                },
                i * staggerMs + 30
            );
        }
    });

    scrim.appendChild(row);

    const delay = reducedMotion ? 0 : displayDice.length * staggerMs + 80;
    const breakdown = document.createElement('div');
    breakdown.className = 'hud-result-breakdown';
    if (!reducedMotion) {
        breakdown.style.opacity = '0';
        breakdown.style.transform = 'scale(0.85)';
        breakdown.style.transition = `opacity 0.35s ease ${delay}ms, transform 0.35s ease ${delay}ms`;
    }

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

    breakdown.innerHTML = totalLine.replace(
        String(evaluated.total),
        `<span class="hud-result-total__value">${evaluated.total}</span>`
    );
    scrim.appendChild(breakdown);

    if (!reducedMotion) {
        setTimeout(() => {
            breakdown.style.opacity = '1';
            breakdown.style.transform = 'scale(1)';
        }, delay + 30);
    }

    const diceList = displayDice
        .map((d) => `${formatDieLabel(d.type, d.role)} = ${d.displayValue ?? d.value}`)
        .join(', ');
    let announce = `Rolled ${evaluated.expression}: ${diceList}. Total ${evaluated.total}.`;
    if (evaluated.opposed) {
        announce += ` Opposed ${evaluated.opposed.expression} total ${evaluated.opposed.total}, margin ${evaluated.opposed.margin}.`;
    }
    if (evaluated.flags?.crit) announce += ' Critical!';
    if (evaluated.flags?.fumble) announce += ' Fumble!';
    _announceIfChanged(announce, {
        force: true,
    });

    resultsOverlay.style.opacity = '1';
}

export function hideResults() {
    if (!resultsOverlay) return;
    resultsOverlay.style.opacity = '0';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _createDiceHud() {
    diceHudPanel = createHudPanel({
        id: 'dice-hud-panel',
        ariaLabel: 'Current dice values',
        anchor: 'bottom-center',
        variant: 'display',
        className: 'hud-panel--dice-hud',
        pointerEventsNone: true,
    }).el;

    const label = document.createElement('div');
    label.className = 'hud-panel--dice-hud__label';
    label.textContent = 'Current Roll';

    diceHudRow = document.createElement('div');
    diceHudRow.className = 'hud-result-row hud-result-row--compact';

    diceHudPanel.querySelector('.hud-panel__body').appendChild(label);
    diceHudPanel.querySelector('.hud-panel__body').appendChild(diceHudRow);
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
    resultsOverlay.className = 'hud-panel--results-overlay';
    resultsOverlay.setAttribute('aria-hidden', 'true');
    resultsOverlay.style.transition = `opacity ${prefersReducedMotion() ? '0.05s' : '0.4s'} ease`;
    container.appendChild(resultsOverlay);
}

function _createScrim() {
    const scrim = document.createElement('div');
    scrim.className = 'hud-result-scrim';
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

function _makeResultCard(
    result,
    { compact = false, rolling = false, kept = true, dropped = false, debug = null } = {}
) {
    const card = document.createElement('div');
    card.className = compact ? 'hud-result-card hud-result-card--compact' : 'hud-result-card';
    if (dropped) card.classList.add('hud-result-card--dropped');
    else if (kept && !compact && !rolling) card.classList.add('hud-result-card--kept-glow');

    const typeEl = document.createElement('div');
    typeEl.className = 'hud-result-card__type';
    typeEl.textContent = result.type;

    const valueEl = document.createElement('div');
    const displayValue = rolling
        ? '…'
        : result.value !== null && result.value !== undefined
          ? result.value
          : '—';
    valueEl.className = 'hud-result-card__value';
    if (dropped) valueEl.classList.add('hud-result-card__value--dropped');
    else if (rolling) valueEl.classList.add('hud-result-card__value--rolling');
    valueEl.textContent = displayValue;

    card.appendChild(typeEl);
    card.appendChild(valueEl);

    if (debug?.disagrees) {
        const badge = document.createElement('div');
        badge.title = `Engine ${debug.engineValue} vs visual ${debug.visualValue}`;
        badge.className = 'hud-result-card__debug-badge';
        badge.textContent = `Δ ${debug.visualValue}`;
        card.appendChild(badge);
    }

    return card;
}
