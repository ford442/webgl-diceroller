/**
 * The Farkle panel: a view of the rules' own state. The model is pure; the DOM
 * panel renders it on createHudPanel and reports presses. Neither scores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFarkleRules, type FarkleAction, type FarkleState } from 'dice-core/game/Farkle';
import type { SettledRoll } from 'dice-core/game/GameRules';
import { createSeededRng } from 'dice-core/wasm/seededThrowParams';
import type { GameSnapshot } from '../../src/app/GameSession.js';
import { createFarklePanel } from '../../src/ui/FarklePanel.js';
import {
    buildFarklePanelModel,
    possessive,
    type FarklePreview,
} from '../../src/ui/farklePanelModel.js';

const rules = createFarkleRules();
const SEATS = [
    { id: 'you', name: 'You', bot: false },
    { id: 'bot', name: 'Tavern bot', bot: true },
];

function roll(faces: number[]): SettledRoll {
    return { faces, seed: 1 };
}

function start(): FarkleState {
    return rules.init(['you', 'bot'], createSeededRng(1));
}

function snapshot(
    state: FarkleState,
    patch: Partial<GameSnapshot<FarkleState, FarkleAction>> = {}
): GameSnapshot<FarkleState, FarkleAction> {
    const phase = patch.phase ?? 'your-turn';
    return {
        rulesId: 'farkle',
        phase,
        state,
        seats: SEATS,
        toAct: rules.toAct(state),
        legal: phase === 'your-turn' ? rules.legalActions(state, 'you') : [],
        throwing: null,
        notice: null,
        outcome: null,
        log: [],
        seed: 1,
        ...patch,
    };
}

/** dice 0..5 = 1 5 2 3 3 6: the 1 and the 5 score. */
function keepState(): FarkleState {
    return rules.apply(start(), { type: 'roll' }, roll([1, 5, 2, 3, 3, 6]));
}

const preview: FarklePreview = (action) => {
    try {
        return { ok: true, state: rules.apply(keepState(), action) };
    } catch (err) {
        return { ok: false, error: (err as Error).message };
    }
};

