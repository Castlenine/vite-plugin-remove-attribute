import type { FileKind } from './utilities';
import type { Plugin, ResolvedConfig } from 'vite';

import { describe, expect, it } from 'vitest';
import { parseSync } from 'vite';

import { createAttributeMatcher, createTagMask, getFileKind, removeRanges } from './utilities';
import removeAttributesPlugin from './index';

type TransformResult = null | { code: string };

/**
 * Transforms one module the way Vite does, with `data-testid` configured for removal.
 *
 * @param code - The module source.
 * @param id - The module ID, whose extension selects how the file is read.
 *
 * @returns The transformed code, or the source itself when the plugin left the module untouched.
 */
function transform(code: string, id: string): string {
	const PLUGIN: Plugin = removeAttributesPlugin({
		attributes: ['data-testid'],
		extensions: ['html', 'svelte', 'vue', 'astro', 'md', 'mdx', 'svx', 'ts', 'tsx', 'js', 'jsx'],
	});

	const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
	const TRANSFORM = PLUGIN.transform as (code: string, id: string) => TransformResult;

	CONFIG_RESOLVED({ root: '/project', logger: { warn: () => undefined } } as unknown as ResolvedConfig);

	return TRANSFORM(code, id)?.code ?? code;
}

/**
 * Removes `data-testid` from a source of the given kind, reading quoted `${…}` placeholders the way every non-Svelte
 * file is read.
 *
 * @param input - The source.
 * @param fileKind - The kind of source.
 *
 * @returns The source without the attribute.
 */
function strip(input: string, fileKind: FileKind): string {
	const { ranges } = createAttributeMatcher(['data-testid'])(input, {
		hasQuotedMustache: false,
		hasQuotedPlaceholder: true,
		fileKind,
	});

	return removeRanges(input, ranges);
}

/**
 * Removes `data-testid` from a Svelte component, whose quoted values may hold `{…}` mustaches.
 *
 * @param input - The component source.
 *
 * @returns The source without the attribute.
 */
function stripSvelte(input: string): string {
	return removeRanges(input, createAttributeMatcher(['data-testid'])(input, { hasQuotedMustache: true }).ranges);
}

/**
 * Removes the given attributes with `removeInStrings` on, from a source read the way the plugin reads its kind.
 *
 * @param input - The source.
 * @param options.fileKind - The kind of source.
 * @param options.attributes - The attribute names to remove. Default: `['data-testid']`
 *
 * @returns The source without the attributes, and the name-start index of every attribute left in place.
 */
function stripInStrings(
	input: string,
	options: { fileKind: FileKind; attributes?: readonly string[] },
): { output: string; skipped: number[] } {
	const IS_SVELTE = options.fileKind === 'markup';
	const { ranges, skipped } = createAttributeMatcher(options.attributes ?? ['data-testid'], {
		removeInStrings: true,
	})(input, { hasQuotedMustache: IS_SVELTE, hasQuotedPlaceholder: !IS_SVELTE, fileKind: options.fileKind });

	return { output: removeRanges(input, ranges), skipped };
}

// ─── Verified repros ──────────────────────────────────────────────────────────

describe('region-aware matching on the verified repros', () => {
	it('keeps an attribute name written in the text of an HTML element', () => {
		expect(transform('<p data-testid="x">Add data-testid to every button</p>', '/project/index.html')).toBe(
			'<p>Add data-testid to every button</p>',
		);
	});

	it('keeps an escaped tag written inside a <pre> block', () => {
		expect(transform('<pre data-testid="x">&lt;div data-testid="x"&gt;</pre>', '/project/index.html')).toBe(
			'<pre>&lt;div data-testid="x"&gt;</pre>',
		);
	});

	it('keeps an attribute name written in the text child of a TSX element', () => {
		expect(
			transform('export const A = () => <p data-testid="x">Missing data-testid here</p>;', '/project/src/A.tsx'),
		).toBe('export const A = () => <p>Missing data-testid here</p>;');
	});

	it('keeps an attribute name written inside a string of a <script> block', () => {
		expect(
			transform(
				'<script>\n\tconst hint = "set data-testid first";\n</script>\n\n<b data-testid="y">b</b>',
				'/project/src/App.svelte',
			),
		).toBe('<script>\n\tconst hint = "set data-testid first";\n</script>\n\n<b>b</b>');
	});

	it('keeps a Markdown fenced code block byte-identical', () => {
		expect(
			transform('<div data-testid="a"></div>\n\n```html\n<div data-testid="b"></div>\n```\n', '/project/src/page.md'),
		).toBe('<div></div>\n\n```html\n<div data-testid="b"></div>\n```\n');
	});
});

// ─── File kinds ───────────────────────────────────────────────────────────────

