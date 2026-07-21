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
 *   2d6!           exploding dice (extra dice, summed per slot)
 *   2d6!!          compounding explode (same math; flagged for display)
 *   4d6r1          reroll faces ≤ 1 once
 *   1d100 / 1d%    percentile (paired d10s)
 *   1d20+5 vs 1d20+2   opposed roll (margin = left − right)
 */

const SUPPORTED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);

/** System presets — change crit/fumble defaults only, not a rules engine. */
export const ROLL_SYSTEMS = {
    dnd5e: {
        id: 'dnd5e',
        label: 'D&D 5e',
        critDie: 20,
        critFace: 20,
        fumbleFace: 1
    },
    pbta: {
        id: 'pbta',
        label: 'PbtA',
        // 2d6 total bands (not single-face crits)
        strongHit: 10,
        weakHit: 7
    },
    savage: {
        id: 'savage',
        label: 'Savage Worlds',
        // Exploding trait/wild die — UX defaults to appending !
        preferExplode: true
    },
    coc: {
        id: 'coc',
        label: 'Call of Cthulhu',
        // Percentile: extreme ≤ ⅕ skill, hard ≤ ½, fumble 96–100 (simplified)
        percentile: true,
        fumbleMin: 96
    }
};

export const DEFAULT_ROLL_SYSTEM = 'dnd5e';

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
 * @property {boolean} compound
 * @property {number|null} rerollMax  faces ≤ this are rerolled once
 * @property {boolean} percentile
 */

/**
 * @typedef {Object} ParsedSide
 * @property {DiceGroup[]} groups
 * @property {number} modifier
 * @property {string} raw
 */

/**
 * @typedef {Object} ParsedRoll
 * @property {DiceGroup[]} groups
 * @property {number} modifier
 * @property {string} raw
 * @property {ParsedSide|null} opposed
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
 * @property {boolean} [rerolled]
 * @property {number|null} [originalValue]
 */

/**
 * @typedef {Object} RollFlags
 * @property {boolean} crit
 * @property {boolean} fumble
 * @property {boolean} advantage
 * @property {boolean} disadvantage
 * @property {boolean} [strongHit]
 * @property {boolean} [weakHit]
 * @property {boolean} [miss]
 */

/**
 * @typedef {Object} EvaluatedRoll
 * @property {string} expression
 * @property {DieOutcome[]} dice
 * @property {{ die: string, faces: number, value: number|null, exploded?: boolean, kept?: boolean, dropped?: boolean, rerolled?: boolean }[]} rolls
 * @property {{ label: string, subtotal: number }[]} groupSubtotals
 * @property {number} modifier
 * @property {number} total
 * @property {RollFlags} flags
 * @property {number|null} seed
 * @property {{ expression: string, total: number, margin: number, dice: DieOutcome[], groupSubtotals: object[], modifier: number }|null} opposed
 */

/**
 * Parse a dice notation string into groups and a net modifier.
 * @param {string} input
 * @returns {ParsedRoll}
 */
export function parseNotation(input) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new NotationError('Empty notation');

    const opposedSplit = splitOpposed(raw);
    if (opposedSplit) {
        const left = parseSide(opposedSplit.left);
        const right = parseSide(opposedSplit.right);
        return {
            groups: left.groups,
            modifier: left.modifier,
            raw,
            opposed: { groups: right.groups, modifier: right.modifier, raw: opposedSplit.right }
        };
    }

    const side = parseSide(raw);
    return { ...side, opposed: null };
}

function splitOpposed(raw) {
    const m = /\s+vs\.?\s+/i.exec(raw);
    if (!m) return null;
    const left = raw.slice(0, m.index).trim();
    const right = raw.slice(m.index + m[0].length).trim();
    if (!left || !right) throw new NotationError('Opposed roll needs both sides');
    return { left, right };
}