describe('buildFarklePanelModel', () => {
    it("shows the rules' state as it is: seats, scores, turn score, dice", () => {
        const model = buildFarklePanelModel(snapshot(start()), new Set(), preview);
        expect(model.seats).toEqual([
            { id: 'you', name: 'You', bot: false, score: 0, current: true },
            { id: 'bot', name: 'Tavern bot', bot: true, score: 0, current: false },
        ]);
        expect(model.turn).toEqual({ who: 'You', score: 0 });
        expect(model.dice).toHaveLength(6);
        expect(model.throw).toEqual({ label: 'Throw 6 dice', enabled: true });
        expect(model.keep).toBeNull();
        expect(model.bank).toBeNull();
    });

    it("prices a selection with the rules' own apply, not a table of its own", () => {
        const state = keepState();
        const none = buildFarklePanelModel(snapshot(state), new Set(), preview);
        expect(none.keep).toMatchObject({ enabled: false });
        expect(none.dice.filter((d) => d.selectable)).toHaveLength(6);

        const one = buildFarklePanelModel(snapshot(state), new Set([0]), preview);
        expect(one.keep).toEqual({ label: 'Set aside (+100)', enabled: true });
        expect(one.selection).toEqual([0]);

        const both = buildFarklePanelModel(snapshot(state), new Set([0, 1]), preview);
        expect(both.keep).toEqual({ label: 'Set aside (+150)', enabled: true });
    });

    it('disables Set aside for dice that do not score, saying why', () => {
        const model = buildFarklePanelModel(snapshot(keepState()), new Set([2]), preview);
        expect(model.keep?.enabled).toBe(false);
        expect(model.keep?.hint).toMatch(/does not all score/);
    });

    it('asks the preview, never computing a score itself', () => {
        const spy = vi.fn(preview);
        buildFarklePanelModel(snapshot(keepState()), new Set([0, 1]), spy);
        expect(spy).toHaveBeenCalledWith({ type: 'keep', dice: [0, 1] });
    });

    it('offers Throw / Bank on the decide screen, with the free-dice count and turn score', () => {
        const decided = rules.apply(keepState(), { type: 'keep', dice: [0, 1] });
        const model = buildFarklePanelModel(snapshot(decided), new Set(), preview);
        expect(model.throw).toEqual({ label: 'Throw 4 dice', enabled: true });
        expect(model.bank).toEqual({ label: 'Bank 150', enabled: true });
        expect(model.dice.filter((d) => d.zone === 'held').map((d) => d.id)).toEqual([0, 1]);
        expect(model.dice.every((d) => !d.selectable)).toBe(true);
    });

    it('drops a selection that is no longer a live keep decision', () => {
        const decided = rules.apply(keepState(), { type: 'keep', dice: [0, 1] });
        const model = buildFarklePanelModel(snapshot(decided), new Set([0, 1]), preview);
        expect(model.selection).toEqual([]);
        expect(model.dice.some((d) => d.selected)).toBe(false);
    });

    it('offers nothing while a bot plays or dice are in the air', () => {
        for (const phase of ['bot-turn', 'throwing', 'acting'] as const) {
            const model = buildFarklePanelModel(
                snapshot(keepState(), { phase }),
                new Set([0]),
                preview
            );
            expect(model.throw).toBeNull();
            expect(model.bank).toBeNull();
            expect(model.keep).toBeNull();
            expect(model.dice.some((d) => d.selectable)).toBe(false);
        }
    });

    it('offers only the re-throw when a die is cocked, and marks it', () => {
        const model = buildFarklePanelModel(
            snapshot(start(), {
                phase: 'cocked',
                throwing: {
                    seat: 'you',
                    dice: [0, 1],
                    faces: [1, 2],
                    cocked: [1],
                    attempt: 1,
                    seed: 3,
                },
            }),
            new Set(),
            preview
        );
        expect(model.rethrow).toEqual({ label: 'Throw again', enabled: true });
        expect(model.throw).toBeNull();
        expect(model.dice.find((d) => d.id === 1)?.cocked).toBe(true);
    });

    it("reports a bust and a bank from the rules' lastTurn", () => {
        const busted = rules.apply(start(), { type: 'roll' }, roll([2, 3, 4, 6, 2, 3]));
        expect(buildFarklePanelModel(snapshot(busted), new Set(), preview).lastTurn).toBe(
            'You busted — no points.'
        );
    });

    it('announces the winner from the outcome', () => {
        const model = buildFarklePanelModel(
            snapshot(start(), {
                phase: 'over',
                outcome: { winners: ['bot'], scores: { you: 9200, bot: 10450 }, reason: 'target' },
            }),
            new Set(),
            preview
        );
        expect(model.over).toEqual({
            headline: 'Tavern bot wins!',
            scores: 'You 9200 · Tavern bot 10450',
        });
    });
});

