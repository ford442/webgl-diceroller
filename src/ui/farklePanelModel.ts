/**
 * What the Farkle panel shows, derived from a `GameSnapshot`. Pure — no DOM —
 * so it has a unit test, and so the panel has nothing to get wrong.
 *
 * The panel holds no rules. Every number on it is a field of the rules' own
 * state, and the only arithmetic here — the points a selection would add — is
 * the rules' own `apply` run on a copy (`preview`), never a second scoring
 * table. The turn score changes only through `Farkle.apply`.
 */

import type { FarkleAction, FarkleState } from 'dice-core/game/Farkle';
import type { GameSnapshot, PreviewResult } from '../app/GameSession.js';

export type FarkleSnapshot = GameSnapshot<FarkleState, FarkleAction>;
export type FarklePreview = (action: FarkleAction) => PreviewResult<FarkleState>;

export interface FarkleSeatRow {
    id: string;
    name: string;
    bot: boolean;
    score: number;
    current: boolean;
}

/** A die chip: `held` is in the jail, `thrown` can be set aside, `free` lies on the table. */
export interface FarkleDieChip {
    id: number;
    value: number | null;
    zone: 'held' | 'thrown' | 'free';
    selectable: boolean;
    selected: boolean;
    cocked: boolean;
}

export interface FarkleButton {
    label: string;
    enabled: boolean;
    /** Why a disabled button is disabled (shown as its tooltip). */
    hint?: string;
}

export interface FarklePanelModel {
    phase: FarkleSnapshot['phase'];
    status: string;
    notice: string | null;
    seats: FarkleSeatRow[];
    round: number;
    turn: { who: string; score: number } | null;
    lastTurn: string | null;
    dice: FarkleDieChip[];
    throw: FarkleButton | null;
    keep: FarkleButton | null;
    scoring: FarkleButton | null;
    bank: FarkleButton | null;
    rethrow: FarkleButton | null;
    over: { headline: string; scores: string } | null;
    /** The selection that survives this snapshot (cleared when it stops being a keep decision). */
    selection: number[];
}

function seatName(snapshot: FarkleSnapshot, id: string | null): string {
    return snapshot.seats.find((s) => s.id === id)?.name ?? id ?? '—';
}

/** "Your" / "Tavern bot's" — a name in front of "turn". */
export function possessive(name: string): string {
    return name === 'You' ? 'Your' : `${name}'s`;
}

/** "You win!" / "Tavern bot wins!" */
function winnerLine(name: string): string {
    return name === 'You' ? 'You win!' : `${name} wins!`;
}

function lastTurnLine(snapshot: FarkleSnapshot): string | null {
    const last = snapshot.state.lastTurn;
    if (!last) return null;
    const who = seatName(snapshot, last.seat);
    return last.result === 'bust' ? `${who} busted — no points.` : `${who} banked ${last.points}.`;
}

function statusLine(snapshot: FarkleSnapshot): string {
    const who = seatName(snapshot, snapshot.toAct);
    switch (snapshot.phase) {
        case 'seating':
            return 'Setting the table…';
        case 'your-turn':
            switch (snapshot.state.phase) {
                case 'roll':
                    return `${who}: throw the dice.`;
                case 'keep':
                    return `${who}: set aside scoring dice.`;
                default:
                    return `${who}: bank ${snapshot.state.turnScore} or throw again.`;
            }
        case 'acting':
            return 'Rolling on…';
        case 'throwing':
            return `${who} throws…`;
        case 'cocked':
            return 'A die is cocked.';
        case 'bot-turn':
            return `${who} is thinking…`;
        case 'over':
            return 'Game over.';
        case 'stopped':
            return 'Game ended.';
    }
}

