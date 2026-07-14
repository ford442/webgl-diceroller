import { DENSITY_PRESETS, LAYOUT_THEMES, buildShareableTableUrl } from './core/TableLayoutConfig.js';
import { isTouchPrimaryDevice } from './core/DeviceCapabilities.js';

export const initUI = (onUpdateDice, onRollAll, layoutHooks = null, notationHooks = null) => {
    const canvasContainer = document.getElementById('canvas-container') || document.body;
    const touchUi = isTouchPrimaryDevice();

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = touchUi ? '8px' : '10px';
    container.style.right = touchUi ? '8px' : '10px';
    container.style.left = touchUi ? '8px' : 'auto';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    container.style.padding = touchUi ? '12px' : '10px';
    container.style.color = 'white';
    container.style.fontFamily = 'sans-serif';
    container.style.borderRadius = '5px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = touchUi ? '8px' : '5px';
    container.style.zIndex = '1000';
    container.style.maxWidth = touchUi ? 'min(92vw, 320px)' : '220px';
    if (touchUi) {
        container.style.maxHeight = '42vh';
        container.style.overflowY = 'auto';
        container.style.webkitOverflowScrolling = 'touch';
    }

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
        input.style.width = touchUi ? '56px' : '40px';
        input.style.minHeight = touchUi ? '44px' : 'auto';
        input.style.fontSize = touchUi ? '16px' : 'inherit';
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

    // --- Dice-set presets: quickly load a themed handful of dice ---
    const PRESETS = {
        'Standard set': { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 },
        'Single d20': { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 1 },
        "Bard's Luck": { d4: 1, d6: 1, d8: 0, d10: 0, d12: 0, d20: 2 },
        'Fistful of d6': { d4: 0, d6: 5, d8: 0, d10: 0, d12: 0, d20: 0 },
        "Wizard's Arsenal": { d4: 2, d6: 2, d8: 2, d10: 1, d12: 1, d20: 1 }
    };

    const applyPreset = (preset) => {
        diceTypes.forEach((type) => {
            counts[type] = preset[type] ?? 0;
            if (inputs[type]) inputs[type].value = String(counts[type]);
        });
        onUpdateDice(counts);
    };

    const presetRow = document.createElement('div');
    presetRow.style.display = 'flex';
    presetRow.style.alignItems = 'center';
    presetRow.style.gap = '6px';
    presetRow.style.marginTop = '6px';
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'Set:';
    const presetSelect = document.createElement('select');
    presetSelect.style.flex = '1';
    const placeholder = document.createElement('option');
    placeholder.textContent = 'Presets…';
    placeholder.value = '';
    presetSelect.appendChild(placeholder);
    Object.keys(PRESETS).forEach((name) => {
        const opt = document.createElement('option');
        opt.textContent = name;
        opt.value = name;
        presetSelect.appendChild(opt);
    });
    presetSelect.addEventListener('change', () => {
        const preset = PRESETS[presetSelect.value];
        if (preset) applyPreset(preset);
        presetSelect.value = '';
    });
    presetSelect.addEventListener('mousedown', (e) => e.stopPropagation());
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    container.appendChild(presetRow);

    // --- Dice notation roll input ---
    if (notationHooks?.onNotationRoll) {
        const notationDivider = document.createElement('div');
        notationDivider.style.marginTop = '8px';
        notationDivider.style.paddingTop = '8px';
        notationDivider.style.borderTop = '1px solid rgba(255,255,255,0.2)';
        notationDivider.style.fontWeight = 'bold';
        notationDivider.textContent = 'Roll Notation';
        container.appendChild(notationDivider);

        const notationHistory = [];
        let historyIndex = -1;

        const notationInput = document.createElement('input');
        notationInput.type = 'text';
        notationInput.placeholder = 'e.g. 3d6+2, 2d20kh1';
        notationInput.spellcheck = false;
        notationInput.style.width = '100%';
        notationInput.style.boxSizing = 'border-box';
        notationInput.style.padding = '4px 6px';
        notationInput.style.marginTop = '4px';
        notationInput.addEventListener('mousedown', (e) => e.stopPropagation());

        const submitNotation = async () => {
            const expr = notationInput.value.trim();
            if (!expr) return;
            notationInput.disabled = true;
            try {
                await notationHooks.onNotationRoll(expr);
                if (!notationHistory.length || notationHistory[0] !== expr) {
                    notationHistory.unshift(expr);
                    if (notationHistory.length > 30) notationHistory.pop();
                }
                historyIndex = -1;
            } catch (err) {
                notationInput.style.outline = '1px solid #c44';
                setTimeout(() => { notationInput.style.outline = ''; }, 1200);
                console.warn('[Notation]', err?.message ?? err);
            } finally {
                notationInput.disabled = false;
            }
        };

        notationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitNotation();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!notationHistory.length) return;
                historyIndex = Math.min(historyIndex + 1, notationHistory.length - 1);
                notationInput.value = notationHistory[historyIndex];
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex <= 0) {
                    historyIndex = -1;
                    notationInput.value = '';
                    return;
                }
                historyIndex--;
                notationInput.value = notationHistory[historyIndex];
            }
        });

        container.appendChild(notationInput);

        const notationBtnRow = document.createElement('div');
        notationBtnRow.style.display = 'flex';
        notationBtnRow.style.gap = '6px';
        notationBtnRow.style.marginTop = '4px';

        const notationRollBtn = document.createElement('button');
        notationRollBtn.textContent = 'Roll';
        notationRollBtn.style.flex = '1';
        notationRollBtn.style.cursor = 'pointer';
        notationRollBtn.addEventListener('click', submitNotation);
        notationRollBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        notationBtnRow.appendChild(notationRollBtn);
        container.appendChild(notationBtnRow);

        const NOTATION_PRESETS = notationHooks.presets ?? [
            '1d20',
            '2d20kh1',
            '3d6',
            '4d6dl1',
            '1d100'
        ];

        const presetChipRow = document.createElement('div');
        presetChipRow.style.display = 'flex';
        presetChipRow.style.flexWrap = 'wrap';
        presetChipRow.style.gap = '4px';
        presetChipRow.style.marginTop = '6px';

        NOTATION_PRESETS.forEach((preset) => {
            const chip = document.createElement('button');
            chip.textContent = preset;
            chip.style.cssText = 'font-size:10px;padding:2px 6px;cursor:pointer;border-radius:3px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:white;';
            chip.addEventListener('mousedown', (e) => e.stopPropagation());
            chip.addEventListener('click', () => {
                notationInput.value = preset;
                submitNotation();
            });
            presetChipRow.appendChild(chip);
        });
        container.appendChild(presetChipRow);
    }

    const rollBtn = document.createElement('button');
    rollBtn.textContent = 'Roll All';
    rollBtn.style.cursor = 'pointer';
    rollBtn.addEventListener('click', () => onRollAll());
    rollBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    rollBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    if (touchUi) {
        const rollDock = document.createElement('div');
        rollDock.style.position = 'absolute';
        rollDock.style.left = '50%';
        rollDock.style.bottom = 'max(16px, env(safe-area-inset-bottom))';
        rollDock.style.transform = 'translateX(-50%)';
        rollDock.style.zIndex = '1001';
        rollBtn.style.marginTop = '0';
        rollBtn.style.minHeight = '52px';
        rollBtn.style.minWidth = 'min(72vw, 280px)';
        rollBtn.style.fontSize = '18px';
        rollBtn.style.fontWeight = 'bold';
        rollBtn.style.borderRadius = '999px';
        rollBtn.style.border = '1px solid rgba(255, 153, 51, 0.65)';
        rollBtn.style.background = 'rgba(255, 153, 51, 0.92)';
        rollBtn.style.color = '#1a1008';
        rollBtn.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
        rollDock.appendChild(rollBtn);
        canvasContainer.appendChild(rollDock);
    } else {
        rollBtn.style.marginTop = '10px';
        container.appendChild(rollBtn);
    }

    // --- Audio volume / mute (persisted in localStorage by the audio module) ---
    const audio = layoutHooks?.audio;
    if (audio) {
        const audioRow = document.createElement('div');
        audioRow.style.display = 'flex';
        audioRow.style.alignItems = 'center';
        audioRow.style.gap = '6px';
        audioRow.style.marginTop = '8px';
        audioRow.addEventListener('mousedown', (e) => e.stopPropagation());

        const muteBtn = document.createElement('button');
        muteBtn.style.cursor = 'pointer';
        muteBtn.style.minWidth = '34px';
        muteBtn.title = 'Mute / unmute';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = String(audio.getMasterVolume?.() ?? 0.6);
        slider.style.flex = '1';
        slider.title = 'Volume';

        const syncMuteIcon = () => {
            const isMuted = audio.isMuted?.() || parseFloat(slider.value) <= 0;
            muteBtn.textContent = isMuted ? '🔇' : '🔊';
            slider.style.opacity = audio.isMuted?.() ? '0.4' : '1';
        };

        slider.addEventListener('input', () => {
            audio.resume?.();
            audio.setMasterVolume?.(parseFloat(slider.value));
            // Adjusting the slider above zero implicitly unmutes.
            if (parseFloat(slider.value) > 0 && audio.isMuted?.()) audio.setMuted?.(false);
            syncMuteIcon();
        });
        muteBtn.addEventListener('click', () => {
            audio.resume?.();
            audio.toggleMute?.();
            syncMuteIcon();
        });
        muteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        slider.addEventListener('mousedown', (e) => e.stopPropagation());

        syncMuteIcon();
        audioRow.appendChild(muteBtn);
        audioRow.appendChild(slider);
        container.appendChild(audioRow);
    }

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
    helpContainer.style.fontSize = touchUi ? '11px' : '12px';
    helpContainer.style.borderRadius = '5px';
    helpContainer.style.zIndex = '1000';
    if (touchUi) {
        helpContainer.style.bottom = 'max(84px, calc(16px + env(safe-area-inset-bottom)))';
        helpContainer.style.maxWidth = 'min(92vw, 320px)';
    }
    helpContainer.innerHTML = touchUi ? `
        <div style="font-weight: bold; margin-bottom: 5px;">Touch Controls:</div>
        <div>👆 <b>Tap table</b> - Roll all dice</div>
        <div>👉 <b>Flick table</b> - Toss dice</div>
        <div>👇 <b>Hold die</b> - Grab and drag</div>
        <div>👆👆 <b>Double-tap die</b> - Levitate</div>
        <div>✌️ <b>Two fingers</b> - Orbit / pinch zoom</div>
    ` : `
        <div style="font-weight: bold; margin-bottom: 5px;">Controls:</div>
        <div>🖱️ <b>Left Click</b> - Grab/throw dice</div>
        <div>🖱️ <b>Right Click</b> - Enter FPS mode</div>
        <div>⌨️ <b>WASD</b> - Move (FPS mode)</div>
        <div>⌨️ <b>ESC</b> - Exit FPS mode</div>
        <div>⌨️ <b>R</b> - Roll all dice</div>
        <div>⌨️ <b>H</b> - Roll history & statistics</div>
        <div>⌨️ <b>Enter</b> - Roll notation expression</div>
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
