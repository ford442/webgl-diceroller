// @vitest-environment node
/**
 * The ESLint rule that keeps `Math.random` / `Date.now` out of the trees that
 * decide the collider world (#369). Linting a snippet "as" a file proves the
 * rule is wired to the right globs, which a config typo would silently undo.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

async function messagesFor(filePath, code) {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-properties');
}

describe('no-restricted-properties for the deterministic trees', () => {
    const offending = 'export const x = Math.random() + Date.now();\n';

    it('rejects Math.random and Date.now under src/environment', async () => {
        const messages = await messagesFor('src/environment/ProbeProp.js', offending);
        expect(messages).toHaveLength(2);
        expect(messages.map((m) => m.message).join(' ')).toMatch(/prop RNG/);
    });

    it('rejects a bare Math.random reference (the `rng ?? Math.random` default)', async () => {
        const messages = await messagesFor(
            'src/environment/clutter/Probe.js',
            'export const pick = (o) => (o.rng ?? Math.random)();\n'
        );
        expect(messages).toHaveLength(1);
    });

    it('rejects them under packages/dice-core/src', async () => {
        const messages = await messagesFor(
            'packages/dice-core/src/roll/Probe.ts',
            'export const x: number = Math.random();\n'
        );
        expect(messages).toHaveLength(1);
    });

    it('lets a justified eslint-disable through', async () => {
        const messages = await messagesFor(
            'src/environment/ProbeProp.js',
            '// eslint-disable-next-line no-restricted-properties\nexport const t = Date.now();\n'
        );
        expect(messages).toHaveLength(0);
    });

    it('leaves the rest of src alone', async () => {
        expect(await messagesFor('src/core/Probe.js', offending)).toHaveLength(0);
    });
});
