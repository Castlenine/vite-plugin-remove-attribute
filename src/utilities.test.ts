import type { AttributeMatchResult, IgnoreMatcher, Range } from './utilities';
import type { Options } from './types';

import { describe, expect, it } from 'vitest';
import { parseSync } from 'vite';

import {
	ANY_DEPTH_DEFAULT_IGNORE_PATHS,
	assertRangeFollowsPrevious,
	ASTRO_EXTENSIONS,
	cleanExtensions,
	cleanIgnoredPaths,
	createAttributeMatcher,
	createExtensionMatcher,
	createIgnoreMatcher,
	DEFAULT_EXTENSIONS,
	DEFAULT_IGNORE_PATHS,
	findExpressionEnd,
	getOptions,
	HTML_EXTENSIONS,
	isStyleRequest,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	removeAttributes,
	removeRanges,
	ROOT_ANCHORED_DEFAULT_IGNORE_PATHS,
	SCRIPT_EXTENSIONS,
	stripQuery,
	SVELTE_EXTENSIONS,
	toRelativePath,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} from './utilities';

/**
 * Builds an ignore matcher from partial plugin options, defaulting the parts the ignore rules do not read.
 *
 * @param options - The ignore-related plugin options under test.
 *
 * @returns A matcher reporting whether a path relative to the Vite root is ignored.
 */
function createIgnoreMatcherFor(options: Partial<Options>): IgnoreMatcher {
	return createIgnoreMatcher(getOptions({ attributes: [], ...options }));
}

/**
 * Finds the ranges of the given attributes the way a non-Svelte file is scanned: a `{` inside a quoted value
 * is literal text.
 *
 * @param input - The markup to scan.
 * @param attributes - The attribute names to look for.
 *
 * @returns The ranges to remove.
 */
function findRanges(input: string, attributes: string[]): Range[] {
	return createAttributeMatcher(attributes)(input, { hasQuotedMustache: false }).ranges;
}

/**
 * Finds the name-start index of every attribute the matcher had to leave in place.
 *
 * @param input - The markup to scan.
 * @param attributes - The attribute names to look for.
 *
 * @returns The skipped indices.
 */
function findSkipped(input: string, attributes: string[]): number[] {
	return createAttributeMatcher(attributes)(input, { hasQuotedMustache: false }).skipped;
}

/**
 * Removes the given attributes the way a Svelte file is transformed: a `{` inside a quoted value opens an
 * expression.
 *
 * @param input - The markup to transform.
 * @param attributes - The attribute names to remove.
 *
 * @returns The markup without the attributes.
 */
function removeSvelteAttributes(input: string, attributes: string[]): string {
	const { ranges } = createAttributeMatcher(attributes)(input, { hasQuotedMustache: true });

	return removeRanges(input, ranges);
}

/**
 * Matches the given attributes the way every non-Svelte file is scanned: a `${…}` inside a quoted value opens
 * a tagged-template placeholder, while a bare `{` stays literal text.
 *
 * @param input - The markup to scan.
 * @param attributes - The attribute names to look for.
 *
 * @returns The ranges to remove and the attributes left in place.
 */
function matchPlaceholderAttributes(input: string, attributes: readonly string[]): AttributeMatchResult {
	return createAttributeMatcher(attributes)(input, { hasQuotedMustache: false, hasQuotedPlaceholder: true });
}

/**
 * Removes the given attributes the way every non-Svelte file is transformed.
 *
 * @param input - The markup to transform.
 * @param attributes - The attribute names to remove.
 *
 * @returns The markup without the attributes.
 */
function removePlaceholderAttributes(input: string, attributes: readonly string[]): string {
	return removeRanges(input, matchPlaceholderAttributes(input, attributes).ranges);
}

/**
 * Attribute names every quoted-placeholder case is matched against
 */
const PLACEHOLDER_ATTRIBUTES = ['data-testid', 'data-cy'] as const;

/**
 * Quoted values holding `${…}` placeholders, with the output a non-Svelte file must get (`expected`) and the
 * one the plain read keeps giving (`plainExpected`).
 *
 * @remarks
 * Where the plain read cuts the value at a quote inside the placeholder, `plainExpected` pins that cut: it is
 * what the flag exists to prevent, and what the one-shot `removeAttributes` helper still gets.
 */
const QUOTED_PLACEHOLDER_CASES = [
	{
		name: 'a placeholder nesting the double quote delimiting the value',
		input: 'html`<div data-testid="${ok ? "a" : "b"}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div a" : "b"}" class="k"></div>`',
	},
	{
		name: 'a placeholder nesting the single quote delimiting the value',
		input: "html`<div data-testid='${ok ? 'a' : 'b'}' class=\"k\"></div>`",
		expected: 'html`<div class="k"></div>`',
		plainExpected: "html`<div a' : 'b'}' class=\"k\"></div>`",
	},
	{
		name: 'a placeholder nesting the other quote',
		input: 'html`<div data-testid="${ok ? \'a\' : \'b\'}" data-cy=\'${ok ? "c" : "d"}\' class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div class="k"></div>`',
	},
	{
		name: 'several placeholders in one value',
		input: 'html`<div data-testid="${a ? "x" : "y"}-${b ? "z" : "w"}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div x" : "y"}-${b ? "z" : "w"}" class="k"></div>`',
	},
	{
		name: 'a placeholder holding a template literal with a placeholder of its own',
		input: 'html`<div data-testid="${`item-${ok ? "a" : "b"}`}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div a" : "b"}`}" class="k"></div>`',
	},
	{
		name: 'a closing brace inside a string of the placeholder',
		input: 'html`<div data-testid="${ok ? "}" : x}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div }" : x}" class="k"></div>`',
	},
	{
		name: 'a closing brace and a quote inside a comment of the placeholder',
		input: 'html`<div data-testid="${x /* "} */}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div } */}" class="k"></div>`',
	},
	{
		name: 'a closing brace and a quote inside a regular expression of the placeholder',
		input: 'html`<div data-testid="${/"}/.source}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div }/.source}" class="k"></div>`',
	},
	{
		name: 'an object literal inside the placeholder',
		input: 'html`<div data-testid="${ {a: "1"}.a }" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div 1"}.a }" class="k"></div>`',
	},
	{
		name: 'a nested tagged template carrying the attribute itself',
		input: 'html`<div data-testid="${ok ? html`<b data-testid="x">y</b>` : ""}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div x">y</b>` : ""}" class="k"></div>`',
	},
	{
		name: 'a lone `$` opening no placeholder',
		input: 'html`<div data-testid="$foo" data-cy="a$" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div class="k"></div>`',
	},
	{
		name: 'an escaped `\\${`, which opens no placeholder',
		input: 'html`<p data-testid="\\${" title="}"></p>`',
		expected: 'html`<p title="}"></p>`',
		plainExpected: 'html`<p title="}"></p>`',
	},
	{
		name: 'an escaped backslash in front of a placeholder, which still opens it',
		input: 'html`<p data-testid="\\\\${ok ? "a" : "b"}" class="k"></p>`',
		expected: 'html`<p class="k"></p>`',
		plainExpected: 'html`<p a" : "b"}" class="k"></p>`',
	},
	{
		name: 'a placeholder spread over several lines',
		input: 'html`<div\n  data-testid="${ok\n    ? "a"\n    : "b"}"\n  class="k"\n></div>`',
		expected: 'html`<div\n  class="k"\n></div>`',
		plainExpected: 'html`<div\n  a"\n    : "b"}"\n  class="k"\n></div>`',
	},
	{
		name: 'a minified neighbor written right against the closing quote',
		input: 'html`<div data-testid="${ok ? "a" : "b"}"class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div a" : "b"}"class="k"></div>`',
	},
	{
		name: 'two removed attributes back to back',
		input: 'html`<div data-testid="${a ? "b" : "c"}" data-cy="${d ? "e" : "f"}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div b" : "c"}" e" : "f"}" class="k"></div>`',
	},
	{
		name: 'the `:`, `v-bind:` and modifier forms of a bound name',
		input:
			'html`<div :data-testid="${a ? "b" : "c"}" v-bind:data-cy="${d ? "e" : "f"}" :data-testid.attr="${g ? "h" : "i"}" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div b" : "c"}" e" : "f"}" h" : "i"}" class="k"></div>`',
	},
	{
		name: 'an unbalanced placeholder, which falls back to the plain read',
		input: 'html`<div data-testid="${a" class="k"></div>`',
		expected: 'html`<div class="k"></div>`',
		plainExpected: 'html`<div class="k"></div>`',
	},
	{
		name: 'a bare `{…}`, which only Svelte reads as an expression',
		input: '<div data-testid="{ok ? "a" : "b"}" class="k"></div>',
		expected: '<div a" : "b"}" class="k"></div>',
		plainExpected: '<div a" : "b"}" class="k"></div>',
	},
] as const;

/**
 * Every shape an attribute written across several lines takes, with the markup each one must leave behind.
 *
 * @remarks
 * The two cosmetic leftovers are intended: the trailing spaces that followed a removed value stay, since they
 * sit after the attribute rather than in front of it, and the blank line before an attribute is consumed along
 * with the rest of the whitespace run leading to it.
 */
const MULTI_LINE_CASES = [
	{
		name: 'on its own line between two others',
		input: '<div\n  class="a"\n  data-testid="x"\n  id="b"\n>',
		expected: '<div\n  class="a"\n  id="b"\n>',
	},
	{
		name: 'on the last line, before a closing bracket of its own',
		input: '<div\n  class="a"\n  data-testid="x"\n>',
		expected: '<div\n  class="a"\n>',
	},
	{
		name: 'on the last line, carrying the closing bracket',
		input: '<div\n  class="a"\n  data-testid="x">',
		expected: '<div\n  class="a">',
	},
	{ name: 'the only attribute, on its own line', input: '<div\n  data-testid="x"\n>', expected: '<div\n>' },
	{ name: 'the only attribute of a self-closing tag', input: '<Foo\n  data-testid="x"\n/>', expected: '<Foo\n/>' },
	{
		name: 'first, on the line of the tag name',
		input: '<div data-testid="x"\n  class="a"\n>',
		expected: '<div\n  class="a"\n>',
	},
	{
		name: 'an expression value spread over several lines',
		input: '<Foo\n  data-testid={[\n    a,\n    b,\n  ].join("-")}\n  class="a"\n/>',
		expected: '<Foo\n  class="a"\n/>',
	},
	{
		name: 'a quoted value spread over two lines',
		input: '<div\n  data-testid="a\n    b"\n  class="a">',
		expected: '<div\n  class="a">',
	},
	{
		name: 'a blank line in front of it',
		input: '<div\n  class="a"\n\n  data-testid="x"\n  id="b">',
		expected: '<div\n  class="a"\n  id="b">',
	},
	{
		name: 'two of them on consecutive lines',
		input: '<div\n  data-testid="x"\n  data-cy="y"\n  class="a">',
		expected: '<div\n  class="a">',
	},
	{
		name: 'trailing spaces after the value',
		input: '<div\n  data-testid="x"   \n  class="a">',
		expected: '<div   \n  class="a">',
	},
	{
		name: 'CRLF line endings',
		input: '<div\r\n  class="a"\r\n  data-testid="x"\r\n  id="b"\r\n>',
		expected: '<div\r\n  class="a"\r\n  id="b"\r\n>',
	},
	{
		name: 'tab indentation',
		input: '<div\n\t\tdata-testid="x"\n\t\tclass="a"\n\t>',
		expected: '<div\n\t\tclass="a"\n\t>',
	},
	{
		name: 'a line comment after the value',
		input: '<Foo\n  data-testid="x" // note\n  class="a"\n/>',
		expected: '<Foo // note\n  class="a"\n/>',
	},
	{
		name: 'the assignment on the next line',
		input: '<div\n  data-testid\n    ="x"\n  class="a">',
		expected: '<div\n  class="a">',
	},
] as const;

