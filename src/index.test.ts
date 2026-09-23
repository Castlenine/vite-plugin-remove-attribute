import type { Logger, Plugin, ResolvedConfig } from 'vite';
import type { Options } from './types';
import type { SourceMap } from './sourcemap';

import { TraceMap, originalPositionFor as traceOriginalPositionFor } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import { parseSync } from 'vite';

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

interface Warning {
	message: string;
	position: number | undefined;
}

interface Harness {
	plugin: Plugin;
	/**
	 * Calls the hook the way anything but the bundler does: with no plugin context at all
	 */
	transform: (code: string, id: string) => TransformResult;
	/**
	 * Calls the hook with a plugin context collecting into `warnings`, the way the bundler does
	 */
	transformWithContext: (code: string, id: string) => TransformResult;
	warnings: Warning[];
	/**
	 * The messages the plugin wrote to the logger of the resolved configuration
	 */
	logs: string[];
}

/**
 * Creates a test harness for the removeAttributesPlugin.
 *
 * @param options - Plugin options to configure attribute removal.
 * @param root - The root directory to use for the Vite config.
 *
 * @returns An object holding the initialized plugin, both transform entry points and the warnings collected.
 */
function createHarness(options: Options, root: string): Harness {
	const PLUGIN = removeAttributesPlugin(options);
	const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
	const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => TransformResult;
	const WARNINGS: Warning[] = [];
	const LOGS: string[] = [];
	const CONTEXT = {
		warn: (message: string, position?: number) => {
			WARNINGS.push({ message, position });
		},
	};

	CONFIG_RESOLVED({ root, logger: createLogger(LOGS) } as ResolvedConfig);

	return {
		plugin: PLUGIN,
		transform: (code, id) => TRANSFORM(code, id),
		transformWithContext: (code, id) => TRANSFORM.call(CONTEXT, code, id),
		warnings: WARNINGS,
		logs: LOGS,
	};
}

/**
 * Creates the part of a Vite logger the plugin writes to, collecting every warning.
 *
 * @param logs - The array each warning message is pushed to.
 *
 * @returns The logger to hand to `configResolved`.
 */
function createLogger(logs: string[]): Pick<Logger, 'warn'> {
	return {
		warn: (message) => {
			logs.push(message);
		},
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

	it('transforms a source file whose folder only shares a name with a root-anchored default', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/routes/public/+page.svelte'), '<div />');
		expectTransformed(transform('<div data-testid="a" />', '/repo/src/lib/build/Step.svelte'), '<div />');
		expectTransformed(transform('<div data-testid="a" />', '/repo/src/e2e/Foo.svelte'), '<div />');
	});

	it('skips a dependency resolved outside the root', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div data-testid="a" />', '/node_modules/x/App.svelte')).toBeNull();
		expect(transform('<div data-testid="a" />', '/repo/packages/a/node_modules/x/App.svelte')).toBeNull();
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

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.svelte?t=1700000000000'), '<div />');
	});

	it('returns null when nothing changed', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div class="x" />', '/repo/src/App.svelte')).toBeNull();
	});

	it('removes an unquoted value and maps the rest of the line', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expectTransformed(transform('<div data-testid=alpha class="x" />', '/repo/src/App.svelte'), '<div class="x" />');
	});

	it('returns null without a usable attribute name', () => {
		const BLANK_ATTRIBUTES: Options = { extensions: ['svelte'], attributes: ['', '   '] };
		const INVALID_ATTRIBUTES: Options = {
			extensions: ['svelte'],
			attributes: [42 as unknown as string, null as unknown as string],
		};

		expect(
			createHarness(BLANK_ATTRIBUTES, '/repo').transform('<div data-testid="a" />', '/repo/src/App.svelte'),
		).toBeNull();
		expect(
			createHarness(INVALID_ATTRIBUTES, '/repo').transform('<div data-testid="a" />', '/repo/src/App.svelte'),
		).toBeNull();
		expect(
			createHarness({ attributes: [] }, '/repo').transform('<div data-testid="a" />', '/repo/src/App.svelte'),
		).toBeNull();
	});

	it('trims the configured attribute names', () => {
		const { transform } = createHarness({ extensions: ['svelte'], attributes: [' data-testid '] }, '/repo');

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.svelte'), '<div />');
	});

	it('reads a quoted mustache as an expression in a Svelte file', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expectTransformed(
			transform('<div data-testid="{a ? "b" : "c"}" class="k" />', '/repo/src/App.svelte'),
			'<div class="k" />',
		);
	});

	it('reads a brace inside a quoted value as text outside a Svelte file', () => {
		const { transform } = createHarness({ extensions: ['jsx'], attributes: ['title'] }, '/repo');

		expectTransformed(
			transform('<div title="{" data-testid="x" other="}" />', '/repo/src/App.jsx'),
			'<div data-testid="x" other="}" />',
		);
	});

	it('names the module in the sourcemap', () => {
		const { transform } = createHarness(OPTIONS, '/repo');
		const RESULT = transform('<div\n\tdata-testid="a"\n\tclass="x" />', '/repo/src/App.svelte?svelte&type=script');

		expect(RESULT?.code).toBe('<div\n\tclass="x" />');
		expect(RESULT?.map.sources).toEqual(['/repo/src/App.svelte']);
		expect(RESULT?.map.mappings.split(';')).toHaveLength(2);
	});
});

