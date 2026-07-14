/**
 * Pure dice-notation parser and evaluator.
 * No DOM or Three.js dependencies — safe for unit tests.
 *
 * Supported grammar (examples):
 *   3d6+2          count + sides + net modifier
 *   2d20kh1        keep highest 1 (advantage)
 *   2d20kl1        keep lowest 1 (disadvantage)
 *   4d6dl1         drop lowest 1
 *   4d6dh1         drop highest 1
 *   2d6!           exploding dice
 *   1d100 / 1d%    percentile (paired d10s)
 */

const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);

/** Map numeric sides to internal die type strings. */
export function sidesToDieType(sides) {
    if (sides === 100) return 'd100';
    return `d${sides}`;
}

/**
 * @typedef {Object} DiceGroup
 * @property {number} count
 * @property {number} sides
 * @property {'h'|'l'|null} keep
 * @property {number} keepCount
 * @property {'h'|'l'|null} drop
 * @property {number} dropCount
 * @property {boolean} explode
 * @property {boolean} percentile
 */

/**
 * @typedef {Object} ParsedRoll
 * @property {DiceGroup[]} groups
 * @property {number} modifier
 * @property {string} raw
 */

/**
 * @typedef {Object} DieOutcome
 * @property {number} groupIndex
 * @property {number} dieIndex
 * @property {string} type
 * @property {number|null} value
 * @property {'tens'|'ones'|null} [role]
 * @property {boolean} [kept]
 * @property {boolean} [dropped]
 * @property {boolean} [exploded]
 */

/**
 * @typedef {Object} EvaluatedRoll
 * @property {string} expression
 * @property {DieOutcome[]} dice
 * @property {{ label: string, subtotal: number }[]} groupSubtotals
 * @property {number} modifier
 * @property {number} total
 */

/**
 * Parse a dice notation string into groups and a net modifier.
 * @param {string} input
 * @returns {ParsedRoll}
 */
export function parseNotation(input) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new NotationError('Empty notation');

    const tokens = tokenize(raw);
    const parser = new Parser(tokens, raw);
    const { groups, modifier } = parser.parseExpression();

    if (!groups.length) throw new NotationError('No dice groups found');

    return { groups, modifier, raw };
}

export class NotationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotationError';
    }
}

function tokenize(input) {
    const re = /([+-]?\d*d(?:%|\d+)(?:kh\d*|kl\d*|dh\d*|dl\d*)?!?)|([+-]\d+)(?!d)/gi;
    const tokens = [];
    let match;
    let lastIndex = 0;

    while ((match = re.exec(input)) !== null) {
        if (match.index > lastIndex) {
            const gap = input.slice(lastIndex, match.index).trim();
            if (gap) throw new NotationError(`Unexpected text "${gap}"`);
        }
        tokens.push(match[0]);
        lastIndex = re.lastIndex;
    }

    const tail = input.slice(lastIndex).trim();
    if (tail) throw new NotationError(`Unexpected text "${tail}"`);

    if (!tokens.length) throw new NotationError('No tokens found');
    return tokens;
}

class Parser {
    constructor(tokens, raw) {
        this.tokens = tokens;
        this.pos = 0;
        this.raw = raw;
    }

    peek() {
        return this.tokens[this.pos];
    }

    consume() {
        return this.tokens[this.pos++];
    }

    parseExpression() {
        const groups = [];
        let modifier = 0;

        while (this.pos < this.tokens.length) {
            const tok = this.peek();
            const diceTok = tok.replace(/^\+/, '');

            if (diceTok.startsWith('d') || /^\d+d/i.test(diceTok)) {
                groups.push(this.parseDiceToken(tok));
                continue;
            }

            if (/^[+-]\d+$/.test(tok)) {
                modifier += Number.parseInt(tok, 10);
                this.consume();
                continue;
            }

            throw new NotationError(`Unexpected token "${tok}"`);
        }

        return { groups, modifier };
    }