describe('getFileKind', () => {
	it.each([
		['/src/App.tsx', 'script'],
		['/src/App.jsx', 'script'],
		['/src/app.js', 'script'],
		['/src/app.mjs', 'script'],
		['/src/app.cjs', 'script'],
		['/src/APP.TSX', 'script'],
		['/src/app.ts', 'ts'],
		['/src/app.mts', 'ts'],
		['/src/app.cts', 'ts'],
		['/src/Counter.svelte.ts', 'ts'],
		['/index.html', 'html'],
		['/index.htm', 'html'],
		['/index.html?html-proxy&index=0.js', 'script'],
		['/index.html?html-proxy&inline-css&index=0.css', 'html'],
		['/src/App.vue', 'vue'],
		['/src/App.vue?vue&type=script&setup=true&lang.ts', 'script'],
		['/src/App.vue?vue&type=template', 'vue'],
		['/src/App.vue?vue&mytype=script', 'vue'],
		['/src/App.vue?type=script', 'vue'],
		['/src/Page.astro', 'astro'],
		['/src/Page.astro?astro&type=script&index=0&lang.ts', 'script'],
		['/docs/page.md', 'markdown'],
		['/docs/page.mdx', 'markdown'],
		['/docs/page.svx', 'markdown'],
		['/src/App.svelte', 'markup'],
		['/src/page.hbs', 'markup'],
		['/src/Makefile', 'markup'],
		['/src/App.tsx#hash', 'script'],
	])('reads %s as %s', (id, fileKind) => {
		expect(getFileKind(id)).toBe(fileKind);
	});
});

// ─── Scripts ──────────────────────────────────────────────────────────────────

