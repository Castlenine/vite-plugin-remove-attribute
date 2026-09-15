import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

const IS_CI = process.env.CI === 'true';

// Rolldown emits `exports.default = removeAttributesPlugin;` for the CommonJS bundle (`output.exports: 'named'`). The
// footer re-exposes the function as `module.exports`, as the 1.0.x UMD build did, while keeping `.default` available:
// `require()` returns the plugin function, `require().default` works, and TypeScript/Babel `__importDefault` interop
// resolves to the function either way.
const CJS_FOOTER = `module.exports = exports.default;
module.exports.default = module.exports;
`;

// Declaration for the CommonJS entry, mirroring the runtime shape above (`export =` plus a namespace merge so that
// `Options` stays importable from a `require()` consumer)
const CJS_DECLARATION = `import type { Plugin } from 'vite';
import type { Options as PluginOptions } from './types.cjs';
declare function removeAttributesPlugin(options: PluginOptions): Plugin;
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
			exclude: ['src/**/*.d.ts', '**/*.{test,spec}.ts'],
			// `.d.ts` for the ESM entry and `.d.cts` for the CommonJS entry, so `require()` consumers resolve types too
			outDirs: [{ dir: 'dist' }, { dir: 'dist', moduleFormat: 'cjs' }],
			beforeWriteFile: (filePath, content) => {
				if (filePath.replaceAll('\\', '/').endsWith('/index.d.cts')) {
					return { content: CJS_DECLARATION };
				}

				// TypeScript emits extensionless relative imports (`from './types'`). Node16 resolution requires explicit
				// extensions, so use `.js` in `.d.ts` files and `.cjs` in `.d.cts` files (TypeScript maps them back to
				// `.d.ts` / `.d.cts`). Any existing `.js`/`.cjs` is replaced, so the hook is idempotent when the plugin
				// derives the `.d.cts` content from an already-rewritten `.d.ts`.
				const EXTENSION = filePath.endsWith('.d.cts') ? '.cjs' : '.js';

				const RELATIVE_IMPORT_WITH_EXTENSION_REGEX = /(from\s+['"]\.\.?\/[^'"]+)\.c?js(['"])/g;
				const RELATIVE_IMPORT_REGEX = /(from\s+['"]\.\.?\/[^'"]+)(['"])/g;

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
		rollupOptions: {
			// Never bundle the peer dependency or Node built-ins into the library
			external: ['vite', /^node:/],
			treeshake: true,
			output: {
				// Emit `exports.default = …` in the CJS bundle so it matches the `export default` in the declarations.
				// Rollup's auto mode would emit `module.exports = …`, which makes TypeScript in node16 mode mis-type `require()`.
				exports: 'named',
				footer: (chunk) => (chunk.fileName.endsWith('.cjs') ? CJS_FOOTER : ''),
			},
		},
		sourcemap: true,
		// Consumers bundle this plugin themselves; readable output is more useful than a few saved bytes
		minify: false,
	},

	test: {
		environment: 'node',
		globals: true,
		expect: { requireAssertions: true },
		reporters: ['verbose'],
		silent: false,
		include: ['src/**/*.{test,spec}.ts', '*.{test,spec}.ts'],
		exclude: [
			...configDefaults.exclude,
			'node_modules/',
			'dist/',
			'*.{idea,git,cache,output,temp,tmp,backup,bak,local,local-backup}*/',
		],
		coverage: {
			enabled: !IS_CI,
			provider: 'v8',
			reporter: ['text', 'json', ['html', { subdir: 'html' }]],
			reportOnFailure: true,
			reportsDirectory: './test-results-vitest',
			include: ['src/**/*.ts'],
			exclude: [
				...coverageConfigDefaults.exclude,
				'src/**/*.d.ts',
				'dist/',
				'*.{idea,git,cache,output,temp,tmp,backup,bak,local,local-backup}*/',
			],
		},
	},
});

export default CONFIGURATION;
