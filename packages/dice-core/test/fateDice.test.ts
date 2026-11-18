import { describe, expect, it } from 'vitest';
import {
    applyExpressionChip,
    defaultExpressionForSystem,
    formatFaceValue,
    ROLL_SYSTEMS,
} from 'dice-core/roll/Notation';
import { createRollSession } from 'dice-core/roll/RollSession';

describe('Fate dice', () => {
    it('has a Fate system whose default expression is 4dF', () => {
        expect(ROLL_SYSTEMS.fate?.label).toBe('Fate');
        expect(defaultExpressionForSystem('fate')).toBe('4dF');
    });

    it('the fate chip emits 4dF and keeps a skill bonus', () => {
        expect(applyExpressionChip('', 'fate')).toBe('4dF');
        expect(applyExpressionChip('1d20+3', 'fate')).toBe('4dF+3');
        expect(applyExpressionChip('2d6 - 1', 'fate')).toBe('4dF-1');
    });

    it('formats fudge faces as + / 0 / −, other dice as numbers', () => {
        expect([1, 0, -1].map((v) => formatFaceValue('dF', v))).toEqual(['+', '0', '−']);
        expect(formatFaceValue('d20', 17)).toBe('17');
        expect(formatFaceValue('d6', null)).toBe('—');
    });

    it('a notation roll scores what the face shows, not which face it is', async () => {
        // Natural d6 faces 1..6 on a dF hull resolve to -1/0/+1 via its
        // numbering; scoring the natural faces would total 14 here, not 2.
        const natural = [3, 6, 2, 3];
        const shown = [1, 1, 0, 1];
        let spawned = 0;
        const session = createRollSession({
            scene: null,
            world: null,
            replaceDiceSet: (_s, _w, specs) => {
                spawned = (specs as unknown[]).length;
            },
            throwDice: () => {},
            readAllDiceValues: () =>
                natural.slice(0, spawned).map((value, i) => ({
                    type: 'dF',
                    value,
                    displayValue: shown[i],
                })),
            areDiceSettled: () => true,
            waitFrame: () => Promise.resolve(),
        });
        const result = await session.roll('4dF-1');
        expect(result.total).toBe(2);
    });
});