describe('removeAttributesPlugin warnings', () => {
	const UNREADABLE = '<div data-testid={ oops>\n<p data-testid={ nope>\n<span data-testid="a" class="x">y</span>';

	it('warns once with the count and the position of the first attribute left in place', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');
		const RESULT = HARNESS.transformWithContext(UNREADABLE, '/repo/src/App.svelte');

		expect(RESULT?.code).toBe('<div data-testid={ oops>\n<p data-testid={ nope>\n<span class="x">y</span>');
		expect(HARNESS.warnings).toEqual([
			{
				message:
					'remove-attributes: left 2 attribute(s) in place in /repo/src/App.svelte — the value could not be parsed',
				position: 5,
			},
		]);
	});

	it('warns even when no attribute could be removed at all', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		expect(HARNESS.transformWithContext('<div data-testid={ oops>', '/repo/src/App.svelte')).toBeNull();
		expect(HARNESS.warnings).toHaveLength(1);
	});

	it('names the module without its query suffix', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		HARNESS.transformWithContext('<div data-testid={ oops>', '/repo/src/App.svelte?svelte&type=script');

		expect(HARNESS.warnings[0]?.message).toContain('in /repo/src/App.svelte —');
	});

	it('warns once about a module every environment transforms, and once about each other module', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		HARNESS.transformWithContext(UNREADABLE, '/repo/src/App.svelte');
		HARNESS.transformWithContext(UNREADABLE, '/repo/src/App.svelte');
		HARNESS.transformWithContext(UNREADABLE, '/repo/src/Other.svelte');

		expect(HARNESS.warnings.map((warning) => warning.message)).toEqual([
			'remove-attributes: left 2 attribute(s) in place in /repo/src/App.svelte — the value could not be parsed',
			'remove-attributes: left 2 attribute(s) in place in /repo/src/Other.svelte — the value could not be parsed',
		]);
	});

	it('stays silent when every attribute was removed', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		expectTransformed(HARNESS.transformWithContext('<div data-testid="a" />', '/repo/src/App.svelte'), '<div />');
		expect(HARNESS.warnings).toEqual([]);
	});

	it('stays silent for a skipped file and for a name that is no attribute', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		expect(HARNESS.transformWithContext(UNREADABLE, '/repo/public/App.svelte')).toBeNull();
		expect(HARNESS.transformWithContext('<div data-testid-extra="a">', '/repo/src/App.svelte')).toBeNull();
		expect(HARNESS.warnings).toEqual([]);
	});

	it('does not throw when the hook is called without a plugin context', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');

		expect(() => HARNESS.transform(UNREADABLE, '/repo/src/App.svelte')).not.toThrow();
		expect(HARNESS.warnings).toEqual([]);
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

describe('removeAttributesPlugin root resolution', () => {
	it('falls back to process.cwd() when configResolved was never called', () => {
		const PLUGIN = removeAttributesPlugin(OPTIONS);
		const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => TransformResult;
		const ID = `${process.cwd()}/src/App.svelte`;

		expectTransformed(TRANSFORM(`<div data-testid="a" />`, ID), '<div />');
	});

	it('resolves ignore tokens the same way with a trailing slash on the root', () => {
		const { transform } = createHarness(OPTIONS, '/repo/');

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.svelte'), '<div />');
		expect(transform('<div data-testid="a" />', '/repo/public/App.svelte')).toBeNull();
	});

	it("matches ignore tokens against the root of the hook's environment over the last configuration resolved", () => {
		const { plugin } = createHarness(OPTIONS, '/repo');
		const TRANSFORM = plugin.transform as (this: unknown, code: string, id: string) => TransformResult;
		const PUBLIC_ROOT_CONTEXT = { environment: { config: { root: '/repo/public' } } };
		const REPO_ROOT_CONTEXT = { environment: { config: {} } };

		expectTransformed(
			TRANSFORM.call(PUBLIC_ROOT_CONTEXT, '<div data-testid="a" />', '/repo/public/App.svelte'),
			'<div />',
		);
		expect(TRANSFORM.call(REPO_ROOT_CONTEXT, '<div data-testid="a" />', '/repo/public/App.svelte')).toBeNull();
	});
});

describe('removeAttributesPlugin extension and syntax detection casing', () => {
	it('matches an upper-cased extension and still reads a quoted mustache as an expression', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expectTransformed(
			transform('<div data-testid="{a ? "b" : "c"}" class="k" />', '/repo/src/App.SVELTE'),
			'<div class="k" />',
		);
	});

	it('matches a mixed-cased Vue extension and reads a quoted brace as literal text', () => {
		const { transform } = createHarness({ extensions: ['vue'], attributes: ['data-testid'] }, '/repo');

		expectTransformed(transform('<div data-testid="{a}" class="k" />', '/repo/src/App.Vue'), '<div class="k" />');
	});
});

