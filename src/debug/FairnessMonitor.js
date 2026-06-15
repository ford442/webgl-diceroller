const DIE_SIDES = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d12: 12,
    d20: 20
};

const DIE_ORDER = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

// Chi-squared critical values for alpha=0.05, df = sides - 1.
const CHI_SQUARED_CRITICAL_95 = {
    4: 7.815,
    6: 11.070,
    8: 14.067,
    10: 16.919,
    12: 19.675,
    20: 30.144
};

const PANEL_FONT = "'Palatino Linotype', 'Book Antiqua', Palatino, serif";
const PANEL_BG = 'rgba(15, 9, 2, 0.92)';
const PANEL_BORDER = '1px solid rgba(232, 200, 130, 0.42)';
const LABEL = '#e8c882';
const MUTED = '#a78a58';
const PASS = '#8fd18f';
const FAIL = '#ff8f7a';
const OBSERVED = '#ffd66b';
const EXPECTED = '#6486ff';
const MIN_SAMPLE_SIZE = 100;

function createEmptyEntry(sides) {
    const counts = new Map();
    for (let face = 1; face <= sides; face++) {
        counts.set(face, 0);
    }
    return {
        sides,
        totalRolls: 0,
        counts
    };
}

function ensureEntry(store, dieType) {
    const sides = DIE_SIDES[dieType];
    if (!sides) return null;

    if (!store.has(dieType)) {
        store.set(dieType, createEmptyEntry(sides));
    }

    return store.get(dieType);
}

export function computeChiSquared(observedCounts, sides) {
    const total = observedCounts.reduce((sum, count) => sum + count, 0);
    if (total === 0 || sides <= 0) return 0;

    const expected = total / sides;
    if (expected === 0) return 0;

    return observedCounts.reduce((sum, count) => (
        sum + ((count - expected) ** 2) / expected
    ), 0);
}

