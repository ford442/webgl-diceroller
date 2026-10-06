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

// The engine lives in the `dice-core` workspace package. Import it by name
// (`dice-core/roll/Notation`), never by a relative path into its tree, and
// never through the old src/ re-export barrels (deleted, #349).
const DICE_CORE_IMPORT_MESSAGE = "Import the headless engine as 'dice-core/<subpath>'.";
const diceCoreImportRule = {
    'no-restricted-imports': [
        'error',
        {
            patterns: [
                {
                    group: ['**/core-engine', '**/core-engine/**'],
                    message: DICE_CORE_IMPORT_MESSAGE,
                },
                {
                    group: ['**/packages/dice-core', '**/packages/dice-core/**'],
                    message: DICE_CORE_IMPORT_MESSAGE,
                },
                {
                    group: ['dice-core/src/**', 'dice-core/dist/**'],
                    message: DICE_CORE_IMPORT_MESSAGE,
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
    ...diceCoreImportRule,
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
            'packages/*/dist/**',
            'legacy/**',
            'public/**',
            'src/wasm/third_party/**',
            'coverage/**',
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
            'packages/dice-core/src/**/*.ts',
            'packages/dice-core/test/**/*.ts',
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
    eslintConfigPrettier,
];