describe('removeAttributesPlugin dev-server module ids', () => {
	it('skips a Svelte style block id, which holds CSS rather than markup', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/src/App.svelte?svelte&type=style')).toBeNull();
	});

	it('processes a Vue template block id as a scanned extension', () => {
		const { transform } = createHarness({ extensions: ['vue'], attributes: ['data-testid'] }, '/repo');

		expectTransformed(transform('<div data-testid="a" />', '/repo/src/App.vue?vue&type=template'), '<div />');
	});

	it('scans an html-proxy inline-script id as HTML, since the query is stripped before matching', () => {
		// Vite's `?html-proxy&index=0.js` ids extract an inline `<script>` block into its own module, and
		// `stripQuery` only cares about the id ending in `.html` — the id is still scanned
		const { transform } = createHarness({ extensions: ['html'], attributes: ['data-testid'] }, '/repo');

		expectTransformed(
			transform('<div data-testid="a"></div>', '/repo/index.html?html-proxy&index=0.js'),
			'<div></div>',
		);
	});
});

describe('removeAttributesPlugin transform without a usable warning context', () => {
	it('does not throw and records no warning when called with a plain object lacking warn', () => {
		const { plugin } = createHarness(OPTIONS, '/repo');
		const TRANSFORM = plugin.transform as (this: unknown, code: string, id: string) => TransformResult;

		expect(() => TRANSFORM.call({}, '<div data-testid={ oops>', '/repo/src/App.svelte')).not.toThrow();
	});

	it('does not throw when called with null as the context', () => {
		const { plugin } = createHarness(OPTIONS, '/repo');
		const TRANSFORM = plugin.transform as (this: unknown, code: string, id: string) => TransformResult;

		expect(() => TRANSFORM.call(null, '<div data-testid={ oops>', '/repo/src/App.svelte')).not.toThrow();
	});

	it('does not throw when called with undefined as the context', () => {
		const { plugin } = createHarness(OPTIONS, '/repo');
		const TRANSFORM = plugin.transform as (this: unknown, code: string, id: string) => TransformResult;

		expect(() => TRANSFORM.call(undefined, '<div data-testid={ oops>', '/repo/src/App.svelte')).not.toThrow();
	});
});

