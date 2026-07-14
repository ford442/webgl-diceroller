import { formatDiceSet, formatResultsSummary } from '../roll/RollHistory.js';

const FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";
const GOLD = '#ffd700';
const GOLD_DIM = '#e8c882';
const GOLD_DARK = '#8B6914';
const BG_PANEL = 'rgba(15, 9, 2, 0.94)';
const BG_CARD = 'rgba(20, 10, 0, 0.92)';
const BORDER = '1px solid rgba(139, 105, 20, 0.45)';
const MUTED = '#a78a58';
const PASS = '#8fd18f';
const FAIL = '#ff8f7a';
const OBSERVED = '#ffd66b';
const EXPECTED = '#6486ff';

function buttonStyle(extra = '') {
    return `
        background: rgba(139, 105, 20, 0.22);
        color: ${GOLD_DIM};
        border: 1px solid rgba(232, 200, 130, 0.28);
        border-radius: 4px;
        padding: 5px 8px;
        cursor: pointer;
        font-family: ${FONT};
        font-size: 11px;
        letter-spacing: 0.4px;
        ${extra}
    `;
}

export function createRollHistoryPanel({
    rollHistory,
    rollStats,
    onReplay = null,
    container = null
} = {}) {
    if (!rollHistory || !rollStats) {
        throw new Error('createRollHistoryPanel requires rollHistory and rollStats');
    }

    const mount = container ?? document.getElementById('canvas-container') ?? document.body;
    let visible = false;
    let activeTab = 'history';
    const expandedIds = new Set();

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'roll-history-toggle';
    toggleBtn.type = 'button';
    toggleBtn.title = 'Roll history (H)';
    toggleBtn.setAttribute('aria-label', 'Toggle roll history');
    toggleBtn.style.cssText = `
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 1085;
        width: 38px;
        height: 38px;
        border-radius: 8px;
        border: ${BORDER};
        background: ${BG_PANEL};
        color: ${GOLD_DIM};
        font-size: 18px;
        cursor: pointer;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
    `;
    toggleBtn.textContent = '📜';
    toggleBtn.addEventListener('mousedown', (event) => event.stopPropagation());
    toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setVisible(!visible);
    });

    const panel = document.createElement('div');
    panel.id = 'roll-history-panel';
    panel.style.cssText = `
        position: absolute;
        top: 56px;
        left: 10px;
        width: min(360px, calc(100vw - 20px));
        max-height: calc(100% - 66px);
        display: none;
        flex-direction: column;
        background: ${BG_PANEL};
        border: ${BORDER};
        border-radius: 10px;
        color: ${GOLD_DIM};
        font-family: ${FONT};
        font-size: 12px;
        z-index: 1080;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
        overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: ${BORDER};
        background: rgba(139, 105, 20, 0.18);
    `;

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:bold;letter-spacing:0.6px;color:' + GOLD + ';';
    title.textContent = 'Roll Chronicle';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close (H)';
    closeBtn.style.cssText = buttonStyle('padding:2px 7px;');
    closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setVisible(false);
    });
    closeBtn.addEventListener('mousedown', (event) => event.stopPropagation());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const tabRow = document.createElement('div');
    tabRow.style.cssText = `
        display: flex;
        gap: 6px;
        padding: 8px 12px 0;
    `;

    const historyTab = document.createElement('button');
    historyTab.type = 'button';
    historyTab.textContent = 'History';
    historyTab.dataset.tab = 'history';

    const statsTab = document.createElement('button');
    statsTab.type = 'button';
    statsTab.textContent = 'Statistics';
    statsTab.dataset.tab = 'statistics';

    const tabs = [historyTab, statsTab];
    tabs.forEach((tab) => {
        tab.style.cssText = buttonStyle('flex:1;');
        tab.addEventListener('mousedown', (event) => event.stopPropagation());
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            activeTab = tab.dataset.tab;
            render();
        });
        tabRow.appendChild(tab);
    });

    const content = document.createElement('div');
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 10px 12px 12px;
    `;

    const footer = document.createElement('div');
    footer.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px 12px;
        border-top: ${BORDER};
        background: rgba(0, 0, 0, 0.12);
    `;

    panel.appendChild(header);
    panel.appendChild(tabRow);
    panel.appendChild(content);
    panel.appendChild(footer);
    mount.appendChild(toggleBtn);
    mount.appendChild(panel);

    function setVisible(next) {
        visible = next;
        panel.style.display = visible ? 'flex' : 'none';
        toggleBtn.style.outline = visible ? `2px solid ${GOLD_DIM}` : 'none';
        if (visible) render();
    }

    function toggle() {
        setVisible(!visible);
    }

    function updateTabStyles() {
        tabs.forEach((tab) => {
            const selected = tab.dataset.tab === activeTab;
            tab.style.background = selected ? 'rgba(232, 200, 130, 0.22)' : 'rgba(139, 105, 20, 0.22)';
            tab.style.color = selected ? GOLD : GOLD_DIM;
            tab.style.fontWeight = selected ? 'bold' : 'normal';
        });
    }

    function renderHistoryTab() {
        const entries = rollHistory.getEntries();
        if (entries.length === 0) {
            content.innerHTML = `<div style="color:${MUTED};font-style:italic;line-height:1.5;">No rolls yet. Throw some dice and they will appear here.</div>`;
            return;
        }

        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

        entries.forEach((entry, index) => {
            const expanded = expandedIds.has(entry.id);
            const row = document.createElement('div');
            row.style.cssText = `
                border: 1px solid rgba(139, 105, 20, 0.22);
                border-radius: 8px;
                background: ${index === 0 ? 'rgba(139, 105, 20, 0.14)' : BG_CARD};
                overflow: hidden;
            `;

            const summaryBtn = document.createElement('button');
            summaryBtn.type = 'button';
            summaryBtn.style.cssText = `
                display: block;
                width: 100%;
                text-align: left;
                background: transparent;
                border: 0;
                color: inherit;
                cursor: pointer;
                padding: 8px 10px;
                font-family: ${FONT};
            `;
            summaryBtn.addEventListener('mousedown', (event) => event.stopPropagation());

            const time = new Date(entry.timestamp).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const setLabel = formatDiceSet(entry.diceSet);
            const summary = formatResultsSummary(entry.diceResults);

            summaryBtn.innerHTML = `
                <div style="font-size:10px;color:${GOLD_DARK};">${time}</div>
                <div style="margin-top:3px;font-size:12px;color:${GOLD_DIM};line-height:1.4;">
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
                details.style.cssText = `
                    padding: 0 10px 10px;
                    border-top: 1px solid rgba(139, 105, 20, 0.18);
                `;

                const diceGrid = document.createElement('div');
                diceGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
                entry.diceResults.forEach((result) => {
                    const chip = document.createElement('div');
                    chip.style.cssText = `
                        min-width: 48px;
                        padding: 4px 8px;
                        border-radius: 6px;
                        border: 1px solid rgba(139, 105, 20, 0.35);
                        background: rgba(0, 0, 0, 0.18);
                        text-align: center;
                    `;
                    chip.innerHTML = `
                        <div style="font-size:9px;color:${GOLD_DARK};text-transform:uppercase;">${result.type}</div>
                        <div style="font-size:18px;color:${GOLD};font-weight:bold;">${result.value}</div>
                    `;
                    diceGrid.appendChild(chip);
                });
                details.appendChild(diceGrid);

                if (entry.expression) {
                    const expr = document.createElement('div');
                    expr.style.cssText = `margin-top:8px;color:${MUTED};font-size:11px;`;
                    expr.textContent = `Expression: ${entry.expression}`;
                    details.appendChild(expr);
                }

                if (entry.seed != null && typeof onReplay === 'function') {
                    const replayBtn = document.createElement('button');
                    replayBtn.type = 'button';
                    replayBtn.textContent = `↻ Replay seed ${entry.seed}`;
                    replayBtn.style.cssText = buttonStyle('margin-top:8px;');
                    replayBtn.addEventListener('mousedown', (event) => event.stopPropagation());
                    replayBtn.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onReplay(entry.seed);
                    });
                    details.appendChild(replayBtn);
                } else if (entry.seed != null) {
                    const seedLabel = document.createElement('div');
                    seedLabel.style.cssText = `margin-top:8px;color:${MUTED};font-size:11px;`;
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
            content.innerHTML = `<div style="color:${MUTED};font-style:italic;line-height:1.5;">Statistics appear after your first settled roll.</div>`;
            return;
        }

        const intro = document.createElement('div');
        intro.style.cssText = `color:${MUTED};line-height:1.45;margin-bottom:10px;`;
        intro.textContent = `Face distributions with expected-vs-actual mean. Chi-squared fairness activates after ${minSampleSize}+ rolls per die type (95% confidence).`;

        const sections = document.createElement('div');
        sections.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

        stats.forEach((stat) => {
            const expected = stat.totalRolls / stat.sides;
            const maxObserved = Math.max(...stat.observedCounts, expected, 1);
            const statusColor = !stat.hasEnoughSamples
                ? GOLD_DIM
                : (stat.passes ? PASS : FAIL);
            const statusText = !stat.hasEnoughSamples
                ? `warming up (${Math.max(0, minSampleSize - stat.totalRolls)} to go)`
                : (stat.passes ? 'fair' : 'skewed');

            const rows = stat.observedCounts.map((count, index) => {
                const face = index + 1;
                const observedWidth = `${(count / maxObserved) * 100}%`;
                const expectedWidth = `${(expected / maxObserved) * 100}%`;
                return `
                    <div style="display:grid;grid-template-columns:28px 1fr 56px;gap:8px;align-items:center;">
                        <div style="color:${GOLD_DIM};font-variant-numeric:tabular-nums;">${face}</div>
                        <div style="display:flex;align-items:center;gap:4px;height:10px;">
                            <div style="height:10px;width:${observedWidth};min-width:${count > 0 ? '2px' : '0'};background:${OBSERVED};border-radius:999px;"></div>
                            <div style="height:6px;width:${expectedWidth};background:${EXPECTED};opacity:0.8;border-radius:999px;"></div>
                        </div>
                        <div style="text-align:right;color:${MUTED};font-variant-numeric:tabular-nums;">${count}/${expected.toFixed(1)}</div>
                    </div>
                `;
            }).join('');

            const section = document.createElement('section');
            section.style.cssText = `
                padding: 8px 9px 9px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(232, 200, 130, 0.16);
                border-radius: 6px;
            `;
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

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy log';
        copyBtn.style.cssText = buttonStyle('flex:1;');
        copyBtn.addEventListener('mousedown', (event) => event.stopPropagation());
        copyBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const text = rollHistory.exportAsText();
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy log'; }, 1500);
            } catch {
                window.prompt('Roll history:', text);
            }
        });

        const csvBtn = document.createElement('button');
        csvBtn.type = 'button';
        csvBtn.textContent = 'CSV';
        csvBtn.style.cssText = buttonStyle('flex:1;');
        csvBtn.addEventListener('mousedown', (event) => event.stopPropagation());
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

        const clearHistoryBtn = document.createElement('button');
        clearHistoryBtn.type = 'button';
        clearHistoryBtn.textContent = 'Clear log';
        clearHistoryBtn.style.cssText = buttonStyle('flex:1;');
        clearHistoryBtn.addEventListener('mousedown', (event) => event.stopPropagation());
        clearHistoryBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            rollHistory.clear();
            expandedIds.clear();
            render();
        });

        const resetStatsBtn = document.createElement('button');
        resetStatsBtn.type = 'button';
        resetStatsBtn.textContent = 'Reset stats';
        resetStatsBtn.style.cssText = buttonStyle('flex:1;');
        resetStatsBtn.addEventListener('mousedown', (event) => event.stopPropagation());
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
        }
    };
}