describe('getOptions', () => {
	it('defaults missing arrays and enables the built-in ignore list', () => {
		expect(getOptions({ extensions: ['svelte'], attributes: ['data-testid'] })).toEqual({
			extensions: ['svelte'],
			attributes: ['data-testid'],
			ignoreFolders: [],
			ignoreFiles: [],
			ignoreDefaults: true,
			removeInStrings: false,
		});
	});

	it('falls back to the default extensions and an empty attributes array for non-array values', () => {
		// @ts-expect-error -- deliberately malformed input
		expect(getOptions({ extensions: 'svelte', attributes: null })).toMatchObject({
			extensions: [...DEFAULT_EXTENSIONS],
			attributes: [],
		});
	});

	it('resolves undefined options', () => {
		expect(getOptions(undefined)).toEqual({
			extensions: [...DEFAULT_EXTENSIONS],
			attributes: [],
			ignoreFolders: [],
			ignoreFiles: [],
			ignoreDefaults: true,
			removeInStrings: false,
		});
	});

	it('keeps ignoreDefaults false', () => {
		expect(getOptions({ extensions: [], attributes: [], ignoreDefaults: false }).ignoreDefaults).toBe(false);
	});

	it('enables removeInStrings on `true` only', () => {
		expect(getOptions({ attributes: [], removeInStrings: true }).removeInStrings).toBe(true);
		expect(getOptions({ attributes: [], removeInStrings: false }).removeInStrings).toBe(false);
		expect(getOptions({ attributes: [], removeInStrings: 'yes' as unknown as boolean }).removeInStrings).toBe(false);
		expect(getOptions({ attributes: [], removeInStrings: 1 as unknown as boolean }).removeInStrings).toBe(false);
	});

	it('keeps an explicit empty extensions array empty', () => {
		expect(getOptions({ extensions: [], attributes: ['data-testid'] }).extensions).toEqual([]);
	});

	it('drops non-string and blank extensions entries', () => {
		expect(
			getOptions({
				extensions: ['svelte', '', '  ', 42 as unknown as string, null as unknown as string, 'ts'],
				attributes: [],
			}).extensions,
		).toEqual(['svelte', 'ts']);
	});

	it('drops non-string and blank attributes entries', () => {
		expect(
			getOptions({
				attributes: ['data-testid', '', '   ', 42 as unknown as string, null as unknown as string],
			}).attributes,
		).toEqual(['data-testid']);
	});

	it('trims and de-duplicates attributes and extensions', () => {
		const RESOLVED = getOptions({
			extensions: [' svelte ', 'svelte'],
			attributes: [' data-testid ', 'data-testid', 'data-id'],
		});

		expect(RESOLVED.extensions).toEqual(['svelte']);
		expect(RESOLVED.attributes).toEqual(['data-testid', 'data-id']);
	});

	it('drops a Set or an object passed where a list was expected', () => {
		expect(getOptions({ attributes: new Set(['data-testid']) as unknown as string[] }).attributes).toEqual([]);
		expect(getOptions({ attributes: ['x'], extensions: { 0: 'svelte' } as unknown as string[] }).extensions).toEqual([
			...DEFAULT_EXTENSIONS,
		]);
	});

	it('accepts a preset passed directly to extensions without spreading', () => {
		const RESOLVED = getOptions({ attributes: ['x'], extensions: DEFAULT_EXTENSIONS });

		expect(RESOLVED.extensions).toEqual(DEFAULT_EXTENSIONS);
		expect(RESOLVED.extensions).not.toBe(DEFAULT_EXTENSIONS);
		expect(Object.isFrozen(RESOLVED.extensions)).toBe(false);
	});
});

describe('cleanIgnoredPaths', () => {
	it('trims, strips leading ./ and /, strips trailing / and de-duplicates', () => {
		expect(cleanIgnoredPaths([' ./src/tests/ ', 'src/tests', '/public', 'Header.svelte'])).toEqual([
			'src/tests',
			'public',
			'Header.svelte',
		]);
	});

	it('drops empty and root-only tokens', () => {
		expect(cleanIgnoredPaths(['', ' ', '.', './', '/', '/.'])).toEqual([]);
	});

	it('drops non-string entries', () => {
		expect(cleanIgnoredPaths([null, 42, 'dist'])).toEqual(['dist']);
	});

	it('turns Windows separators into / and strips leading ../ segments', () => {
		expect(cleanIgnoredPaths(['src\\tests\\', '..\\shared', '../../shared/ui', '../', '..'])).toEqual([
			'src/tests',
			'shared',
			'shared/ui',
		]);
	});
});

describe('stripQuery', () => {
	it('removes the Vite query suffix', () => {
		expect(stripQuery('/src/App.svelte?svelte&type=style&lang.css')).toBe('/src/App.svelte');
		expect(stripQuery('/src/App.svelte')).toBe('/src/App.svelte');
	});

	it('removes a #hash suffix, after a query or on its own', () => {
		expect(stripQuery('/src/App.svelte#frag')).toBe('/src/App.svelte');
		expect(stripQuery('/src/App.svelte?raw#frag')).toBe('/src/App.svelte');
	});

	it('keeps a # followed by a / as part of a folder name', () => {
		expect(stripQuery('/src/#internal/App.svelte')).toBe('/src/#internal/App.svelte');
		expect(stripQuery('/src/#internal/App.svelte#frag')).toBe('/src/#internal/App.svelte');
	});
});

describe('isStyleRequest', () => {
	it.each([
		'/src/App.vue?vue&type=style&index=0&lang.css',
		'/src/App.vue?vue&type=style&index=0&scoped=7a7a37b1&lang.scss',
		'/src/App.svelte?svelte&type=style&lang.css',
		'/src/App.svelte?svelte&type=style',
		'/src/Page.astro?astro&type=style&index=0&lang.css',
		'/index.html?html-proxy&inline-css&index=0.css',
		'/index.html?html-proxy&direct&index=0.css',
		'/src/App.vue?vue&lang.less',
	])('recognizes the CSS sub-request %s', (id) => {
		expect(isStyleRequest(id)).toBe(true);
	});

	it.each([
		'/src/App.vue',
		'/src/App.vue?vue&type=script&setup=true&lang.ts',
		'/src/App.vue?vue&type=template',
		'/index.html?html-proxy&index=0.js',
		'/src/style.css.svelte',
		'/src/App.svelte?mytype=style',
		'/src/App.svelte#type=style',
	])('leaves the non-style request %s alone', (id) => {
		expect(isStyleRequest(id)).toBe(false);
	});
});

describe('toRelativePath', () => {
	it('resolves ids inside the root', () => {
		expect(toRelativePath('/opt/buildhome/repo/src/App.svelte', '/opt/buildhome/repo')).toBe('src/App.svelte');
	});

	it('resolves ids outside the root', () => {
		expect(toRelativePath('/opt/.pnpm/x/node_modules/y/index.js', '/opt/buildhome/repo')).toBe(
			'../../.pnpm/x/node_modules/y/index.js',
		);
	});

	it('strips the query suffix first', () => {
		expect(toRelativePath('/repo/src/App.svelte?svelte&type=style', '/repo')).toBe('src/App.svelte');
	});
});

describe('extension presets', () => {
	it('holds lower-case extensions without a leading dot and without duplicates', () => {
		const PRESETS = [
			JAVASCRIPT_EXTENSIONS,
			TYPESCRIPT_EXTENSIONS,
			JSX_EXTENSIONS,
			SCRIPT_EXTENSIONS,
			SVELTE_EXTENSIONS,
			VUE_EXTENSIONS,
			ASTRO_EXTENSIONS,
			HTML_EXTENSIONS,
			DEFAULT_EXTENSIONS,
		];

		for (const PRESET of PRESETS) {
			expect(PRESET).toEqual(PRESET.map((extension) => extension.toLowerCase()));
			expect(PRESET.some((extension) => extension.startsWith('.'))).toBe(false);
			expect(new Set(PRESET).size).toBe(PRESET.length);
		}
	});

	it('names the expected extensions', () => {
		expect(JAVASCRIPT_EXTENSIONS).toEqual(['js', 'mjs', 'cjs']);
		expect(TYPESCRIPT_EXTENSIONS).toEqual(['ts', 'mts', 'cts']);
		expect(JSX_EXTENSIONS).toEqual(['jsx', 'tsx']);
		expect(SVELTE_EXTENSIONS).toEqual(['svelte']);
		expect(VUE_EXTENSIONS).toEqual(['vue']);
		expect(ASTRO_EXTENSIONS).toEqual(['astro']);
		expect(HTML_EXTENSIONS).toEqual(['html', 'htm']);
	});

	it('freezes every exported constant', () => {
		const EXPORTED = [
			JAVASCRIPT_EXTENSIONS,
			TYPESCRIPT_EXTENSIONS,
			JSX_EXTENSIONS,
			SCRIPT_EXTENSIONS,
			SVELTE_EXTENSIONS,
			VUE_EXTENSIONS,
			ASTRO_EXTENSIONS,
			HTML_EXTENSIONS,
			DEFAULT_EXTENSIONS,
		];

		for (const CONSTANT of EXPORTED) {
			expect(Object.isFrozen(CONSTANT)).toBe(true);
		}
	});

	it('rejects a consumer trying to grow a preset', () => {
		expect(() => (DEFAULT_EXTENSIONS as string[]).push('evil')).toThrow(TypeError);
		expect(DEFAULT_EXTENSIONS).not.toContain('evil');
	});

	it('resolves the defaults into a fresh mutable copy', () => {
		const RESOLVED = getOptions({ attributes: ['data-testid'] });

		expect(RESOLVED.extensions).toEqual(DEFAULT_EXTENSIONS);
		expect(RESOLVED.extensions).not.toBe(DEFAULT_EXTENSIONS);
		expect(Object.isFrozen(RESOLVED.extensions)).toBe(false);

		RESOLVED.extensions.push('evil');

		expect(DEFAULT_EXTENSIONS).not.toContain('evil');
	});

	it('composes the unions by spreading', () => {
		expect(SCRIPT_EXTENSIONS).toEqual([...JAVASCRIPT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS, ...JSX_EXTENSIONS]);
		expect(DEFAULT_EXTENSIONS).toEqual([
			...JSX_EXTENSIONS,
			...SVELTE_EXTENSIONS,
			...VUE_EXTENSIONS,
			...ASTRO_EXTENSIONS,
			...HTML_EXTENSIONS,
		]);
	});

	it('pins the exact preset contents', () => {
		expect(SCRIPT_EXTENSIONS).toEqual(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx']);
		expect(DEFAULT_EXTENSIONS).toEqual(['jsx', 'tsx', 'svelte', 'vue', 'astro', 'html', 'htm']);
	});
});

describe('default ignore tokens', () => {
	it('splits the defaults into an any-depth group and a root-anchored group', () => {
		expect(ANY_DEPTH_DEFAULT_IGNORE_PATHS).toEqual(['node_modules', '.git']);
		expect(DEFAULT_IGNORE_PATHS).toEqual([...ANY_DEPTH_DEFAULT_IGNORE_PATHS, ...ROOT_ANCHORED_DEFAULT_IGNORE_PATHS]);
		expect(ROOT_ANCHORED_DEFAULT_IGNORE_PATHS).toEqual(expect.arrayContaining(['build', 'dist', 'public', 'e2e']));
		expect(ROOT_ANCHORED_DEFAULT_IGNORE_PATHS).not.toContain('node_modules');
	});
});

describe('createIgnoreMatcher', () => {
	const HAS_IGNORE_PATH = createIgnoreMatcherFor({});

	it('does not match a source file against the defaults', () => {
		expect(HAS_IGNORE_PATH('src/components/Button.svelte')).toBe(false);
	});

	it('matches only on segment boundaries', () => {
		expect(HAS_IGNORE_PATH('buildhome/repo/src/App.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('src/distribution/App.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('build/app.js')).toBe(true);
		expect(HAS_IGNORE_PATH('.svelte-kit/generated/root.svelte')).toBe(true);
	});

	it('anchors every default but node_modules and .git to the first segment under the root', () => {
		expect(HAS_IGNORE_PATH('src/routes/public/+page.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('src/routes/logs/+page.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('src/lib/build/Step.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('src/e2e/Foo.tsx')).toBe(false);
		expect(HAS_IGNORE_PATH('src/dist/Bar.svelte')).toBe(false);
		expect(HAS_IGNORE_PATH('public/x.html')).toBe(true);
		expect(HAS_IGNORE_PATH('logs/x.html')).toBe(true);
		expect(HAS_IGNORE_PATH('e2e/Foo.tsx')).toBe(true);
	});

	it('anchors every framework and deploy-adapter token to the first segment under the root', () => {
		const TOKENS = [
			'.output',
			'.nitro',
			'.data',
			'out',
			'.react-router',
			'.astro',
			'.solid',
			'.vinxi',
			'.tanstack',
			'.angular',
			'.vercel',
			'.netlify',
			'.wrangler',
		];

		for (const TOKEN of TOKENS) {
			expect(ROOT_ANCHORED_DEFAULT_IGNORE_PATHS).toContain(TOKEN);
			expect(HAS_IGNORE_PATH(`${TOKEN}/Page.tsx`)).toBe(true);
			expect(HAS_IGNORE_PATH(`src/${TOKEN}/Page.tsx`)).toBe(false);
		}

		expect(HAS_IGNORE_PATH('src/out/Page.tsx')).toBe(false);
		expect(HAS_IGNORE_PATH('src/.astro/x.astro')).toBe(false);
	});

	it('no longer ignores the Remix cache folder, which no Remix version generates', () => {
		expect(ROOT_ANCHORED_DEFAULT_IGNORE_PATHS).not.toContain('.remix');
		expect(HAS_IGNORE_PATH('.remix/x.jsx')).toBe(false);
	});

	it('matches node_modules and .git at any depth', () => {
		expect(HAS_IGNORE_PATH('packages/a/node_modules/x/y.jsx')).toBe(true);
		expect(HAS_IGNORE_PATH('packages/a/.git/x.svelte')).toBe(true);
	});

	it('matches dependencies resolved outside the root', () => {
		expect(HAS_IGNORE_PATH('../../.pnpm/x/node_modules/y/dist/index.js')).toBe(true);
	});

	it('keeps configured tokens matching at any depth', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({
			ignoreFolders: ['src/tests'],
			ignoreFiles: ['Header.svelte'],
		});

		expect(HAS_CONFIGURED_PATH('src/tests/a.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/tests-e2e/a.svelte')).toBe(false);
		expect(HAS_CONFIGURED_PATH('lib/src/tests/a.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/layouts/Header.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/layouts/SubHeader.svelte')).toBe(false);
	});

	it('matches multi-segment tokens', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFiles: ['src/components/Modal.svelte'] });

		expect(HAS_CONFIGURED_PATH('src/components/Modal.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/components/Modal.svelte.bak')).toBe(false);
	});

	it('supports * within a segment', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFiles: ['*.log', '.env.*', '*.stories.svelte'] });

		expect(HAS_CONFIGURED_PATH('logs/server.log')).toBe(true);
		expect(HAS_CONFIGURED_PATH('.env.production')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/Button.stories.svelte')).toBe(true);
		expect(createIgnoreMatcherFor({ ignoreFiles: ['a*b.svelte'] })('src/a/b.svelte')).toBe(false);
	});

	it('treats regex characters in tokens literally', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFolders: ['(group)'] });

		expect(HAS_CONFIGURED_PATH('src/(group)/page.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src/group/page.svelte')).toBe(false);
	});

	it('ignores nothing when the defaults are off and no token is configured', () => {
		const HAS_IGNORED_PATH_WITHOUT_DEFAULTS = createIgnoreMatcherFor({ ignoreDefaults: false });

		expect(HAS_IGNORED_PATH_WITHOUT_DEFAULTS('node_modules/x/y.svelte')).toBe(false);
		expect(HAS_IGNORED_PATH_WITHOUT_DEFAULTS('build/app.js')).toBe(false);
		expect(HAS_IGNORED_PATH_WITHOUT_DEFAULTS('')).toBe(false);
	});

	it('keeps configured tokens when the defaults are off', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFolders: ['x'], ignoreDefaults: false });

		expect(HAS_CONFIGURED_PATH('x/a.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('build/app.js')).toBe(false);
	});
});

