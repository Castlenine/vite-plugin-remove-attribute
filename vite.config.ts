import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

const IS_CI = process.env.CI === 'true';

// Rolldown emits `exports.default = removeAttributesPlugin;` for the CommonJS bundle (`output.exports: 'named'`). The
// footer re-exposes the function as `module.exports`, so a CommonJS config can call `require()` directly like any
// single-function Vite plugin, while keeping `.default` available: `require()` returns the plugin function,
// `require().default` works, and TypeScript/Babel `__importDefault` interop resolves to the function either way. Reassigning `module.exports` leaves the `exports` binding untouched, so every
// named export is copied back onto the function; the loop keeps that list from drifting away from src/index.ts.
const CJS_FOOTER = `module.exports = exports.default;
module.exports.default = module.exports;

for (const name of Object.keys(exports)) {
	if (name !== 'default') module.exports[name] = exports[name];
}

`;

// Declaration for the CommonJS entry, mirroring the runtime shape above: `export =` of a callable value carrying the
// named exports and the `.default` self-reference (`default` is a reserved word, so it can only be declared as an
// interface member), merged with a namespace so that `Options` stays reachable from a `require()` consumer
const CJS_DECLARATION = `import type { Plugin } from 'vite';
import type { Options as PluginOptions } from './types.cjs';
interface RemoveAttributesPlugin {
	(options: PluginOptions): Plugin;

	readonly default: RemoveAttributesPlugin;

	readonly JAVASCRIPT_EXTENSIONS: readonly string[];

	readonly TYPESCRIPT_EXTENSIONS: readonly string[];

	readonly JSX_EXTENSIONS: readonly string[];

	readonly SCRIPT_EXTENSIONS: readonly string[];

	readonly SVELTE_EXTENSIONS: readonly string[];

	readonly VUE_EXTENSIONS: readonly string[];

	readonly ASTRO_EXTENSIONS: readonly string[];

	readonly HTML_EXTENSIONS: readonly string[];

	readonly DEFAULT_EXTENSIONS: readonly string[];
}

declare const removeAttributesPlugin: RemoveAttributesPlugin;
declare namespace removeAttributesPlugin {
	export type Options = PluginOptions;
}

export = removeAttributesPlugin;
`;