describe('removeAttributesPlugin warning position after a prior removal', () => {
	it('reports the position of the first skipped attribute in the original, unshifted source', () => {
		const HARNESS = createHarness(OPTIONS, '/repo');
		// The first occurrence is removable; the second is left in place because its expression never closes.
		// The warning position must point at the second occurrence's name-start index in the *original* code,
		// unaffected by the first removal shifting everything after it
		const CODE = '<div data-testid="a" />\n<span data-testid={ oops>';
		const NAME_START_INDEX = CODE.indexOf('data-testid', CODE.indexOf('\n'));

		const RESULT = HARNESS.transformWithContext(CODE, '/repo/src/App.svelte');

		expect(RESULT?.code).toBe('<div />\n<span data-testid={ oops>');
		expect(HARNESS.warnings).toEqual([
			{
				message:
					'remove-attributes: left 1 attribute(s) in place in /repo/src/App.svelte — the value could not be parsed',
				position: NAME_START_INDEX,
			},
		]);
	});
});

describe('removeAttributesPlugin sourcemap contents', () => {
	it('names the query-stripped id as the single sources entry', () => {
		const { transform } = createHarness(OPTIONS, '/repo');
		const RESULT = transform('<div data-testid="a" />', '/repo/src/App.svelte?svelte&type=script&lang.ts');

		expect(RESULT?.map.sources).toEqual(['/repo/src/App.svelte']);
	});

	it('produces a map that a real sourcemap consumer can decode', () => {
		const { transform } = createHarness(OPTIONS, '/repo');
		const CODE = '<div\n\tdata-testid="a"\n\tclass="x" />';
		const RESULT = transform(CODE, '/repo/src/App.svelte');

		if (RESULT == null) {
			throw new Error('expected a transform result');
		}

		const ORIGINAL_POSITION = traceOriginalPositionFor(new TraceMap(RESULT.map), { line: 2, column: 1 });

		expect(ORIGINAL_POSITION).toMatchObject({ line: 3, column: 1 });
	});
});

