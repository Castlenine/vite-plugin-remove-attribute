import { describe, expect, it } from 'vitest';

import {
	ASTRO_EXTENSIONS,
	cleanIgnoredPaths,
	DEFAULT_EXTENSIONS,
	DEFAULT_IGNORE_PATHS,
	findAttributeRanges,
	findExpressionEnd,
	getIgnoredPaths,
	getOptions,
	hasExtension,
	hasIgnorePath,
	HTML_EXTENSIONS,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	removeAttributes,
	SCRIPT_EXTENSIONS,
	stripQuery,
	SVELTE_EXTENSIONS,
	toRelativePath,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} from './utilities';

describe('getOptions', () => {
	it('defaults missing arrays and enables the built-in ignore list', () => {
		expect(getOptions({ extensions: ['svelte'], attributes: ['data-testid'] })).toEqual({
			extensions: ['svelte'],
			attributes: ['data-testid'],
			ignoreFolders: [],
			ignoreFiles: [],
			ignoreDefaults: true,
		});
	});

	it('falls back to the default extensions and an empty attributes array for non-array values', () => {
		// @ts-expect-error -- deliberately malformed input
		expect(getOptions({ extensions: 'svelte', attributes: null })).toMatchObject({
			extensions: [...DEFAULT_EXTENSIONS],
			attributes: [],
		});
	});

	it('keeps ignoreDefaults false', () => {
		expect(getOptions({ extensions: [], attributes: [], ignoreDefaults: false }).ignoreDefaults).toBe(false);
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
		// @ts-expect-error -- deliberately malformed input
		expect(cleanIgnoredPaths([null, 42, 'dist'])).toEqual(['dist']);
	});
});

describe('getIgnoredPaths', () => {
	it('merges folders, files and the defaults', () => {
		const RESULT = getIgnoredPaths(
			getOptions({ extensions: [], attributes: [], ignoreFolders: ['src/tests'], ignoreFiles: ['Header.svelte'] }),
		);

		expect(RESULT.slice(0, 2)).toEqual(['src/tests', 'Header.svelte']);
		expect(RESULT).toEqual(expect.arrayContaining([...DEFAULT_IGNORE_PATHS]));
	});

	it('omits the defaults when ignoreDefaults is false', () => {
		expect(
			getIgnoredPaths(getOptions({ extensions: [], attributes: [], ignoreFolders: ['x'], ignoreDefaults: false })),
		).toEqual(['x']);
	});
});