export function buildFarklePanelModel(
    snapshot: FarkleSnapshot,
    selection: ReadonlySet<number>,
    preview: FarklePreview
): FarklePanelModel {
    const { state } = snapshot;
    const myTurn = snapshot.phase === 'your-turn';
    const deciding = myTurn && state.phase === 'keep';
    const thrown = new Set(state.thrown);
    const cocked = new Set(snapshot.throwing?.cocked ?? []);

    // A selection only means something while the keep decision is open, and
    // only for dice that are still on offer.
    const live = deciding ? [...selection].filter((id) => thrown.has(id)) : [];

    const dice: FarkleDieChip[] = state.dice.map((die) => {
        const zone = die.kept ? 'held' : thrown.has(die.id) ? 'thrown' : 'free';
        return {
            id: die.id,
            value: die.value,
            zone,
            selectable: deciding && zone === 'thrown',
            selected: live.includes(die.id),
            cocked: cocked.has(die.id),
        };
    });

    const offered = (type: FarkleAction['type']) =>
        myTurn && snapshot.legal.some((a) => a.type === type);

    const freeCount = state.dice.filter((d) => !d.kept).length;
    const throwButton: FarkleButton | null = offered('roll')
        ? { label: `Throw ${freeCount} ${freeCount === 1 ? 'die' : 'dice'}`, enabled: true }
        : null;
    const bankButton: FarkleButton | null = offered('bank')
        ? { label: `Bank ${state.turnScore}`, enabled: true }
        : null;

    let keepButton: FarkleButton | null = null;
    let scoringButton: FarkleButton | null = null;
    if (deciding) {
        if (live.length === 0) {
            keepButton = {
                label: 'Set aside',
                enabled: false,
                hint: 'Pick the dice to set aside.',
            };
        } else {
            const tried = preview({ type: 'keep', dice: live });
            // `'error' in` narrows without strictNullChecks too (the app-wide
            // tsc runs non-strict; a boolean discriminant would not narrow there).
            keepButton =
                'error' in tried
                    ? { label: 'Set aside', enabled: false, hint: tried.error }
                    : {
                          label: `Set aside (+${tried.state.turnScore - state.turnScore})`,
                          enabled: true,
                      };
        }
        const biggest = biggestLegalKeep(snapshot);
        scoringButton = {
            label: 'All scoring',
            enabled: biggest.length > 0,
            hint: biggest.length ? undefined : 'Nothing scores.',
        };
    }

    const over = snapshot.outcome
        ? {
              headline:
                  snapshot.outcome.winners.length === 1
                      ? winnerLine(seatName(snapshot, snapshot.outcome.winners[0] ?? null))
                      : `Tie: ${snapshot.outcome.winners.map((w) => seatName(snapshot, w)).join(' & ')}`,
              scores: snapshot.seats
                  .map((s) => `${s.name} ${snapshot.outcome?.scores[s.id] ?? 0}`)
                  .join(' · '),
          }
        : null;

    return {
        phase: snapshot.phase,
        status: statusLine(snapshot),
        notice: snapshot.notice,
        seats: snapshot.seats.map((s) => ({
            id: s.id,
            name: s.name,
            bot: s.bot,
            score: state.scores[s.id] ?? 0,
            current: snapshot.toAct === s.id && snapshot.phase !== 'over',
        })),
        round: state.round,
        turn:
            snapshot.toAct === null
                ? null
                : { who: seatName(snapshot, snapshot.toAct), score: state.turnScore },
        lastTurn: lastTurnLine(snapshot),
        dice,
        throw: throwButton,
        keep: keepButton,
        scoring: scoringButton,
        bank: bankButton,
        rethrow: snapshot.phase === 'cocked' ? { label: 'Throw again', enabled: true } : null,
        over,
        selection: live,
    };
}

/** The legal keep with the most dice — the "All scoring" shortcut, straight from the rules. */
export function biggestLegalKeep(snapshot: FarkleSnapshot): number[] {
    return snapshot.legal
        .filter((a): a is Extract<FarkleAction, { type: 'keep' }> => a.type === 'keep')
        .reduce<number[]>((best, a) => (a.dice.length > best.length ? a.dice : best), []);
}