function parseSide(raw) {
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
    // die term: optional sign, count, d(sides|%), optional keep/drop, optional rN, optional ! or !!
    const re = /([+-]?\d*d(?:%|\d+)(?:kh\d*|kl\d*|dh\d*|dl\d*)?(?:r\d+)?(?:!!|!)?)|([+-]\d+)(?!d)/gi;
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
        const m = /^(\d*)d(%|\d+)((kh|kl|dh|dl)(\d+)?)?(r(\d+))?(!!|!)?$/i.exec(normalized);
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

        const rerollMax = m[7] != null ? Number.parseInt(m[7], 10) : null;
        if (rerollMax != null && (rerollMax < 1 || rerollMax >= sides)) {
            throw new NotationError(`Invalid reroll threshold in "${tok}"`);
        }

        const explodeMark = m[8] ?? '';
        const explode = explodeMark === '!' || explodeMark === '!!';
        const compound = explodeMark === '!!';
        const percentile = sides === 100;

        if (percentile && count !== 1) {
            throw new NotationError('Percentile rolls must be 1d100 or 1d%');
        }
        if (percentile && (keep || drop || explode || rerollMax != null)) {
            throw new NotationError('Keep/drop/explode/reroll are not supported on percentile rolls');
        }

        return {
            count,
            sides,
            keep,
            keepCount,
            drop,
            dropCount,
            explode,
            compound,
            rerollMax,
            percentile
        };
    }
}

/**
 * Build spawn specifications from a parsed roll (attacker / left side only).
 * @param {ParsedRoll|ParsedSide} parsed
 * @returns {import('./RollSession.js').DieSpec[]}
 */
export function buildSpawnSpecs(parsed) {
    return buildSpawnSpecsForGroups(parsed.groups);
}

/**
 * @param {DiceGroup[]} groups
 */