describe('region-aware matching in a script', () => {
	it('keeps strings, comments and regular expressions holding markup', () => {
		const INPUT = [
			'const single = \'<div data-testid="a">\';',
			'const double = "<div data-testid=\'b\'>";',
			'// <div data-testid="c">',
			'/* <div data-testid="d"> */',
			'const regex = /<div data-testid="e">/;',
		].join('\n');

		expect(strip(INPUT, 'script')).toBe(INPUT);
		expect(strip(INPUT, 'ts')).toBe(INPUT);
	});

	it('removes the attributes of JSX elements nested in attribute values and children', () => {
		expect(
			strip(
				'const A = () => <Show when={a > 0} fallback={<b data-testid="f" />} data-testid="s">{ok && <i data-testid="c" />}{<u data-testid="d" />}</Show>;',
				'script',
			),
		).toBe('const A = () => <Show when={a > 0} fallback={<b />}>{ok && <i />}{<u />}</Show>;');
	});

	it('reads the markup of every template literal, tagged or not', () => {
		expect(
			strip(
				'const a = html`<b data-testid="x">data-testid text</b>`;\nconst b = `<i title="data-testid y" data-testid=${id}>`;',
				'ts',
			),
		).toBe('const a = html`<b>data-testid text</b>`;\nconst b = `<i title="data-testid y">`;');
	});

	it('keeps the comments, values and text of template-literal markup', () => {
		const INPUT = [
			'const a = `<!-- <b data-testid="c"> --><p>x</p>`;',
			"const b = `<i title= data-testid a='data-testid'>`;",
			'const d = `a < b data-testid="x"`;',
			'const e = `<br/>data-testid="x"`;',
			'const f = `<a href=x/>data-testid="y"`;',
			'const g = `<a href=>data-testid="z"`;',
		].join('\n');

		expect(strip(INPUT, 'ts')).toBe(INPUT);
	});

	it('reads a placeholder naming the element, and escaped characters as the markup they cook to', () => {
		expect(strip('const a = html`<${tag} data-testid="x" class="k">`;', 'ts')).toBe(
			'const a = html`<${tag} class="k">`;',
		);
		expect(strip('const a = `<b title=\\"x\\" data-testid="y">`;', 'ts')).toBe('const a = `<b title=\\"x\\">`;');
		expect(strip('const a = `<b\\tdata-testid="y">`;', 'ts')).toBe('const a = `<b\\tdata-testid="y">`;');
	});

	it('reads a `<Name>` no closing tag follows as a type rather than an element', () => {
		const INPUT =
			'type F = <T>(x: T) => T;\nconst s = "<b data-testid=\'s\'>";\nconst e = <i data-testid="e" />;\nconst g = <T,>(x: T) => x;';

		expect(strip(INPUT, 'script')).toBe(INPUT.replace(' data-testid="e"', ''));
	});

	it('reads a `<Name>` a closing tag follows as an element', () => {
		expect(strip('const a = <T>x <b data-testid="x" /></T>;', 'script')).toBe('const a = <T>x <b /></T>;');
		expect(strip('const a = <><b data-testid="x" /></>;', 'script')).toBe('const a = <><b /></>;');
		expect(strip('const a = <T >x <b data-testid="x" /></T>;', 'script')).toBe('const a = <T >x <b /></T>;');
	});

	it('pairs every `<Name>` with the closing tags written after it only', () => {
		const INPUT = [
			'const a = <T>x</T>;',
			'const b = <T><b data-testid="b" /></T>;',
			'const c = <T>y</T>;',
			'type F = <T>(x: T) => T;',
			'const s = "<i data-testid=\'s\'>";',
		].join('\n');

		expect(strip(INPUT, 'script')).toBe(INPUT.replace(' data-testid="b"', ''));
	});

	it.each([
		['self-closing', 'const a = <A<string> data-testid="x" />;', 'const a = <A<string> />;'],
		[
			'with children',
			'const a = <A<string> data-testid="x"><b data-testid="y" /></A>;',
			'const a = <A<string>><b /></A>;',
		],
		[
			'nested in children',
			'const a = <div><A<string> title="x" data-testid="y" /></div>;',
			'const a = <div><A<string> title="x" /></div>;',
		],
		[
			'nested in an attribute value',
			'const a = <Show fallback={<A<string> data-testid="f" />} data-testid="s" />;',
			'const a = <Show fallback={<A<string> />} />;',
		],
		['holding an object type', 'const a = <A<{ a: 1 }> data-testid="x" />;', 'const a = <A<{ a: 1 }> />;'],
		['holding an array type', 'const a = <A<B[]> data-testid="x" />;', 'const a = <A<B[]> />;'],
		['holding a union type', 'const a = <A<B | C> data-testid="x" />;', 'const a = <A<B | C> />;'],
		['holding nested generics', 'const a = <A<Map<K, B<C>>> data-testid="x" />;', 'const a = <A<Map<K, B<C>>> />;'],
		['holding a function type', 'const a = <A<(x: T) => U> data-testid="x" />;', 'const a = <A<(x: T) => U> />;'],
		['holding a string with a `>`', 'const a = <A<\'>\' | "<"> data-testid="x" />;', 'const a = <A<\'>\' | "<"> />;'],
		['holding an escaped quote', "const a = <A<'>\\'>'> data-testid=\"x\" />;", "const a = <A<'>\\'>'> />;"],
	])('skips the type arguments of a generic element %s as one list', (_name, input, expected) => {
		expect(strip(input, 'script')).toBe(expected);
	});

	it('stops marking once the type arguments of an element close a bracket they never opened', () => {
		const INPUT = 'const a = <A<B)> data-testid="x" />;\nconst b = <i data-testid="y" />;';

		expect(strip(INPUT, 'script')).toBe(INPUT);
	});

	it('keeps removing attributes after a generic element nested in children', () => {
		const INPUT = [
			'function F() { return (<div><A<string> title="x" /></div>); }',
			'const P = <div data-testid="PROBE" />;',
		].join('\n');

		expect(strip(INPUT, 'script')).toBe(INPUT.replace(' data-testid="PROBE"', ''));
		expect(
			transform(
				'const a = <div><A<string> title="x" /></div>;\nconst P = <div data-testid="PROBE" />;',
				'/project/src/A.tsx',
			),
		).toBe('const a = <div><A<string> title="x" /></div>;\nconst P = <div />;');
	});

	it('reads the `default` keyword as the start of an operand, unless it names a property', () => {
		expect(strip('export default <div data-testid="x" />;', 'script')).toBe('export default <div />;');

		const REGULAR_EXPRESSION = 'export default /(<i data-testid="x">)/;\nconst a = <b data-testid="y" />;';

		expect(strip(REGULAR_EXPRESSION, 'script')).toBe(REGULAR_EXPRESSION.replace(' data-testid="y"', ''));
		expect(strip('const a = m.default / 2, b = <i data-testid="x" />, c = 1 / 3;', 'script')).toBe(
			'const a = m.default / 2, b = <i />, c = 1 / 3;',
		);
	});

	it('reads a quoted string that is the value of a `template` property as markup', () => {
		expect(
			strip(
				'@Component({ selector: \'x\', template: \'<div data-testid="a" class="q"><p>data-testid="t"</p></div>\' })',
				'ts',
			),
		).toBe('@Component({ selector: \'x\', template: \'<div class="q"><p>data-testid="t"</p></div>\' })');
		expect(strip('@Component({ template : "<div data-testid=\'a\'></div>" })', 'ts')).toBe(
			'@Component({ template : "<div></div>" })',
		);
	});

	it('keeps a quoted string that is no `template` property value, or holds an escape or a line break', () => {
		const INPUT = [
			'const a = { title: \'<div data-testid="a">\', mytemplate: \'<div data-testid="b">\' };',
			"const b = { template: '<div data-testid=\\'c\\' data-testid=\"d\">' };",
			'const c = x ? template : \'<div data-testid="e">\';',
			'const d = { template: \'<div data-testid="f">',
			"', 'template': '<div data-testid=\"g\">' };",
		].join('\n');

		expect(strip(INPUT, 'ts')).toBe(INPUT);
		// A literal the region ends in before its closing quote
		expect(strip('const e = { template: \'<div data-testid="h">', 'ts')).toBe(
			'const e = { template: \'<div data-testid="h">',
		);
	});

	it('keeps a `template` string whose markup does not close inside it', () => {
		const INPUT = [
			'@Component({ template: \'<div data-testid="a"\' })',
			"@Component({ template: '<div data-testid=\"' + id + '\">' })",
			'@Component({ template: "<div data-testid=\'b>" })',
		].join('\n');

		expect(strip(INPUT, 'ts')).toBe(INPUT);
	});

	it('never reads JSX in a TypeScript module', () => {
		const INPUT = 'const a = <T>value;\nconst b = <div data-testid="x" />;\nconst c = html`<i data-testid="y">`;';

		expect(strip(INPUT, 'ts')).toBe(INPUT.replace(' data-testid="y"', ''));
	});

	it('starts over after a brace that balances nothing', () => {
		expect(strip('}\nconst v = html`<i data-testid="x">`;', 'ts')).toBe('}\nconst v = html`<i>`;');
	});

	it('reads the content of a <script> or <style> element of template-literal markup as raw text', () => {
		const INPUT = [
			'const a = html`<script>if (1 <b) {} const s = \'<i data-testid="s">\';<\\/script><i data-testid="a">`;',
			'const b = html`<STYLE media="x">[data-testid] { }</style><i data-testid="b">`;',
			'const c = html`<script async=>1 <b data-testid="c1"></script><i data-testid="c2">`;',
			'const d = html`<script type=module>1 <b data-testid="d1"></script ><i data-testid="d2">`;',
		].join('\n');

		expect(strip(INPUT, 'ts')).toBe(
			INPUT.replace(' data-testid="a"', '')
				.replace(' data-testid="b"', '')
				.replace(' data-testid="c2"', '')
				.replace(' data-testid="d2"', ''),
		);
	});

	it('ends the raw text of template-literal markup only on the closing tag of its own element', () => {
		const INPUT = [
			'const a = html`<script>1 </scriptx> <b data-testid="a1"> <\\/style> <i data-testid="a2"></script>`;',
			'const b = html`<scripted><b data-testid="b"></scripted>`;',
		].join('\n');

		expect(strip(INPUT, 'ts')).toBe(INPUT.replace(' data-testid="b"', ''));
	});

	it('stops marking once the markup of a module cannot be followed', () => {
		const INPUT = 'const a = <div data-testid="a">x</span>;\nconst b = <i data-testid="b" />;';

		expect(strip(INPUT, 'script')).toBe('const a = <div>x</span>;\nconst b = <i data-testid="b" />;');
	});

	it('emits a module that still parses', () => {
		const OUTPUT = strip(
			'// data-testid\nconst hint = "data-testid";\nexport const A = () => <p data-testid="x" title={`<b data-testid="y">`}>data-testid</p>;',
			'script',
		);

		expect(OUTPUT).toBe(
			'// data-testid\nconst hint = "data-testid";\nexport const A = () => <p title={`<b>`}>data-testid</p>;',
		);
		expect(parseSync('module.tsx', OUTPUT).errors).toEqual([]);
	});
});