describe('removeAttributesPlugin quoted placeholders', () => {
	const EVERY_EXTENSION: Options = {
		extensions: [...SCRIPT_EXTENSIONS, ...DEFAULT_EXTENSIONS],
		attributes: ['data-testid'],
	};

	const NESTED_QUOTE_VIEW = 'const view = html`<div data-testid="${ok ? "a" : "b"}" class="k"></div>`;';
	const ESCAPED_PLACEHOLDER = '<p data-testid="\\${" title="}"></p>';

	it.each([
		'/repo/src/el.ts',
		'/repo/src/el.mts',
		'/repo/src/el.cts',
		'/repo/src/el.js',
		'/repo/src/el.mjs',
		'/repo/src/el.cjs',
		'/repo/src/App.jsx',
		'/repo/src/App.tsx',
		'/repo/src/EL.TS',
		'/repo/src/my-element.ts?inline',
		'/repo/src/App.vue',
		'/repo/src/App.vue?vue&type=script&setup=true&lang.ts',
		'/repo/src/App.astro',
		'/repo/index.html',
		'/repo/index.htm',
		'/repo/index.html?html-proxy&index=0.js',
	])('reads a quoted placeholder as an expression in %s', (id) => {
		const { transform } = createHarness(EVERY_EXTENSION, '/repo');

		expectTransformed(transform(NESTED_QUOTE_VIEW, id), 'const view = html`<div class="k"></div>`;');
	});

	it('reads a quoted placeholder as an expression in a file of a configured custom extension', () => {
		const { transform } = createHarness({ extensions: ['md'], attributes: ['data-testid'] }, '/repo');

		expectTransformed(transform(NESTED_QUOTE_VIEW, '/repo/docs/page.md'), 'const view = html`<div class="k"></div>`;');
	});

	it.each(['/repo/src/App.tsx', '/repo/src/App.vue', '/repo/src/App.astro', '/repo/index.html'])(
		'reads a bare brace in a quoted value as text in %s',
		(id) => {
			const { transform } = createHarness(EVERY_EXTENSION, '/repo');

			expectTransformed(
				transform('<div data-testid="{ok ? "a" : "b"}" class="k" />', id),
				'<div a" : "b"}" class="k" />',
			);
		},
	);

	it.each(['/repo/src/App.tsx', '/repo/src/App.vue', '/repo/src/App.astro', '/repo/index.html'])(
		'skips the escaped `\\${` in %s, where a Svelte file reads it as a mustache',
		(id) => {
			const { transform } = createHarness(EVERY_EXTENSION, '/repo');

			expectTransformed(transform(ESCAPED_PLACEHOLDER, id), '<p title="}"></p>');
			expectTransformed(transform(ESCAPED_PLACEHOLDER, '/repo/src/App.svelte'), '<p></p>');
		},
	);

	it('skips the escaped `\\${` of a template literal in a TypeScript module', () => {
		const { transform } = createHarness(EVERY_EXTENSION, '/repo');

		expectTransformed(
			transform(`const view = html\`${ESCAPED_PLACEHOLDER}\`;`, '/repo/src/el.ts'),
			'const view = html`<p title="}"></p>`;',
		);
	});

	it.each(['/repo/src/App.svelte', '/repo/src/App.SVELTE'])(
		'reads a literal `$` before a mustache in %s rather than a placeholder',
		(id) => {
			// Only the mustache read applies: `\${` escapes nothing in Svelte, so the brace still opens an expression,
			// where a template literal reads the same characters as a literal `${` ending at the first inner quote
			const { transform } = createHarness(EVERY_EXTENSION, '/repo');
			const INPUT = '<p data-testid="\\${ok ? "a" : "b"}" class="k"></p>';

			expectTransformed(transform(INPUT, id), '<p class="k"></p>');
			expectTransformed(transform(INPUT, '/repo/src/App.tsx'), '<p a" : "b"}" class="k"></p>');
		},
	);

	it('warns at the position of a quoted placeholder the spent budget left in place', () => {
		// Each of the five placeholders opens a comment that never closes, so it is read as plain text and removed,
		// but its scan ran to the end of the module: together they spend the budget, and the well-formed value
		// after them cannot be measured
		const REMOVABLE_PREFIX = `${'<i data-testid="${a /*">\n'.repeat(5)}// ${'x'.repeat(2000)}\n`;
		const LEFT_IN_PLACE = '<p data-testid="${ok ? "a" : "b"}" class="k">';
		const HARNESS = createHarness(EVERY_EXTENSION, '/repo');
		const CODE = `${REMOVABLE_PREFIX}${LEFT_IN_PLACE}`;

		expectTransformed(
			HARNESS.transformWithContext(CODE, '/repo/index.html'),
			`${'<i>\n'.repeat(5)}// ${'x'.repeat(2000)}\n${LEFT_IN_PLACE}`,
		);
		expect(HARNESS.warnings).toEqual([
			{
				message: 'remove-attributes: left 1 attribute(s) in place in /repo/index.html — the value could not be parsed',
				position: REMOVABLE_PREFIX.length + '<p '.length,
			},
		]);
	});

	it('emits a Lit module that still parses', () => {
		const { transform } = createHarness(EVERY_EXTENSION, '/repo');
		const RESULT = transform(
			'const view = html`<div data-testid="${ok ? "a" : `b-${id}`}" class="k">${label}</div>`;',
			'/repo/src/my-element.ts',
		);

		expectTransformed(RESULT, 'const view = html`<div class="k">${label}</div>`;');
		expect(parseSync('my-element.ts', RESULT?.code ?? '').errors).toEqual([]);
	});

	it('maps a token after a multi-line placeholder removal back to its original position', () => {
		const { transform } = createHarness(EVERY_EXTENSION, '/repo');
		const RESULT = transform(
			'const view = html`<div\n\tdata-testid="${ok\n\t\t? "a"\n\t\t: "b"}"\n\tclass="k"\n></div>`;',
			'/repo/src/my-element.ts',
		);

		if (RESULT == null) {
			throw new Error('expected a transform result');
		}

		const TRACE = new TraceMap(RESULT.map);

		expect(RESULT.code).toBe('const view = html`<div\n\tclass="k"\n></div>`;');
		expect(traceOriginalPositionFor(TRACE, { line: 2, column: 1 })).toMatchObject({ line: 5, column: 1 });
		expect(traceOriginalPositionFor(TRACE, { line: 3, column: 0 })).toMatchObject({ line: 6, column: 0 });
	});
});