describe('createExtensionMatcher', () => {
	it('matches configured extensions case-insensitively', () => {
		expect(createExtensionMatcher(['svelte'])('/src/App.svelte')).toBe(true);
		expect(createExtensionMatcher(['svelte'])('/src/App.SVELTE')).toBe(true);
		expect(createExtensionMatcher(['svelte', 'ts'])('/src/App.vue')).toBe(false);
	});

	it('ignores the query suffix', () => {
		expect(createExtensionMatcher(['svelte'])('/src/App.svelte?svelte&type=style&lang.css')).toBe(true);
	});

	it('ignores the #hash suffix', () => {
		expect(createExtensionMatcher(['svelte'])('/src/App.svelte#frag')).toBe(true);
	});

	it('accepts extensions with a leading dot and escapes them', () => {
		expect(createExtensionMatcher(['.svelte'])('/src/a.svelte')).toBe(true);
		expect(createExtensionMatcher(['svelte'])('/src/axsvelte')).toBe(false);
	});

	it('returns false without usable extensions', () => {
		expect(createExtensionMatcher([])('/src/App.svelte')).toBe(false);
		expect(createExtensionMatcher(['', '  ', '.'])('/src/App.svelte')).toBe(false);
	});
});

describe('cleanExtensions', () => {
	it('trims, drops leading dots, blank and dot-only entries, and de-duplicates', () => {
		expect(cleanExtensions([' .svelte ', 'svelte', '..vue', '', ' ', '.', '...', 'ts'])).toEqual([
			'svelte',
			'vue',
			'ts',
		]);
	});
});