// ─── Markup strings ───────────────────────────────────────────────────────────

describe('region-aware matching of markup strings with removeInStrings', () => {
	it('keeps every string holding markup with the option off', () => {
		const INPUT = 'el.innerHTML = \'<div data-testid="a">\';\nconst b = "<i data-testid=\'b\'></i>";';
		const { ranges } = createAttributeMatcher(['data-testid'], { removeInStrings: false })(INPUT, {
			hasQuotedMustache: false,
			hasQuotedPlaceholder: true,
			fileKind: 'ts',
		});

		expect(removeRanges(INPUT, ranges)).toBe(INPUT);
	});

	it.each<[string, string, FileKind, string]>([
		[
			'a single-quoted string',
			'const a = \'<div data-testid="a" class="k"></div>\';',
			'ts',
			'const a = \'<div class="k"></div>\';',
		],
		['a double-quoted string', 'const b = "<div data-testid=\'b\'>x</div>";', 'script', 'const b = "<div>x</div>";'],
		[
			'an innerHTML assignment',
			'el.innerHTML = \'<p data-testid="c">text</p><!-- c --><br data-testid>\';',
			'ts',
			"el.innerHTML = '<p>text</p><!-- c --><br>';",
		],
		[
			'a string in a template-literal placeholder',
			'const d = `<ul>${\'<li data-testid="d">\'}</ul>`;',
			'ts',
			"const d = `<ul>${'<li>'}</ul>`;",
		],
		[
			'a Svelte {@html} tag',
			'{@html \'<em data-testid="e">x</em>\'}\n<p data-testid="p">',
			'markup',
			"{@html '<em>x</em>'}\n<p>",
		],
		['a Vue interpolation', '{{ \'<i data-testid="f">\' }}<p data-testid="p">', 'vue', "{{ '<i>' }}<p>"],
		[
			'an Astro frontmatter',
			'---\nconst g = \'<b data-testid="g">\';\n---\n<p data-testid="p">',
			'astro',
			"---\nconst g = '<b>';\n---\n<p>",
		],
		[
			'a <script> block',
			'<script>const h = "<b data-testid=\'h\'>";</script>',
			'html',
			'<script>const h = "<b>";</script>',
		],
	])('removes the attributes of %s', (_name, input, fileKind, expected) => {
		expect(stripInStrings(input, { fileKind })).toEqual({ output: expected, skipped: [] });
	});

	it.each([
		['holding no `<`', 'const a = \'data-testid="x"\';'],
		['holding an escaped quote', 'const b = "<div data-testid=\\"x\\">";'],
		['holding a line continuation', 'const c = \'<div data-testid="x">\\\n</div>\';'],
		['running into a line break', 'const d = \'<div data-testid="x">\nconst e = 1;'],
		['holding a tag split across concatenated strings', "const f = '<div data-testid=\"' + id + '\">';"],
		['holding an unclosed tag', "const g = '<div data-testid';"],
		['holding an unclosed quoted value', "const h = '<div data-testid=\"x>';"],
		['holding an unclosed comment', 'const i = \'<!-- <b data-testid="x">\';'],
		['holding an unclosed raw-text element', 'const j = \'<script><b data-testid="x">\';'],
		['holding a selector', 'document.querySelector(\'[data-testid="x"]\');'],
		['holding a `<` that opens no tag', 'const k = \'a < b data-testid="x"\';'],
		['never closing', 'const l = \'<b data-testid="x">'],
	])('keeps a string %s byte-identical', (_name, input) => {
		expect(stripInStrings(input, { fileKind: 'ts' })).toEqual({ output: input, skipped: [] });
	});

	it('keeps the value of a JSX attribute byte-identical', () => {
		const INPUT = 'const a = <A title=\'<b data-testid="x">\' data-testid="y" />;';

		expect(stripInStrings(INPUT, { fileKind: 'script' })).toEqual({
			output: 'const a = <A title=\'<b data-testid="x">\' />;',
			skipped: [],
		});
	});

	it('keeps a string holding a configured name as plain text', () => {
		expect(
			stripInStrings("let title = 'Home';\nconst a = '<b title=\"t\">' + title;", {
				fileKind: 'ts',
				attributes: ['title'],
			}),
		).toEqual({ output: "let title = 'Home';\nconst a = '<b>' + title;", skipped: [] });
	});

	it('skips an attribute whose value reads on past the closing quote of its string', () => {
		// A Svelte quoted value opens a mustache on `{`, whose scan only closes on the brace of the next statement
		const INPUT = '<script>el.innerHTML = \'<p data-testid="{">\'; x = "}";</script>';

		expect(stripInStrings(INPUT, { fileKind: 'markup' })).toEqual({
			output: INPUT,
			skipped: ["<script>el.innerHTML = '<p ".length],
		});
	});

	it('reads the strings of the rest of a document anew once a slot never closes', () => {
		expect(
			stripInStrings('{ a \'<b data-testid="x">\'\n<script>const s = \'<i data-testid="y">\';</script>', {
				fileKind: 'markup',
			}),
		).toEqual({ output: "{ a '<b>'\n<script>const s = '<i>';</script>", skipped: [] });
	});
});