describe('createFarklePanel (DOM)', () => {
    let container: HTMLElement;
    const actions = () => ({
        onStart: vi.fn(),
        onClose: vi.fn(),
        onThrow: vi.fn(),
        onKeep: vi.fn(),
        onBank: vi.fn(),
        onRethrow: vi.fn(),
    });
    const button = (root: HTMLElement, key: string) =>
        root.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;

    beforeEach(() => {
        document.body.innerHTML = '<div id="canvas-container"></div>';
        container = document.getElementById('canvas-container')!;
    });

    it('is a collapsible hud panel in the left stack, labelled for screen readers', () => {
        const a = actions();
        const { panel } = createFarklePanel({ actions: a, parent: container });
        expect(panel.el.classList.contains('hud-panel')).toBe(true);
        expect(panel.el.getAttribute('aria-label')).toBe('Farkle game');
        expect(panel.el.dataset.hudAnchor).toBe('left-stack');
        expect(panel.collapseButton).not.toBeNull();
        expect(panel.isCollapsed()).toBe(true);
    });

    it('offers "Play Farkle" when idle', () => {
        const a = actions();
        const { panel } = createFarklePanel({ actions: a, parent: container });
        button(panel.body, 'start').click();
        expect(a.onStart).toHaveBeenCalledTimes(1);
    });

    it('expands for a game and reports a throw press', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        farkle.render(snapshot(start()), preview);
        expect(farkle.panel.isCollapsed()).toBe(false);
        button(farkle.panel.body, 'throw').click();
        expect(a.onThrow).toHaveBeenCalledTimes(1);
    });

    it('ticks dice, shows the points, and hands the selected ids to onKeep', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        const snap = snapshot(keepState());
        farkle.render(snap, preview);

        expect(button(farkle.panel.body, 'keep').disabled).toBe(true);
        button(farkle.panel.body, 'die-0').click();
        button(farkle.panel.body, 'die-1').click();
        expect(button(farkle.panel.body, 'die-0').getAttribute('aria-pressed')).toBe('true');
        expect(button(farkle.panel.body, 'keep').textContent).toBe('Set aside (+150)');

        button(farkle.panel.body, 'keep').click();
        expect(a.onKeep).toHaveBeenCalledWith([0, 1]);
    });

    it('"All scoring" ticks the rules\' biggest legal keep', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        farkle.render(snapshot(keepState()), preview);
        button(farkle.panel.body, 'scoring').click();
        expect(button(farkle.panel.body, 'die-0').getAttribute('aria-pressed')).toBe('true');
        expect(button(farkle.panel.body, 'die-1').getAttribute('aria-pressed')).toBe('true');
        expect(button(farkle.panel.body, 'die-2').getAttribute('aria-pressed')).toBe('false');
    });

    it('keeps keyboard focus on the control after it re-renders', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        farkle.render(snapshot(keepState()), preview);
        button(farkle.panel.body, 'die-0').focus();
        button(farkle.panel.body, 'die-0').click();
        expect(document.activeElement).toBe(button(farkle.panel.body, 'die-0'));
    });

    it('does not carry a selection into the next throw', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        farkle.render(snapshot(keepState()), preview);
        button(farkle.panel.body, 'die-0').click();
        const decided = rules.apply(keepState(), { type: 'keep', dice: [0] });
        farkle.render(snapshot(decided), preview);
        farkle.render(snapshot(keepState()), preview);
        expect(button(farkle.panel.body, 'die-0').getAttribute('aria-pressed')).toBe('false');
    });

    it('offers the re-throw for a cocked die and new game / close when over', () => {
        const a = actions();
        const farkle = createFarklePanel({ actions: a, parent: container });
        farkle.render(
            snapshot(start(), {
                phase: 'cocked',
                throwing: { seat: 'you', dice: [0], faces: [1], cocked: [0], attempt: 1, seed: 1 },
            }),
            preview
        );
        button(farkle.panel.body, 'rethrow').click();
        expect(a.onRethrow).toHaveBeenCalledTimes(1);

        farkle.render(
            snapshot(start(), {
                phase: 'over',
                outcome: { winners: ['you'], scores: { you: 10050, bot: 8000 }, reason: 'target' },
            }),
            preview
        );
        expect(farkle.panel.body.textContent).toContain('You win!');
        button(farkle.panel.body, 'start').click();
        button(farkle.panel.body, 'close').click();
        expect(a.onStart).toHaveBeenCalledTimes(1);
        expect(a.onClose).toHaveBeenCalledTimes(1);
    });

    it('speaks of the person as "Your", not "You\'s", and of the bot by name', () => {
        expect(possessive('You')).toBe('Your');
        expect(possessive('Tavern bot')).toBe("Tavern bot's");
        const farkle = createFarklePanel({ actions: actions(), parent: container });
        farkle.render(snapshot(start()), preview);
        expect(farkle.panel.body.textContent).toContain('Your turn: 0');
        expect(farkle.panel.body.textContent).not.toContain("You's");
    });

    it('says why a game could not start', () => {
        const farkle = createFarklePanel({ actions: actions(), parent: container });
        farkle.showMessage('Farkle needs the physics engine, which did not load.');
        expect(farkle.panel.isCollapsed()).toBe(false);
        expect(farkle.panel.body.textContent).toContain('physics engine');
    });
});
