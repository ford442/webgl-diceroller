import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const importRules = {
    'import/no-duplicates': 'error',
    'import/no-unresolved': [
        'error',
        {
            commonjs: true,
            caseSensitive: true,
            ignore: ['^three/webgpu$', '^three/tsl$', '^three/addons/', '^/src/__'],
        },
    ],
};

/**
 * The package boundary, from both sides. App code, tests and scripts reach
 * dice-core only through its package name (`dice-core`, `dice-core/wasm/…`),
 * never by a relative path into its sources — and the old `core-engine`
 * re-export barrels cannot come back.
 */
const packageBoundaryRule = {
    'no-restricted-imports': [
        'error',
        {
            patterns: [
                {
                    group: ['**/core-engine', '**/core-engine/**'],
                    message:
                        'src/core-engine moved to packages/dice-core — import from "dice-core".',
                },
                {
                    group: ['**/packages/dice-core/src', '**/packages/dice-core/src/**'],
                    message: 'Import dice-core by package name ("dice-core/…"), not by path.',
                },
            ],
        },
    ],
};

/** Inside packages/dice-core/src: no Three.js, no reaching back into the app. */
const insidePackageRule = {
    'no-restricted-imports': [
        'error',
        {
            patterns: [
                {
                    group: ['three', 'three/*'],
                    message: 'dice-core is Three.js-free; keep rendering in src/.',
                },
                {
                    group: ['../../*', '../../**', 'dice-core', 'dice-core/*'],
                    message:
                        'Stay inside packages/dice-core/src (relative imports, no self-reference).',
                },
            ],
        },
    ],
};

const coreRules = {
    ...js.configs.recommended.rules,
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-case-declarations': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
        'error',
        {
            vars: 'all',
            varsIgnorePattern: '^_',
            args: 'after-used',
            argsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
        },
    ],
};

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'legacy/**',
            'public/**',
            'src/wasm/third_party/**',
            // CMake/native build trees (test:solver now configures build-emcc).
            'src/wasm/build-*/**',
            'coverage/**',
            'packages/*/dist/**',
            'render-regression-*.png',
        ],
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
            },
        },
        plugins: { import: importPlugin, 'unused-imports': unusedImports },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                    // Workspace packages export TS sources under `source`.
                    conditionNames: ['source', 'types', 'import', 'node', 'default'],
                },
                node: {
                    extensions: ['.js', '.mjs', '.ts'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
        },
    },
    ...tseslint.config({
        files: [
            'src/**/*.ts',
            'tests/unit/**/*.ts',
            'packages/*/src/**/*.ts',
            'packages/*/test/**/*.ts',
        ],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parser: tseslint.parser,
            globals: {
                ...globals.browser,
                ...globals.es2021,
            },
        },
        plugins: { import: importPlugin, 'unused-imports': unusedImports },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                    // Workspace packages export TS sources under `source`.
                    conditionNames: ['source', 'types', 'import', 'node', 'default'],
                },
                node: {
                    extensions: ['.js', '.mjs', '.ts'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
            // TypeScript already resolves globals from `lib` (Transferable,
            // MessageEvent, …); eslint's browser globals list does not.
            'no-undef': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    }),
    ...tseslint.config({
        files: ['packages/dice-core/src/wasm/dice_physics.worker.ts'],
        extends: [tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parser: tseslint.parser,
            globals: {
                ...globals.worker,
                ...globals.es2021,
            },
        },
        plugins: { import: importPlugin, 'unused-imports': unusedImports },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                    // Workspace packages export TS sources under `source`.
                    conditionNames: ['source', 'types', 'import', 'node', 'default'],
                },
                node: {
                    extensions: ['.js', '.mjs', '.ts'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
            // TypeScript already resolves globals from `lib` (Transferable,
            // MessageEvent, …); eslint's browser globals list does not.
            'no-undef': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    }),
    {
        files: [
            'scripts/**/*.{js,mjs}',
            'tests/**/*.{js,mjs}',
            'vite.config.js',
            'vitest.config.js',
            'eslint.config.js',
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
                ...globals.es2021,
            },
        },
        plugins: { import: importPlugin, 'unused-imports': unusedImports },
        settings: {
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: './tsconfig.json',
                    // Workspace packages export TS sources under `source`.
                    conditionNames: ['source', 'types', 'import', 'node', 'default'],
                },
                node: {
                    extensions: ['.js', '.mjs', '.ts'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
        },
    },
    {
        files: ['tests/unit/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
        },
    },
    {
        files: [
            'src/**/*.{js,ts}',
            'tests/**/*.{js,ts,mjs}',
            'scripts/**/*.{js,mjs}',
            'packages/*/test/**/*.ts',
        ],
        rules: packageBoundaryRule,
    },
    {
        files: ['packages/dice-core/src/**/*.ts'],
        rules: insidePackageRule,
    },
    eslintConfigPrettier,
];
