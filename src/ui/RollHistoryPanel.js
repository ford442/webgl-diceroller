import { formatDiceSet, formatResultsSummary } from '../roll/RollHistory.js';
import { createHudPanel, hudButton, guardPointerEvents } from './hudPanel.js';

const GOLD = '#ffd700';
const GOLD_DARK = '#8B6914';
const MUTED = '#a78a58';
const PASS = '#8fd18f';
const FAIL = '#ff8f7a';
const OBSERVED = '#ffd66b';
const EXPECTED = '#6486ff';

/** @typedef {import('../types/roll').RollHistoryEntry} RollHistoryEntry */

/**
 * @param {object} config
 * @param {{ getEntries: () => RollHistoryEntry[]; exportAsText: () => string; exportAsCsv: () => string; clear: () => void }} config.rollHistory
 * @param {{ getStats: () => import('../types/roll').RollDieStats[]; minSampleSize?: number; reset: () => void }} config.rollStats
 * @param {(seed: number) => void} [config.onReplay]
 * @param {HTMLElement} [config.container]
 */
export function createRollHistoryPanel({
    rollHistory,
    rollStats,
    onReplay = null,
    container = null,
}) {
    if (!rollHistory || !rollStats) {
        throw new Error('createRollHistoryPanel requires rollHistory and rollStats');
    }

    const mount = container ?? document.getElementById('canvas-container') ?? document.body;
    let visible = false;
    let activeTab = 'history';
    const expandedIds = new Set();

    const toggleBtn = hudButton('📜', 'hud-panel--history-toggle');
    toggleBtn.id = 'roll-history-toggle';
    toggleBtn.title = 'Roll history (H)';
    toggleBtn.setAttribute('aria-label', 'Toggle roll history');
    toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setVisible(!visible);
    });
    mount.appendChild(toggleBtn);

    const hudPanel = createHudPanel({
        id: 'roll-history-panel',
        ariaLabel: 'Roll history and statistics',
        anchor: 'top-left',
        variant: 'display',
        className: 'hud-panel--history',
        parent: mount,
    });
    const { el: panel, body: content } = hudPanel;
    panel.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'hud-panel--history__header';

    const title = document.createElement('div');
    title.className = 'hud-panel--history__title';
    title.textContent = 'Roll Chronicle';

    const closeBtn = hudButton('✕');
    closeBtn.title = 'Close (H)';
    closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setVisible(false);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const tabRow = document.createElement('div');
    tabRow.className = 'hud-row hud-panel--history__tabs';

    const historyTab = hudButton('History');
    historyTab.dataset.tab = 'history';
    historyTab.style.flex = '1';

    const statsTab = hudButton('Statistics');
    statsTab.dataset.tab = 'statistics';
    statsTab.style.flex = '1';

    const tabs = [historyTab, statsTab];
    tabs.forEach((tab) => {
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            activeTab = tab.dataset.tab;
            render();
        });
        tabRow.appendChild(tab);
    });

    const footer = document.createElement('div');
    footer.className = 'hud-row hud-row--wrap hud-panel--history__footer';

    // Rebuild the panel's own header (title/close/tabs are bespoke; the
    // primitive's default header only covers the title+collapse pattern).
    // `content` (the primitive's body, styled via #roll-history-panel .hud-panel__body)
    // is used directly as the scrollable area.
    panel.insertBefore(tabRow, content);
    panel.insertBefore(header, tabRow);
    panel.appendChild(footer);

    function setVisible(next) {
        visible = next;
        panel.style.display = visible ? 'flex' : 'none';
        toggleBtn.style.outline = visible ? `2px solid ${GOLD_DARK}` : 'none';
        if (visible) render();
    }

    function toggle() {
        setVisible(!visible);
    }

    function updateTabStyles() {
        tabs.forEach((tab) => {
            const selected = tab.dataset.tab === activeTab;
            tab.classList.toggle('hud-btn--selected', selected);
        });
    }

    function renderHistoryTab() {
        const entries = rollHistory.getEntries();
        if (entries.length === 0) {
            content.innerHTML = `<div class="hud-panel--history__empty">No rolls yet. Throw some dice and they will appear here.</div>`;
            return;
        }

        const list = document.createElement('div');
        list.className = 'hud-panel--history__list';

        entries.forEach((entry, index) => {
            const expanded = expandedIds.has(entry.id);
            const row = document.createElement('div');
            row.className = 'hud-panel--history__entry';
            if (index === 0) row.classList.add('hud-panel--history__entry--latest');

            const summaryBtn = document.createElement('button');
            summaryBtn.type = 'button';
            summaryBtn.className = 'hud-panel--history__entry-summary';
            guardPointerEvents(summaryBtn);

            const time = new Date(entry.timestamp).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const setLabel = formatDiceSet(entry.diceSet);
            const summary = formatResultsSummary(entry.diceResults);

            summaryBtn.innerHTML = `
                <div style="font-size:10px;color:${GOLD_DARK};">${time}</div>
                <div style="margin-top:3px;font-size:12px;color:var(--hud-fg);line-height:1.4;">
                    ${setLabel ? `<span style="color:${MUTED};">${setLabel}</span><br>` : ''}
                    ${summary}
                </div>
                <div style="margin-top:4px;font-size:13px;color:${GOLD};font-weight:bold;">Total: ${entry.total}</div>
                <div style="margin-top:2px;font-size:10px;color:${MUTED};">${expanded ? '▲ hide details' : '▼ show details'}</div>
            `;

            summaryBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (expandedIds.has(entry.id)) expandedIds.delete(entry.id);
                else expandedIds.add(entry.id);
                render();
            });

            row.appendChild(summaryBtn);

            if (expanded) {
                const details = document.createElement('div');
                details.className = 'hud-panel--history__entry-details';

                const diceGrid = document.createElement('div');
                diceGrid.className = 'hud-panel--history__die-grid';
                entry.diceResults.forEach((result) => {
                    const chip = document.createElement('div');
                    chip.className = 'hud-panel--history__die-chip';
                    chip.innerHTML = `
                        <div style="font-size:9px;color:${GOLD_DARK};text-transform:uppercase;">${result.type}</div>
                        <div style="font-size:18px;color:${GOLD};font-weight:bold;">${result.value}</div>
                    `;
                    diceGrid.appendChild(chip);
                });
                details.appendChild(diceGrid);

                if (entry.expression) {
                    const expr = document.createElement('div');
                    expr.className = 'hud-panel--history__meta-line';
                    expr.textContent = `Expression: ${entry.expression}`;
                    details.appendChild(expr);
                }

                if (entry.seed != null && typeof onReplay === 'function') {
                    const replayBtn = hudButton(`↻ Replay seed ${entry.seed}`, 'hud-mt-xs');
                    replayBtn.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onReplay(entry.seed);
                    });
                    details.appendChild(replayBtn);
                } else if (entry.seed != null) {
                    const seedLabel = document.createElement('div');
                    seedLabel.className = 'hud-panel--history__meta-line';
                    seedLabel.textContent = `Seed: ${entry.seed}`;
                    details.appendChild(seedLabel);
                }

                row.appendChild(details);
            }

            list.appendChild(row);
        });

        content.innerHTML = '';
        content.appendChild(list);
    }

    function renderStatsTab() {
        const stats = rollStats.getStats();
        const minSampleSize = rollStats.minSampleSize ?? 100;

        if (stats.length === 0) {
            content.innerHTML = `<div class="hud-panel--history__empty">Statistics appear after your first settled roll.</div>`;
            return;
        }

        const intro = document.createElement('div');
        intro.className = 'hud-panel--history__intro';
        intro.textContent = `Face distributions with expected-vs-actual mean. Chi-squared fairness activates after ${minSampleSize}+ rolls per die type (95% confidence).`;

        const sections = document.createElement('div');
        sections.className = 'hud-panel--history__sections';

        stats.forEach((stat) => {
            const expected = stat.totalRolls / stat.sides;
            const maxObserved = Math.max(...stat.observedCounts, expected, 1);
            const statusColor = !stat.hasEnoughSamples ? GOLD_DARK : stat.passes ? PASS : FAIL;
            const statusText = !stat.hasEnoughSamples
                ? `warming up (${Math.max(0, minSampleSize - stat.totalRolls)} to go)`
                : stat.passes
                  ? 'fair'
                  : 'skewed';

            const rows = stat.observedCounts
                .map((count, index) => {
                    const face = index + 1;
                    const observedWidth = `${(count / maxObserved) * 100}%`;
                    const expectedWidth = `${(expected / maxObserved) * 100}%`;
                    return `
                    <div style="display:grid;grid-template-columns:28px 1fr 56px;gap:8px;align-items:center;">
                        <div style="color:var(--hud-fg);font-variant-numeric:tabular-nums;">${face}</div>
                        <div style="display:flex;align-items:center;gap:4px;height:10px;">
                            <div style="height:10px;width:${observedWidth};min-width:${count > 0 ? '2px' : '0'};background:${OBSERVED};border-radius:999px;"></div>
                            <div style="height:6px;width:${expectedWidth};background:${EXPECTED};opacity:0.8;border-radius:999px;"></div>
                        </div>
                        <div style="text-align:right;color:${MUTED};font-variant-numeric:tabular-nums;">${count}/${expected.toFixed(1)}</div>
                    </div>
                `;
                })
                .join('');

            const section = document.createElement('section');
            section.className = 'hud-panel--history__stat-section';
            section.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
                    <div style="font-size:13px;color:${OBSERVED};font-weight:bold;">${stat.dieType}</div>
                    <div style="color:${statusColor};text-transform:uppercase;letter-spacing:0.4px;font-size:10px;">${statusText}</div>
                </div>
                <div style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;color:${MUTED};font-variant-numeric:tabular-nums;font-size:11px;">
                    <span>N=${stat.totalRolls}</span>
                    <span>mean ${stat.actualMean.toFixed(2)} / ${stat.expectedMean.toFixed(2)}</span>
                    <span>χ²=${stat.chiSquared.toFixed(2)}</span>
                    <span>crit=${stat.criticalValue?.toFixed(2) ?? 'n/a'}</span>
                </div>
                <div style="margin-top:7px;display:flex;flex-direction:column;gap:4px;">${rows}</div>
            `;
            sections.appendChild(section);
        });

        content.innerHTML = '';
        content.appendChild(intro);
        content.appendChild(sections);
    }

    function renderFooter() {
        footer.innerHTML = '';

        const copyBtn = hudButton('Copy log');
        copyBtn.style.flex = '1';
        copyBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const text = rollHistory.exportAsText();
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy log';
                }, 1500);
            } catch {
                window.prompt('Roll history:', text);
            }
        });

        const csvBtn = hudButton('CSV');
        csvBtn.style.flex = '1';
        csvBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const csv = rollHistory.exportAsCsv();
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `dice-roll-history-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        });

        const clearHistoryBtn = hudButton('Clear log');
        clearHistoryBtn.style.flex = '1';
        clearHistoryBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            rollHistory.clear();
            expandedIds.clear();
            render();
        });

        const resetStatsBtn = hudButton('Reset stats');
        resetStatsBtn.style.flex = '1';
        resetStatsBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            rollStats.reset();
            render();
        });

        footer.appendChild(copyBtn);
        footer.appendChild(csvBtn);
        footer.appendChild(clearHistoryBtn);
        footer.appendChild(resetStatsBtn);
    }

    function render() {
        updateTabStyles();
        if (activeTab === 'statistics') renderStatsTab();
        else renderHistoryTab();
        renderFooter();
    }

    const onKeyDown = (event) => {
        if (event.code !== 'KeyH' || event.repeat) return;
        if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
        event.preventDefault();
        toggle();
    };
    window.addEventListener('keydown', onKeyDown);

    return {
        toggle,
        setVisible,
        refresh: render,
        destroy() {
            window.removeEventListener('keydown', onKeyDown);
            toggleBtn.remove();
            panel.remove();
        },
    };
}