// ─── Documents ────────────────────────────────────────────────────────────────

describe('region-aware matching in a component document', () => {
	it('reads the script blocks as code and leaves styles, comments and text alone', () => {
		const INPUT = [
			'<script>const s = "<b data-testid=\'s\'>"; const t = `<i data-testid="t">`;</script>',
			'<style>[data-testid="x"] { content: "<b data-testid=\'y\'>"; }</style>',
			'<!-- <b data-testid="c"> -->',
			'<p data-testid="p">data-testid</p>',
		].join('\n');

		expect(strip(INPUT, 'markup')).toBe(INPUT.replace(' data-testid="t"', '').replace(' data-testid="p"', ''));
	});

	it('reads JSX in a script block only when its language or type allows it', () => {
		expect(strip('<script lang="tsx">const a = <b data-testid="x" />;</script>', 'markup')).toBe(
			'<script lang="tsx">const a = <b />;</script>',
		);
		expect(strip('<script type="text/babel">const a = <b data-testid="x" />;</script>', 'html')).toBe(
			'<script type="text/babel">const a = <b />;</script>',
		);
		expect(strip('<script lang="ts">const a = <b data-testid="x" />;</script>', 'markup')).toBe(
			'<script lang="ts">const a = <b data-testid="x" />;</script>',
		);
	});

	it('reads the body of a script block by its type', () => {
		expect(strip('<script type="text/x-template"><b data-testid="t"></b></script>', 'html')).toBe(
			'<script type="text/x-template"><b></b></script>',
		);
		expect(strip('<script type="text/html"><b data-testid="t"></b></script>', 'html')).toBe(
			'<script type="text/html"><b></b></script>',
		);
		expect(strip('<script type="module; charset=utf-8">x = `<b data-testid="m">`</script>', 'html')).toBe(
			'<script type="module; charset=utf-8">x = `<b>`</script>',
		);

		const DATA = [
			'<script type="application/json">{"a": "<b data-testid=\\"j\\">"}</script>',
			'<script src="a.js"><b data-testid="s"></b></script>',
			'<script type=importmap>{"b": "<b data-testid=\'i\'>"}</script>',
		].join('\n');

		expect(strip(DATA, 'html')).toBe(DATA);
	});

	it('reads the document on after a script tag closing itself or never closed', () => {
		expect(strip('<script src="a.js" /><b data-testid="x"></b>', 'markup')).toBe('<script src="a.js" /><b></b>');
		expect(strip('<script data-testid="s"><b data-testid="x">', 'markup')).toBe('<script><b>');
		expect(strip('<style>a {}<b data-testid="x">', 'markup')).toBe('<style>a {}<b>');
		expect(strip('<style>a {}<style><b data-testid="x">', 'markup')).toBe('<style>a {}<style><b>');
	});

	it('finds the closer of a raw-text block past lookalikes', () => {
		expect(strip('<script>const a = "</scripts>" + "</script x>";</script ><b data-testid="x">', 'markup')).toBe(
			'<script>const a = "</scripts>" + "</script x>";</script ><b>',
		);
	});

	it('reads the expressions of a Svelte component, blocks included', () => {
		const INPUT = [
			'{#if a > 0}<b data-testid="if" />{:else if b}<i data-testid="else" />{/if}',
			'{#each items as item}{@html \'<b data-testid="html">\'}{/each}',
			'<Child {...rest} snippet={<b data-testid="nested" />} data-testid="child" />',
		].join('\n');

		expect(stripSvelte(INPUT)).toBe(
			[
				'{#if a > 0}<b />{:else if b}<i />{/if}',
				'{#each items as item}{@html \'<b data-testid="html">\'}{/each}',
				'<Child {...rest} snippet={<b />} />',
			].join('\n'),
		);
	});

	it('reads the rest of the document as text once a slot never closes', () => {
		expect(stripSvelte('{ a <b data-testid="x">\n<p data-testid="y">')).toBe('{ a <b>\n<p>');
		expect(stripSvelte('{/if <b data-testid="x">')).toBe('{/if <b>');
	});

	it('steps over a value that cannot be measured, and reads the rest of its tag', () => {
		expect(stripSvelte('<i data-testid={ />\n<p data-testid="y">')).toBe('<i data-testid={ />\n<p>');
		expect(stripSvelte('<i {...rest data-testid="y">')).toBe('<i {...rest>');
		expect(strip('<i title={a b} data-testid="y">', 'html')).toBe('<i title={a b}>');
		expect(strip('<i title="${a" data-testid="y">', 'html')).toBe('<i title="${a">');
	});

	it('abandons a tag whose quoted value never closes', () => {
		expect(strip('<a title="x data-testid>\n<b data-testid="y">', 'html')).toBe(
			'<a title="x data-testid>\n<b data-testid="y">',
		);
	});

	it('reads a tag cut off by the end of the input', () => {
		expect(strip('<div data-testid="x"', 'html')).toBe('<div');
		expect(strip('<div / data-testid ', 'html')).toBe('<div / ');
	});

	it('skips declarations, closing tags and a `<` opening nothing', () => {
		const INPUT = '<!doctype html><?xml a="data-testid"?></b data-testid><1 data-testid="x">< b data-testid="y">';

		expect(strip(INPUT, 'html')).toBe(INPUT);
		expect(strip('<!unclosed data-testid="x"', 'html')).toBe('<!unclosed data-testid="x"');
		expect(strip('<!-- unclosed <b data-testid="x">', 'html')).toBe('<!-- unclosed <b data-testid="x">');
	});

	it('reads a `{` as text in an HTML document', () => {
		expect(strip('<p>{ <b data-testid="x"> }</p>', 'html')).toBe('<p>{ <b> }</p>');
	});
});

