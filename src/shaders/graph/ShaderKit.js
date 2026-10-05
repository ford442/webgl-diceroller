/**
 * One shader vocabulary, two backends.
 *
 * Every visual idea in the tavern used to be written twice — a GLSL string for
 * `WebGLRenderer` and a TSL node graph for `WebGPURenderer` — and kept in step
 * by a comment saying they matched. They did not always match. A graph written
 * against this kit is built by *both* backends from the same JS, so a term can
 * no longer be added to one renderer and forgotten in the other:
 *
 *   - `createGlslKit()` returns GLSL source: expressions are strings, statements
 *     are appended to the current block, `fn` emits a GLSL function once.
 *   - `createTslKit(TSL)` returns nodes: the same calls map onto `three/tsl`
 *     (`Fn`, `If`, `Loop`, `toVar`, …). `three/tsl` is passed in rather than
 *     imported so the WebGL path never loads the node system.
 *
 * `WebGLRenderer` cannot run a `NodeMaterial`, and the WebGL2 node backend of
 * `WebGPURenderer` is the one that breaks under SwiftShader, so generating GLSL
 * from the graph is what keeps `?webgl` / XR / CI on the stable renderer while
 * the maths lives in one place.
 *
 * The surface is deliberately small — what the dice, god-ray and vignette graphs
 * use. Everything is a function (`k.mul(a, b)`, not `a.mul(b)`), JS numbers are
 * float literals, and `variable` / `fn` take GLSL type names because GLSL needs
 * them to declare anything. Add an op to *both* backends or the kit parity test
 * fails.
 */

/** Ops every kit must implement. `tests/unit/shaderKit.test.js` checks both. */
export const SHADER_KIT_OPS = Object.freeze([
    // literals / constructors
    'float',
    'int',
    'vec2',
    'vec3',
    'vec4',
    // arithmetic
    'add',
    'sub',
    'mul',
    'div',
    'negate',
    // built-ins
    'sin',
    'exp',
    'floor',
    'fract',
    'abs',
    'normalize',
    'fwidth',
    'dot',
    'cross',
    'max',
    'min',
    'pow',
    'mix',
    'smoothstep',
    'step',
    'clamp',
    // access
    'swizzle',
    'element',
    'sample',
    // logic
    'lessThan',
    'greaterThan',
    'select',
    // statements
    'variable',
    'assign',
    'If',
    'Loop',
    'fn',
]);

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/** A JS number as a GLSL float literal (`2` → `2.0`). */
export function glslFloat(value) {
    if (!Number.isFinite(value)) throw new Error(`ShaderKit: non-finite literal ${value}`);
    const text = String(value);
    return /[.eE]/.test(text) ? text : `${text}.0`;
}

function glslArg(value) {
    if (typeof value === 'number') return glslFloat(value);
    if (typeof value === 'string') return value;
    throw new Error(`ShaderKit(glsl): expected an expression, got ${typeof value}`);
}

/**
 * @param {{ prefix?: string }} [options] `prefix` namespaces generated variable
 *   names so two graphs spliced into one shader cannot collide.
 */