describe('findExpressionEnd', () => {
	it('finds the matching brace across nested braces, strings and template literals', () => {
		const INPUT = '{`item-${index}` + "}" + \'{\' + { a: 1 }.a}';

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('returns -1 when unbalanced', () => {
		expect(findExpressionEnd('{a ? { b: 1 } : 2', 0)).toBe(-1);
		expect(findExpressionEnd('{`unterminated', 0)).toBe(-1);
	});

	it('treats an escaped quote inside a string as text', () => {
		const INPUT = '{\'a\\\'}\' + "b\\"}"}';

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('skips a brace inside a line comment', () => {
		const INPUT = '{id // }\n}';

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('skips a brace and an apostrophe inside a block comment', () => {
		const INPUT = "{id /* don't } */}";

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('skips a brace inside a regular expression literal', () => {
		expect(findExpressionEnd('{/}/.test(x)}', 0)).toBe(12);
		expect(findExpressionEnd('{/[/}]/.test(x)}', 0)).toBe(15);
		expect(findExpressionEnd('{x.replace(/}/g, "")}', 0)).toBe(20);
	});

	it('reads a slash after a value as division rather than a regular expression', () => {
		expect(findExpressionEnd('{a / b}', 0)).toBe(6);
		expect(findExpressionEnd('{total / count}.x}', 0)).toBe(14);
		expect(findExpressionEnd('{(a + b) / 2}', 0)).toBe(12);
		expect(findExpressionEnd('{a[0] / 2}', 0)).toBe(9);
		expect(findExpressionEnd('{"return" / 2}', 0)).toBe(13);
	});

	it('reads a slash after a keyword as a regular expression literal', () => {
		expect(findExpressionEnd('{typeof /}/}', 0)).toBe(11);
		expect(findExpressionEnd('{x in /[}]/}', 0)).toBe(11);
		expect(findExpressionEnd('{x instanceof /}/ }', 0)).toBe(18);
		expect(findExpressionEnd('{(() => { return /}/.test(x) })()}', 0)).toBe(33);
	});

	it('reads a slash after an identifier that merely ends with a keyword as division', () => {
		expect(findExpressionEnd('{retin / 2}', 0)).toBe(10);
		expect(findExpressionEnd('{myreturn / 2}', 0)).toBe(13);
		expect(findExpressionEnd('{xin / 2}', 0)).toBe(8);
	});

	it('reads a slash after an element name as a closing tag', () => {
		expect(findExpressionEnd('{ok && <p>x</p>}', 0)).toBe(15);
		expect(findExpressionEnd('{ok ? <A /> : <B />}', 0)).toBe(19);
	});

	it('ends a string at an unescaped newline', () => {
		const INPUT = "{list.map((item) => (\n\t<li>don't</li>\n))}";

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});
});

describe('findExpressionEnd on nested elements', () => {
	it('reads the text of an element as content rather than as code', () => {
		for (const INPUT of ["{<p>don't</p>}", '{<p>/path</p>}', '{<p>a "b c</p>}', '{<p>a `b c</p>}', '{<p>1 < 2</p>}']) {
			expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
		}
	});

	it('reads a brace in the text of an element as a nested expression', () => {
		expect(findExpressionEnd('{<p>{x}</p>}', 0)).toBe(11);
		expect(findExpressionEnd('{<p>{"}"}</p>}', 0)).toBe(13);
	});

	it('closes a fragment like any other element', () => {
		const INPUT = '{<><i>it\'s {"}"}</i></>}';

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('reads an attribute of a nested element', () => {
		expect(findExpressionEnd('{<B x="}" />}', 0)).toBe(12);
		expect(findExpressionEnd('{<li key={index}>{index}</li>}', 0)).toBe(29);
		expect(findExpressionEnd('{<T {...props} />}', 0)).toBe(17);
	});

	it('treats a backslash in an element as content rather than as an escape', () => {
		expect(findExpressionEnd("{fn(<T a='\\' />)}", 0)).toBe(16);
		expect(findExpressionEnd('{<T a="\\" />}', 0)).toBe(12);
	});

	it('enters an element only from an operand position', () => {
		// `a < b` compares, and so does `a<b`: only an operator, an opening punctuation or a keyword may precede
		expect(findExpressionEnd('{a < b ? "x" : "y"}', 0)).toBe(18);
		expect(findExpressionEnd('{a<b}', 0)).toBe(4);
		expect(findExpressionEnd('{x > 1 && y < 2}', 0)).toBe(15);
		expect(findExpressionEnd('{a << b}', 0)).toBe(7);
		expect(findExpressionEnd('{a<<b}', 0)).toBe(5);
		expect(findExpressionEnd('{x as Array<string>}', 0)).toBe(19);
		expect(findExpressionEnd('{count<total}', 0)).toBe(12);
	});

	it('reads a regular expression literal after a comparison', () => {
		expect(findExpressionEnd('{a < /}/.test(b)}', 0)).toBe(16);
	});

	it('reads a `</` that cannot open a closing tag as a comparison against a literal', () => {
		// `a</re/.test(b)` compares `a` with the result, exactly as the spaced `a < /re/.test(b)` does
		expect(findExpressionEnd('{a</re/.test(b)}', 0)).toBe(15);
		expect(findExpressionEnd('{x < /re/.test(y)}', 0)).toBe(17);
		expect(findExpressionEnd('{a</b/}', 0)).toBe(6);
		expect(findExpressionEnd('{a</}/.test(b)}', 0)).toBe(14);
	});

	it('reads a slash after a closed element as a division', () => {
		expect(findExpressionEnd('{<A /> / 2}', 0)).toBe(10);
		expect(findExpressionEnd('{(<A />) / 2}', 0)).toBe(12);
	});

	it('leaves a `<` inside a string or a template literal alone', () => {
		expect(findExpressionEnd('{"a<b"}', 0)).toBe(6);
		expect(findExpressionEnd('{`a<b${x}c`}', 0)).toBe(11);
		expect(findExpressionEnd("{'</p>'}", 0)).toBe(7);
	});

	it('returns -1 when an element is never closed', () => {
		expect(findExpressionEnd('{ok && <p>x', 0)).toBe(-1);
		expect(findExpressionEnd('{<p>x</p>', 0)).toBe(-1);
	});

	it('gives up rather than letting an enclosing closing tag end an element it does not name', () => {
		// Without the name check, `</ul>` would close the `<Foo>` text frame, the scan would escape the value
		// and report the `}` of the surrounding function as the one ending the attribute
		expect(findExpressionEnd('{ok && <Foo>}><li>x</li></ul>\n  );\n}', 0)).toBe(-1);
		expect(findExpressionEnd('{<a>x</b>}', 0)).toBe(-1);
	});

	it('gives up on a closing tag at an operand position with no element open in the expression', () => {
		// Where an element could start, a `</` is a closing tag and nothing else: there is no value in front
		// of it for the comparison `a</re/.test(b)` to compare
		expect(findExpressionEnd('{</p>}', 0)).toBe(-1);
		expect(findExpressionEnd('{ok && </p>}', 0)).toBe(-1);
		expect(findExpressionEnd('{[</p>]}', 0)).toBe(-1);
	});

	it('gives up on a stray closing tag following an element that is already closed', () => {
		// An element that closed is a value, but not one a `</` may compare: the tag closes an element the
		// expression no longer has open, so no brace can be trusted to be the one ending the value
		expect(findExpressionEnd('{<p>x</p></p>}', 0)).toBe(-1);
		expect(findExpressionEnd('{<p>x</p> </p>}', 0)).toBe(-1);
		expect(findExpressionEnd('{<A /></A>}', 0)).toBe(-1);
	});

	it('gives up on a stray closing tag whose literal a later value would close', () => {
		// Read as a comparison, the `</` opens a literal that runs to the `/` of the next value and leaves the
		// scan to report a brace past the end of the attribute as the one closing it
		expect(findExpressionEnd('{<p>x</p></p>} b={a/b}', 0)).toBe(-1);
		expect(findExpressionEnd('{<p>x</p> </p>} b={a/b}', 0)).toBe(-1);
		expect(findExpressionEnd('{<A /></A>} b={a/b}', 0)).toBe(-1);
	});

	it('gives up on a `</` comparison whose literal does not end on its line', () => {
		// A regular expression literal cannot span lines, so a `</` whose literal reaches the end of the line
		// was a closing tag with no element open after all — and the code below it is not the value's
		expect(findExpressionEnd('{a</p>}\n + 1}', 0)).toBe(-1);
		expect(findExpressionEnd('{a</p>}\n b={c}', 0)).toBe(-1);
		// A literal that does end on its line closes the value at its own brace
		expect(findExpressionEnd('{a</re/.test(b)}\n + 1}', 0)).toBe(15);
	});

	it('pairs a closing tag with the element of the same name', () => {
		expect(findExpressionEnd('{<p><p>x</p></p>}', 0)).toBe(16);
		expect(findExpressionEnd('{<Foo.Bar>x</Foo.Bar>}', 0)).toBe(21);
		expect(findExpressionEnd('{<svg:rect />}', 0)).toBe(13);
		expect(findExpressionEnd('{<my-el>x</my-el>}', 0)).toBe(17);
		expect(findExpressionEnd('{<>x</>}', 0)).toBe(7);
	});

	it('reads a `!` that ends a value as the non-null assertion rather than as a prefix operator', () => {
		expect(findExpressionEnd('{n!<max}', 0)).toBe(7);
		expect(findExpressionEnd('{n!.x<y}', 0)).toBe(7);
		expect(findExpressionEnd('{a !== b}', 0)).toBe(8);
		expect(findExpressionEnd('{a! / 2}', 0)).toBe(7);
		// A `!` at an operand position is the logical operator, so an element may still follow it
		expect(findExpressionEnd('{ok && !<p>x</p>}', 0)).toBe(16);
		expect(findExpressionEnd('{!x}', 0)).toBe(3);
	});
});

describe('findExpressionEnd on generic parameter lists', () => {
	it('reads a type parameter list as an operator rather than as an element', () => {
		expect(findExpressionEnd('{<T,>(x: T) => x}', 0)).toBe(16);
		expect(findExpressionEnd('{<T, U>(x: T, y: U) => [x, y]}', 0)).toBe(29);
		expect(findExpressionEnd('{<T extends U>(x: T) => x}', 0)).toBe(25);
		expect(findExpressionEnd('{<T extends Record<string, string>>(x: T) => x}', 0)).toBe(46);
	});

	it('ends the value at its own brace, not at one belonging to the module around it', () => {
		expect(findExpressionEnd('{<T,>(x: T) =>\n x} className="card">\n <h2>T</h2>\n </section>\n );\n}', 0)).toBe(17);
	});

	it('keeps reading an element whose first attribute is named after the constraint keyword', () => {
		// Only a bare `extends` closed by whitespace names a constraint: `extends="x"` is an attribute
		expect(findExpressionEnd('{<Foo extends="x">y</Foo>}', 0)).toBe(25);
		expect(findExpressionEnd('{<Foo extended="x">y</Foo>}', 0)).toBe(26);
		// A closing tag carries no parameter list, so the keyword is part of the tag wherever it sits in one
		expect(findExpressionEnd('{<p>x</p extends >}', 0)).toBe(18);
	});

	it('reads punctuation inside an unquoted attribute value as part of the value', () => {
		// Past the first `=` of its attribute list, the `<` opened an element beyond doubt: none of these
		// characters ends the tag the way it would in `<T,>` or `<T | U>`
		expect(findExpressionEnd('{<a href=x&y>z</a>}', 0)).toBe(18);
		expect(findExpressionEnd('{<a href=x?y=1>z</a>}', 0)).toBe(20);
		expect(findExpressionEnd('{<i style=width:100%>z</i>}', 0)).toBe(26);
	});

	it('gives up on the forms a generic parameter list cannot be told from', () => {
		// An old-style cast and a bare attribute named `extends` stay ambiguous: the scan reports no brace and
		// the caller leaves the attribute in place rather than cutting the value at the wrong point
		expect(findExpressionEnd('{<Foo>bar}', 0)).toBe(-1);
		expect(findExpressionEnd('{<Foo extends >y</Foo>}', 0)).toBe(-1);
		expect(findExpressionEnd('{<A,>{x}</A>}', 0)).toBe(-1);
		expect(findExpressionEnd('{<p><T,>x</p>}', 0)).toBe(-1);
	});
});

describe('createAttributeMatcher', () => {
	it('returns the range of each occurrence in source order', () => {
		const INPUT = '<ul data-testid="list"><li data-id={id} data-testid="item">x</li></ul>';

		expect(findRanges(INPUT, ['data-testid', 'data-id'])).toEqual([
			[3, 22],
			[26, 39],
			[39, 58],
		]);
	});

	it('returns sorted, non-overlapping ranges for adjacent occurrences', () => {
		const INPUT = '<div data-testid="a" data-testid="b">';
		const RANGES = findRanges(INPUT, ['data-testid']);

		expect(RANGES).toEqual([
			[4, 20],
			[20, 36],
		]);
		expect(removeRanges(INPUT, RANGES)).toBe('<div>');
		expect(findRanges('<div data-testid={ x } data-id="y">', ['data-testid', 'data-id'])).toEqual([
			[4, 22],
			[22, 34],
		]);
	});

	it('returns no range when nothing matches', () => {
		expect(findRanges('<div class="x">', ['data-testid'])).toEqual([]);
		expect(findRanges('<div class="x">', [])).toEqual([]);
	});

	it('compiles once and stays usable across inputs', () => {
		const MATCH_ATTRIBUTES = createAttributeMatcher(['data-testid']);

		expect(MATCH_ATTRIBUTES('<div data-testid="a">', { hasQuotedMustache: false }).ranges).toEqual([[4, 20]]);
		expect(MATCH_ATTRIBUTES('<div class="x">', { hasQuotedMustache: false }).ranges).toEqual([]);
		expect(MATCH_ATTRIBUTES('<p data-testid="b">', { hasQuotedMustache: false }).ranges).toEqual([[2, 18]]);
	});

	it('keeps the whitespace run out of the range when nothing separates the attribute from the next one', () => {
		expect(findRanges('<div data-testid="a"class="b">', ['data-testid'])).toEqual([[5, 20]]);
		expect(findRanges('<div data-testid="a" class="b">', ['data-testid'])).toEqual([[4, 20]]);
	});
});

describe('assertRangeFollowsPrevious', () => {
	it('accepts a range that starts where the previous one ends', () => {
		expect(() => assertRangeFollowsPrevious([[0, 5]], [5, 9])).not.toThrow();
		expect(() => assertRangeFollowsPrevious([], [0, 1])).not.toThrow();
	});

	it('throws on a range overlapping the previous one', () => {
		expect(() =>
			assertRangeFollowsPrevious(
				[
					[0, 5],
					[5, 12],
				],
				[9, 20],
			),
		).toThrow(/overlaps/);
	});

	it('throws on an empty or reversed range', () => {
		expect(() => assertRangeFollowsPrevious([], [4, 4])).toThrow(/empty removal range/);
		expect(() => assertRangeFollowsPrevious([], [9, 4])).toThrow(/empty removal range/);
	});
});

describe('removeAttributes', () => {
	it('removes quoted values', () => {
		expect(removeAttributes('<div data-testid="a">', ['data-testid'])).toBe('<div>');
		expect(removeAttributes("<div data-testid='a'>", ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid=`a`>', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid = "a b" class="x">', ['data-testid'])).toBe('<div class="x">');
	});

	it('removes expression values', () => {
		expect(removeAttributes('<div data-testid={value}>', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid={`item-${index}`}>', ['data-testid'])).toBe('<div>');
		expect(removeAttributes("<div data-testid={a ? '}' : '{'}>", ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid={{ a: 1 }.a} id="x">', ['data-testid'])).toBe('<div id="x">');
	});

	it('removes expression values holding escaped quotes', () => {
		expect(removeAttributes("<div data-testid={'a\\'}'} id=\"x\">", ['data-testid'])).toBe('<div id="x">');
		expect(removeAttributes('<div data-testid={`a\\`}`} id="x">', ['data-testid'])).toBe('<div id="x">');
	});

	it('removes bare attributes', () => {
		expect(removeAttributes('<input data-testid />', ['data-testid'])).toBe('<input />');
		expect(removeAttributes('<input data-testid/>', ['data-testid'])).toBe('<input/>');
		expect(removeAttributes('<div data-testid>', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid\n\tclass="x">', ['data-testid'])).toBe('<div\n\tclass="x">');
	});

	it('removes unquoted values', () => {
		expect(removeAttributes('<div data-testid=foo class="a">', ['data-testid'])).toBe('<div class="a">');
		expect(removeAttributes('<div data-testid = foo class="a">', ['data-testid'])).toBe('<div class="a">');
		expect(removeAttributes('<input data-testid=foo/>', ['data-testid'])).toBe('<input/>');
		expect(removeAttributes('<input data-testid=foo />', ['data-testid'])).toBe('<input />');
		expect(removeAttributes('<a data-testid=a/b href="/">go</a>', ['data-testid'])).toBe('<a href="/">go</a>');
	});

	it('leaves an attribute whose value cannot be read untouched, dangling `=` included', () => {
		expect(removeAttributes('<div data-testid = <span>', ['data-testid'])).toBe('<div data-testid = <span>');
		expect(removeAttributes('<div data-testid=>', ['data-testid'])).toBe('<div data-testid=>');
		expect(removeAttributes('<div data-testid="unterminated>', ['data-testid'])).toBe(
			'<div data-testid="unterminated>',
		);
	});

	it('removes Vue bindings', () => {
		expect(removeAttributes('<div :data-testid="id">', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div v-bind:data-testid="id">', ['data-testid'])).toBe('<div>');
	});

	it('removes values holding another quote form or a closing angle bracket', () => {
		expect(removeAttributes(`<div data-testid="it's">`, ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div data-testid="a > b" id="x">', ['data-testid'])).toBe('<div id="x">');
	});

	it('removes adjacent occurrences and values spread over several lines', () => {
		expect(removeAttributes('<div data-testid="a" data-testid="b">', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div\n\tdata-testid=\n\t\t"a"\n\tclass="x">', ['data-testid'])).toBe('<div\n\tclass="x">');
	});

	it('leaves no blank line behind when the attribute sits on a CRLF line of its own', () => {
		expect(removeAttributes('<div\r\n  data-testid="x"\r\n  class="a">', ['data-testid'])).toBe('<div\r\n  class="a">');
	});

	it('keeps the separating whitespace when nothing follows the value', () => {
		expect(removeAttributes('<div data-testid="a"class="b">x</div>', ['data-testid'])).toBe('<div class="b">x</div>');
		expect(removeAttributes('<input data-testid="a"required>', ['data-testid'])).toBe('<input required>');
		expect(removeAttributes('<div data-testid={x}class="b">y</div>', ['data-testid'])).toBe('<div class="b">y</div>');
		expect(removeAttributes('<div data-testid=\'a\'class="b">y</div>', ['data-testid'])).toBe('<div class="b">y</div>');
	});

	it('removes several attributes and occurrences', () => {
		const INPUT = '<ul data-testid="list"><li data-id={id} data-testid="item">x</li></ul>';

		expect(removeAttributes(INPUT, ['data-testid', 'data-id'])).toBe('<ul><li>x</li></ul>');
	});

	it('is case-insensitive on the attribute name', () => {
		expect(removeAttributes('<div DATA-TESTID="a">', ['data-testid'])).toBe('<div>');
		expect(removeAttributes('<div V-BIND:DATA-TESTID="a">', ['data-testid'])).toBe('<div>');
	});

	it('leaves an unbalanced expression untouched', () => {
		const INPUT = '<div data-testid={a ? { b: 1 } : 2>';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
	});

	it('leaves longer or prefixed attribute names untouched', () => {
		expect(removeAttributes('<div data-testid-extra="x">', ['data-testid'])).toBe('<div data-testid-extra="x">');
		expect(removeAttributes('<div data-testidx="x">', ['data-testid'])).toBe('<div data-testidx="x">');
		expect(removeAttributes('<div xdata-testid="x">', ['data-testid'])).toBe('<div xdata-testid="x">');
	});

	it('prefers the longest configured name', () => {
		expect(removeAttributes('<div data-testid-extra="x" class="k">', ['data-testid', 'data-testid-extra'])).toBe(
			'<div class="k">',
		);
	});

	it('treats regex characters in attribute names literally', () => {
		expect(removeAttributes('<div data.id="x">', ['data.id'])).toBe('<div>');
		expect(removeAttributes('<div dataXid="x">', ['data.id'])).toBe('<div dataXid="x">');
	});

	it('removes nothing for blank or non-string attribute names', () => {
		const INPUT = 'const a = "x"; <div  class="a" >';

		expect(removeAttributes(INPUT, [''])).toBe(INPUT);
		expect(removeAttributes(INPUT, ['   '])).toBe(INPUT);
		expect(removeAttributes(INPUT, [42 as unknown as string])).toBe(INPUT);
		expect(removeAttributes(INPUT, [null as unknown as string, undefined as unknown as string])).toBe(INPUT);
	});

	it('returns the input unchanged when nothing matches', () => {
		const INPUT = '<div class="x">';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(removeAttributes(INPUT, [])).toBe(INPUT);
	});

	it('removes an expression value holding a comment, a regular expression or a division', () => {
		expect(removeAttributes('<A data-testid={id // }\n} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={id /* don\'t */} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={/}/.test(x) ? "a" : "b"} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={/[/}]/.test(x)} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={a / b} c />', ['data-testid'])).toBe('<A c />');
	});

	it('removes an expression value whose regular expression follows a keyword', () => {
		expect(removeAttributes('<A data-testid={(() => { return /}/.test(x) })()} b="1" />', ['data-testid'])).toBe(
			'<A b="1" />',
		);
		expect(removeAttributes('<A data-testid={typeof /}/} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={x in /[}]/} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={x instanceof /}/ } b="1" />', ['data-testid'])).toBe('<A b="1" />');
	});

	it('removes an expression value holding nested markup', () => {
		expect(removeAttributes('<A data-testid={ok && <p>x</p>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(
			removeAttributes('<A\n\tdata-testid={list.map((item) => (\n\t\t<li>don\'t</li>\n\t))}\n\tclass="x" />', [
				'data-testid',
			]),
		).toBe('<A\n\tclass="x" />');
	});

	it('reads a brace inside a quoted value as literal text', () => {
		expect(removeAttributes('<div title="{" data-testid="x" other="}">', ['title'])).toBe(
			'<div data-testid="x" other="}">',
		);
	});

	it('scans a whitespace run in linear time', () => {
		const INPUT = `<div${' '.repeat(40_000)}>`;
		const STARTED_AT = performance.now();

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(performance.now() - STARTED_AT).toBeLessThan(500);
	});

	it('still removes well-formed attributes after an unbalanced expression', () => {
		const INPUT = '<div data-testid={ oops>\n<p data-testid="a" class="x">1</p>\n<p data-testid={id} class="y">2</p>';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(
			'<div data-testid={ oops>\n<p class="x">1</p>\n<p class="y">2</p>',
		);
	});
});

describe('removeAttributes on values holding elements', () => {
	it('removes a value holding an element whose text would not parse as code', () => {
		expect(removeAttributes('<A data-testid={ok && <p>don\'t</p>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<p>/path {x}</p>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<><i>it\'s {"}"}</i></>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
	});

	it('removes a value holding an element whose own attributes hold braces', () => {
		expect(removeAttributes('<A data-testid={ok ? <A /> : <B x="}" />} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={list.map((i) => <li key={i}>{i}</li>)} b="1" />', ['data-testid'])).toBe(
			'<A b="1" />',
		);
		expect(removeAttributes('<A data-testid={fn(<T a=\'\\\' />)} b="1" />', ['data-testid'])).toBe('<A b="1" />');
	});

	it('keeps reading a comparison as a comparison', () => {
		expect(removeAttributes('<A data-testid={a < /}/.test(b)} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={a < b ? "x" : "y"} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={x > 1 && y < 2} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={a<b} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={a</re/.test(b)} class="x" />', ['data-testid'])).toBe('<A class="x" />');
		expect(removeAttributes('<A data-testid={x as Array<string>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		// The literal of the comparison ends on its own `/`, so the value of the attribute behind it survives
		expect(removeAttributes('<A data-testid={a</re/.test(b)} b={a/b} class="k" />', ['data-testid'])).toBe(
			'<A b={a/b} class="k" />',
		);
	});

	it('removes a value holding an element whose unquoted attribute value carries punctuation', () => {
		expect(removeAttributes('<A data-testid={<a href=x&y>z</a>} class="k" />', ['data-testid'])).toBe(
			'<A class="k" />',
		);
		expect(removeAttributes('<A data-testid={<a href=x?y=1>z</a>} class="k" />', ['data-testid'])).toBe(
			'<A class="k" />',
		);
		expect(removeAttributes('<A data-testid={<i style=width:100%>z</i>} class="k" />', ['data-testid'])).toBe(
			'<A class="k" />',
		);
	});

	it('keeps reading a regular expression after an arrow, a string and a template literal', () => {
		expect(removeAttributes('<A data-testid={() => /}/.test(y)} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={"a<b"} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={`a<b${x}c`} b="1" />', ['data-testid'])).toBe('<A b="1" />');
	});
});

describe('removeAttributes on a value whose markup does not balance', () => {
	/**
	 * Asserts that a module is left exactly as it was, with its attribute reported as one that was skipped.
	 *
	 * @param input - The module source to scan.
	 */
	function expectLeftUntouched(input: string): void {
		expect(removeAttributes(input, ['data-testid'])).toBe(input);
		expect(findSkipped(input, ['data-testid'])).toHaveLength(1);
		expect(findRanges(input, ['data-testid'])).toEqual([]);
	}

	it('leaves an element opened but never closed inside the value in place', () => {
		expectLeftUntouched('function List() {\n  return (\n    <ul data-testid={ok && <Foo>}><li>x</li></ul>\n  );\n}');
	});

	it('leaves a value holding a stray closing tag in place', () => {
		expectLeftUntouched('<A data-testid={<p>x</p></p>} b="1" />');
		expectLeftUntouched('<A data-testid={<a>x</b>} b="1" />');
	});

	it('leaves a stray closing tag in place rather than deleting the attribute behind it', () => {
		// Read as a comparison, the `</` would open a literal ending on the `/` of the next value, and the
		// range would swallow that whole attribute without a word
		expectLeftUntouched('<A data-testid={<p>x</p></p>} b={a/b} class="k" />');
		expectLeftUntouched('<A data-testid={<p>x</p> </p>} b={a/b} class="k" />');
	});

	it('leaves a closing tag whose literal crosses a line in place rather than cutting the module', () => {
		expectLeftUntouched('function F() {\n  return <A data-testid={a</p>}\n    class="k" />;\n}');
	});

	it('removes a value whose elements do balance', () => {
		expect(removeAttributes('<A data-testid={<p><p>x</p></p>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<Foo.Bar>x</Foo.Bar>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<svg:rect />} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<my-el>x</my-el>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
		expect(removeAttributes('<A data-testid={<>x</>} b="1" />', ['data-testid'])).toBe('<A b="1" />');
	});

	it('removes a comparison against a non-null assertion', () => {
		expect(
			removeAttributes('function Cell() {\n  return (\n    <td data-testid={n!<max}>{n}</td>\n  );\n}', [
				'data-testid',
			]),
		).toBe('function Cell() {\n  return (\n    <td>{n}</td>\n  );\n}');
	});
});

describe('removeAttributes on generic parameter lists', () => {
	it('removes a value holding a generic arrow function', () => {
		expect(removeAttributes('<A data-testid={<T,>(x: T) => x} class="x" />', ['data-testid'])).toBe('<A class="x" />');
		expect(removeAttributes('<A data-testid={<T, U>(x: T, y: U) => [x, y]} class="x" />', ['data-testid'])).toBe(
			'<A class="x" />',
		);
		expect(removeAttributes('<A data-testid={<T extends U>(x: T) => x} class="x" />', ['data-testid'])).toBe(
			'<A class="x" />',
		);
	});

	it('removes the attribute without cutting the module around it', () => {
		const INPUT =
			'export function Card({items}: Props) {\n  return (\n    <section data-testid={<T,>(x: T) =>\n        x} className="card">\n      <h2>Title</h2>\n    </section>\n  );\n}\nexport const OTHER = { id: 1 };';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(
			'export function Card({items}: Props) {\n  return (\n    <section className="card">\n      <h2>Title</h2>\n    </section>\n  );\n}\nexport const OTHER = { id: 1 };',
		);
	});

	it('removes a value holding an element whose attribute is named after the constraint keyword', () => {
		expect(removeAttributes('<A data-testid={<Foo extends="x">y</Foo>} class="x" />', ['data-testid'])).toBe(
			'<A class="x" />',
		);
		expect(removeAttributes('<A data-testid={<p>x</p extends >} class="k" />', ['data-testid'])).toBe(
			'<A class="k" />',
		);
	});

	it('leaves the forms a generic parameter list cannot be told from in place', () => {
		// An old-style cast, a bare attribute named after the constraint keyword and an element name followed
		// by a comma all stay ambiguous, and are reported as attributes the plugin had to keep
		for (const INPUT of [
			'<A data-testid={<Foo>bar} class="x" />',
			'<A data-testid={<Foo extends >y</Foo>} class="x" />',
			'<A data-testid={<A,>{x}</A>} class="x" />',
		]) {
			expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
			expect(findSkipped(INPUT, ['data-testid'])).toEqual([3]);
		}
	});
});

describe('removeAttributes on tagged template placeholders', () => {
	it('removes a value interpolated from a `${…}` placeholder', () => {
		expect(removeAttributes('html`<div data-testid=${id} class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
	});

	it('removes a placeholder holding a nested template literal', () => {
		expect(removeAttributes('html`<div data-testid=${cond ? \'a\' : `b${c}`} class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
	});

	it('removes a placeholder written inside quotes', () => {
		expect(removeAttributes('html`<div data-testid="${id}" class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
	});

	it('ends the range at the placeholder rather than at the attribute that follows it', () => {
		const INPUT = 'html`<div data-testid=${id} class="k"></div>`';

		expect(findRanges(INPUT, ['data-testid'])).toEqual([[9, 27]]);
		expect(INPUT.slice(9, 27)).toBe(' data-testid=${id}');
	});

	it('reads a `$` that opens no placeholder as an ordinary unquoted value', () => {
		expect(removeAttributes('<div data-testid=$foo class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div data-testid=$foo>', ['data-testid'])).toBe('<div>');
	});

	it('leaves an unbalanced placeholder in place and reports it', () => {
		const INPUT = 'html`<div data-testid=${id class="k"></div>`';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(findSkipped(INPUT, ['data-testid'])).toEqual([10]);
	});

	it('removes a value interpolated from several placeholders', () => {
		expect(removeAttributes('html`<div data-testid=${a}${b} class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
		expect(removeAttributes('html`<div data-testid=${a}-${b} class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
	});

	it('removes a value a placeholder and a plain run make up together', () => {
		expect(removeAttributes('html`<div data-testid=${a}suffix class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
		expect(removeAttributes('html`<div data-testid=a${b} class="k"></div>`', ['data-testid'])).toBe(
			'html`<div class="k"></div>`',
		);
	});

	it('leaves a value whose second placeholder does not balance in place and reports it', () => {
		const INPUT = 'html`<div data-testid=${a}${ class="k"></div>`';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(findSkipped(INPUT, ['data-testid'])).toEqual([10]);
	});

	it('leaves a placeholder that no separator follows in place and reports it', () => {
		// Where the next attribute is written right against the placeholder, nothing says how much of what
		// follows belongs to the value, so the attribute stays rather than taking a name down with it
		const INPUT = 'html`<div data-testid=${a}class="k"></div>`';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(findSkipped(INPUT, ['data-testid'])).toEqual([10]);
	});
});

describe('createAttributeMatcher on quoted placeholders', () => {
	it.each(QUOTED_PLACEHOLDER_CASES)('removes $name as a whole', ({ input, expected }) => {
		const { ranges, skipped } = matchPlaceholderAttributes(input, PLACEHOLDER_ATTRIBUTES);

		expect(removeRanges(input, ranges)).toBe(expected);
		expect(skipped).toEqual([]);
	});

	it('removes the outer attribute in one range, the nested one inside it included', () => {
		const INPUT = 'html`<div data-testid="${ok ? html`<b data-testid="x">y</b>` : ""}" class="k"></div>`';

		expect(matchPlaceholderAttributes(INPUT, ['data-testid']).ranges).toEqual([[9, 67]]);
		expect(INPUT.slice(9, 67)).toBe(' data-testid="${ok ? html`<b data-testid="x">y</b>` : ""}"');
	});

	it('keeps the whitespace in front of a value a minified neighbor follows', () => {
		const INPUT = 'html`<div data-testid="${a}"class="k">`';

		expect(matchPlaceholderAttributes(INPUT, ['data-testid']).ranges).toEqual([[10, 28]]);
		expect(INPUT.slice(10, 28)).toBe('data-testid="${a}"');
	});

	it('leaves a value whose quote never closes after its placeholder in place and reports it', () => {
		const INPUT = 'html`<div data-testid="${a} class=k></div>`';
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(ranges).toEqual([]);
		expect(skipped).toEqual([10]);
	});

	it('leaves a value whose quote only closes inside its placeholder in place and reports it', () => {
		const INPUT = 'html`<div data-testid="${ok ? "a" : "b"} class=k></div>`';
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(ranges).toEqual([]);
		expect(skipped).toEqual([10]);
	});
});

describe('createAttributeMatcher on quoted placeholders with the flag off', () => {
	it.each(QUOTED_PLACEHOLDER_CASES)('keeps the plain read of $name', ({ input, plainExpected }) => {
		expect(removeAttributes(input, PLACEHOLDER_ATTRIBUTES)).toBe(plainExpected);
	});

	it('reads an omitted flag as off', () => {
		const INPUT = 'html`<div data-testid="${ok ? "a" : "b"}" class="k"></div>`';
		const MATCH_ATTRIBUTES = createAttributeMatcher(['data-testid']);

		expect(MATCH_ATTRIBUTES(INPUT, { hasQuotedMustache: false })).toEqual(
			MATCH_ATTRIBUTES(INPUT, { hasQuotedMustache: false, hasQuotedPlaceholder: false }),
		);
		expect(MATCH_ATTRIBUTES(INPUT, { hasQuotedMustache: false }).ranges).toEqual([[10, 31]]);
		expect(INPUT.slice(10, 31)).toBe('data-testid="${ok ? "');
	});

	it('still leaves a value whose quote never closes in place and reports it', () => {
		const INPUT = 'html`<div data-testid="${a} class=k></div>`';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(findSkipped(INPUT, ['data-testid'])).toEqual([10]);
	});
});

describe('createAttributeMatcher on a literal `${` or `{` in a quoted value', () => {
	it('falls back to the plain read on the last element of a component, rather than closing on its brace', () => {
		const INPUT =
			'export function Price() {\n  return <span data-testid="${" className="p">{price}</span>;\n}\n\nexport function Other() {\n  return <b className="o">o</b>;\n}\n';
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);
		const OUTPUT = removeRanges(INPUT, ranges);

		expect(OUTPUT).toBe(
			'export function Price() {\n  return <span className="p">{price}</span>;\n}\n\nexport function Other() {\n  return <b className="o">o</b>;\n}\n',
		);
		// The plain read measures the value, so nothing is left in place
		expect(skipped).toEqual([]);
		expect(parseSync('module.tsx', OUTPUT).errors).toEqual([]);
	});

	it.each([
		{
			name: 'the string its closing quote opens runs into a newline',
			input: '<b data-testid="${" hidden>x</b>\n}\n<i title="y">',
			expected: '<b hidden>x</b>\n}\n<i title="y">',
		},
		{
			name: 'an attribute value follows that string on its line',
			input: '<b data-testid="${" class="p">x</b><i title="}">',
			expected: '<b class="p">x</b><i title="}">',
		},
		{
			name: 'a brace follows that string on its line',
			input: '<b data-testid="${" :class="{a: b}">x</b><i :style="}">',
			expected: '<b :class="{a: b}">x</b><i :style="}">',
		},
		{
			name: 'another string follows that string on its line',
			input: '<b data-testid="${" class="">x</b><i title="}">',
			expected: '<b class="">x</b><i title="}">',
		},
		{
			name: 'a word longer than every operator keyword follows that string',
			input: '<b data-testid="${" c="instanceofx}">',
			expected: '<b c="instanceofx}">',
		},
	])('falls back to the plain read when $name', ({ input, expected }) => {
		const { ranges, skipped } = matchPlaceholderAttributes(input, ['data-testid']);

		expect(removeRanges(input, ranges)).toBe(expected);
		expect(skipped).toEqual([]);
	});

	it('falls back to the plain read on a literal `{` in a Svelte quoted value the same way', () => {
		expect(removeSvelteAttributes('<b data-testid="{" class="p">x</b><i title="}">', ['data-testid'])).toBe(
			'<b class="p">x</b><i title="}">',
		);
	});

	it.each([
		{ name: 'an `as` assertion', input: 'html`<b data-testid="${mode as "a" | "b"}" class="k">`' },
		{ name: 'an `in` operator', input: 'html`<b data-testid="${"a" in o ? "x" : "y"}" class="k">`' },
		{
			name: 'an `instanceof` operator',
			input: 'html`<b data-testid="${"a" instanceof String ? "x" : "y"}" class="k">`',
		},
		{
			name: 'a `satisfies` operator',
			input: 'html`<b data-testid="${("a" satisfies string) ? "x" : "y"}" class="k">`',
		},
		{
			name: 'a statement on the next line',
			input: 'html`<b data-testid="${(() => {\n  const v = "y"\n  return v\n})()}" class="k">`',
		},
		{ name: 'an index and a member access', input: 'html`<b data-testid="${"ab"[0] + "cd".length}" class="k">`' },
		{ name: 'a comment', input: 'html`<b data-testid="${"a" /* x */ + "b"}" class="k">`' },
	])('still removes a placeholder whose string is followed by $name as a whole', ({ input }) => {
		const { ranges, skipped } = matchPlaceholderAttributes(input, ['data-testid']);

		expect(removeRanges(input, ranges)).toBe('html`<b class="k">`');
		expect(skipped).toEqual([]);
	});

	it('charges a literal `${` only up to where its scan lost track, so later values are still measured', () => {
		// Charging each of them the rest of the input would spend the budget long before the expression value
		const INPUT = `${'<i data-testid="${" class="p">\n'.repeat(200)}<p data-testid={id} class="x">`;
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(removeRanges(INPUT, ranges)).toBe(`${'<i class="p">\n'.repeat(200)}<p class="x">`);
		expect(skipped).toEqual([]);
	});
});

describe('createAttributeMatcher on a `$` in a Svelte quoted value', () => {
	it('reads `${…}` as literal text followed by a mustache', () => {
		expect(removeSvelteAttributes('<p data-testid="cost ${price}" class="k"></p>', ['data-testid'])).toBe(
			'<p class="k"></p>',
		);
		expect(removeSvelteAttributes('<p data-testid="cost ${ok ? "a" : "b"}" class="k"></p>', ['data-testid'])).toBe(
			'<p class="k"></p>',
		);
	});

	it('reads a backslash in front of `${` as literal text, since Svelte escapes nothing', () => {
		expect(removeSvelteAttributes('<p data-testid="\\${" title="}"></p>', ['data-testid'])).toBe('<p></p>');
	});
});

describe('removeAttributes on Vue modifiers', () => {
	it('removes a bound name carrying no modifier at all', () => {
		expect(removeAttributes('<div :data-testid="x" class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div v-bind:data-testid="x" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('removes one modifier and a chain of them', () => {
		expect(removeAttributes('<div :data-testid.attr="x" class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div v-bind:data-testid.camel.prop="x" class="k">', ['data-testid'])).toBe(
			'<div class="k">',
		);
		expect(removeAttributes('<div :data-testid.foo-bar="x" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('removes a bare bound name carrying a modifier', () => {
		expect(removeAttributes('<div :data-testid.attr class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<input v-bind:data-testid.prop />', ['data-testid'])).toBe('<input />');
	});

	it('leaves a dotted suffix alone without a binding prefix', () => {
		expect(removeAttributes('<div data-testid.foo="x" class="k">', ['data-testid'])).toBe(
			'<div data-testid.foo="x" class="k">',
		);
		expect(removeAttributes('<div data-testid.foo class="k">', ['data-testid'])).toBe(
			'<div data-testid.foo class="k">',
		);
	});

	it('still refuses a longer bound name', () => {
		expect(removeAttributes('<div :data-testid-extra="x" class="k">', ['data-testid'])).toBe(
			'<div :data-testid-extra="x" class="k">',
		);
	});
});

describe('removeAttributes on an attribute with no whitespace in front of it', () => {
	it('removes an attribute starting right after the previous value', () => {
		expect(removeAttributes('<div class="x"data-testid="y">', ['data-testid'])).toBe('<div class="x">');
		expect(removeAttributes("<div class='x'data-testid='y'>", ['data-testid'])).toBe("<div class='x'>");
		expect(removeAttributes('<A b={1}data-testid="y" />', ['data-testid'])).toBe('<A b={1} />');
		expect(removeAttributes('<div data-testid="a"data-testid="b"class="c">', ['data-testid'])).toBe('<div class="c">');
	});

	it('leaves a name that merely ends a longer one untouched', () => {
		expect(removeAttributes('<div xdata-testid="y">', ['data-testid'])).toBe('<div xdata-testid="y">');
		expect(removeAttributes('<div foo-data-testid="y">', ['data-testid'])).toBe('<div foo-data-testid="y">');
		expect(removeAttributes('<div data-testid-extra="y">', ['data-testid'])).toBe('<div data-testid-extra="y">');
	});

	it('keeps the ranges sorted and non-overlapping', () => {
		const INPUT = '<div data-testid="a"data-testid="b"class="c">';

		expect(findRanges(INPUT, ['data-testid'])).toEqual([
			[5, 20],
			[20, 35],
		]);
	});
});

describe('createAttributeMatcher skipped attributes', () => {
	it('reports the name-start index of every attribute left in place', () => {
		expect(findSkipped('<div data-testid={ oops>', ['data-testid'])).toEqual([5]);
		expect(findSkipped('<div data-testid="unterminated>', ['data-testid'])).toEqual([5]);
		expect(findSkipped('<div data-testid=>', ['data-testid'])).toEqual([5]);
		expect(findSkipped('<div data-testid={ a>\n<p data-testid={ b>', ['data-testid'])).toEqual([5, 25]);
	});

	it('reports nothing for an attribute that is removed or is not one at all', () => {
		expect(findSkipped('<div data-testid="a" class="b">', ['data-testid'])).toEqual([]);
		expect(findSkipped('<div xdata-testid="a">', ['data-testid'])).toEqual([]);
		expect(findSkipped('<div data-testid-extra="a">', ['data-testid'])).toEqual([]);
	});

	it('reports the attributes left in place alongside the ranges it did find', () => {
		const INPUT = '<div data-testid={ oops>\n<p data-testid="a" class="x">1</p>';

		expect(createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: false })).toEqual({
			ranges: [[27, 43]],
			skipped: [5],
		});
	});
});

describe('removeAttributes across lines', () => {
	const ATTRIBUTES = ['data-testid', 'data-cy'];

	it.each(MULTI_LINE_CASES)('$name', ({ input, expected }) => {
		expect(removeAttributes(input, ATTRIBUTES)).toBe(expected);
	});
});

describe('removeAttributes on pathological input', () => {
	/**
	 * Measures how long one matcher call takes on the given markup.
	 *
	 * @param input - The markup to scan.
	 * @param hasQuotedMustache - Whether a `{` inside a quoted value opens an expression.
	 *
	 * @returns The elapsed milliseconds.
	 */
	function measureMatch(input: string, hasQuotedMustache: boolean): number {
		const MATCH_ATTRIBUTES = createAttributeMatcher(['data-testid']);
		const STARTED_AT = performance.now();

		MATCH_ATTRIBUTES(input, { hasQuotedMustache });

		return performance.now() - STARTED_AT;
	}

	it('bounds the work spent on thousands of unterminated expressions', () => {
		expect(measureMatch('<div data-testid={ '.repeat(4000), false)).toBeLessThan(1000);
	});

	it('bounds the work spent on thousands of unterminated strings inside expressions', () => {
		expect(measureMatch("<div data-testid={'x ".repeat(4000), false)).toBeLessThan(1000);
	});

	it('bounds the work spent on thousands of unbalanced quoted mustaches', () => {
		expect(measureMatch('<div data-testid="{a '.repeat(4000), true)).toBeLessThan(1000);
	});
});

describe('removeAttributes with quoted mustaches', () => {
	it('removes a quoted value holding a Svelte mustache', () => {
		expect(removeSvelteAttributes('<div data-testid="{a ? "b" : "c"}" class="k">', ['data-testid'])).toBe(
			'<div class="k">',
		);
		expect(removeSvelteAttributes('<div data-testid="prefix-{id}" class="k">', ['data-testid'])).toBe(
			'<div class="k">',
		);
	});

	it('falls back to the first closing quote when the mustache is unbalanced', () => {
		expect(removeSvelteAttributes('<div data-testid="{a ? \'b\'" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('still removes the other value forms', () => {
		expect(removeSvelteAttributes('<div data-testid={id} class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeSvelteAttributes('<div data-testid=foo class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeSvelteAttributes('<div data-testid class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('leaves a value whose quote never closes in place and reports it', () => {
		const INPUT = '<div data-testid="{a}b class=k>';

		expect(removeSvelteAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: true }).skipped).toEqual([5]);
	});
});

describe('findExpressionEnd on regular expression literals', () => {
	it('reads an escaped slash inside a literal as part of it', () => {
		expect(findExpressionEnd('{/a\\/b}/}', 0)).toBe(8);
		expect(findExpressionEnd('{/a\\/b}/.test(x)}', 0)).toBe(16);
	});

	it('ends a literal at a newline, since one cannot span lines', () => {
		expect(findExpressionEnd('{x in /a\n b}', 0)).toBe(11);
		expect(findExpressionEnd('{typeof /a\n}', 0)).toBe(11);
	});

	it('reads a slash inside a character class as part of the class', () => {
		expect(findExpressionEnd('{/[/]/.test(x)}', 0)).toBe(14);
	});

	it('closes a value whose comment ends before the brace', () => {
		expect(findExpressionEnd('{a // x\n}', 0)).toBe(8);
		expect(findExpressionEnd('{a /* x */}', 0)).toBe(10);
	});

	it('returns -1 for a comment the input never ends', () => {
		expect(findExpressionEnd('{a // x', 0)).toBe(-1);
		expect(findExpressionEnd('{a /* x', 0)).toBe(-1);
	});
});

describe('findExpressionEnd on the bounded state it tracks', () => {
	it('pairs two element names agreeing over the tracked prefix', () => {
		// Documented collision: only the first 64 characters of a name decide which element a closing tag ends
		const INPUT = `{<${'a'.repeat(65)}>x</${'a'.repeat(64)}b>}`;

		expect(findExpressionEnd(INPUT, 0)).toBe(INPUT.length - 1);
	});

	it('reads a slash after an identifier longer than the tracked prefix as division', () => {
		expect(findExpressionEnd('{xxxxxxxxxxxreturn / 2}', 0)).toBe(22);
	});

	it('closes an identifier run at whitespace rather than fusing two of them', () => {
		// The token in front of the slash is `b`, not `ab`, so the slash divides
		expect(findExpressionEnd('{a b /re/}', 0)).toBe(9);
	});

	it('reads the content of a fragment as text rather than as an attribute list', () => {
		expect(findExpressionEnd('{<> a="b" </>}', 0)).toBe(13);
		expect(findExpressionEnd('{<A><>x</></A>}', 0)).toBe(14);
	});

	it('reads every brace in the text of an element as a nested expression', () => {
		expect(findExpressionEnd('{<p>a{b}c{d}e</p>}', 0)).toBe(17);
	});

	it('reads a placeholder nested in a template inside an attribute of a nested element', () => {
		expect(findExpressionEnd('{<A x={`a${b ? `${c}` : d}e`} />}', 0)).toBe(32);
	});

	it('treats an escaped backtick in a template literal as content', () => {
		expect(findExpressionEnd('{`a\\`}`}', 0)).toBe(7);
	});

	it('reads a `</` inside a string or a template literal as content', () => {
		expect(findExpressionEnd("{'</p>'}", 0)).toBe(7);
		expect(findExpressionEnd('{`</p>`}', 0)).toBe(7);
	});

	it('reads a slash after a self-closing element nested in text as a division', () => {
		expect(findExpressionEnd('{<div><A /> / 2</div>}', 0)).toBe(21);
	});

	it('gives up on a closing tag naming another element even when a later brace balances', () => {
		expect(findExpressionEnd('{<a>x</b>} + {y}', 0)).toBe(-1);
	});

	it('gives up on a generic parameter list opened in the text of an element', () => {
		expect(findExpressionEnd('{<p><T,>x</p>}', 0)).toBe(-1);
	});
});

describe('removeAttributes on every value form', () => {
	it('removes an empty value', () => {
		expect(removeAttributes('<div data-testid="" class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div data-testid=\'\' class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div data-testid={} class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('removes a backtick value', () => {
		expect(removeAttributes('<div data-testid=`a` class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('leaves an assignment carrying no value in place and reports it', () => {
		expect(removeAttributes('<div data-testid=', ['data-testid'])).toBe('<div data-testid=');
		expect(findSkipped('<div data-testid=', ['data-testid'])).toEqual([5]);
		expect(removeAttributes('<div data-testid=>', ['data-testid'])).toBe('<div data-testid=>');
		expect(findSkipped('<div data-testid=>', ['data-testid'])).toEqual([5]);
	});

	it('keeps a slash inside an unquoted value and ends it at a self-closing one', () => {
		expect(removeAttributes('<a data-testid=a/b href="/">go</a>', ['data-testid'])).toBe('<a href="/">go</a>');
		expect(removeAttributes('<input data-testid=foo/>', ['data-testid'])).toBe('<input/>');
	});

	it('leaves an unquoted value that no separator ends in place and reports it', () => {
		// A run stopping at a character no unquoted value may hold is not the end of the value: cutting there
		// would leave the rest of it behind as markup of its own (`<div =b class="k">`)
		for (const INPUT of ['<div data-testid=a=b class="k">', '<div data-testid=a<b class="k">']) {
			expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
			expect(findSkipped(INPUT, ['data-testid'])).toEqual([5]);
		}
	});

	it.each([
		{ name: 'a brace after a plain run', input: '<i data-testid=a{b} class="k">', expected: '<i class="k">' },
		{ name: 'a brace after a placeholder', input: '<i data-testid=${a}{b} class="k">', expected: '<i class="k">' },
		{ name: 'plain runs between braces', input: '<i data-testid=a{b}c{d} class="k">', expected: '<i class="k">' },
		{ name: 'a closing brace inside a string', input: '<i data-testid=a{"}"} class="k">', expected: '<i class="k">' },
		{ name: 'a self-closing end right after it', input: '<i data-testid=a{b}/>', expected: '<i/>' },
		{ name: 'a tag end right after it', input: '<i data-testid=a{b}>', expected: '<i>' },
		{
			name: 'the escaped placeholder of a compiled Solid template',
			input: 'template(`<i data-testid=$\\{props.id} class=a>`)',
			expected: 'template(`<i class=a>`)',
		},
	])('continues an unquoted value through $name', ({ input, expected }) => {
		expect(removeAttributes(input, ['data-testid'])).toBe(expected);
		expect(findSkipped(input, ['data-testid'])).toEqual([]);
	});

	it('removes the whole unquoted value whichever syntax the file is read as', () => {
		const INPUT = '<i data-testid=a{ok ? "b" : "c"}d class="k">';

		expect(removeSvelteAttributes(INPUT, ['data-testid'])).toBe('<i class="k">');
		expect(removePlaceholderAttributes(INPUT, ['data-testid'])).toBe('<i class="k">');
	});

	it('leaves an unquoted value whose brace never closes in place and reports it', () => {
		// Ending the value at the brace would leave the rest behind as an attribute of its own (`<i {b class="k">`)
		for (const INPUT of ['<i data-testid=a{b class="k">', '<i data-testid=a{b}c{ class="k">']) {
			expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
			expect(findSkipped(INPUT, ['data-testid'])).toEqual([3]);
		}
	});

	it('still ends an expression value at its own brace, whatever follows it', () => {
		// The `={…}` form is not an unquoted value: a minifier writes the next attribute right against its brace
		expect(removeAttributes('<i data-testid={a}b class="k">', ['data-testid'])).toBe('<i b class="k">');
	});

	it('removes a value holding characters outside the basic plane', () => {
		expect(removeAttributes('<div data-testid="🎉x" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('consumes a carriage return, a tab, a form feed and a vertical tab in front of the attribute', () => {
		expect(removeAttributes('<div\r\tdata-testid="x"\rclass="a">', ['data-testid'])).toBe('<div\rclass="a">');
		expect(removeAttributes('<div\f\vdata-testid="x" class="a">', ['data-testid'])).toBe('<div class="a">');
	});
});

describe('removeAttributes on attribute boundaries', () => {
	it('removes an attribute written right after a spread', () => {
		expect(removeAttributes('<A {...props}data-testid="x" b="1" />', ['data-testid'])).toBe('<A {...props} b="1" />');
	});

	it('leaves a name that a letter, a digit, a dash, an underscore or a namespace runs into', () => {
		for (const INPUT of [
			'<div xdata-testid="y">',
			'<div 1data-testid="y">',
			'<div foo-data-testid="y">',
			'<div _data-testid="y">',
			'<use xlink:data-testid="y" />',
		]) {
			expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		}
	});

	it('leaves the Vue event and slot shorthands alone', () => {
		expect(removeAttributes('<div @data-testid="x" class="k">', ['data-testid'])).toBe(
			'<div @data-testid="x" class="k">',
		);
		expect(removeAttributes('<div #data-testid="x" class="k">', ['data-testid'])).toBe(
			'<div #data-testid="x" class="k">',
		);
	});

	it('removes a binding prefix written in mixed case, modifiers included', () => {
		expect(removeAttributes('<div V-Bind:data-testid.Camel="x" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('removes a bound name ending in a lone dot', () => {
		expect(removeAttributes('<div :data-testid. class="k">', ['data-testid'])).toBe('<div class="k">');
		expect(removeAttributes('<div :data-testid.="x" class="k">', ['data-testid'])).toBe('<div class="k">');
	});

	it('leaves a name that starts the input, with nothing in front of it to consume', () => {
		expect(removeAttributes('data-testid="x"', ['data-testid'])).toBe('data-testid="x"');
		expect(findRanges('data-testid="x"', ['data-testid'])).toEqual([]);
		expect(findSkipped('data-testid="x"', ['data-testid'])).toEqual([]);
	});
});

describe('createAttributeMatcher under a spent scan budget', () => {
	/**
	 * Five hundred expressions that never close, each skipped, which together spend the whole budget
	 */
	const EXHAUSTING_PREFIX = '<div data-testid={ '.repeat(500);

	it('skips and reports a well-formed expression value once the budget is gone', () => {
		const INPUT = `${EXHAUSTING_PREFIX}<p data-testid={id} class="x">1</p>`;
		const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: false });

		expect(ranges).toEqual([]);
		expect(skipped).toHaveLength(501);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
	});

	it('skips and reports a nested-quote Svelte mustache once the budget is gone, rather than cutting it', () => {
		const INPUT = `${EXHAUSTING_PREFIX}<p data-testid="{ok ? "a" : "b"}" class="k">`;
		const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: true });

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(501);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});

	it('skips and reports a nested-quote placeholder once the budget is gone, rather than cutting it', () => {
		const INPUT = `${EXHAUSTING_PREFIX}<p data-testid="\${ok ? "a" : "b"}" class="k">`;
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(501);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});

	it.each([
		{ syntax: 'a Svelte file', options: { hasQuotedMustache: true } },
		{ syntax: 'a non-Svelte file', options: { hasQuotedMustache: false, hasQuotedPlaceholder: true } },
		{ syntax: 'the plain read', options: { hasQuotedMustache: false } },
	])('still removes a quoted value holding no expression in $syntax once the budget is gone', ({ options }) => {
		const INPUT = `${EXHAUSTING_PREFIX}<p data-testid="plain" class="k">`;
		const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, options);

		expect(removeRanges(INPUT, ranges)).toBe(`${EXHAUSTING_PREFIX}<p class="k">`);
		expect(skipped).toHaveLength(500);
	});

	it('charges unquoted values rejected after their placeholders balanced, until later ones are skipped', () => {
		// Every value balances its placeholders over the rest of the input, then runs into an `=` that cannot end
		// it. Charging that work is what spends the budget, so the well-formed value at the end is left unscanned
		const INPUT = `<p${' data-testid=${'.repeat(50)}${'}='.repeat(50)}\n<p data-testid=\${id} class=k>`;
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(51);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});

	it('skips and reports an unquoted value interpolating a brace once the budget is gone', () => {
		const INPUT = `${EXHAUSTING_PREFIX}<p data-testid=a{b} class="k">`;
		const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: false });

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(501);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});

	it('charges unquoted values rejected after their braces balanced, until later ones are skipped', () => {
		const INPUT = `<p${' data-testid=a{'.repeat(50)}${'}='.repeat(50)}\n<p data-testid=a{b} class=k>`;
		const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: false });

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(51);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});

	it('charges quoted values whose quote never closes after their placeholders balanced, until later ones are skipped', () => {
		// Read the plain way, a value that cannot be measured runs to the quote the next copy opens with, so every
		// other name is text of the value before it rather than an attribute
		const INPUT = `<p${' data-testid="${`'.repeat(50)}${'`}'.repeat(50)}\n<p data-testid=\${id} class=k>`;
		const { ranges, skipped } = matchPlaceholderAttributes(INPUT, ['data-testid']);

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
		expect(skipped).toHaveLength(26);
		expect(skipped.at(-1)).toBe(INPUT.lastIndexOf('data-testid'));
	});
});

describe('createExtensionMatcher on unusual ids', () => {
	it('accepts an extension written with a dot and in upper case', () => {
		expect(createExtensionMatcher(['.SVELTE'])('/src/App.svelte')).toBe(true);
		expect(createExtensionMatcher(['.SVELTE'])('/src/App.SVELTE')).toBe(true);
	});

	it('does not match an extension that merely shares characters with another', () => {
		expect(createExtensionMatcher(['vue'])('/src/App.svelte')).toBe(false);
		expect(createExtensionMatcher(['svelte'])('/src/App.vue')).toBe(false);
	});

	it('refuses an id whose query carries the extension but whose path does not', () => {
		expect(createExtensionMatcher(['svelte'])('/src/App?svelte&type=style')).toBe(false);
	});

	it('reads the extension of a virtual id and of one followed by a hash', () => {
		expect(createExtensionMatcher(['svelte'])('\0virtual:/src/App.svelte')).toBe(true);
		expect(createExtensionMatcher(['svelte'])('/src/App.svelte#hash')).toBe(true);
	});
});

describe('createIgnoreMatcher on unusual tokens', () => {
	it('reads a backslash in a token as a path separator', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFolders: ['src\\tests'] });

		expect(HAS_CONFIGURED_PATH('src/tests/a.svelte')).toBe(true);
		expect(HAS_CONFIGURED_PATH('src\\tests/a.svelte')).toBe(false);
	});

	it('matches every path for a token made of nothing but wildcards', () => {
		expect(createIgnoreMatcherFor({ ignoreFiles: ['*'] })('a.svelte')).toBe(true);
		expect(createIgnoreMatcherFor({ ignoreFiles: ['**'] })('a/b.svelte')).toBe(true);
	});

	it('matches a wildcard at either edge of a segment', () => {
		expect(createIgnoreMatcherFor({ ignoreFiles: ['*.svelte'] })('src/a.svelte')).toBe(true);
		expect(createIgnoreMatcherFor({ ignoreFolders: ['foo*'] })('src/foobar/a.svelte')).toBe(true);
	});

	it('drops a `..` token, which names no segment once the leading parent segments are stripped', () => {
		expect(cleanIgnoredPaths(['..'])).toEqual([]);
		expect(createIgnoreMatcherFor({ ignoreFolders: ['..'] })('../x/a.svelte')).toBe(false);
	});

	it('matches a token written with Windows separators or leading parent segments', () => {
		expect(createIgnoreMatcherFor({ ignoreFolders: ['src\\tests'] })('src/tests/a.svelte')).toBe(true);
		expect(createIgnoreMatcherFor({ ignoreFolders: ['../shared'] })('../shared/a.svelte')).toBe(true);
		expect(createIgnoreMatcherFor({ ignoreFolders: ['../shared'] })('src/shared/a.svelte')).toBe(true);
	});

	it('matches a dependency resolved several levels outside the root', () => {
		expect(createIgnoreMatcherFor({})('../../x/node_modules/y/index.js')).toBe(true);
	});

	it('keeps the built-in tokens when the configured lists are empty', () => {
		expect(createIgnoreMatcherFor({ ignoreFolders: [], ignoreFiles: [] })('node_modules/a.js')).toBe(true);
	});
});

describe('removeRanges', () => {
	it('cuts a range starting at index 0', () => {
		expect(removeRanges('abcdef', [[0, 2]])).toBe('cdef');
	});

	it('cuts a range ending at the end of the input', () => {
		expect(removeRanges('abcdef', [[4, 6]])).toBe('abcd');
	});

	it('cuts adjacent ranges', () => {
		expect(
			removeRanges('abcdef', [
				[1, 2],
				[2, 3],
			]),
		).toBe('adef');
	});

	it('cuts a single character', () => {
		expect(removeRanges('abcdef', [[3, 4]])).toBe('abcef');
	});

	it('returns the input when there is no range', () => {
		expect(removeRanges('abcdef', [])).toBe('abcdef');
	});
});

describe('pinned limitations', () => {
	it('keeps an attribute name standing alone inside a string literal', () => {
		// Formerly pinned as removed: only the attribute list of an opening tag holds attributes
		const INPUT = "<script>const message = 'Missing data-testid on element';</script>";

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
	});

	it('keeps an identifier-named attribute in the script block of a component', () => {
		// Formerly pinned as removed, which broke the build: `title` in a `<script>` block is code
		const INPUT = '<script>\n\tlet title = \'Home\';\n</script>\n<h1 title="x">Home</h1>';

		expect(removeAttributes(INPUT, ['title'])).toBe("<script>\n\tlet title = 'Home';\n</script>\n<h1>Home</h1>");
	});

	it('keeps an attribute written right after a template-literal placeholder outside a tag', () => {
		// Formerly pinned as removed: outside a tag, the markup of a template literal is text
		const INPUT = 'const markup = `${x}data-testid="y"`;';

		expect(createAttributeMatcher(['data-testid'])(INPUT, { hasQuotedMustache: false, fileKind: 'ts' }).ranges).toEqual(
			[],
		);
	});

	it('takes the following attribute down with a stray unclosed mustache in a Svelte quoted value', () => {
		// README: in `.svelte` files, a quoted value with a stray unclosed `{` (not valid Svelte) can take the
		// following attribute down with it when that attribute's value closes the brace (`class="}c"`). One whose
		// value starts with a word (`class="b}c"`) stops reading as JavaScript first and is kept
		expect(removeSvelteAttributes('<div data-testid="a{" class="}c">', ['data-testid'])).toBe('<div>');
		expect(removeSvelteAttributes('<div data-testid="a{" class="b}c">', ['data-testid'])).toBe('<div class="b}c">');
	});

	it('takes the attribute a balanced literal `${` spans with it in a non-Svelte file', () => {
		// A JSX, Vue, Astro or HTML attribute holding a literal `${` is read as a placeholder: when a later quoted
		// value closes it (`data-testid="${" class="}"`), the attribute in between goes with the removed one
		expect(removePlaceholderAttributes('<div data-testid="${" class="}"></div>', ['data-testid'])).toBe('<div></div>');
		expect(removeAttributes('<div data-testid="${" class="}"></div>', ['data-testid'])).toBe('<div class="}"></div>');
	});

	it('takes every attribute up to a closing brace along when the markup after a literal `${` reads as JavaScript', () => {
		// Nothing but strings and operators between the literal `${` and a later brace reads exactly as a
		// placeholder holding a string would, so the value runs on to the quote after that brace — with no warning,
		// and even across elements (`<b>y</i>` is broken markup)
		expect(removePlaceholderAttributes('<p><b data-testid="${">x</b><i title="}">y</i></p>', ['data-testid'])).toBe(
			'<p><b>y</i></p>',
		);
		expect(removePlaceholderAttributes('<b data-testid="${" class="-}">x</b>', ['data-testid'])).toBe('<b>x</b>');
	});

	it('keeps an attribute written inside an HTML comment', () => {
		// Formerly pinned as removed: a comment holds no tag
		const INPUT = '<!-- <div data-testid="x"> --><p data-testid="y" class="k">y</p>';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe('<!-- <div data-testid="x"> --><p class="k">y</p>');
	});

	it('leaves an old-style cast in an expression value in place and reports it', () => {
		// README: an element opened inside the value that is never closed — including an old-style cast — leaves
		// the attribute in place and emits a build warning
		const INPUT = '<A data-testid={<Foo>bar} class="x" />';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(findSkipped(INPUT, ['data-testid'])).toEqual([3]);
	});
});