describe('region-aware matching in a Vue component', () => {
	it('reads interpolations as code and a single brace as text', () => {
		expect(strip('{{ a<b ? \'<i data-testid="s">\' : c }}<p data-testid="x">', 'vue')).toBe(
			'{{ a<b ? \'<i data-testid="s">\' : c }}<p>',
		);
		expect(strip('{ <b data-testid="x"> }', 'vue')).toBe('{ <b> }');
		expect(strip('<p {x} data-testid="y">', 'vue')).toBe('<p {x}>');
	});

	it('reads the rest of the document as text once an interpolation never closes', () => {
		expect(strip('{{ a <b data-testid="x">', 'vue')).toBe('{{ a <b>');
	});
});

describe('region-aware matching in front matter and Markdown', () => {
	it('leaves a leading front matter block alone outside Astro', () => {
		const INPUT = '---\ntitle: <b data-testid="f">\n---\n<p data-testid="p">';

		expect(strip(INPUT, 'markdown')).toBe('---\ntitle: <b data-testid="f">\n---\n<p>');
		expect(strip(INPUT, 'markup')).toBe('---\ntitle: <b data-testid="f">\n---\n<p>');
	});

	it('reads the frontmatter of an Astro component as TypeScript', () => {
		expect(
			strip(
				'---\nconst s = \'<b data-testid="s">\';\nconst t = html`<i data-testid="t">`;\n---\n<p data-testid="p">',
				'astro',
			),
		).toBe('---\nconst s = \'<b data-testid="s">\';\nconst t = html`<i>`;\n---\n<p>');
	});

	it('reads a `---` no closing fence follows as the document', () => {
		expect(strip('---\n<p data-testid="p">', 'astro')).toBe('---\n<p>');
	});

	it('leaves every fenced code block of a Markdown document alone', () => {
		const INPUT = [
			'~~~js title="a"',
			'<b data-testid="tilde">',
			'```',
			'<b data-testid="still-tilde">',
			'~~~',
			'   ````',
			'<b data-testid="indented">',
			'```',
			'<b data-testid="short-closer">',
			'````',
			'<p data-testid="text">',
			'```a`b <b data-testid="inline">',
			'```',
			'<b data-testid="unclosed">',
		].join('\n');

		expect(strip(INPUT, 'markdown')).toBe(
			INPUT.replace('<p data-testid="text">', '<p>').replace(' data-testid="inline"', ''),
		);
	});

	it('reads the expressions of an MDX document', () => {
		expect(strip('{cond && <b data-testid="x" />}\n<p data-testid="y" />', 'markdown')).toBe('{cond && <b />}\n<p />');
	});
});