export function createFairnessMonitor({ enabled = false, minSampleSize = MIN_SAMPLE_SIZE } = {}) {
    const store = new Map();
    let panel = null;

    function init() {
        if (!enabled || panel) return;

        const container = document.getElementById('canvas-container') || document.body;
        panel = document.createElement('div');
        panel.id = 'fairness-monitor-panel';
        panel.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            width: 340px;
            max-height: calc(100% - 20px);
            overflow-y: auto;
            padding: 10px 12px 12px;
            background: ${PANEL_BG};
            border: ${PANEL_BORDER};
            border-radius: 8px;
            color: ${LABEL};
            font-family: ${PANEL_FONT};
            font-size: 12px;
            z-index: 1090;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.26);
        `;
        container.appendChild(panel);
        render();
    }

    function recordResults(diceResults) {
        if (!enabled || !Array.isArray(diceResults)) return;

        for (const result of diceResults) {
            if (!result || typeof result.type !== 'string') continue;
            if (!Number.isInteger(result.value)) continue;

            const entry = ensureEntry(store, result.type);
            if (!entry || result.value < 1 || result.value > entry.sides) continue;

            entry.totalRolls += 1;
            entry.counts.set(result.value, (entry.counts.get(result.value) ?? 0) + 1);
        }

        render();
    }

    function reset() {
        store.clear();
        render();
    }

    function getStats() {
        return DIE_ORDER
            .map((dieType) => {
                const entry = store.get(dieType);
                if (!entry) return null;

                const observedCounts = Array.from({ length: entry.sides }, (_, index) => entry.counts.get(index + 1) ?? 0);
                const chiSquared = computeChiSquared(observedCounts, entry.sides);
                const criticalValue = CHI_SQUARED_CRITICAL_95[entry.sides] ?? null;
                return {
                    dieType,
                    sides: entry.sides,
                    totalRolls: entry.totalRolls,
                    observedCounts,
                    chiSquared,
                    criticalValue,
                    hasEnoughSamples: entry.totalRolls >= minSampleSize,
                    passes: criticalValue == null ? null : chiSquared <= criticalValue
                };
            })
            .filter(Boolean);
    }

    function render() {
        if (!panel) return;

        const stats = getStats();
        if (stats.length === 0) {
            panel.innerHTML = `
                <div style="font-size:14px;font-weight:bold;letter-spacing:0.6px;color:${OBSERVED};">Fairness Monitor</div>
                <div style="margin-top:6px;color:${MUTED};line-height:1.45;">
                    Tracks settled roll outcomes by die type and computes a Pearson chi-squared goodness-of-fit test.
                </div>
                <div style="margin-top:8px;color:${MUTED};font-style:italic;">No settled rolls recorded yet.</div>
            `;
            return;
        }

        const sections = stats.map((stat) => renderDieSection(stat)).join('');
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                <div>
                    <div style="font-size:14px;font-weight:bold;letter-spacing:0.6px;color:${OBSERVED};">Fairness Monitor</div>
                    <div style="margin-top:2px;color:${MUTED};line-height:1.35;">
                        Pearson chi-squared test against a uniform face distribution.
                    </div>
                </div>
                <button id="fairness-monitor-reset" style="
                    background: rgba(232, 200, 130, 0.12);
                    color: ${LABEL};
                    border: 1px solid rgba(232, 200, 130, 0.28);
                    border-radius: 4px;
                    padding: 3px 7px;
                    cursor: pointer;
                    font: inherit;
                ">Reset</button>
            </div>
            <div style="margin-top:8px;color:${MUTED};line-height:1.4;">
                Pass/fail activates once a die type reaches ${minSampleSize}+ recorded rolls. Critical values use 95% confidence.
            </div>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">${sections}</div>
        `;

        const resetButton = panel.querySelector('#fairness-monitor-reset');
        if (resetButton) {
            resetButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                reset();
            });
        }
    }

    function renderDieSection(stat) {
        const expected = stat.totalRolls / stat.sides;
        const maxObserved = Math.max(...stat.observedCounts, expected, 1);
        const statusColor = !stat.hasEnoughSamples
            ? LABEL
            : (stat.passes ? PASS : FAIL);
        const statusText = !stat.hasEnoughSamples
            ? `warming up (${minSampleSize - stat.totalRolls} to go)`
            : (stat.passes ? 'pass' : 'fail');

        const rows = stat.observedCounts.map((count, index) => {
            const face = index + 1;
            const observedWidth = `${(count / maxObserved) * 100}%`;
            const expectedWidth = `${(expected / maxObserved) * 100}%`;
            return `
                <div style="display:grid;grid-template-columns:28px 1fr 56px;gap:8px;align-items:center;">
                    <div style="color:${LABEL};font-variant-numeric:tabular-nums;">${face}</div>
                    <div style="display:flex;align-items:center;gap:4px;height:10px;">
                        <div style="height:10px;width:${observedWidth};min-width:${count > 0 ? '2px' : '0'};background:${OBSERVED};border-radius:999px;"></div>
                        <div style="height:6px;width:${expectedWidth};background:${EXPECTED};opacity:0.8;border-radius:999px;"></div>
                    </div>
                    <div style="text-align:right;color:${MUTED};font-variant-numeric:tabular-nums;">${count}/${expected.toFixed(1)}</div>
                </div>
            `;
        }).join('');

        return `
            <section style="padding:8px 9px 9px;background:rgba(255,255,255,0.03);border:1px solid rgba(232, 200, 130, 0.16);border-radius:6px;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
                    <div style="font-size:13px;color:${OBSERVED};font-weight:bold;">${stat.dieType}</div>
                    <div style="color:${statusColor};text-transform:uppercase;letter-spacing:0.4px;">${statusText}</div>
                </div>
                <div style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap;color:${MUTED};font-variant-numeric:tabular-nums;">
                    <span>N=${stat.totalRolls}</span>
                    <span>chi^2=${stat.chiSquared.toFixed(2)}</span>
                    <span>crit=${stat.criticalValue?.toFixed(2) ?? 'n/a'}</span>
                </div>
                <div style="margin-top:7px;display:flex;flex-direction:column;gap:4px;">${rows}</div>
            </section>
        `;
    }

    return {
        init,
        recordResults,
        reset,
        getStats
    };
}
