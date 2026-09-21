import { DEFAULT_MIN_SAMPLE_SIZE } from '../roll/RollStats.js';
import { createHudPanel } from '../ui/hudPanel.js';

const LABEL = '#e8c882';
const MUTED = '#a78a58';
const PASS = '#8fd18f';
const FAIL = '#ff8f7a';
const OBSERVED = '#ffd66b';
const EXPECTED = '#6486ff';

export function createFairnessMonitor({
    enabled = false,
    rollStats = null,
    minSampleSize = DEFAULT_MIN_SAMPLE_SIZE,
} = {}) {
    let hudPanel = null;
    let panel = null;

    function init() {
        if (!enabled || panel || !rollStats) return;

        hudPanel = createHudPanel({
            id: 'fairness-monitor-panel',
            ariaLabel: 'Fairness monitor',
            anchor: 'top-right',
            variant: 'display',
            className: 'hud-panel--fairness',
        });
        panel = hudPanel.body;
        render();
    }

    function reset() {
        rollStats?.reset();
        render();
    }

    function render() {
        if (!panel || !rollStats) return;

        const stats = rollStats.getStats();
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
                <button id="fairness-monitor-reset" class="hud-btn">Reset</button>
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
        const statusColor = !stat.hasEnoughSamples ? LABEL : stat.passes ? PASS : FAIL;
        const statusText = !stat.hasEnoughSamples
            ? `warming up (${minSampleSize - stat.totalRolls} to go)`
            : stat.passes
              ? 'pass'
              : 'fail';

        const rows = stat.observedCounts
            .map((count, index) => {
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
            })
            .join('');

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
        reset,
        render,
        getStats: () => rollStats?.getStats() ?? [],
    };
}

export { computeChiSquared } from '../roll/RollStats.js';
