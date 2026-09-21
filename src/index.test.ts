import type { Options } from './types';
import type { Plugin, ResolvedConfig } from 'vite';
import type { SourceMap } from './sourcemap';

import { describe, expect, it } from 'vitest';

import removeAttributesPlugin, {
	ASTRO_EXTENSIONS,
	DEFAULT_EXTENSIONS,
	HTML_EXTENSIONS,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	SVELTE_EXTENSIONS,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} from './index';

const TEMPLATE_STRING_SCRIPT = 'const markup = `<div data-testid="a" />`;';

type TransformResult = null | { code: string; map: SourceMap };

interface Harness {
	plugin: Plugin;
	transform: (code: string, id: string) => TransformResult;
}

/**
 * Creates a test harness for the removeAttributesPlugin.
 *
 * @param options - Plugin options to configure attribute removal.
 * @param root - The root directory to use for the Vite config.
 *
 * @returns An object containing the initialized plugin and a transform function.
 */
function createHarness(options: Options, root: string): Harness {
	const PLUGIN = removeAttributesPlugin(options);
	const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
	const TRANSFORM = PLUGIN.transform as (code: string, id: string) => TransformResult;

	CONFIG_RESOLVED({ root } as ResolvedConfig);

	return {
		plugin: PLUGIN,
		transform: (code, id) => TRANSFORM(code, id),
	};
}

/**
 * Asserts that the result of a plugin transform matches the expected output code and carries a valid source map.
 *
 * @param result - The output of the transform, either `null` or an object containing the transformed code and source map.
 * @param code - The expected transformed code string.
 *
 * @throws If the transformed code does not match `code`, if no valid source map is present, or if the mappings are empty.
 */
function expectTransformed(result: TransformResult, code: string): void {
	expect(result?.code).toBe(code);
	expect(result?.map).toMatchObject({ version: 3 });
	expect(result?.map.mappings).not.toBe('');
}

const OPTIONS: Options = { extensions: ['svelte'], attributes: ['data-testid'] };

describe('removeAttributesPlugin', () => {
	it('exposes the plugin identity', () => {
		const { plugin } = createHarness(OPTIONS, '/repo');

		expect(plugin.name).toBe('remove-attributes');
		expect(plugin.enforce).toBe('pre');
	});

	it('transforms a file whose absolute path contains an ignore token outside the root', () => {
		const { transform } = createHarness(OPTIONS, '/opt/buildhome/repo');

		expectTransformed(transform('<div data-testid={id} />', '/opt/buildhome/repo/src/App.svelte'), '<div />');
	});

	it('skips files under a default ignored folder', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/public/App.svelte')).toBeNull();
	});

	it('transforms files under a default ignored folder when ignoreDefaults is false', () => {
		const { transform } = createHarness({ ...OPTIONS, ignoreDefaults: false }, '/repo');

		expectTransformed(transform('<div data-testid="a" />', '/repo/public/App.svelte'), '<div />');
	});

	it('skips configured folders and files', () => {
		const { transform } = createHarness(
			{ ...OPTIONS, ignoreFolders: ['src/tests'], ignoreFiles: ['Header.svelte'] },
			'/repo',
		);

		expect(transform('<div data-testid="a" />', '/repo/src/tests/App.svelte')).toBeNull();
		expect(transform('<div data-testid="a" />', '/repo/src/layouts/Header.svelte')).toBeNull();
		expectTransformed(transform('<div data-testid="a" />', '/repo/src/layouts/Footer.svelte'), '<div />');
	});

	it('skips non-matching extensions and virtual modules', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/src/App.vue')).toBeNull();
		expect(transform('<div data-testid="a" />', '\0virtual:module.svelte')).toBeNull();
	});

	it('ignores the query suffix of the id', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expectTransformed(
			transform('<div data-testid="a" />', '/repo/src/App.svelte?svelte&type=style&lang.css'),
			'<div />',
		);
	});

	it('returns null when nothing changed', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div class="x" />', '/repo/src/App.svelte')).toBeNull();
	});

	it('names the module in the sourcemap', () => {
		const { transform } = createHarness(OPTIONS, '/repo');
		const RESULT = transform('<div\n\tdata-testid="a"\n\tclass="x" />', '/repo/src/App.svelte?svelte&type=script');

		expect(RESULT?.code).toBe('<div\n\tclass="x" />');
		expect(RESULT?.map.sources).toEqual(['/repo/src/App.svelte']);
		expect(RESULT?.map.mappings.split(';')).toHaveLength(2);
	});
});

describe('removeAttributesPlugin extension presets', () => {
	it('processes a default-listed file when extensions is omitted', () => {
		const { transform } = createHarness({ attributes: ['data-testid'] }, '/repo');

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.svelte'), '<div />');
	});

	it('skips a file outside a narrowed preset list', () => {
		const { transform } = createHarness({ extensions: [...JSX_EXTENSIONS], attributes: ['data-testid'] }, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/src/App.svelte')).toBeNull();
	});

	it('processes a custom extension appended to the default preset list', () => {
		const { transform } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, 'svx'], attributes: ['data-testid'] },
			'/repo',
		);

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.svx'), '<div />');
	});

	it('exposes every extension preset as a named export', () => {
		expect(JAVASCRIPT_EXTENSIONS).toEqual(['js', 'mjs', 'cjs']);
		expect(TYPESCRIPT_EXTENSIONS).toEqual(['ts', 'mts', 'cts']);
		expect(JSX_EXTENSIONS).toEqual(['jsx', 'tsx']);
		expect(SCRIPT_EXTENSIONS).toEqual([...JAVASCRIPT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS, ...JSX_EXTENSIONS]);
		expect(SVELTE_EXTENSIONS).toEqual(['svelte']);
		expect(VUE_EXTENSIONS).toEqual(['vue']);
		expect(ASTRO_EXTENSIONS).toEqual(['astro']);
		expect(HTML_EXTENSIONS).toEqual(['html', 'htm']);
		expect(DEFAULT_EXTENSIONS).toEqual([
			...JSX_EXTENSIONS,
			...SVELTE_EXTENSIONS,
			...VUE_EXTENSIONS,
			...ASTRO_EXTENSIONS,
			...HTML_EXTENSIONS,
		]);
	});

	it('skips a script file when extensions is omitted, since scripts are opt-in', () => {
		const { transform } = createHarness({ attributes: ['data-testid'] }, '/repo');

		expect(transform(TEMPLATE_STRING_SCRIPT, '/repo/src/App.ts')).toBeNull();
	});

	it('transforms a script file once the script presets are added to the default list', () => {
		const { transform } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid'] },
			'/repo',
		);

		expectTransformed(transform(TEMPLATE_STRING_SCRIPT, '/repo/src/App.ts'), 'const markup = `<div />`;');
	});
});