describe('removeAttributesPlugin removeInStrings', () => {
	const MODULE = 'el.innerHTML = \'<b data-testid="x" class="k">b</b>\';\nconst i = "<i data-testid=\'y\'></i>";';
	const MODULE_ID = '/repo/src/view.ts';

	/**
	 * Creates a harness processing TypeScript modules and Svelte components.
	 *
	 * @param removeInStrings - The value passed for the option, whatever its type.
	 *
	 * @returns The harness.
	 */
	function createStringHarness(removeInStrings: unknown): Harness {
		return createHarness(
			{
				extensions: [...TYPESCRIPT_EXTENSIONS, ...SVELTE_EXTENSIONS],
				attributes: ['data-testid'],
				removeInStrings: removeInStrings as boolean,
			},
			'/repo',
		);
	}

	it('leaves the markup of a string alone by default', () => {
		const { transform } = createHarness({ extensions: ['ts'], attributes: ['data-testid'] }, '/repo');

		expect(transform(MODULE, MODULE_ID)).toBeNull();
	});

	it('removes the attributes of the markup a string holds when on', () => {
		expectTransformed(
			createStringHarness(true).transform(MODULE, MODULE_ID),
			'el.innerHTML = \'<b class="k">b</b>\';\nconst i = "<i></i>";',
		);
	});

	it.each(['yes', 1, 'true', {}])('stays off for the non-boolean value %j', (value) => {
		expect(createStringHarness(value).transform(MODULE, MODULE_ID)).toBeNull();
	});

	it('maps the code after an attribute removed from a string back to its original position', () => {
		const RESULT = createStringHarness(true).transform(MODULE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('expected a transform result');
		}

		const TRACER = new TraceMap(RESULT.map);
		// Columns are 0-based and lines 1-based, as the sourcemap spec counts them
		const CLASS_POSITION = traceOriginalPositionFor(TRACER, {
			line: 1,
			column: RESULT.code.indexOf('class="k"'),
		});
		const SECOND_LINE = RESULT.code.split('\n')[1] ?? '';
		const CLOSER_POSITION = traceOriginalPositionFor(TRACER, { line: 2, column: SECOND_LINE.indexOf('></i>') });

		expect(CLASS_POSITION).toMatchObject({ line: 1, column: MODULE.indexOf('class="k"') });
		expect(CLOSER_POSITION).toMatchObject({ line: 2, column: "const i = \"<i data-testid='y'>".length - 1 });
	});

	it('warns about an attribute left in its string rather than removed past the closing quote', () => {
		const HARNESS = createStringHarness(true);
		const CODE = '<script>el.innerHTML = \'<p data-testid="{">\'; x = "}";</script>\n<b data-testid="b"></b>';
		const RESULT = HARNESS.transformWithContext(CODE, '/repo/src/App.svelte');

		expect(RESULT?.code).toBe('<script>el.innerHTML = \'<p data-testid="{">\'; x = "}";</script>\n<b></b>');
		expect(HARNESS.warnings).toEqual([
			{
				message:
					'remove-attributes: left 1 attribute(s) in place in /repo/src/App.svelte — the value could not be parsed',
				position: "<script>el.innerHTML = '<p ".length,
			},
		]);
	});
});