export function createGlslKit({ prefix = 'sk' } = {}) {
    /** Statement buffers; the last one is the block being written. */
    const blocks = [[]];
    /** Emitted function definitions, dependency-first. */
    const functions = [];
    /** name → caller, so a graph that asks twice gets one definition. */
    const callers = new Map();
    let counter = 0;

    const emit = (line) => blocks[blocks.length - 1].push(line);
    const call =
        (name) =>
        (...args) =>
            `${name}(${args.map(glslArg).join(', ')})`;
    const binary = (op) => (a, b) => `(${glslArg(a)} ${op} ${glslArg(b)})`;

    const withBlock = (body) => {
        blocks.push([]);
        body();
        return blocks.pop();
    };
    const indent = (lines) => lines.map((line) => `    ${line}`);

    return {
        backend: 'glsl',

        float: (value) => glslArg(value),
        int: (value) =>
            typeof value === 'number' ? String(Math.trunc(value)) : `int(${glslArg(value)})`,
        vec2: call('vec2'),
        vec3: call('vec3'),
        vec4: call('vec4'),

        add: binary('+'),
        sub: binary('-'),
        mul: binary('*'),
        div: binary('/'),
        negate: (a) => `(-${glslArg(a)})`,

        sin: call('sin'),
        exp: call('exp'),
        floor: call('floor'),
        fract: call('fract'),
        abs: call('abs'),
        normalize: call('normalize'),
        fwidth: call('fwidth'),
        dot: call('dot'),
        cross: call('cross'),
        max: call('max'),
        min: call('min'),
        pow: call('pow'),
        mix: call('mix'),
        smoothstep: call('smoothstep'),
        step: call('step'),
        clamp: call('clamp'),

        swizzle: (value, components) => `${glslArg(value)}.${components}`,
        element: (array, index) => `${glslArg(array)}[${glslArg(index)}]`,
        sample: (sampler, uv) => `texture2D(${glslArg(sampler)}, ${glslArg(uv)})`,

        lessThan: binary('<'),
        greaterThan: binary('>'),
        select: (condition, a, b) => `(${glslArg(condition)} ? ${glslArg(a)} : ${glslArg(b)})`,

        variable(type, init) {
            const name = `${prefix}_${counter++}`;
            emit(`${type} ${name} = ${glslArg(init)};`);
            return name;
        },
        assign(target, value) {
            emit(`${target} = ${glslArg(value)};`);
        },
        If(condition, body) {
            const lines = withBlock(body);
            emit(`if (${glslArg(condition)}) {`);
            indent(lines).forEach(emit);
            emit('}');
        },
        Loop(count, body) {
            const index = `${prefix}_i${counter++}`;
            const lines = withBlock(() => body(index));
            emit(`for (int ${index} = 0; ${index} < ${Math.trunc(count)}; ${index}++) {`);
            indent(lines).forEach(emit);
            emit('}');
        },
        /**
         * @param {string} name GLSL function name (also the dedupe key)
         * @param {string} returnType
         * @param {[type: string, name: string][]} params
         * @param {(...args: string[]) => string} body returns the result expression
         */
        fn(name, returnType, params, body) {
            if (callers.has(name)) return callers.get(name);
            let result = '';
            const lines = withBlock(() => {
                result = glslArg(body(...params.map(([, param]) => param)));
            });
            const signature = params.map(([type, param]) => `${type} ${param}`).join(', ');
            functions.push(
                [
                    `${returnType} ${name}(${signature}) {`,
                    ...indent(lines),
                    `    return ${result};`,
                    '}',
                ].join('\n')
            );
            const caller = call(name);
            callers.set(name, caller);
            return caller;
        },

        /** Function definitions emitted so far, ready to go ahead of `main()`. */
        functionsSource: () => functions.join('\n\n'),
        /** Top-level statements emitted so far (and clears them). */
        takeStatements: () => blocks[0].splice(0).join('\n'),
    };
}

// ---------------------------------------------------------------------------
// TSL
// ---------------------------------------------------------------------------

/**
 * @param {typeof import('three/tsl')} TSL the lazily imported `three/tsl` module
 */
export function createTslKit(TSL) {
    const T = /** @type {any} */ (TSL);
    const callers = new Map();
    const node = (value) => (typeof value === 'number' ? T.float(value) : value);

    return {
        backend: 'tsl',

        float: (value) => T.float(value),
        int: (value) => T.int(value),
        vec2: (...args) => T.vec2(...args),
        vec3: (...args) => T.vec3(...args),
        vec4: (...args) => T.vec4(...args),

        add: (a, b) => T.add(node(a), node(b)),
        sub: (a, b) => T.sub(node(a), node(b)),
        mul: (a, b) => T.mul(node(a), node(b)),
        div: (a, b) => T.div(node(a), node(b)),
        negate: (a) => T.negate(node(a)),

        sin: (a) => T.sin(node(a)),
        exp: (a) => T.exp(node(a)),
        floor: (a) => T.floor(node(a)),
        fract: (a) => T.fract(node(a)),
        abs: (a) => T.abs(node(a)),
        normalize: (a) => T.normalize(a),
        fwidth: (a) => T.fwidth(a),
        dot: (a, b) => T.dot(a, b),
        cross: (a, b) => T.cross(a, b),
        max: (a, b) => T.max(node(a), node(b)),
        min: (a, b) => T.min(node(a), node(b)),
        pow: (a, b) => T.pow(node(a), node(b)),
        // Functional `mix(a, b, t)` on purpose: TSL's *method* `a.mix(b, t)` is
        // `mix(b, t, a)` — the receiver is the blend factor — which is exactly
        // the kind of trap a second hand-written graph falls into.
        mix: (a, b, t) => T.mix(node(a), node(b), node(t)),
        smoothstep: (e0, e1, x) => T.smoothstep(node(e0), node(e1), node(x)),
        step: (edge, x) => T.step(node(edge), node(x)),
        clamp: (x, lo, hi) => T.clamp(node(x), node(lo), node(hi)),

        swizzle: (value, components) => value[components],
        element: (array, index) => array.element(index),
        sample: (texture, uv) => T.texture(texture, uv),

        lessThan: (a, b) => T.lessThan(node(a), node(b)),
        greaterThan: (a, b) => T.greaterThan(node(a), node(b)),
        select: (condition, a, b) => T.select(condition, node(a), node(b)),

        variable: (type, init) => T[type](init).toVar(),
        assign: (target, value) => target.assign(node(value)),
        If: (condition, body) => T.If(condition, body),
        Loop: (count, body) => T.Loop(count, ({ i }) => body(T.int(i))),
        fn(name, _returnType, _params, body) {
            if (callers.has(name)) return callers.get(name);
            const built = T.Fn((args) => body(...args));
            const caller = (...args) => built(...args.map(node));
            callers.set(name, caller);
            return caller;
        },
    };
}
