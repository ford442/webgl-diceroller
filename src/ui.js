import { DENSITY_PRESETS, LAYOUT_THEMES, buildShareableTableUrl } from './core/TableLayoutConfig.js';

export const initUI = (onUpdateDice, onRollAll, layoutHooks = null) => {
    const canvasContainer = document.getElementById('canvas-container') || document.body;
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    container.style.padding = '10px';
    container.style.color = 'white';
    container.style.fontFamily = 'sans-serif';
    container.style.borderRadius = '5px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '5px';
    container.style.zIndex = '1000';
    container.style.maxWidth = '220px';

    const diceTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const inputs = {};
    const counts = { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 };

    diceTypes.forEach(type => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';

        const label = document.createElement('label');
        label.textContent = type.toUpperCase() + ': ';
        label.style.marginRight = '10px';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '10';
        input.value = counts[type];
        input.style.width = '40px';
        input.style.marginLeft = '5px';

        input.addEventListener('change', () => {
            counts[type] = parseInt(input.value) || 0;
            onUpdateDice(counts);
        });
        input.addEventListener('mousedown', (e) => e.stopPropagation());

        inputs[type] = input;
        row.appendChild(label);
        row.appendChild(input);
        container.appendChild(row);
    });

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll All';
    rollBtn.style.marginTop = '10px';
    rollBtn.style.cursor = 'pointer';
    rollBtn.addEventListener('click', () => onRollAll());
    rollBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    container.appendChild(rollBtn);

    let densitySelect;
    let themeSelect;
    let statusLine;
    let rerollBtn;
    let shareBtn;

    if (layoutHooks?.onRerollLayout) {
        const layoutDivider = document.createElement('div');
        layoutDivider.style.marginTop = '8px';
        layoutDivider.style.paddingTop = '8px';
        layoutDivider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
        layoutDivider.style.fontWeight = 'bold';
        layoutDivider.textContent = 'Table Layout';
        container.appendChild(layoutDivider);

        const densityRow = document.createElement('div');
        densityRow.style.display = 'flex';
        densityRow.style.justifyContent = 'space-between';
        densityRow.style.alignItems = 'center';
        densityRow.style.gap = '8px';

        const densityLabel = document.createElement('label');
        densityLabel.textContent = 'Density';
        densityLabel.style.fontSize = '12px';

        densitySelect = document.createElement('select');
        densitySelect.style.flex = '1';
        Object.keys(DENSITY_PRESETS).forEach((key) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
            densitySelect.appendChild(option);
        });
        densitySelect.value = layoutHooks.layoutConfig?.density ?? 'med';
        densitySelect.addEventListener('mousedown', (e) => e.stopPropagation());
        densityRow.appendChild(densityLabel);
        densityRow.appendChild(densitySelect);
        container.appendChild(densityRow);

        const themeRow = document.createElement('div');
        themeRow.style.display = 'flex';
        themeRow.style.justifyContent = 'space-between';
        themeRow.style.alignItems = 'center';
        themeRow.style.gap = '8px';

        const themeLabel = document.createElement('label');
        themeLabel.textContent = 'Theme';
        themeLabel.style.fontSize = '12px';

        themeSelect = document.createElement('select');
        themeSelect.style.flex = '1';
        Object.values(LAYOUT_THEMES).forEach((theme) => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.label;
            themeSelect.appendChild(option);
        });
        themeSelect.value = layoutHooks.layoutConfig?.theme ?? 'default';
        themeSelect.addEventListener('mousedown', (e) => e.stopPropagation());
        themeRow.appendChild(themeLabel);
        themeRow.appendChild(themeSelect);
        container.appendChild(themeRow);

        rerollBtn = document.createElement('button');
        rerollBtn.textContent = 'New Table';
        rerollBtn.style.cursor = 'pointer';
        rerollBtn.style.marginTop = '4px';
        rerollBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        rerollBtn.addEventListener('click', async () => {
            rerollBtn.disabled = true;
            rerollBtn.textContent = 'Arranging...';
            try {
                const result = await layoutHooks.onRerollLayout({
                    density: densitySelect.value,
                    theme: themeSelect.value,
                    newSeed: true
                });
                updateLayoutStatus(result);
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.textContent = 'New Table';
            }
        });
        container.appendChild(rerollBtn);

        shareBtn = document.createElement('button');
        shareBtn.textContent = 'Copy Table Link';
        shareBtn.style.cursor = 'pointer';
        shareBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        shareBtn.addEventListener('click', async () => {
            const config = layoutHooks.onShareTable?.() ?? layoutHooks.layoutConfig;
            const url = buildShareableTableUrl(config);
            try {
                await navigator.clipboard.writeText(url);
                shareBtn.textContent = 'Copied!';
                setTimeout(() => { shareBtn.textContent = 'Copy Table Link'; }, 1500);
            } catch {
                window.prompt('Share this table:', url);
            }
        });
        container.appendChild(shareBtn);

        statusLine = document.createElement('div');
        statusLine.style.fontSize = '11px';
        statusLine.style.opacity = '0.85';
        statusLine.style.lineHeight = '1.35';
        container.appendChild(statusLine);
        updateLayoutStatus(layoutHooks.layoutConfig);
    }

    function updateLayoutStatus(config) {
        if (!statusLine || !config) return;
        statusLine.textContent = `Seed ${config.seed} · ${config.clutterCount} clutter · ${config.decorCount} decor`;
    }

    canvasContainer.appendChild(container);

    const helpContainer = document.createElement('div');
    helpContainer.style.position = 'absolute';
    helpContainer.style.bottom = '10px';
    helpContainer.style.left = '10px';
    helpContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    helpContainer.style.padding = '10px';
    helpContainer.style.color = 'white';
    helpContainer.style.fontFamily = 'sans-serif';
    helpContainer.style.fontSize = '12px';
    helpContainer.style.borderRadius = '5px';
    helpContainer.style.zIndex = '1000';
    helpContainer.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">Controls:</div>
        <div>🖱️ <b>Left Click</b> - Grab/throw dice</div>
        <div>🖱️ <b>Right Click</b> - Enter FPS mode</div>
        <div>⌨️ <b>WASD</b> - Move (FPS mode)</div>
        <div>⌨️ <b>ESC</b> - Exit FPS mode</div>
        <div>⌨️ <b>R</b> - Roll all dice</div>
        <div>⌨️ <b>Shift+R</b> - New table layout</div>
    `;
    canvasContainer.appendChild(helpContainer);

    return {
        updateCounts: (newCounts) => {
            if (!newCounts || typeof newCounts !== 'object') return;
            Object.keys(newCounts).forEach(key => {
                if (inputs[key]) {
                    inputs[key].value = newCounts[key];
                    counts[key] = newCounts[key];
                }
            });
        },
        updateLayoutStatus
    };
};

export const createCrosshair = () => {
    const canvasContainer = document.getElementById('canvas-container') || document.body;
    const crosshair = document.createElement('div');
    crosshair.style.position = 'absolute';
    crosshair.style.left = '50%';
    crosshair.style.top = '50%';
    crosshair.style.width = '20px';
    crosshair.style.height = '20px';
    crosshair.style.pointerEvents = 'none';
    crosshair.style.zIndex = '999';
    crosshair.style.transform = 'translate(-50%, -50%)';

    const circle = document.createElement('div');
    circle.style.width = '100%';
    circle.style.height = '100%';
    circle.style.border = '2px solid rgba(255, 255, 255, 0.7)';
    circle.style.borderRadius = '50%';
    crosshair.appendChild(circle);

    const dot = document.createElement('div');
    dot.style.position = 'absolute';
    dot.style.top = '50%';
    dot.style.left = '50%';
    dot.style.width = '4px';
    dot.style.height = '4px';
    dot.style.backgroundColor = 'white';
    dot.style.borderRadius = '50%';
    dot.style.transform = 'translate(-50%, -50%)';
    crosshair.appendChild(dot);

    canvasContainer.appendChild(crosshair);

    return {
        updatePosition: (x, y) => {
            crosshair.style.left = `${x}px`;
            crosshair.style.top = `${y}px`;
        },
        setVisible: (visible) => {
            crosshair.style.display = visible ? 'block' : 'none';
        }
    };
};
