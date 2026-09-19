import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import perfectionist from 'eslint-plugin-perfectionist';
import prettier from 'eslint-config-prettier/flat';
// @ts-expect-error -- eslint-plugin-security has no type declarations
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const CONFIGURATION = defineConfig(
	// ─── Global Ignores ───────────────────────────────────────────────────────────
	{
		ignores: [
			// Node modules
			'node_modules/',
			// Output
			'dist/',
			// Vite
			'vite.config.js.timestamp-*',
			'vite.config.ts.timestamp-*',
			// Test results & coverage
			'coverage/',
			'test-results-vitest/',
			'.vitest-attachments/',
			'.vitest/',
			// Logs
			'*-debug.log',
			'*.log',
			'*.log-*',
			'*.log.*',
			'*.logs',
			'logs/',
			// Backup & local files
			'*.backup',
			'*.backup.*',
			'*.bak',
			'*.bak.*',
			'*.local',
			'*.local.*',
			'*.local-backup',
			'*.local-backup.*',
			'local-files/',
			// Env files
			'.env',
			'.env.*',
			// OS generated files
			'.DS_Store',
			'Thumbs.db',
			// PNPM store
			'.pnpm-store/',
		],
	},

	// ─── Base: ESLint Recommended ─────────────────────────────────────────────────
	js.configs.recommended,

	// ─── TypeScript: Recommended Type-Checked ─────────────────────────────────────
	tseslint.configs.recommendedTypeChecked,

	// ─── Global Language Options ──────────────────────────────────────────────────
	{
		languageOptions: {
			// The plugin runs inside the Vite (Node) process; no browser globals
			globals: {
				...globals.node,
			},
			parserOptions: {
				projectService: true,
			},
		},
	},

	// ─── Import & Export Ordering ────────────────────────────────────────────────
	// No ESLint plugin supports auto-fixing declaration order by variable name — all sort by module path
	// Member and export sorting: perfectionist with types-first grouping
	{
		plugins: { perfectionist },
		rules: {
			'perfectionist/sort-named-imports': [
				'warn',
				{
					type: 'natural',
					groups: ['type', 'value'],
					customGroups: [
						{ groupName: 'type', modifiers: ['type'], selector: 'import' },
						{ groupName: 'value', modifiers: ['value'], selector: 'import' },
					],
				},
			],
			'perfectionist/sort-named-exports': [
				'warn',
				{
					type: 'natural',
					groups: ['type', 'value'],
					customGroups: [
						{ groupName: 'type', modifiers: ['type'], selector: 'export' },
						{ groupName: 'value', modifiers: ['value'], selector: 'export' },
					],
				},
			],
			'perfectionist/sort-exports': [
				'warn',
				{
					type: 'natural',
					groups: ['type', 'value'],
					customGroups: [
						{ groupName: 'type', modifiers: ['type'], selector: 'export' },
						{ groupName: 'value', modifiers: ['value'], selector: 'export' },
					],
				},
			],
		},
	},

	// ─── SonarJS: Code Quality ───────────────────────────────────────────────────
	{
		plugins: { sonarjs },
		rules: {
			'sonarjs/cognitive-complexity': ['warn', 20],
			'sonarjs/no-identical-functions': 'warn',
			'sonarjs/no-all-duplicated-branches': 'warn',
			'sonarjs/no-collapsible-if': 'warn',
			'sonarjs/no-duplicated-branches': 'warn',
		},
	},

	// ─── Security ─────────────────────────────────────────────────────────────────
	// The plugin builds RegExps from user-supplied attribute names; those call sites carry a
	// scoped `eslint-disable-next-line security/detect-non-literal-regexp` in src/utilities.ts.
	{
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- eslint-plugin-security lacks type declarations
		plugins: { security },
		rules: {
			'security/detect-object-injection': 'off', // Flags all bracket notation (obj[key]) — excessive false positives in TypeScript where bracket access is type-safe
			'security/detect-non-literal-regexp': 'warn',
			'security/detect-non-literal-fs-filename': 'warn',
			'security/detect-eval-with-expression': 'error',
			'security/detect-no-csrf-before-method-override': 'warn',
			'security/detect-possible-timing-attacks': 'warn',
			'security/detect-unsafe-regex': 'warn',
		},
	},

	// ─── Custom Rules ─────────────────────────────────────────────────────────────
	{
		rules: {
			// ── Complexity ──
			'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
			'max-params': ['warn', { max: 5 }],

			// ── Type-Checked Overrides ──
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
			'@typescript-eslint/unbound-method': 'off', // Callbacks passed as references (Vite hooks, array methods) false-positive when the method is not called with a class receiver
			'@typescript-eslint/await-thenable': 'warn',
			'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
			'@typescript-eslint/no-misused-promises': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',

			// ── Correctness (override recommended levels) ──
			'no-undef': 'off', // TypeScript compiler catches undefined variables; this rule false-positives on global types and ambient declarations
			'no-useless-assignment': 'error',
			'no-loss-of-precision': 'error',
			'no-nonoctal-decimal-escape': 'error',

			// ── Style ──
			'@typescript-eslint/naming-convention': [
				'warn',
				{ selector: 'default', format: ['camelCase'] },
				{ selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
				{ selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
				{ selector: 'function', format: ['camelCase'] },
				{ selector: 'typeLike', format: ['PascalCase'] },
				{ selector: 'enumMember', format: ['UPPER_CASE'] },
				{ selector: 'objectLiteralProperty', format: null },
				{ selector: 'objectLiteralMethod', format: ['camelCase'] },
				{ selector: 'classProperty', format: ['camelCase'] },
				{ selector: 'classProperty', modifiers: ['static'], format: ['camelCase', 'UPPER_CASE'] },
				{ selector: 'classProperty', modifiers: ['private'], format: ['camelCase'] },
				{ selector: 'classMethod', format: ['camelCase'] },
				{ selector: 'import', format: null },
			],
			'@typescript-eslint/no-inferrable-types': 'error',
			'@typescript-eslint/no-namespace': 'error',
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					args: 'all',
					argsIgnorePattern: '^_',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'@typescript-eslint/no-non-null-assertion': 'warn',
			'@typescript-eslint/no-dynamic-delete': 'warn',
			'@typescript-eslint/default-param-last': 'warn',
			'@typescript-eslint/no-unnecessary-type-constraint': 'error',
			'@typescript-eslint/no-useless-constructor': 'error',
			'@typescript-eslint/no-useless-empty-export': 'error',
			'@typescript-eslint/require-await': 'warn',
			'@typescript-eslint/no-misused-new': 'error',
			'@typescript-eslint/no-unsafe-declaration-merging': 'error',
			'@typescript-eslint/no-redeclare': 'error',
			'@typescript-eslint/no-dupe-class-members': 'error',
			'@typescript-eslint/prefer-optional-chain': 'warn',
			'@typescript-eslint/prefer-nullish-coalescing': 'warn',
			'@typescript-eslint/prefer-readonly': 'warn',
			'@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
			'@typescript-eslint/switch-exhaustiveness-check': 'warn',
			'@typescript-eslint/no-unnecessary-condition': 'warn',
			'@typescript-eslint/no-unnecessary-template-expression': 'warn',
			'@typescript-eslint/ban-ts-comment': [
				'warn',
				{
					'ts-expect-error': 'allow-with-description',
					'ts-ignore': 'allow-with-description',
					'ts-nocheck': 'allow-with-description',
					minimumDescriptionLength: 10,
				},
			],

			// ── Core Style ──
			'prefer-const': ['error', { destructuring: 'all' }],
			'no-var': 'error',
			'no-param-reassign': 'error',
			'prefer-template': 'warn',
			'no-lonely-if': 'warn',
			'one-var': ['error', 'never'],
			'no-unneeded-ternary': 'error',
			'no-useless-rename': 'error',
			'no-useless-catch': 'error',
			'no-lone-blocks': 'error',
			'no-eval': 'error',
			'no-negated-condition': 'warn',
			'default-case-last': 'warn',
			'prefer-exponentiation-operator': 'warn',
			'operator-assignment': 'warn',
			'logical-assignment-operators': 'warn',
			'no-extra-boolean-cast': 'error',
			'no-unused-private-class-members': 'warn',
			'no-label-var': 'error',

			// ── Suspicious ──
			eqeqeq: ['warn', 'smart'],
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-debugger': 'warn',
			'no-console': 'warn', // A published Vite plugin must not log; the plugin has no console stripper, so restrict console logging to essential debugging or informative cases only
			'no-empty': ['warn', { allowEmptyCatch: false }],
			'no-return-assign': 'warn',
		},
	},

	// ─── Override: Test Files ─────────────────────────────────────────────────────
	{
		files: ['**/*.test.ts', '**/*.spec.ts'],
		rules: {
			'sonarjs/cognitive-complexity': 'off', // Test suites have deeply nested describe/it blocks and complex setup
			'max-lines-per-function': 'off', // Test functions are naturally long with multiple assertions and scenarios
			'max-params': 'off', // Parameterized tests and test utilities often require many parameters
			'@typescript-eslint/no-explicit-any': 'off', // Tests frequently mock and stub with dynamic types
			'@typescript-eslint/no-unsafe-assignment': 'off', // Test fixtures and mock data are often untyped
			'@typescript-eslint/no-unsafe-member-access': 'off', // Accessing mock/stub properties requires untyped access
			'@typescript-eslint/no-unsafe-call': 'off', // Calling mocked functions triggers unsafe-call false positives
		},
	},

	// ─── Override: Config Files ───────────────────────────────────────────────────
	{
		files: ['*.config.ts', '*.config.js', '.commitlintrc.ts'],
		rules: {
			'@typescript-eslint/naming-convention': 'off', // Config files must match external tool schemas (Vite, ESLint, commitlint) which use their own naming
		},
	},

	// ─── Override: Root Scripts ───────────────────────────────────────────────────
	{
		files: ['*.ts'],
		rules: {
			'no-console': 'off', // Root-level CLI scripts report through stdout/stderr; only the published `src/` must stay silent
		},
	},

	// ─── Prettier (MUST be last — disables conflicting formatting rules) ──────────
	prettier,
);

export default CONFIGURATION;