    parseDiceToken(tok) {
        this.consume();
        const normalized = tok.replace(/^\+/, '');
        const m = /^(\d*)d(%|\d+)((kh|kl|dh|dl)(\d+)?)?(!)?$/i.exec(normalized);
        if (!m) throw new NotationError(`Invalid dice term "${tok}"`);

        const count = m[1] ? Number.parseInt(m[1], 10) : 1;
        if (count < 1 || count > 100) throw new NotationError(`Invalid count in "${tok}"`);

        const sidesRaw = m[2];
        const sides = sidesRaw === '%' ? 100 : Number.parseInt(sidesRaw, 10);
        if (!SUPPORTED_SIDES.has(sides)) {
            throw new NotationError(`Unsupported die d${sidesRaw}`);
        }

        let keep = null;
        let keepCount = 0;
        let drop = null;
        let dropCount = 0;

        if (m[4]) {
            const mode = m[4][1]; // h or l
            const n = m[5] ? Number.parseInt(m[5], 10) : 1;
            if (n < 1) throw new NotationError(`Invalid keep/drop count in "${tok}"`);
            if (m[4].startsWith('k')) {
                keep = mode;
                keepCount = n;
            } else {
                drop = mode;
                dropCount = n;
            }
        }

        if (keep && drop) throw new NotationError(`Cannot combine keep and drop in "${tok}"`);

        const explode = m[6] === '!';
        const percentile = sides === 100;

        if (percentile && count !== 1) {
            throw new NotationError('Percentile rolls must be 1d100 or 1d%');
        }
        if (percentile && (keep || drop || explode)) {
            throw new NotationError('Keep/drop/explode are not supported on percentile rolls');
        }

        return {
            count,
            sides,
            keep,
            keepCount,
            drop,
            dropCount,
            explode,
            percentile
        };
    }
}

/**
 * Build spawn specifications from a parsed roll.
 * Each spec: { type, role?, groupIndex, dieIndex, explode, sides }
 * @param {ParsedRoll} parsed
 * @returns {import('./RollSession.js').DieSpec[]}
 */
export function buildSpawnSpecs(parsed) {
    const specs = [];

    parsed.groups.forEach((group, groupIndex) => {
        if (group.percentile) {
            specs.push({
                type: 'd10',
                role: 'tens',
                groupIndex,
                dieIndex: 0,
                explode: false,
                sides: 100
            });
            specs.push({
                type: 'd10',
                role: 'ones',
                groupIndex,
                dieIndex: 1,
                explode: false,
                sides: 100
            });
            return;
        }

        const dieType = sidesToDieType(group.sides);
        for (let i = 0; i < group.count; i++) {
            specs.push({
                type: dieType,
                role: null,
                groupIndex,
                dieIndex: i,
                explode: group.explode,
                sides: group.sides
            });
        }
    });

    return specs;
}

/**
 * Convert a physical d10 face read (1–10) to percentile component.
 * @param {number} raw
 * @param {'tens'|'ones'} role
 */
export function mapPercentileComponent(raw, role) {
    if (raw == null || Number.isNaN(raw)) return null;
    if (role === 'tens') {
        // 10 → 00, 1 → 10, 2 → 20, … 9 → 90
        const digit = raw === 10 ? 0 : raw;
        return digit * 10;
    }
    // ones: 10 → 0, 1–9 → 1–9
    return raw === 10 ? 0 : raw;
}

/**
 * Compose tens + ones into a d100 result (1–100).
 */
export function composePercentile(tens, ones) {
    if (tens == null || ones == null) return null;
    if (tens === 0 && ones === 0) return 100;
    return tens + ones;
}

/**
 * Format a die's display label for HUD/overlay.
 */
export function formatDieLabel(type, role) {
    if (role === 'tens') return 'd10₀₀';
    if (role === 'ones') return 'd10₁';
    return type;
}

/**
 * Evaluate raw die readings against parsed notation.
 * @param {ParsedRoll} parsed
 * @param {DieOutcome[]} rawDice — one entry per physical die, in spawn order
 * @returns {EvaluatedRoll}
 */