describe('removeAttributesPlugin edge-case inputs', () => {
	it('returns null for an empty file', () => {
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('', '/repo/src/App.svelte')).toBeNull();
	});

	it('returns null when the attribute sits at the very start of the file', () => {
		// An attribute with nothing separating it from the start of the file is never recognized as standalone
		const { transform } = createHarness(OPTIONS, '/repo');

		expect(transform('data-testid="a"', '/repo/src/App.svelte')).toBeNull();
	});

	it('returns null for a mismatched extension even when there is nothing to remove', () => {
		const { transform } = createHarness({ attributes: [] }, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/src/App.xyz')).toBeNull();
	});
});

describe('removeAttributesPlugin empty-list warnings', () => {
	it('names every rejected attribute entry, non-strings by their type', () => {
		const { logs } = createHarness({ extensions: ['svelte'], attributes: ['', ' ', 42, Object.create(null)] }, '/repo');

		expect(logs).toEqual([
			'[remove-attributes] the "attributes" option resolved to an empty list (no usable attribute name among "", " ", <number>, <object>), so the plugin will not remove anything',
		]);
	});

	it('warns without a detail when no attribute was given at all', () => {
		expect(createHarness({ extensions: ['svelte'], attributes: [] }, '/repo').logs).toEqual([
			'[remove-attributes] the "attributes" option resolved to an empty list, so the plugin will not remove anything',
		]);
		expect(createHarness({ extensions: ['svelte'] } as unknown as Options, '/repo').logs).toEqual([
			'[remove-attributes] the "attributes" option resolved to an empty list, so the plugin will not remove anything',
		]);
	});

	it('names every rejected extension entry, including one made of dots only', () => {
		const { logs } = createHarness(
			{ extensions: ['.', ' ', null] as unknown as string[], attributes: ['data-testid'] },
			'/repo',
		);

		expect(logs).toEqual([
			'[remove-attributes] the "extensions" option resolved to an empty list (no usable extension among ".", " ", <object>), so the plugin will not process any file',
		]);
	});

	it('warns about both lists, once per plugin instance however often the configuration resolves', () => {
		const { plugin, logs } = createHarness({ extensions: [], attributes: [] }, '/repo');
		const CONFIG_RESOLVED = plugin.configResolved as (config: ResolvedConfig) => void;

		CONFIG_RESOLVED({ root: '/repo', logger: createLogger(logs) } as ResolvedConfig);

		expect(logs).toEqual([
			'[remove-attributes] the "attributes" option resolved to an empty list, so the plugin will not remove anything',
			'[remove-attributes] the "extensions" option resolved to an empty list, so the plugin will not process any file',
		]);
	});

	it('stays silent when both lists keep a usable entry, or when extensions fall back to the defaults', () => {
		expect(createHarness({ extensions: ['.svelte', ''], attributes: ['data-testid', ''] }, '/repo').logs).toEqual([]);
		expect(createHarness({ attributes: ['data-testid'] }, '/repo').logs).toEqual([]);
	});
});