// ─── Compiled Astro ───────────────────────────────────────────────────────────

/**
 * Removes the given attributes from an Astro component compiled by Astro's compiler.
 *
 * @param input - The compiled module.
 * @param attributes - The attribute names to remove.
 *
 * @returns The module without the attributes.
 */
function stripCompiledAstro(input: string, attributes: readonly string[] = ['data-testid']): string {
	const { ranges, skipped } = createAttributeMatcher(attributes)(input, {
		hasQuotedMustache: false,
		hasQuotedPlaceholder: true,
		fileKind: 'ts',
		isCompiledAstro: true,
	});

	expect(skipped).toEqual([]);

	return removeRanges(input, ranges);
}

describe('region-aware matching in a compiled Astro component', () => {
	it('removes the whole placeholder rendering a configured dynamic attribute', () => {
		expect(stripCompiledAstro('$$render`<p${$$addAttribute(id, "data-testid")} class="a">x</p>`;')).toBe(
			'$$render`<p class="a">x</p>`;',
		);
		expect(
			stripCompiledAstro(
				'$$render`<p${$$addAttribute(a, "title")}${$$addAttribute(`t-${b}`, "DATA-TESTID")}${$$addAttribute(f(c, "x"), "data-testid")}>`;',
			),
		).toBe('$$render`<p${$$addAttribute(a, "title")}>`;');
		expect(
			stripCompiledAstro('$$render`<p class="a"${$$addAttribute(() => { return ")}"; }, "data-testid")}/>`;'),
		).toBe('$$render`<p class="a"/>`;');
	});

	it('leaves a placeholder whose call differs from the shape the compiler emits', () => {
		const INPUT = [
			'$$render`<p${$$addAttribute(a, "data-testid", false)}>`;',
			'$$render`<p${$$addAttribute(a, name)}>`;',
			'$$render`<p${$$addAttribute(a, "data\\u002dtestid")}>`;',
			'$$render`<p${$$addAttribute(, "data-testid")}>`;',
			'$$render`<p${$$addAttribute(a)}>`;',
			'$$render`<p${$$addAttribute(a, "data-testid") + ""}>`;',
			'$$render`<p${$$addAttribute(a], "data-testid")}>`;',
			'$$render`<p${$$addAttribute(a, "data-testid")}class="k">`;',
			'$$render`<p${$$addAttribute(a, "data-cy")}${$$spreadAttributes(b)}>`;',
			'$$render`<${$$addAttribute(a, "data-testid")}>`;',
			'$$render`<p title="${$$addAttribute(a, "data-testid")}">`;',
			'$$render`<p>${$$addAttribute(a, "data-testid")}</p>`;',
			'const s = "${$$addAttribute(a, \\"data-testid\\")}";',
		].join('\n');

		expect(stripCompiledAstro(INPUT)).toBe(INPUT);
	});

	it('leaves a placeholder whose arguments cannot be read to their end', () => {
		expect(stripCompiledAstro('$$render`<p${$$addAttribute(</b>, "data-testid")}>`;')).toBe(
			'$$render`<p${$$addAttribute(</b>, "data-testid")}>`;',
		);
		expect(stripCompiledAstro('$$render`<p${$$addAttribute(a, "data-testid"')).toBe(
			'$$render`<p${$$addAttribute(a, "data-testid"',
		);
	});

	it('removes a configured prop passed to a component or a custom element', () => {
		expect(
			stripCompiledAstro(
				'$$render`${$$renderComponent($$result, "Card", Card, {\n\t"data-testid": id,\n\t"title": "t"\n})}`;',
			),
		).toBe('$$render`${$$renderComponent($$result, "Card", Card, {\n\t"title": "t"\n})}`;');
		expect(
			stripCompiledAstro(
				'$$render`${$$renderComponent($$result, "my-el", "my-el", { "class": "c", "data-testid": id }, { "default": ($$result) => $$render`x` })}`;',
			),
		).toBe(
			'$$render`${$$renderComponent($$result, "my-el", "my-el", { "class": "c",  }, { "default": ($$result) => $$render`x` })}`;',
		);
		expect(
			stripCompiledAstro(
				'$$render`${$$renderComponent($$result, "Card", Card, { "data-testid": a, "data-cy": b, "title": t, "data-TestId": c, })}`;',
				['data-testid', 'data-cy'],
			),
		).toBe('$$render`${$$renderComponent($$result, "Card", Card, { "title": t, })}`;');
	});

	it('removes a prop whose value holds a configured attribute once, whole', () => {
		expect(
			stripCompiledAstro(
				'$$render`${$$renderComponent($$result, "Card", Card, { "data-testid": $$render`<b${$$addAttribute(x, "data-testid")} data-testid="y">` })}`;',
			),
		).toBe('$$render`${$$renderComponent($$result, "Card", Card, {  })}`;');
	});

	it('leaves the props of a call whose shape differs from the one the compiler emits', () => {
		const INPUT = [
			'$$render`${$$renderComponent($$result, "Card", Card, { ...props, [key]: a, title: b })}`;',
			'$$render`${$$renderComponent($$result, "Card", Card, props)}`;',
			'$$render`${$$renderComponent($$result, "Card", Card, { "data-testid": a } || b)}`;',
			'$$render`${$$renderComponent($$result, "Card")}`;',
			'$$render`${$$renderComponent($$result, "Card", Card, { "data-testid": a )}`;',
			'$$render`${$$maybeRenderHead($$result)}<p${$$spreadAttributes({ "data-testid": a })}>`;',
		].join('\n');

		expect(stripCompiledAstro(INPUT)).toBe(INPUT);
	});

	it('emits a module that still parses', () => {
		const OUTPUT = stripCompiledAstro(
			'export default () => $$render`<main data-testid="m">${$$renderComponent($$result, "Card", Card, { "data-testid": id })}<p${$$addAttribute(id, "data-testid")}>${id}</p></main>`;',
		);

		expect(OUTPUT).toBe(
			'export default () => $$render`<main>${$$renderComponent($$result, "Card", Card, {  })}<p>${id}</p></main>`;',
		);
		expect(parseSync('module.js', OUTPUT).errors).toEqual([]);
	});

	it('reads nothing more when no configured name appears in the module', () => {
		expect(stripCompiledAstro('$$render`<p${$$addAttribute(id, "title")}>`;')).toBe(
			'$$render`<p${$$addAttribute(id, "title")}>`;',
		);
	});
});

