import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

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
                node: {
                    extensions: ['.js', '.mjs'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
        },
    },
    {
        files: ['src/wasm/dice_physics.worker.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.worker,
                ...globals.es2021,
            },
        },
        plugins: { import: importPlugin, 'unused-imports': unusedImports },
        settings: {
            'import/resolver': {
                node: {
                    extensions: ['.js', '.mjs'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
        },
    },
    {
        files: [
            'scripts/**/*.{js,mjs}',
            'tests/**/*.{js,mjs}',
            'test_dicecup.js',
            'vite.config.js',
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
                node: {
                    extensions: ['.js', '.mjs'],
                },
            },
        },
        rules: {
            ...coreRules,
            ...importRules,
        },
    },
    {
        files: ['tests/**/*.js', 'tests/helpers/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.commonjs,
                ...globals.browser,
            },
        },
    },
    eslintConfigPrettier,
    {
        files: ['src/environment/**/*.js'],
        ignores: [
            'src/environment/PropPhysics.js',
            'src/environment/PropLifecycle.js',
            'src/environment/propKit.js',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: './PropPhysics.js',
                            message:
                                'Use createProp + declarative colliders from propKit.js instead of PropPhysics.',
                        },
                        {
                            name: '../environment/PropPhysics.js',
                            message:
                                'Use createProp + declarative colliders from propKit.js instead of PropPhysics.',
                        },
                        {
                            name: '../physics.js',
                            message: 'Props must not import physics.js — use propKit/StaticColliderBridge.',
                        },
                        {
                            name: '../../physics.js',
                            message: 'Props must not import physics.js — use propKit/StaticColliderBridge.',
                        },
                    ],
                },
            ],
        },
    },
];
