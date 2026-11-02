/**
 * The Farkle game panel — a `createHudPanel` shell, no chrome of its own.
 *
 * It renders a `FarklePanelModel` (see farklePanelModel.ts) and reports button
 * presses; it never scores, never decides legality and never touches the table.
 * The only state it keeps is which thrown dice the person has ticked, which is
 * a selection in progress, not a copy of anything the rules own.
 */

import { createHudPanel, hudButton, type HudPanel } from './hudPanel.js';
import {
    biggestLegalKeep,
    buildFarklePanelModel,
    possessive,
    type FarklePanelModel,
    type FarklePreview,
    type FarkleSnapshot,
} from './farklePanelModel.js';

export interface FarklePanelActions {
    onStart(): void;
    onClose(): void;
    onThrow(): void;
    onKeep(ids: number[]): void;
    onBank(): void;
    onRethrow(): void;
}

export interface FarklePanelOptions {
    actions: FarklePanelActions;
    touchUi?: boolean;
    parent?: HTMLElement | null;
}

export interface FarklePanel {
    panel: HudPanel;
    /** Show a game's snapshot; `null` returns the panel to its "start a game" face. */
    render(snapshot: FarkleSnapshot | null, preview?: FarklePreview): void;
    /** Show why a game could not start, without a snapshot. */
    showMessage(message: string): void;
    destroy(): void;
}

