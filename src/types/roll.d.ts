export interface DiceGroup {
    count: number;
    sides: number;
    keep: 'h' | 'l' | null;
    keepCount: number;
    drop: 'h' | 'l' | null;
    dropCount: number;
    explode: boolean;
    compound: boolean;
    /** Faces <= this are rerolled once. */
    rerollMax: number | null;
    percentile: boolean;
}

export interface ParsedRoll {
    groups: DiceGroup[];
    modifier: number;
    raw: string;
    opposed: { groups: DiceGroup[]; modifier: number; raw: string } | null;
}

export interface DieOutcome {
    groupIndex: number;
    dieIndex: number;
    type: string;
    value: number | null;
    role?: 'tens' | 'ones' | null;
    kept?: boolean;
    dropped?: boolean;
    exploded?: boolean;
    rerolled?: boolean;
    replacedByReroll?: boolean;
    originalValue?: number | null;
    /** Percentile display override or explosion slot total. */
    displayValue?: number | null;
}

export interface RollOutcomeEntry {
    die: string;
    faces: number;
    value: number | null;
    exploded?: boolean;
    kept?: boolean;
    dropped?: boolean;
    rerolled?: boolean;
}

export interface RollFlags {
    crit: boolean;
    fumble: boolean;
    advantage: boolean;
    disadvantage: boolean;
    strongHit?: boolean;
    weakHit?: boolean;
    miss?: boolean;
    opposedWin?: boolean;
}

export interface EvaluatedRoll {
    expression: string;
    dice: DieOutcome[];
    rolls: RollOutcomeEntry[];
    groupSubtotals: { label: string; subtotal: number; groupIndex?: number }[];
    modifier: number;
    total: number;
    flags: RollFlags;
    seed: number | null;
    opposed: {
        expression: string;
        total: number;
        margin: number;
        dice: DieOutcome[];
        groupSubtotals: object[];
        modifier: number;
        rolls: RollOutcomeEntry[];
    } | null;
}

export interface DieSpec {
    type: string;
    role: 'tens' | 'ones' | null;
    groupIndex: number;
    dieIndex: number;
    explode: boolean;
    sides: number;
    replacesDieIndex?: number;
}

export interface RollHistoryEntry {
    id: string | number;
    timestamp: number;
    diceSet?: Record<string, number>;
    diceResults?: Array<{ type: string; value: number | null; total?: number }>;
    expression?: string;
    seed?: number | null;
    total?: number;
}

export interface RollDieStats {
    dieType: string;
    sides: number;
    totalRolls: number;
    observedCounts: number[];
    chiSquared: number;
    criticalValue: number | null;
    expectedMean: number;
    actualMean: number;
    hasEnoughSamples: boolean;
    passes: boolean | null;
}

export interface RollSessionDeps {
    scene: import('three').Scene;
    world: import('../types/ammo').AmmoWorld | null;
    replaceDiceSet: (
        scene: import('three').Scene,
        world: import('../types/ammo').AmmoWorld | null,
        specs: DieSpec[]
    ) => void;
    throwDice: (
        scene: import('three').Scene,
        world: import('../types/ammo').AmmoWorld | null,
        seed?: number | null
    ) => void;
    readAllDiceValues: () => Array<{
        type: string;
        value: number | null;
        role?: 'tens' | 'ones' | null;
        groupIndex?: number;
    }>;
    areDiceSettled: () => boolean;
    waitFrame?: () => Promise<void>;
    setDeferAutoResults?: (active: boolean) => void;
    onComplete?: (result: EvaluatedRoll) => void;
    onStateChange?: (state: string) => void;
}
