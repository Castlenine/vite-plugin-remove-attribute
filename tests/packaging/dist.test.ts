import type { Plugin } from 'vite';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

import {
	ASTRO_EXTENSIONS,
	DEFAULT_EXTENSIONS,
	HTML_EXTENSIONS,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	SVELTE_EXTENSIONS,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} from '../../src/utilities';

const BUILD_TIMEOUT_IN_MS = 120_000;

// Every preset the package exports, paired with the reference values from `src/utilities.ts`. Declared once so
// the ESM and CJS assertions below check the exact same list instead of drifting apart.
const NAMED_PRESETS = {
	ASTRO_EXTENSIONS,
	DEFAULT_EXTENSIONS,
	HTML_EXTENSIONS,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	SVELTE_EXTENSIONS,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} as const;

const RELATIVE_IMPORT_SPECIFIER_REGEX = /(?:from\s+|import\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

/**
 * Collects every relative import specifier (`from './foo'` or `import('./foo')`) found in a declaration file's content.
 *
 * @param content - The `.d.ts` or `.d.cts` file content to scan.
 *
 * @returns The relative specifiers found, in file order.
 */
function collectRelativeImportSpecifiers(content: string): string[] {
	return [...content.matchAll(RELATIVE_IMPORT_SPECIFIER_REGEX)].map((match) => match[1] ?? '');
}

describe('dist/ shape', () => {
	// `dist` is hard-coded in vite.config.ts's `dts({ outDirs: [...] })`, independent of `build.outDir` — so the
	// JS bundle is built into a disposable temp directory, but the declaration files vite-plugin-dts
	// emits always land in the repository's real `dist/` regardless of where the bundle went. This test never
	// deletes `dist/` afterward: it is the project's own build artifact, not test scratch space.
	let outDir = '';
	const DIST_DIRECTORY = join(import.meta.dirname, '..', '..', 'dist');

	beforeAll(async () => {
		outDir = await mkdtemp(join(tmpdir(), 'vite-plugin-remove-attribute-dist-'));

		await build({
			configFile: join(import.meta.dirname, '..', '..', 'vite.config.ts'),
			logLevel: 'silent',
			build: { outDir, emptyOutDir: true },
		});
	}, BUILD_TIMEOUT_IN_MS);

	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it('exports a working ESM entry with every frozen preset', async () => {
		const MODULE = (await import(pathToFileURL(join(outDir, 'index.js')).href)) as Record<string, unknown> & {
			default: (options: { attributes: string[] }) => Plugin;
		};

		expect(typeof MODULE.default).toBe('function');

		for (const [name, value] of Object.entries(NAMED_PRESETS)) {
			expect(MODULE[name]).toStrictEqual(value);
			expect(Object.isFrozen(MODULE[name])).toBe(true);
		}

		const PLUGIN = MODULE.default({ attributes: ['data-testid'] });

		expect(PLUGIN.name).toBe('remove-attributes');
		expect(PLUGIN.enforce).toBe('pre');

		const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => { code: string } | null;
		const RESULT = TRANSFORM.call(undefined, '<div data-testid="a" class="b"></div>', '/x/App.svelte');

		expect(RESULT?.code).toBe('<div class="b"></div>');
	});

	it('exports a working CJS entry mirroring the ESM named exports', () => {
		const REQUIRE_FROM_TEST = createRequire(import.meta.url);
		const MODULE = REQUIRE_FROM_TEST(join(outDir, 'index.cjs')) as Record<string, unknown> & {
			default: (options: { attributes: string[] }) => Plugin;
			(options: { attributes: string[] }): Plugin;
		};

		expect(typeof MODULE).toBe('function');
		expect(MODULE.default).toBe(MODULE);

		for (const [name, value] of Object.entries(NAMED_PRESETS)) {
			expect(MODULE[name]).toStrictEqual(value);
		}

		const PLUGIN = MODULE({ attributes: ['data-testid'] });

		expect(PLUGIN.name).toBe('remove-attributes');
		expect(PLUGIN.enforce).toBe('pre');

		const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => { code: string } | null;
		const RESULT = TRANSFORM.call(undefined, '<div data-testid="a" class="b"></div>', '/x/App.svelte');

		expect(RESULT?.code).toBe('<div class="b"></div>');
	});

	it('emits only the two bundle formats, without sourcemaps', async () => {
		// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a mkdtemp directory, not from input
		expect((await readdir(outDir)).sort()).toStrictEqual(['index.cjs', 'index.js']);
	});

	it('drops JSDoc from the bundles while keeping it in the declarations', async () => {
		// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from a mkdtemp directory, not from input
		const ESM_BUNDLE = await readFile(join(outDir, 'index.js'), 'utf8');
		const ESM_DECLARATION = await readFile(join(DIST_DIRECTORY, 'index.d.ts'), 'utf8');

		expect(ESM_BUNDLE).not.toContain('@param');
		expect(ESM_DECLARATION).toContain('@param options');
	});

	it('emits an ESM declaration exporting the default plugin, Options, and every preset', async () => {
		const CONTENT = await readFile(join(DIST_DIRECTORY, 'index.d.ts'), 'utf8');

		expect(CONTENT).toContain('export default removeAttributesPlugin;');
		expect(CONTENT).toContain('export type { Options }');

		for (const name of Object.keys(NAMED_PRESETS)) {
			expect(CONTENT).toContain(name);
		}

		const RELATIVE_SPECIFIERS = collectRelativeImportSpecifiers(CONTENT);

		expect(RELATIVE_SPECIFIERS.length).toBeGreaterThan(0);
		expect(RELATIVE_SPECIFIERS.every((specifier) => specifier.endsWith('.js'))).toBe(true);
	});

	it('emits the CJS declaration using the export = namespace-merge shape', async () => {
		const CONTENT = await readFile(join(DIST_DIRECTORY, 'index.d.cts'), 'utf8');

		expect(CONTENT).toContain('export = removeAttributesPlugin;');
		expect(CONTENT).toContain('readonly default: RemoveAttributesPlugin;');
		expect(CONTENT).toContain('declare namespace removeAttributesPlugin');
		expect(CONTENT).toContain('export type Options = PluginOptions;');
		expect(CONTENT).toMatch(/from\s+['"]\.\/types\.cjs['"]/);

		const RELATIVE_SPECIFIERS = collectRelativeImportSpecifiers(CONTENT);

		expect(RELATIVE_SPECIFIERS.length).toBeGreaterThan(0);
		expect(RELATIVE_SPECIFIERS.every((specifier) => specifier.endsWith('.cjs'))).toBe(true);
	});

	it('rewrites relative imports in the other declaration files with the format-matching extension', async () => {
		const TYPES_DECLARATION = await readFile(join(DIST_DIRECTORY, 'types.d.ts'), 'utf8');
		const UTILITIES_DECLARATION = await readFile(join(DIST_DIRECTORY, 'utilities.d.ts'), 'utf8');

		for (const content of [TYPES_DECLARATION, UTILITIES_DECLARATION]) {
			const RELATIVE_SPECIFIERS = collectRelativeImportSpecifiers(content);

			expect(RELATIVE_SPECIFIERS.every((specifier) => specifier.endsWith('.js'))).toBe(true);
		}
	});
});
