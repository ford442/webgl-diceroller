const STORAGE_KEY = 'dice-roller-roll-history';
const DEFAULT_MAX_ENTRIES = 500;
const DICE_TYPE_ORDER = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;

type DieType = (typeof DICE_TYPE_ORDER)[number];

interface DiceResult {
    type: string;
    value: number;
}

interface RollHistoryMeta {
    diceSet?: Record<string, number>;
    seed?: number | null;
    expression?: string | null;
}

interface RollHistoryEntry {
    id: string;
    timestamp: number;
    diceSet: Record<string, number>;
    diceResults: DiceResult[];
    total: number;
    seed: number | null;
    expression: string | null;
}

export interface RollHistoryOptions {
    maxEntries?: number;
    storageKey?: string;
    persist?: boolean;
}

export interface RollHistory {
    appendRoll: (diceResults: DiceResult[] | null | undefined, meta?: RollHistoryMeta) => RollHistoryEntry | null;
    getEntries: () => RollHistoryEntry[];
    clear: () => void;
    exportAsText: () => string;
    exportAsCsv: () => string;
    maxEntries: number;
}

function formatDiceSet(diceSet: Record<string, number> | null | undefined): string {
    if (!diceSet || typeof diceSet !== 'object') return '';
    return DICE_TYPE_ORDER.filter((type) => (diceSet[type] ?? 0) > 0)
        .map((type) => `${diceSet[type]}${type}`)
        .join(' + ');
}

function formatResultsSummary(diceResults: DiceResult[]): string {
    const grouped: Partial<Record<DieType, number[]>> = {};
    for (const result of diceResults) {
        if (!result?.type || !Number.isInteger(result.value)) continue;
        const type = result.type as DieType;
        if (!grouped[type]) grouped[type] = [];
        grouped[type]!.push(result.value);
    }

    return DICE_TYPE_ORDER.filter((type) => grouped[type])
        .map((type) => `${grouped[type]!.length}${type}: ${grouped[type]!.join(', ')}`)
        .join('  •  ');
}

function escapeCsv(value: unknown): string {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function createRollHistory({
    maxEntries = DEFAULT_MAX_ENTRIES,
    storageKey = STORAGE_KEY,
    persist = true,
}: RollHistoryOptions = {}): RollHistory {
    let entries: RollHistoryEntry[] = [];
    let nextId = 1;

    function load(): void {
        if (!persist || typeof localStorage === 'undefined') return;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { entries?: unknown };
            if (!Array.isArray(parsed?.entries)) return;

            entries = parsed.entries
                .filter(
                    (entry): entry is RollHistoryEntry =>
                        !!entry &&
                        typeof entry === 'object' &&
                        Array.isArray((entry as RollHistoryEntry).diceResults)
                )
                .map((entry) => ({
                    id: entry.id ?? `roll-${nextId++}`,
                    timestamp: entry.timestamp ?? Date.now(),
                    diceSet: entry.diceSet ?? {},
                    diceResults: entry.diceResults,
                    total: entry.total ?? 0,
                    seed: entry.seed ?? null,
                    expression: entry.expression ?? null,
                }));

            const maxId = entries.reduce((max, entry) => {
                const match = /^roll-(\d+)$/.exec(entry.id ?? '');
                return match ? Math.max(max, Number(match[1])) : max;
            }, 0);
            nextId = maxId + 1;
        } catch (error) {
            console.warn('[RollHistory] Failed to load persisted history:', error);
            entries = [];
        }
    }

    function save(): void {
        if (!persist || typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(storageKey, JSON.stringify({ entries }));
        } catch (error) {
            console.warn('[RollHistory] Failed to persist history:', error);
        }
    }

    function appendRoll(
        diceResults: DiceResult[] | null | undefined,
        meta: RollHistoryMeta = {}
    ): RollHistoryEntry | null {
        const valid = (diceResults ?? []).filter(
            (result) => result && Number.isInteger(result.value)
        );
        if (valid.length === 0) return null;

        const total = valid.reduce((sum, result) => sum + result.value, 0);
        const entry: RollHistoryEntry = {
            id: `roll-${nextId++}`,
            timestamp: Date.now(),
            diceSet: meta.diceSet ?? {},
            diceResults: valid.map((result) => ({ type: result.type, value: result.value })),
            total,
            seed: meta.seed ?? null,
            expression: meta.expression ?? null,
        };

        entries.unshift(entry);
        if (entries.length > maxEntries) {
            entries.length = maxEntries;
        }

        save();
        return entry;
    }

    function getEntries(): RollHistoryEntry[] {
        return entries.map((entry) => ({ ...entry, diceResults: [...entry.diceResults] }));
    }

    function clear(): void {
        entries = [];
        save();
    }

    function exportAsText(): string {
        if (entries.length === 0) return 'No rolls recorded.';

        return entries
            .map((entry) => {
                const time = new Date(entry.timestamp).toLocaleString();
                const set = formatDiceSet(entry.diceSet);
                const summary = formatResultsSummary(entry.diceResults);
                const seedPart = entry.seed != null ? ` | seed=${entry.seed}` : '';
                const expressionPart = entry.expression ? ` | expr=${entry.expression}` : '';
                const setPart = set ? `${set} → ` : '';
                return `[${time}] ${setPart}${summary} | Total: ${entry.total}${seedPart}${expressionPart}`;
            })
            .join('\n');
    }

    function exportAsCsv(): string {
        const header = 'timestamp,dice_set,results,total,seed,expression';
        const rows = entries.map((entry) => {
            const time = new Date(entry.timestamp).toISOString();
            const set = formatDiceSet(entry.diceSet);
            const summary = formatResultsSummary(entry.diceResults);
            return [
                escapeCsv(time),
                escapeCsv(set),
                escapeCsv(summary),
                escapeCsv(entry.total),
                escapeCsv(entry.seed ?? ''),
                escapeCsv(entry.expression ?? ''),
            ].join(',');
        });

        return [header, ...rows].join('\n');
    }

    load();

    return {
        appendRoll,
        getEntries,
        clear,
        exportAsText,
        exportAsCsv,
        maxEntries,
    };
}

export { DICE_TYPE_ORDER, formatDiceSet, formatResultsSummary, DEFAULT_MAX_ENTRIES };