describe('removeAttributesPlugin sourcemap generation', () => {
	const CODE = '<div data-testid="a" />';
	const ID = '/repo/src/App.svelte';

	/**
	 * Resolves the plugin against a configuration and runs its transform under an optional plugin context.
	 *
	 * @param options.config - The part of the resolved configuration the sourcemap decision reads.
	 * @param options.context - The `this` value of the transform, carrying the Vite 6+ environment.
	 *
	 * @returns The transform result, whose map is `null` when the build wants none.
	 */
	function transformUnder(options: {
		config: Partial<Pick<ResolvedConfig, 'command'>> & { build?: { sourcemap?: unknown } };
		context?: unknown;
	}): null | { code: string; map: SourceMap | null } {
		const PLUGIN = removeAttributesPlugin(OPTIONS);
		const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
		const TRANSFORM = PLUGIN.transform as (
			this: unknown,
			code: string,
			id: string,
		) => null | { code: string; map: SourceMap | null };

		CONFIG_RESOLVED({ root: '/repo', logger: createLogger([]), ...options.config } as ResolvedConfig);

		return TRANSFORM.call(options.context, CODE, ID);
	}

	it('skips the map of a build whose sourcemap setting is off', () => {
		expect(transformUnder({ config: { command: 'build', build: { sourcemap: false } } })).toEqual({
			code: '<div />',
			map: null,
		});
	});

	it.each([true, 'inline', 'hidden'])('generates the map of a build whose sourcemap setting is %j', (sourcemap) => {
		expect(transformUnder({ config: { command: 'build', build: { sourcemap } } })?.map).toMatchObject({
			sources: [ID],
		});
	});

	it('always generates the map on the dev server, whatever the build setting', () => {
		expect(transformUnder({ config: { command: 'serve', build: { sourcemap: false } } })?.map).toMatchObject({
			sources: [ID],
		});
	});

	it('lets the setting of the Vite 6+ environment win over the top-level one', () => {
		const ENVIRONMENT_OFF = { environment: { config: { command: 'build', build: { sourcemap: false } } } };
		const ENVIRONMENT_ON = { environment: { config: { command: 'build', build: { sourcemap: true } } } };

		expect(
			transformUnder({ config: { command: 'build', build: { sourcemap: true } }, context: ENVIRONMENT_OFF })?.map,
		).toBeNull();
		expect(
			transformUnder({ config: { command: 'build', build: { sourcemap: false } }, context: ENVIRONMENT_ON })?.map,
		).toMatchObject({ sources: [ID] });
	});

	it('generates the map when no configuration says otherwise', () => {
		expect(transformUnder({ config: {} })?.map).toMatchObject({ sources: [ID] });
		expect(transformUnder({ config: { command: 'build' } })?.map).toMatchObject({ sources: [ID] });
	});
});

describe('removeAttributesPlugin module id suffixes', () => {
	it('processes an id carrying a #hash suffix and names the file without it', () => {
		const { transform } = createHarness(OPTIONS, '/repo');
		const RESULT = transform('<div data-testid="a" />', '/repo/src/App.svelte#frag');

		expectTransformed(RESULT, '<div />');
		expect(RESULT?.map.sources).toEqual(['/repo/src/App.svelte']);
	});

	it('names the html-proxy id, with the script it holds as sourcesContent, in the map of an inline script', () => {
		const { transform } = createHarness({ extensions: ['html'], attributes: ['data-testid'] }, '/repo');
		const CODE = 'const markup = `<b data-testid="a"></b>`;';
		const RESULT = transform(CODE, '/repo/index.html?html-proxy&index=0.js');

		expect(RESULT?.code).toBe('const markup = `<b></b>`;');
		expect(RESULT?.map.sources).toEqual(['/repo/index.html?html-proxy&index=0.js']);
		expect(RESULT?.map.sourcesContent).toEqual([CODE]);
	});

	it.each([
		['/repo/src/App.vue?vue&type=style&index=0&lang.css', 'vue'],
		['/repo/src/App.svelte?svelte&type=style&lang.css', 'svelte'],
		['/repo/index.html?html-proxy&inline-css&index=0.css', 'html'],
	])('leaves the CSS sub-request %s untouched', (id, extension) => {
		const { transform } = createHarness({ extensions: [extension], attributes: ['data-testid'] }, '/repo');

		expect(transform('.a::after { content: \' data-testid="x"\'; }', id)).toBeNull();
	});
});

describe('removeAttributesPlugin ignore token normalization', () => {
	it('skips a folder written with Windows separators', () => {
		const { transform } = createHarness({ ...OPTIONS, ignoreFolders: ['src\\tests'] }, '/repo');

		expect(transform('<div data-testid="a" />', '/repo/src/tests/A.svelte')).toBeNull();
	});

	it('skips a folder outside the root written with a leading ../', () => {
		const { transform } = createHarness({ ...OPTIONS, ignoreFolders: ['../shared'] }, '/repo/app');

		expect(transform('<div data-testid="a" />', '/repo/shared/A.svelte')).toBeNull();
	});
});