const DIE_FACE = ['·', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function actionButton(
    key: string,
    label: string,
    enabled: boolean,
    hint: string | undefined,
    onClick: () => void,
    extraClass = ''
): HTMLButtonElement {
    const btn = hudButton(label, extraClass);
    btn.dataset.key = key;
    btn.disabled = !enabled;
    if (hint) btn.title = hint;
    btn.addEventListener('click', onClick);
    return btn;
}

export function createFarklePanel(options: FarklePanelOptions): FarklePanel {
    const { actions } = options;
    const panel = createHudPanel({
        id: 'farkle-panel',
        ariaLabel: 'Farkle game',
        anchor: 'left-stack',
        stackOrder: -1,
        title: 'Farkle',
        collapsible: true,
        collapsed: true,
        touchUi: options.touchUi ?? false,
        parent: options.parent,
        className: 'hud-game',
    });

    // Announces turn changes and results to screen readers without re-reading
    // the whole panel every time a chip is ticked.
    const live = el('div', 'visually-hidden');
    live.setAttribute('aria-live', 'polite');
    panel.el.appendChild(live);
    let lastAnnounced = '';

    let selection = new Set<number>();
    let last: { snapshot: FarkleSnapshot; preview: FarklePreview } | null = null;

    function announce(text: string): void {
        if (text === lastAnnounced) return;
        lastAnnounced = text;
        live.textContent = text;
    }

    /** Rebuild the body, keeping keyboard focus on the same control. */
    function paint(build: (body: HTMLElement) => void): void {
        const focused = document.activeElement;
        const key = focused instanceof HTMLElement ? focused.dataset.key : undefined;
        panel.body.replaceChildren();
        build(panel.body);
        if (key) {
            panel.body.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
        }
    }

    function renderIdle(message: string | null): void {
        paint((body) => {
            body.appendChild(
                el(
                    'div',
                    'hud-game__blurb',
                    'Six dice, push your luck. Set aside scoring dice, bank, or throw on. First to 10,000 — a bot across the table plays with you.'
                )
            );
            if (message) body.appendChild(el('div', 'hud-game__notice', message));
            const row = el('div', 'hud-game__actions');
            row.appendChild(
                actionButton('start', 'Play Farkle', true, undefined, () => actions.onStart())
            );
            body.appendChild(row);
        });
        if (message) announce(message);
    }

    function renderModel(model: FarklePanelModel): void {
        paint((body) => {
            const seats = el('ul', 'hud-game__seats');
            for (const seat of model.seats) {
                const row = el('li', 'hud-game__seat');
                if (seat.current) row.dataset.current = 'true';
                row.appendChild(
                    el('span', 'hud-game__seat-name', seat.name + (seat.bot ? ' 🤖' : ''))
                );
                row.appendChild(el('span', 'hud-game__seat-score', String(seat.score)));
                seats.appendChild(row);
            }
            body.appendChild(seats);

            if (model.turn) {
                body.appendChild(
                    el(
                        'div',
                        'hud-game__turn',
                        `Round ${model.round} · ${possessive(model.turn.who)} turn: ${model.turn.score}`
                    )
                );
            }
            body.appendChild(el('div', 'hud-game__status', model.status));
            if (model.notice) body.appendChild(el('div', 'hud-game__notice', model.notice));
            if (model.lastTurn) body.appendChild(el('div', 'hud-game__last', model.lastTurn));

            const diceRow = el('div', 'hud-game__dice');
            diceRow.setAttribute('role', 'group');
            diceRow.setAttribute('aria-label', 'Dice');
            for (const die of model.dice) {
                const face = die.value ? (DIE_FACE[die.value] ?? String(die.value)) : '·';
                const chip = hudButton(face, 'hud-game__die');
                chip.dataset.key = `die-${die.id}`;
                chip.dataset.zone = die.zone;
                if (die.cocked) chip.dataset.cocked = 'true';
                chip.setAttribute(
                    'aria-label',
                    `Die ${die.id + 1}: ${die.value ?? 'not thrown'}, ${die.zone === 'held' ? 'set aside' : die.zone === 'thrown' ? 'thrown' : 'on the table'}${die.cocked ? ', cocked' : ''}`
                );
                if (die.selectable) {
                    chip.setAttribute('aria-pressed', String(die.selected));
                    if (die.selected) chip.dataset.selected = 'true';
                    chip.addEventListener('click', () => {
                        if (selection.has(die.id)) selection.delete(die.id);
                        else selection.add(die.id);
                        if (last) render(last.snapshot, last.preview);
                    });
                } else {
                    chip.disabled = true;
                }
                diceRow.appendChild(chip);
            }
            body.appendChild(diceRow);

            if (model.over) {
                body.appendChild(el('div', 'hud-game__result', model.over.headline));
                body.appendChild(el('div', 'hud-game__last', model.over.scores));
            }

            const row = el('div', 'hud-game__actions');
            if (model.scoring) {
                row.appendChild(
                    actionButton(
                        'scoring',
                        model.scoring.label,
                        model.scoring.enabled,
                        model.scoring.hint,
                        () => {
                            if (!last) return;
                            selection = new Set(biggestLegalKeep(last.snapshot));
                            render(last.snapshot, last.preview);
                        }
                    )
                );
            }
            if (model.keep) {
                row.appendChild(
                    actionButton(
                        'keep',
                        model.keep.label,
                        model.keep.enabled,
                        model.keep.hint,
                        () => {
                            const ids = [...selection].sort((a, b) => a - b);
                            selection = new Set();
                            actions.onKeep(ids);
                        },
                        'hud-game__primary'
                    )
                );
            }
            if (model.throw) {
                row.appendChild(
                    actionButton(
                        'throw',
                        model.throw.label,
                        model.throw.enabled,
                        model.throw.hint,
                        () => actions.onThrow(),
                        'hud-game__primary'
                    )
                );
            }
            if (model.bank) {
                row.appendChild(
                    actionButton(
                        'bank',
                        model.bank.label,
                        model.bank.enabled,
                        model.bank.hint,
                        () => actions.onBank()
                    )
                );
            }
            if (model.rethrow) {
                row.appendChild(
                    actionButton(
                        'rethrow',
                        model.rethrow.label,
                        model.rethrow.enabled,
                        model.rethrow.hint,
                        () => actions.onRethrow(),
                        'hud-game__primary'
                    )
                );
            }
            if (model.over || model.phase === 'stopped') {
                row.appendChild(
                    actionButton('start', 'New game', true, undefined, () => actions.onStart())
                );
            }
            row.appendChild(
                actionButton(
                    'close',
                    model.over || model.phase === 'stopped' ? 'Close' : 'Quit',
                    true,
                    undefined,
                    () => actions.onClose()
                )
            );
            body.appendChild(row);
        });
        announce(
            model.over
                ? `${model.over.headline} ${model.over.scores}`
                : (model.notice ?? model.status)
        );
    }

    function render(snapshot: FarkleSnapshot | null, preview?: FarklePreview): void {
        if (!snapshot || !preview) {
            last = null;
            selection = new Set();
            renderIdle(null);
            return;
        }
        last = { snapshot, preview };
        const model = buildFarklePanelModel(snapshot, selection, preview);
        // A selection that is no longer a live decision is dropped, not carried
        // into the next throw.
        selection = new Set(model.selection);
        if (panel.isCollapsed() && snapshot.phase !== 'stopped') panel.setCollapsed(false);
        renderModel(model);
    }

    renderIdle(null);

    return {
        panel,
        render,
        showMessage(message) {
            last = null;
            selection = new Set();
            if (panel.isCollapsed()) panel.setCollapsed(false);
            renderIdle(message);
        },
        destroy: () => panel.destroy(),
    };
}