describe('stripQuery', () => {
	it('removes the Vite query suffix', () => {
		expect(stripQuery('/src/App.svelte?svelte&type=style&lang.css')).toBe('/src/App.svelte');
		expect(stripQuery('/src/App.svelte')).toBe('/src/App.svelte');
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

describe('hasIgnorePath', () => {
	it('does not match a source file against the defaults', () => {
		expect(hasIgnorePath('src/components/Button.svelte', DEFAULT_IGNORE_PATHS)).toBe(false);
	});

	it('matches only on segment boundaries', () => {
		expect(hasIgnorePath('buildhome/repo/src/App.svelte', DEFAULT_IGNORE_PATHS)).toBe(false);
		expect(hasIgnorePath('src/distribution/App.svelte', DEFAULT_IGNORE_PATHS)).toBe(false);
		expect(hasIgnorePath('build/app.js', DEFAULT_IGNORE_PATHS)).toBe(true);
		expect(hasIgnorePath('.svelte-kit/generated/root.svelte', DEFAULT_IGNORE_PATHS)).toBe(true);
	});

	it('matches dependencies resolved outside the root', () => {
		expect(hasIgnorePath('../../.pnpm/x/node_modules/y/dist/index.js', DEFAULT_IGNORE_PATHS)).toBe(true);
	});

	it('matches multi-segment tokens', () => {
		expect(hasIgnorePath('src/tests/a.svelte', ['src/tests'])).toBe(true);
		expect(hasIgnorePath('src/tests-e2e/a.svelte', ['src/tests'])).toBe(false);
		expect(hasIgnorePath('lib/src/tests/a.svelte', ['src/tests'])).toBe(true);
		expect(hasIgnorePath('src/components/Modal.svelte', ['src/components/Modal.svelte'])).toBe(true);
		expect(hasIgnorePath('src/components/Modal.svelte.bak', ['src/components/Modal.svelte'])).toBe(false);
	});

	it('matches file names anywhere in the tree', () => {
		expect(hasIgnorePath('src/layouts/Header.svelte', ['Header.svelte'])).toBe(true);
		expect(hasIgnorePath('src/layouts/SubHeader.svelte', ['Header.svelte'])).toBe(false);
	});

	it('supports * within a segment', () => {
		expect(hasIgnorePath('logs/server.log', ['*.log'])).toBe(true);
		expect(hasIgnorePath('.env.production', ['.env.*'])).toBe(true);
		expect(hasIgnorePath('src/Button.stories.svelte', ['*.stories.svelte'])).toBe(true);
		expect(hasIgnorePath('src/a/b.svelte', ['a*b.svelte'])).toBe(false);
	});

	it('treats regex characters in tokens literally', () => {
		expect(hasIgnorePath('src/(group)/page.svelte', ['(group)'])).toBe(true);
		expect(hasIgnorePath('src/group/page.svelte', ['(group)'])).toBe(false);
	});
});

describe('hasExtension', () => {
	it('matches configured extensions case-insensitively', () => {
		expect(hasExtension('/src/App.svelte', ['svelte'])).toBe(true);
		expect(hasExtension('/src/App.SVELTE', ['svelte'])).toBe(true);
		expect(hasExtension('/src/App.vue', ['svelte', 'ts'])).toBe(false);
	});

	it('ignores the query suffix', () => {
		expect(hasExtension('/src/App.svelte?svelte&type=style&lang.css', ['svelte'])).toBe(true);
	});

	it('accepts extensions with a leading dot and escapes them', () => {
		expect(hasExtension('/src/a.svelte', ['.svelte'])).toBe(true);
		expect(hasExtension('/src/axsvelte', ['svelte'])).toBe(false);
	});

	it('returns false without extensions', () => {
		expect(hasExtension('/src/App.svelte', [])).toBe(false);
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
});

describe('findAttributeRanges', () => {
	it('returns the range of each occurrence in source order', () => {
		const INPUT = '<ul data-testid="list"><li data-id={id} data-testid="item">x</li></ul>';

		expect(findAttributeRanges(INPUT, ['data-testid', 'data-id'])).toEqual([
			[3, 22],
			[26, 58],
		]);
	});

	it('merges touching and overlapping ranges', () => {
		expect(findAttributeRanges('<div data-testid="a" data-testid="b">', ['data-testid'])).toEqual([[4, 36]]);
		expect(findAttributeRanges('<div data-testid={ x } data-id="y">', ['data-testid', 'data-id'])).toEqual([[4, 34]]);
	});

	it('returns no range when nothing matches', () => {
		expect(findAttributeRanges('<div class="x">', ['data-testid'])).toEqual([]);
		expect(findAttributeRanges('<div class="x">', [])).toEqual([]);
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

	it('removes several attributes and occurrences', () => {
		const INPUT = '<ul data-testid="list"><li data-id={id} data-testid="item">x</li></ul>';

		expect(removeAttributes(INPUT, ['data-testid', 'data-id'])).toBe('<ul><li>x</li></ul>');
	});

	it('is case-insensitive on the attribute name', () => {
		expect(removeAttributes('<div DATA-TESTID="a">', ['data-testid'])).toBe('<div>');
	});

	it('leaves an unbalanced expression untouched', () => {
		const INPUT = '<div data-testid={a ? { b: 1 } : 2>';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
	});

	it('leaves longer or prefixed attribute names untouched', () => {
		expect(removeAttributes('<div data-testid-extra="x">', ['data-testid'])).toBe('<div data-testid-extra="x">');
		expect(removeAttributes('<div xdata-testid="x">', ['data-testid'])).toBe('<div xdata-testid="x">');
	});

	it('treats regex characters in attribute names literally', () => {
		expect(removeAttributes('<div data.id="x">', ['data.id'])).toBe('<div>');
		expect(removeAttributes('<div dataXid="x">', ['data.id'])).toBe('<div dataXid="x">');
	});

	it('returns the input unchanged when nothing matches', () => {
		const INPUT = '<div class="x">';

		expect(removeAttributes(INPUT, ['data-testid'])).toBe(INPUT);
		expect(removeAttributes(INPUT, [])).toBe(INPUT);
	});
});