export function evaluateRoll(parsed, rawDice) {
    const dice = rawDice.map((d) => ({ ...d }));
    const groupSubtotals = [];

    parsed.groups.forEach((group, groupIndex) => {
        const groupDice = dice.filter((d) => d.groupIndex === groupIndex);

        if (group.percentile) {
            const tensDie = groupDice.find((d) => d.role === 'tens');
            const onesDie = groupDice.find((d) => d.role === 'ones');
            const tens = mapPercentileComponent(tensDie?.value ?? null, 'tens');
            const ones = mapPercentileComponent(onesDie?.value ?? null, 'ones');
            const composed = composePercentile(tens, ones);

            groupDice.forEach((d) => {
                d.kept = true;
                d.dropped = false;
                if (d.role === 'tens') d.displayValue = tens;
                else if (d.role === 'ones') d.displayValue = ones;
            });

            groupSubtotals.push({
                label: '1d100',
                subtotal: composed ?? 0,
                groupIndex
            });
            return;
        }

        // Collapse explosion chains: sum all throws sharing a dieIndex slot.
        const slotTotals = new Map();
        groupDice.forEach((d) => {
            if (d.value == null) return;
            const key = d.dieIndex;
            slotTotals.set(key, (slotTotals.get(key) ?? 0) + d.value);
        });

        const values = [...slotTotals.entries()]
            .map(([dieIndex, value]) => ({ index: dieIndex, value, dieIndex }))
            .filter((v) => v.value != null);

        let kept = values.map((v) => v);

        if (group.keep) {
            const n = Math.min(group.keepCount, kept.length);
            kept.sort((a, b) => group.keep === 'h' ? b.value - a.value : a.value - b.value);
            kept = kept.slice(0, n);
        } else if (group.drop) {
            const n = Math.min(group.dropCount, kept.length);
            const sorted = [...kept].sort((a, b) => group.drop === 'l' ? a.value - b.value : b.value - a.value);
            const droppedSet = new Set(sorted.slice(0, n).map((v) => v.index));
            kept = kept.filter((v) => !droppedSet.has(v.index));
        }

        const keptSet = new Set(kept.map((v) => v.index));
        groupDice.forEach((d) => {
            const slotTotal = slotTotals.get(d.dieIndex);
            d.displayValue = slotTotal ?? d.value;
            if (!slotTotals.has(d.dieIndex)) {
                d.kept = false;
                d.dropped = true;
                return;
            }
            // Mark only the primary die per slot for keep/drop display; extras from explosions inherit.
            const isPrimary = !d.exploded;
            if (!isPrimary) {
                d.kept = keptSet.has(d.dieIndex);
                d.dropped = !d.kept;
                return;
            }
            d.kept = keptSet.has(d.dieIndex);
            d.dropped = !d.kept;
        });

        const subtotal = kept.reduce((s, v) => s + v.value, 0);
        const label = formatGroupLabel(group);
        groupSubtotals.push({ label, subtotal, groupIndex });
    });

    const modifier = parsed.modifier;
    const total = groupSubtotals.reduce((s, g) => s + g.subtotal, 0) + modifier;

    return {
        expression: parsed.raw,
        dice,
        groupSubtotals,
        modifier,
        total
    };
}

/**
 * @param {DiceGroup} group
 */
export function formatGroupLabel(group) {
    let label = `${group.count}d${group.percentile ? '100' : group.sides}`;
    if (group.keep) label += `k${group.keep}${group.keepCount}`;
    if (group.drop) label += `d${group.drop}${group.dropCount}`;
    if (group.explode) label += '!';
    return label;
}

/**
 * Dice that exploded (rolled max) and need an extra throw.
 * @param {ParsedRoll} parsed
 * @param {DieOutcome[]} dice
 * @returns {import('./RollSession.js').DieSpec[]}
 */
export function getExplodingRespawnSpecs(parsed, dice) {
    const specs = [];

    parsed.groups.forEach((group, groupIndex) => {
        if (!group.explode || group.percentile) return;

        const maxFace = group.sides;
        const groupDice = dice.filter((d) => d.groupIndex === groupIndex && d.role == null);

        groupDice.forEach((d) => {
            if (d.value === maxFace) {
                specs.push({
                    type: sidesToDieType(group.sides),
                    role: null,
                    groupIndex,
                    dieIndex: d.dieIndex,
                    explode: true,
                    sides: group.sides,
                    replacesDieIndex: d.dieIndex
                });
            }
        });
    });

    return specs;
}

/**
 * Format evaluated roll as a compact history string.
 * @param {EvaluatedRoll} result
 */
export function formatResultSummary(result) {
    const groupParts = result.groupSubtotals.map((g) => `${g.label} → ${g.subtotal}`);
    let summary = groupParts.join('  •  ');
    if (result.modifier) {
        const sign = result.modifier > 0 ? '+' : '';
        summary += `  ${sign}${result.modifier}`;
    }
    return summary;
}