export function buildSpawnSpecsForGroups(groups) {
    const specs = [];

    groups.forEach((group, groupIndex) => {
        if (group.percentile) {
            specs.push({
                type: 'd10',
                role: 'tens',
                groupIndex,
                dieIndex: 0,
                explode: false,
                sides: 100,
                rerollMax: null
            });
            specs.push({
                type: 'd10',
                role: 'ones',
                groupIndex,
                dieIndex: 1,
                explode: false,
                sides: 100,
                rerollMax: null
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
                sides: group.sides,
                rerollMax: group.rerollMax
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
        const digit = raw === 10 ? 0 : raw;
        return digit * 10;
    }
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
 * @param {DieOutcome[]} rawDice — one entry per physical die, in spawn order (left side)
 * @param {object} [options]
 * @param {DieOutcome[]} [options.opposedDice]
 * @param {number|null} [options.seed]
 * @param {string} [options.system]
 * @returns {EvaluatedRoll}
 */
export function evaluateRoll(parsed, rawDice, options = {}) {
    const seed = options.seed ?? null;
    const systemId = options.system ?? DEFAULT_ROLL_SYSTEM;

    const left = evaluateSide(
        { groups: parsed.groups, modifier: parsed.modifier, raw: parsed.raw },
        rawDice
    );

    let opposed = null;
    if (parsed.opposed) {
        const rightDice = options.opposedDice ?? [];
        const right = evaluateSide(parsed.opposed, rightDice);
        opposed = {
            expression: parsed.opposed.raw,
            total: right.total,
            margin: left.total - right.total,
            dice: right.dice,
            groupSubtotals: right.groupSubtotals,
            modifier: right.modifier,
            rolls: right.rolls
        };
    }

    const flags = computeFlags(parsed, left.dice, left.total, systemId, opposed);

    return {
        expression: parsed.raw,
        dice: left.dice,
        rolls: left.rolls,
        groupSubtotals: left.groupSubtotals,
        modifier: left.modifier,
        total: left.total,
        flags,
        seed,
        opposed
    };
}

/**
 * @param {ParsedSide} side
 * @param {DieOutcome[]} rawDice
 */
function evaluateSide(side, rawDice) {
    const dice = rawDice.map((d) => ({ ...d }));
    const groupSubtotals = [];

    side.groups.forEach((group, groupIndex) => {
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

        // Prefer final value after a one-shot reroll when present.
        const slotTotals = new Map();
        groupDice.forEach((d) => {
            if (d.value == null) return;
            if (d.replacedByReroll) return; // discarded pre-reroll face
            const key = d.dieIndex;
            slotTotals.set(key, (slotTotals.get(key) ?? 0) + d.value);
        });

        const values = [...slotTotals.entries()]
            .map(([dieIndex, value]) => ({ index: dieIndex, value, dieIndex }))
            .filter((v) => v.value != null);

        let kept = values.map((v) => v);

        if (group.keep) {
            const n = Math.min(group.keepCount, kept.length);
            kept.sort((a, b) => (group.keep === 'h' ? b.value - a.value : a.value - b.value));
            kept = kept.slice(0, n);
        } else if (group.drop) {
            const n = Math.min(group.dropCount, kept.length);
            const sorted = [...kept].sort((a, b) => (
                group.drop === 'l' ? a.value - b.value : b.value - a.value
            ));
            const droppedSet = new Set(sorted.slice(0, n).map((v) => v.index));
            kept = kept.filter((v) => !droppedSet.has(v.index));
        }

        const keptSet = new Set(kept.map((v) => v.index));
        groupDice.forEach((d) => {
            const slotTotal = slotTotals.get(d.dieIndex);
            d.displayValue = slotTotal ?? d.value;
            if (!slotTotals.has(d.dieIndex) || d.replacedByReroll) {
                d.kept = false;
                d.dropped = true;
                return;
            }
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
        groupSubtotals.push({ label: formatGroupLabel(group), subtotal, groupIndex });
    });

    const modifier = side.modifier;
    const total = groupSubtotals.reduce((s, g) => s + g.subtotal, 0) + modifier;
    const rolls = dice.map((d) => ({
        die: formatDieLabel(d.type, d.role),
        faces: d.role ? 10 : (Number.parseInt(String(d.type).replace(/\D/g, ''), 10) || 0),
        value: d.displayValue ?? d.value,
        exploded: Boolean(d.exploded),
        kept: d.kept !== false,
        dropped: d.dropped === true,
        rerolled: Boolean(d.rerolled)
    }));

    return { dice, rolls, groupSubtotals, modifier, total };
}

/**
 * @param {ParsedRoll} parsed
 * @param {DieOutcome[]} dice
 * @param {number} total
 * @param {string} systemId
 * @param {object|null} opposed
 * @returns {RollFlags}
 */
export function computeFlags(parsed, dice, total, systemId = DEFAULT_ROLL_SYSTEM, opposed = null) {
    const system = ROLL_SYSTEMS[systemId] ?? ROLL_SYSTEMS[DEFAULT_ROLL_SYSTEM];
    const flags = {
        crit: false,
        fumble: false,
        advantage: false,
        disadvantage: false
    };

    for (const g of parsed.groups) {
        if (g.sides === 20 && g.keep === 'h' && g.count >= 2) flags.advantage = true;
        if (g.sides === 20 && g.keep === 'l' && g.count >= 2) flags.disadvantage = true;
    }

    if (system.id === 'dnd5e') {
        const critDie = system.critDie ?? 20;
        const critFace = system.critFace ?? 20;
        const fumbleFace = system.fumbleFace ?? 1;
        for (const d of dice) {
            if (d.dropped || d.replacedByReroll) continue;
            const faces = d.role ? null : Number.parseInt(String(d.type).replace(/\D/g, ''), 10);
            if (faces !== critDie) continue;
            const v = d.value;
            if (v === critFace) flags.crit = true;
            if (v === fumbleFace) flags.fumble = true;
        }
        // Nat 20 kept under advantage shouldn't also count a discarded 1 as fumble
        // if the kept die is the crit — still allow both if both kept somehow.
        if (flags.advantage || flags.disadvantage) {
            const keptD20 = dice.filter((d) => (
                !d.dropped && !d.replacedByReroll && d.type === 'd20' && d.kept !== false
            ));
            flags.crit = keptD20.some((d) => d.value === critFace);
            flags.fumble = keptD20.some((d) => d.value === fumbleFace);
        }
    } else if (system.id === 'pbta') {
        flags.strongHit = total >= (system.strongHit ?? 10);
        flags.weakHit = !flags.strongHit && total >= (system.weakHit ?? 7);
        flags.miss = total < (system.weakHit ?? 7);
        // Map strong hit / miss onto crit/fumble for game-feel consumers.
        flags.crit = Boolean(flags.strongHit);
        flags.fumble = Boolean(flags.miss);
    } else if (system.id === 'coc') {
        const pct = parsed.groups.some((g) => g.percentile)
            ? total
            : null;
        if (pct != null) {
            flags.fumble = pct >= (system.fumbleMin ?? 96);
            flags.crit = pct === 1; // classic "01" critical
        }
    } else if (system.id === 'savage') {
        // Ace / explosion already flagged on dice; treat any exploded max as "crit-ish"
        flags.crit = dice.some((d) => d.exploded && d.value != null);
    }

    if (opposed) {
        flags.opposedWin = opposed.margin > 0;
        flags.opposedTie = opposed.margin === 0;
        flags.opposedLoss = opposed.margin < 0;
    }

    return flags;
}

/**
 * @param {DiceGroup} group
 */
export function formatGroupLabel(group) {
    let label = `${group.count}d${group.percentile ? '100' : group.sides}`;
    if (group.keep) label += `k${group.keep}${group.keepCount}`;
    if (group.drop) label += `d${group.drop}${group.dropCount}`;
    if (group.rerollMax != null) label += `r${group.rerollMax}`;
    if (group.compound) label += '!!';
    else if (group.explode) label += '!';
    return label;
}

/**
 * Dice that exploded (rolled max) and need an extra throw.
 * @param {ParsedRoll|ParsedSide} parsed
 * @param {DieOutcome[]} dice
 */
export function getExplodingRespawnSpecs(parsed, dice) {
    const specs = [];
    const groups = parsed.groups;

    groups.forEach((group, groupIndex) => {
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
                    rerollMax: null,
                    replacesDieIndex: d.dieIndex
                });
            }
        });
    });

    return specs;
}

/**
 * Dice that need a one-shot reroll (value ≤ rerollMax, not already rerolled).
 * @param {ParsedRoll|ParsedSide} parsed
 * @param {DieOutcome[]} dice
 */
export function getRerollRespawnSpecs(parsed, dice) {
    const specs = [];
    parsed.groups.forEach((group, groupIndex) => {
        if (group.rerollMax == null || group.percentile) return;
        const groupDice = dice.filter((d) => (
            d.groupIndex === groupIndex && d.role == null && !d.rerolled && !d.exploded
        ));
        groupDice.forEach((d) => {
            if (d.value != null && d.value <= group.rerollMax) {
                specs.push({
                    type: sidesToDieType(group.sides),
                    role: null,
                    groupIndex,
                    dieIndex: d.dieIndex,
                    explode: group.explode,
                    sides: group.sides,
                    rerollMax: null,
                    replacesDieIndex: d.dieIndex,
                    isReroll: true
                });
            }
        });
    });
    return specs;
}

/**
 * Rewrite helpers for mobile-friendly UI chips (no raw typing required).
 * @param {string} expression
 * @param {'advantage'|'disadvantage'|'explode'|'compound'|'reroll1'|'percentile'|'clear'} chip
 * @param {string} [systemId]
 */
export function applyExpressionChip(expression, chip, systemId = DEFAULT_ROLL_SYSTEM) {
    const system = ROLL_SYSTEMS[systemId] ?? ROLL_SYSTEMS.dnd5e;
    const trimmed = String(expression ?? '').trim();

    if (chip === 'percentile' || (chip === 'clear' && system.percentile)) {
        return '1d100';
    }

    if (chip === 'advantage') {
        return rewriteD20Pool(trimmed || '1d20', { keep: 'h', count: 2, keepCount: 1 });
    }
    if (chip === 'disadvantage') {
        return rewriteD20Pool(trimmed || '1d20', { keep: 'l', count: 2, keepCount: 1 });
    }
    if (chip === 'explode' || (chip === 'explode' && system.preferExplode)) {
        return appendDieSuffix(trimmed || '1d6', '!');
    }
    if (chip === 'compound') {
        return appendDieSuffix(trimmed || '1d6', '!!');
    }
    if (chip === 'reroll1') {
        return appendDieSuffix(trimmed || '4d6', 'r1');
    }
    if (chip === 'clear') {
        return '';
    }
    return trimmed;
}

/**
 * Default expression for a system preset chip.
 * @param {string} systemId
 */
export function defaultExpressionForSystem(systemId) {
    const system = ROLL_SYSTEMS[systemId];
    if (!system) return '1d20';
    if (system.id === 'pbta') return '2d6';
    if (system.id === 'coc' || system.percentile) return '1d100';
    if (system.id === 'savage') return '1d8!';
    return '1d20';
}

function rewriteD20Pool(expr, { keep, count, keepCount }) {
    // Strip opposed side for chip rewrite of the left expression only.
    const vs = /\s+vs\.?\s+/i.exec(expr);
    const left = vs ? expr.slice(0, vs.index).trim() : expr;
    const right = vs ? expr.slice(vs.index).trim() : '';

    let next = left;
    if (/\d*d20/i.test(left)) {
        next = left.replace(
            /(\d*)d20(?:kh\d*|kl\d*|dh\d*|dl\d*)?(?:r\d+)?(?:!!|!)?/i,
            `${count}d20k${keep}${keepCount}`
        );
    } else {
        next = `${count}d20k${keep}${keepCount}${left && !/^\d*d/i.test(left) ? left : ''}`;
        if (!/\d*d20/i.test(left) && left) {
            // Keep trailing +mod if the left was e.g. "+5" alone — rare.
            const modOnly = /^[+-]\d+$/.exec(left);
            next = modOnly
                ? `${count}d20k${keep}${keepCount}${modOnly[0]}`
                : `${count}d20k${keep}${keepCount}`;
        }
    }
    return right ? `${next}${right.startsWith(' ') ? '' : ' '}${right}` : next;
}

function appendDieSuffix(expr, suffix) {
    const vs = /\s+vs\.?\s+/i.exec(expr);
    const left = vs ? expr.slice(0, vs.index).trim() : expr;
    const right = vs ? expr.slice(vs.index) : '';

    const replaced = left.replace(
        /(\d*d(?:%|\d+)(?:kh\d*|kl\d*|dh\d*|dl\d*)?)(?:r\d+)?(?:!!|!)?/i,
        (full, base) => {
            let out = base;
            if (suffix.startsWith('r') && !/r\d+/i.test(full)) out += suffix;
            else if (suffix === '!!') out = `${base.replace(/!+$/, '')}!!`;
            else if (suffix === '!' && !/!/.test(full)) out = `${base}!`;
            else if (suffix === '!' && /!!/.test(full)) out = full;
            else out = full;
            return out;
        }
    );
    return right ? `${replaced}${right}` : replaced;
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
    if (result.opposed) {
        summary += `  vs ${result.opposed.expression} → ${result.opposed.total} (margin ${result.opposed.margin >= 0 ? '+' : ''}${result.opposed.margin})`;
    }
    return summary;
}
