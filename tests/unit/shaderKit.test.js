/**
 * The kit is what makes "one graph, two renderers" hold: a graph can only use
 * ops both backends implement, and the GLSL backend has to emit source a
 * WebGL2 compiler accepts (the browser compile itself is
 * `npm run verify:shader-parity`).
 */
import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import {
    SHADER_KIT_OPS,
    createGlslKit,
    createTslKit,
    glslFloat,
} from '../../src/shaders/graph/ShaderKit.js';

describe('ShaderKit parity', () => {
    it.each([
        ['glsl', () => createGlslKit()],
        ['tsl', () => createTslKit(TSL)],
    ])('%s implements every kit op', (_name, make) => {
        const kit = make();
        const missing = SHADER_KIT_OPS.filter((op) => typeof kit[op] !== 'function');
        expect(missing).toEqual([]);
    });

    it('neither backend exposes an op the other lacks', () => {
        const ops = (kit) =>
            Object.keys(kit)
                .filter((key) => typeof kit[key] === 'function')
                .filter((key) => !['functionsSource', 'takeStatements'].includes(key))
                .sort();
        expect(ops(createGlslKit())).toEqual(ops(createTslKit(TSL)));
        expect(ops(createGlslKit())).toEqual([...SHADER_KIT_OPS].sort());
    });
});

describe('GLSL backend', () => {
    it('writes numbers as float literals', () => {
        expect(glslFloat(2)).toBe('2.0');
        expect(glslFloat(-1)).toBe('-1.0');
        expect(glslFloat(0.42)).toBe('0.42');
        expect(glslFloat(1e-7)).toBe('1e-7');
        expect(() => glslFloat(Number.NaN)).toThrow();
    });

    it('emits a function once, dependencies first', () => {
        const k = createGlslKit();
        const inner = k.fn('inner', 'float', [['float', 'x']], (x) => k.mul(x, 2));
        const outer = k.fn('outer', 'float', [['float', 'x']], (x) => k.add(inner(x), 1));
        k.fn('outer', 'float', [['float', 'x']], () => {
            throw new Error('a second definition must not be built');
        });

        expect(outer('y')).toBe('outer(y)');
        expect(k.functionsSource()).toBe(
            [
                'float inner(float x) {',
                '    return (x * 2.0);',
                '}',
                '',
                'float outer(float x) {',
                '    return (inner(x) + 1.0);',
                '}',
            ].join('\n')
        );
    });

    it('nests statements in the block that emitted them', () => {
        const k = createGlslKit({ prefix: 't' });
        const best = k.variable('int', k.int(0));
        k.Loop(4, (i) => {
            k.If(k.lessThan(i, 'uCount'), () => {
                k.assign(best, i);
            });
        });
        expect(k.takeStatements()).toBe(
            [
                'int t_0 = 0;',
                'for (int t_i1 = 0; t_i1 < 4; t_i1++) {',
                '    if ((t_i1 < uCount)) {',
                '        t_0 = t_i1;',
                '    }',
                '}',
            ].join('\n')
        );
        expect(k.takeStatements()).toBe('');
    });
});

describe('TSL backend', () => {
    it('builds nodes, with JS numbers promoted', () => {
        const k = createTslKit(TSL);
        const node = k.mix(k.vec3(1, 0, 0), k.vec3(0, 0, 1), 0.25);
        expect(node.isNode).toBe(true);
        expect(k.mul(2, 3).isNode).toBe(true);
    });

    it('caches functions by name like the GLSL backend', () => {
        const k = createTslKit(TSL);
        const a = k.fn('f', 'float', [['float', 'x']], (x) => k.mul(x, 2));
        const b = k.fn('f', 'float', [['float', 'x']], (x) => k.mul(x, 3));
        expect(a).toBe(b);
    });
});
