import {
    DENSITY_PRESETS,
    LAYOUT_THEMES,
    buildShareableTableUrl,
} from './core/TableLayoutConfig.js';
import { isTouchPrimaryDevice } from './core/DeviceCapabilities.js';
import {
    createHudPanel,
    hudButton,
    hudSelect,
    hudInput,
    guardPointerEvents,
} from './ui/hudPanel.js';

/**
 * @param {(counts: Record<string, number>) => void} onUpdateDice
 * @param {() => void} onRollAll
 * @param {object | null} [layoutHooks]
 * @param {{
 *   onNotationRoll?: (expression: string, options?: { system?: string }) => void | Promise<void>;
 *   presets?: string[];
 *   getSystem?: () => string;
 *   systems?: { id: string; label: string }[];
 *   setSystem?: (system: string) => void;
 *   defaultExpressionForSystem?: (system: string) => string;
 *   mechanicChips?: { id: string; label: string }[];
 *   applyChip?: (expression: string, chipId: string, system: string) => string;
 * } | null} [notationHooks]
 * @param {{ hasShareableRoll?: () => boolean; buildShareUrl?: () => string | null } | null} [rollShareHooks]
 */
export const initUI = (
    onUpdateDice,
    onRollAll,
    layoutHooks = null,
    notationHooks = null,
    rollShareHooks = null
) => {
    const canvasContainer = document.getElementById('canvas-container') || document.body;
    const touchUi = isTouchPrimaryDevice();

    const controlsPanel = createHudPanel({
        id: 'dice-controls-panel',
        ariaLabel: 'Dice controls',
        anchor: 'top-right',
        touchUi,
        parent: canvasContainer,
    });
    const container = controlsPanel.body;

    const diceTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const inputs = {};
    const counts = { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 };

    diceTypes.forEach((type) => {
        const row = document.createElement('div');
        row.className = 'hud-row hud-row--between';

        const label = document.createElement('label');
        label.htmlFor = `dice-count-${type}`;
        label.textContent = type.toUpperCase() + ': ';

        const input = hudInput('number', `${type} count`);
        input.id = `dice-count-${type}`;
        input.min = '0';
        input.max = '10';
        input.value = counts[type];
        input.style.width = touchUi ? '56px' : '40px';

        input.addEventListener('change', () => {
            counts[type] = parseInt(input.value) || 0;
            onUpdateDice(counts);
        });

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
        "Wizard's Arsenal": { d4: 2, d6: 2, d8: 2, d10: 1, d12: 1, d20: 1 },
    };

    const applyPreset = (preset) => {
        diceTypes.forEach((type) => {
            counts[type] = preset[type] ?? 0;
            if (inputs[type]) inputs[type].value = String(counts[type]);
        });
        onUpdateDice(counts);
    };

    const presetRow = document.createElement('div');
    presetRow.className = 'hud-row hud-mt-sm';
    const presetLabel = document.createElement('label');
    presetLabel.htmlFor = 'dice-preset-select';
    presetLabel.textContent = 'Set:';
    const presetSelect = hudSelect('Dice set preset');
    presetSelect.id = 'dice-preset-select';
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
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    container.appendChild(presetRow);

    // --- Dice notation roll input ---
    if (notationHooks?.onNotationRoll) {
        const notationDivider = document.createElement('div');
        notationDivider.className = 'hud-divider';
        notationDivider.textContent = 'Roll Notation';
        container.appendChild(notationDivider);

        const notationHistory = [];
        let historyIndex = -1;
        let activeSystem = notationHooks.getSystem?.() ?? 'dnd5e';

        const notationInput = hudInput('text', 'Dice notation expression');
        notationInput.id = 'notation-roll-input';
        notationInput.placeholder = 'e.g. 3d6+2, 2d20kh1, 1d20 vs 1d20';
        notationInput.spellcheck = false;
        notationInput.style.width = '100%';
        notationInput.classList.add('hud-mt-xs');

        const submitNotation = async () => {
            const expr = notationInput.value.trim();
            if (!expr) return;
            notationInput.disabled = true;
            try {
                await notationHooks.onNotationRoll(expr, { system: activeSystem });
                if (!notationHistory.length || notationHistory[0] !== expr) {
                    notationHistory.unshift(expr);
                    if (notationHistory.length > 30) notationHistory.pop();
                }
                historyIndex = -1;
            } catch (err) {
                notationInput.style.outline = '1px solid #c44';
                setTimeout(() => {
                    notationInput.style.outline = '';
                }, 1200);
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

        // System preset (defaults only — not a rules engine)
        const systemRow = document.createElement('div');
        systemRow.className = 'hud-row hud-mt-xs';
        const systemLabel = document.createElement('label');
        systemLabel.textContent = 'System';
        systemLabel.className = 'hud-label';
        systemLabel.htmlFor = 'notation-system-select';
        const systemSelect = hudSelect('Roll system preset');
        systemSelect.id = 'notation-system-select';
        systemSelect.style.flex = '1';
        const systems = notationHooks.systems ?? [
            { id: 'dnd5e', label: 'D&D 5e' },
            { id: 'pbta', label: 'PbtA' },
            { id: 'savage', label: 'Savage Worlds' },
            { id: 'coc', label: 'Call of Cthulhu' },
        ];
        systems.forEach((sys) => {
            const opt = document.createElement('option');
            opt.value = sys.id;
            opt.textContent = sys.label;
            if (sys.id === activeSystem) opt.selected = true;
            systemSelect.appendChild(opt);
        });
        systemSelect.addEventListener('change', () => {
            activeSystem = systemSelect.value;
            notationHooks.setSystem?.(activeSystem);
            if (notationHooks.defaultExpressionForSystem) {
                notationInput.value = notationHooks.defaultExpressionForSystem(activeSystem);
            }
        });
        systemRow.appendChild(systemLabel);
        systemRow.appendChild(systemSelect);
        container.appendChild(systemRow);

        // Mechanic chips — rewrite the expression without typing raw notation
        const chipDefs = notationHooks.mechanicChips ?? [
            { id: 'advantage', label: 'Adv' },
            { id: 'disadvantage', label: 'Dis' },
            { id: 'explode', label: 'Explode !' },
            { id: 'compound', label: 'Compound !!' },
            { id: 'reroll1', label: 'Reroll 1s' },
            { id: 'percentile', label: 'd100' },
            { id: 'opposed', label: 'Opposed' },
        ];

        const mechanicRow = document.createElement('div');
        mechanicRow.className = 'hud-row hud-row--wrap hud-mt-sm';
        mechanicRow.setAttribute('role', 'group');
        mechanicRow.setAttribute('aria-label', 'Notation modifiers');

        chipDefs.forEach((chip) => {
            const btn = hudButton(chip.label, 'hud-btn--chip');
            btn.addEventListener('click', () => {
                if (chip.id === 'opposed') {
                    const base = notationInput.value.trim() || '1d20';
                    if (/\s+vs\.?\s+/i.test(base)) return;
                    notationInput.value = `${base} vs 1d20`;
                    return;
                }
                if (notationHooks.applyChip) {
                    notationInput.value = notationHooks.applyChip(
                        notationInput.value,
                        chip.id,
                        activeSystem
                    );
                }
            });
            mechanicRow.appendChild(btn);
        });
        container.appendChild(mechanicRow);

        const notationBtnRow = document.createElement('div');
        notationBtnRow.className = 'hud-row hud-mt-xs';

        const notationRollBtn = hudButton('Roll');
        notationRollBtn.style.flex = '1';
        notationRollBtn.addEventListener('click', submitNotation);
        notationBtnRow.appendChild(notationRollBtn);
        container.appendChild(notationBtnRow);

        const NOTATION_PRESETS = notationHooks.presets ?? [
            '1d20',
            '2d20kh1',
            '3d6',
            '4d6dl1',
            '4d6r1',
            '2d6!',
            '1d100',
            '1d20 vs 1d20',
        ];

        const presetChipRow = document.createElement('div');
        presetChipRow.className = 'hud-row hud-row--wrap hud-mt-sm';

        NOTATION_PRESETS.forEach((preset) => {
            const chip = hudButton(preset, 'hud-btn--chip');
            chip.addEventListener('click', () => {
                notationInput.value = preset;
                submitNotation();
            });
            presetChipRow.appendChild(chip);
        });
        container.appendChild(presetChipRow);
    }

    const rollBtn = hudButton('Roll All', 'hud-btn--primary');
    rollBtn.id = 'roll-all-btn';
    rollBtn.setAttribute('aria-keyshortcuts', 'R');
    rollBtn.addEventListener('click', () => onRollAll());

    if (touchUi) {
        const rollDock = document.createElement('div');
        rollDock.className = 'hud-roll-dock';
        rollDock.appendChild(rollBtn);
        canvasContainer.appendChild(rollDock);
    } else {
        rollBtn.classList.add('hud-mt-lg');
        container.appendChild(rollBtn);
    }

    if (rollShareHooks?.buildShareUrl) {
        const shareRollBtn = hudButton('Share Roll', 'hud-mt-xs');
        shareRollBtn.title = 'Copy a link that replays this exact roll';
        shareRollBtn.addEventListener('click', async () => {
            if (rollShareHooks.hasShareableRoll && !rollShareHooks.hasShareableRoll()) {
                shareRollBtn.textContent = 'Roll first';
                setTimeout(() => {
                    shareRollBtn.textContent = 'Share Roll';
                }, 1500);
                return;
            }
            const url = rollShareHooks.buildShareUrl();
            if (!url) return;
            try {
                await navigator.clipboard.writeText(url);
                shareRollBtn.textContent = 'Copied!';
                setTimeout(() => {
                    shareRollBtn.textContent = 'Share Roll';
                }, 1500);
            } catch {
                window.prompt('Share this roll:', url);
            }
        });
        container.appendChild(shareRollBtn);
    }

    // --- Audio volume / mute (persisted in localStorage by the audio module) ---
    const audio = layoutHooks?.audio;
    if (audio) {
        const audioRow = document.createElement('div');
        audioRow.className = 'hud-row hud-mt';
        guardPointerEvents(audioRow);

        const muteBtn = hudButton('', 'hud-btn--collapse');
        muteBtn.title = 'Mute / unmute';

        const slider = hudInput('range', 'Volume');
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.01';
        slider.value = String(audio.getMasterVolume?.() ?? 0.6);
        slider.style.flex = '1';

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
        layoutDivider.className = 'hud-divider';
        layoutDivider.textContent = 'Table Layout';
        container.appendChild(layoutDivider);

        const densityRow = document.createElement('div');
        densityRow.className = 'hud-row hud-row--between';

        const densityLabel = document.createElement('label');
        densityLabel.htmlFor = 'layout-density-select';
        densityLabel.textContent = 'Density';
        densityLabel.className = 'hud-label';

        densitySelect = hudSelect('Table clutter density');
        densitySelect.id = 'layout-density-select';
        densitySelect.style.flex = '1';
        Object.keys(DENSITY_PRESETS).forEach((key) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
            densitySelect.appendChild(option);
        });
        densitySelect.value = layoutHooks.layoutConfig?.density ?? 'med';
        densityRow.appendChild(densityLabel);
        densityRow.appendChild(densitySelect);
        container.appendChild(densityRow);

        const themeRow = document.createElement('div');
        themeRow.className = 'hud-row hud-row--between';

        const themeLabel = document.createElement('label');
        themeLabel.htmlFor = 'layout-theme-select';
        themeLabel.textContent = 'Theme';
        themeLabel.className = 'hud-label';

        themeSelect = hudSelect('Table layout theme');
        themeSelect.id = 'layout-theme-select';
        themeSelect.style.flex = '1';
        Object.values(LAYOUT_THEMES).forEach((theme) => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.label;
            themeSelect.appendChild(option);
        });
        themeSelect.value = layoutHooks.layoutConfig?.theme ?? 'default';
        themeRow.appendChild(themeLabel);
        themeRow.appendChild(themeSelect);
        container.appendChild(themeRow);

        rerollBtn = hudButton('New Table', 'hud-mt-xs');
        rerollBtn.id = 'reroll-layout-btn';
        rerollBtn.setAttribute('aria-keyshortcuts', 'Shift+R');
        rerollBtn.addEventListener('click', async () => {
            rerollBtn.disabled = true;
            rerollBtn.textContent = 'Arranging...';
            try {
                const result = await layoutHooks.onRerollLayout({
                    density: densitySelect.value,
                    theme: themeSelect.value,
                    newSeed: true,
                });
                updateLayoutStatus(result);
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.textContent = 'New Table';
            }
        });
        container.appendChild(rerollBtn);

        shareBtn = hudButton('Copy Table Link');
        shareBtn.addEventListener('click', async () => {
            const config = layoutHooks.onShareTable?.() ?? layoutHooks.layoutConfig;
            const url = buildShareableTableUrl(config);
            try {
                await navigator.clipboard.writeText(url);
                shareBtn.textContent = 'Copied!';
                setTimeout(() => {
                    shareBtn.textContent = 'Copy Table Link';
                }, 1500);
            } catch {
                window.prompt('Share this table:', url);
            }
        });
        container.appendChild(shareBtn);

        statusLine = document.createElement('div');
        statusLine.className = 'hud-status-line';
        container.appendChild(statusLine);
        updateLayoutStatus(layoutHooks.layoutConfig);
    }

    function updateLayoutStatus(config) {
        if (!statusLine || !config) return;
        statusLine.textContent = `Seed ${config.seed} · ${config.clutterCount} clutter · ${config.decorCount} decor`;
    }

    const helpPanel = createHudPanel({
        id: 'dice-help-panel',
        ariaLabel: touchUi ? 'Touch controls' : 'Keyboard and mouse controls',
        anchor: 'bottom-left',
        touchUi,
        parent: canvasContainer,
    });
    helpPanel.body.innerHTML = touchUi
        ? `
        <div style="font-weight: bold; margin-bottom: 5px;">Touch Controls:</div>
        <div>👆 <b>Tap table</b> - Roll all dice</div>
        <div>👉 <b>Flick table</b> - Toss dice</div>
        <div>👇 <b>Hold die</b> - Grab and drag</div>
        <div>👆👆 <b>Double-tap die</b> - Levitate</div>
        <div>✌️ <b>Two fingers</b> - Orbit / pinch zoom</div>
    `
        : `
        <div style="font-weight: bold; margin-bottom: 5px;">Controls:</div>
        <div>🖱️ <b>Left Click</b> - Grab/throw dice</div>
        <div>🖱️ <b>Right Click</b> - Enter FPS mode</div>
        <div>⌨️ <b>Tab</b> - Focus dice controls, layout, and history</div>
        <div>⌨️ <b>WASD</b> - Move (FPS mode)</div>
        <div>⌨️ <b>ESC</b> - Exit FPS mode</div>
        <div>⌨️ <b>R</b> - Roll all dice</div>
        <div>🎲 <b>Dice cup</b> - Click, shake, release to pour (WASM)</div>
        <div>⌨️ <b>T</b> - Pour while shaking cup</div>
        <div>⌨️ <b>H</b> - Roll history &amp; statistics</div>
        <div>⌨️ <b>Enter</b> - Roll notation expression</div>
        <div>⌨️ <b>Shift+R</b> - New table layout</div>
    `;

    return {
        updateCounts: (newCounts) => {
            if (!newCounts || typeof newCounts !== 'object') return;
            Object.keys(newCounts).forEach((key) => {
                if (inputs[key]) {
                    inputs[key].value = newCounts[key];
                    counts[key] = newCounts[key];
                }
            });
        },
        updateLayoutStatus,
    };
};

export const createCrosshair = () => {
    const canvasContainer = document.getElementById('canvas-container') || document.body;
    const crosshair = document.createElement('div');
    crosshair.className = 'hud-crosshair';

    const circle = document.createElement('div');
    circle.className = 'hud-crosshair__ring';
    crosshair.appendChild(circle);

    const dot = document.createElement('div');
    dot.className = 'hud-crosshair__dot';
    crosshair.appendChild(dot);

    canvasContainer.appendChild(crosshair);

    return {
        updatePosition: (x, y) => {
            crosshair.style.left = `${x}px`;
            crosshair.style.top = `${y}px`;
        },
        setVisible: (visible) => {
            crosshair.style.display = visible ? 'block' : 'none';
        },
    };
};
