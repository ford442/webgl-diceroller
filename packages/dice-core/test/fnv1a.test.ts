import { describe, expect, it } from 'vitest';
import { fnv1a32, fnv1a64Hex } from '../src/hash/fnv1a.js';

/** The textbook BigInt form the double-based implementation must equal. */
function reference64(input: string): string {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(input)) {
        hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
}

describe('fnv1a', () => {
    it('matches the published FNV-1a vectors', () => {
        expect(fnv1a64Hex('')).toBe('cbf29ce484222325');
        expect(fnv1a64Hex('a')).toBe('af63dc4c8601ec8c');
        expect(fnv1a64Hex('foobar')).toBe('85944171f73967e8');
        expect(fnv1a32('')).toBe(0x811c9dc5);
        expect(fnv1a32('a')).toBe(0xe40c292c);
        expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    });

    it('agrees with a BigInt reference on varied input, including non-ASCII', () => {
        const samples = [
            'world-v1',
            '{"type":"box","center":[0,-10,0],"halfExtents":[20,0.5,20]}',
            'héllo wörld ✓ 骰子 🎲',
            'x'.repeat(5000),
        ];
        let state = 12345;
        for (let i = 0; i < 50; i++) {
            let text = '';
            for (let j = 0; j < 1 + (i % 40); j++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                text += String.fromCharCode(32 + (state % 95));
            }
            samples.push(text);
        }
        for (const sample of samples) expect(fnv1a64Hex(sample)).toBe(reference64(sample));
    });
});