const CONFIGURATION = defineConfig({
	plugins: [
		// Emits `dist/*.d.ts` from `src/` using tsconfig.json (the plugin forces `declaration`/`emitDeclarationOnly`
		// regardless of `noEmit`). Hand-written `.d.ts` files and tests are excluded so they never shadow the generated
		// declarations.
		dts({
			tsconfigPath: './tsconfig.json',
			include: ['src'],
			exclude: ['src/**/*.d.ts', '**/*.{test,spec,test-d}.ts'],
			// `.d.ts` for the ESM entry and `.d.cts` for the CommonJS entry, so `require()` consumers resolve types too
			outDirs: [{ dir: 'dist' }, { dir: 'dist', moduleFormat: 'cjs' }],
			beforeWriteFile: (filePath, content) => {
				if (filePath.replaceAll('\\', '/').endsWith('/index.d.cts')) {
					return { content: CJS_DECLARATION };
				}

				// TypeScript emits extensionless relative specifiers, both in import statements (`from './types'`) and in
				// inline type references (`import('./types')`). Node16 resolution requires explicit extensions, so use
				// `.js` in `.d.ts` files and `.cjs` in `.d.cts` files (TypeScript maps them back to `.d.ts` / `.d.cts`).
				// Any existing `.js`/`.cjs` is replaced, so the hook is idempotent when the plugin derives the `.d.cts`
				// content from an already-rewritten `.d.ts`.
				const EXTENSION = filePath.endsWith('.d.cts') ? '.cjs' : '.js';

				const RELATIVE_IMPORT_WITH_EXTENSION_REGEX = /((?:from\s+|import\(\s*)['"]\.\.?\/[^'"]+)\.c?js(['"])/g;
				const RELATIVE_IMPORT_REGEX = /((?:from\s+|import\(\s*)['"]\.\.?\/[^'"]+)(['"])/g;

				return {
					content: content
						.replace(RELATIVE_IMPORT_WITH_EXTENSION_REGEX, '$1$2')
						.replace(RELATIVE_IMPORT_REGEX, `$1${EXTENSION}$2`),
				};
			},
		}),
	],

	build: {
		// Same as tsconfig.json — the plugin runs inside the Vite (Node >= 18) process, not in a browser. ES2022 is the
		// newest target Node 18 runs without transpilation, which is what `engines.node` promises
		target: 'es2022',
		lib: {
			entry: './src/index.ts',
			formats: ['es', 'cjs'],
			fileName: 'index',
		},
		rolldownOptions: {
			// Never bundle the peer dependency or Node built-ins into the library
			external: ['vite', /^node:/],
			treeshake: true,
			output: {
				// Emit `exports.default = …` in the CJS bundle so it matches the `export default` in the declarations.
				// Rollup's auto mode would emit `module.exports = …`, which makes TypeScript in node16 mode mis-type `require()`.
				exports: 'named',
				footer: (chunk) => (chunk.fileName.endsWith('.cjs') ? CJS_FOOTER : ''),
				// The JSDoc already ships in the declarations; `@__PURE__` annotations stay for the consumer's tree-shaking
				comments: { legal: true, annotation: true, jsdoc: false },
			},
		},
		// The output is unminified, so a map adds size without improving a consumer's stack traces
		sourcemap: false,
		// Consumers bundle this plugin themselves; readable output is more useful than a few saved bytes
		minify: false,
	},

	test: {
		environment: 'node',
		globals: true,
		expect: { requireAssertions: true },
		reporters: ['verbose'],
		silent: false,
		exclude: [
			...configDefaults.exclude,
			'node_modules/',
			'dist/',
			'*.{idea,git,cache,output,temp,tmp,backup,bak,local,local-backup}*/',
		],
		// `unit` covers the fast, always-on suite (source unit tests, framework fixtures, packaging, property tests,
		// and type-level tests); `performance` holds the linear-time checks, kept out of the coverage run whose
		// instrumentation skews their timings; `integration` is the real `vite.build()` suite kept separate because it
		// is slow and needs the framework devDependencies installed
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['src/**/*.{test,spec}.ts', 'tests/{frameworks,packaging,property}/**/*.{test,spec}.ts'],
					typecheck: {
						enabled: true,
						include: ['src/**/*.test-d.ts'],
						tsconfig: './tsconfig.json',
					},
				},
			},
			{
				extends: true,
				test: {
					name: 'performance',
					include: ['tests/performance/**/*.{test,spec}.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.{test,spec}.ts'],
					testTimeout: 120_000,
					hookTimeout: 120_000,
					fileParallelism: false,
				},
			},
		],
		coverage: {
			// `pnpm test:coverage` turns it on with `--coverage`; a plain run, whole or filtered to one file, skips it,
			// so that the 100 % thresholds only judge a run that covers the whole suite
			enabled: false,
			provider: 'v8',
			// CI only needs the plain-text summary in logs; local runs keep json + html for browsing
			reporter: IS_CI ? ['text'] : ['text', 'json', ['html', { subdir: 'html' }]],
			reportOnFailure: true,
			reportsDirectory: './test-results-vitest',
			include: ['src/**/*.ts'],
			// Lines, functions, branches and statements must all stay fully covered
			thresholds: { 100: true },
			exclude: [
				...coverageConfigDefaults.exclude,
				'src/**/*.d.ts',
				'src/**/*.test-d.ts',
				'dist/',
				'*.{idea,git,cache,output,temp,tmp,backup,bak,local,local-backup}*/',
			],
		},
	},
});

export default CONFIGURATION;