describe('createTagMask', () => {
	it('marks the attribute names of an opening tag and nothing else', () => {
		const INPUT = '<p a="b">c</p>';
		const MASK = createTagMask(INPUT, {
			fileKind: 'html',
			hasQuotedMustache: false,
			hasQuotedPlaceholder: false,
			shouldReadMarkupStrings: false,
		});

		expect([...MASK.positions].map(String).join('')).toBe('00010000000000');
	});

	it('marks the attribute list of a JSX tag', () => {
		const INPUT = '<p a="b">c</p>';
		const MASK = createTagMask(INPUT, {
			fileKind: 'script',
			hasQuotedMustache: false,
			hasQuotedPlaceholder: false,
			shouldReadMarkupStrings: false,
		});

		expect([...MASK.positions].map(String).join('')).toBe('00011100100000');
	});

	it('marks the placeholders of template-literal markup in an attribute list and in text', () => {
		const INPUT = 'html`<p${a} b>${c}`';
		const MASK = createTagMask(INPUT, {
			fileKind: 'ts',
			hasQuotedMustache: false,
			hasQuotedPlaceholder: true,
			shouldReadMarkupStrings: false,
		});

		expect([...MASK.positions].map(String).join('')).toBe('0000000200001130000');
	});

	it('records the content range of every string read as markup, and marks its attribute list', () => {
		const INPUT = "a('<b c>', '<i>', 'd')";
		const OPTIONS = { fileKind: 'ts', hasQuotedMustache: false, hasQuotedPlaceholder: true } as const;
		const MASK = createTagMask(INPUT, { ...OPTIONS, shouldReadMarkupStrings: true });

		expect(MASK.markupStrings).toEqual([
			[3, 8],
			[12, 15],
		]);
		expect([...MASK.positions].map(String).join('')).toBe('0000001100000000000000');
		expect(createTagMask(INPUT, { ...OPTIONS, shouldReadMarkupStrings: false }).markupStrings).toEqual([]);
	});
});
