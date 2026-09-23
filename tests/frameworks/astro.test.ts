import type { ResolvedConfig } from 'vite';
import type { TransformResult } from './harness';

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';
import removeAttributesPlugin from '../../src/index';

const CARD_FIXTURE_PATH = 'tests/fixtures/astro/src/components/Card.astro';
const CARD_MODULE_ID = '/project/src/components/Card.astro';

const INDEX_FIXTURE_PATH = 'tests/fixtures/astro/src/pages/index.astro';
const INDEX_MODULE_ID = '/project/src/pages/index.astro';

const EXPECTED_CARD_OUTPUT = `---
interface Props {
	title: string;
}

const { title } = Astro.props;
---

<div class="card">
	<h2 class="card-title">{title}</h2>
	<slot />
</div>

<style>
	.card {
		border: 1px solid #ccc;
	}
</style>
`;

const EXPECTED_INDEX_OUTPUT = `---
import Card from '../components/Card.astro';

const items = ['a', 'b'];
const price = 5;
const label = \`cost \${price > 0 ? "paid" : "free"}\`;
const html = String.raw;
const badge = html\`<b class="badge">badge</b>\`;
---

<html lang="en">
	<head>
		<title>Astro fixture</title>
	</head>
	<body class="page">
		<main class="main">
			<Card title="hello" client:load class="hello-card" />
			<ul>
				{items.map((item) => <li class="item">{item}</li>)}
			</ul>
			<div set:html="<span>raw</span>" class="raw" />
			<p class="price">{label}</p>
			<p class="spanned-title">spanned title</p>
			<div set:html={badge} class="badge-host" />
			<script class="inline">
				console.log('astro fixture');
			</script>
			<script>
				const html = String.raw;
				const isReady = document.readyState !== 'loading';

				document.body.insertAdjacentHTML(
					'beforeend',
					html\`<b class="script-badge">script</b>\`,
				);
			</script>
		</main>
	</body>
</html>

<style>
	.page {
		color: navy;
	}
</style>
`;

describe('Astro fixture — component', () => {
	it('removes data-testid and data-cy from the frontmatter-free component and keeps control attributes', () => {
		const CODE = readFileSync(CARD_FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['astro'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, CARD_MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_CARD_OUTPUT);
		expect(RESULT?.code).not.toContain('data-testid');
		expect(RESULT?.code).not.toContain('data-cy');
		expect(warnings).toEqual([]);
		expect(RESULT?.code).toContain('class="card"');
		expect(RESULT?.code).toContain('class="card-title"');
		expect(RESULT?.code).toContain('<slot />');
	});
});

describe('Astro fixture — page', () => {
	it('removes data-testid and data-cy from frontmatter, client:load, set:html and template forms', () => {
		const CODE = readFileSync(INDEX_FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['astro'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, INDEX_MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_INDEX_OUTPUT);
		expect(RESULT?.code).not.toContain('data-testid');
		expect(RESULT?.code).not.toContain('data-cy');
		expect(warnings).toEqual([]);

		expect(RESULT?.code).toContain('client:load');
		expect(RESULT?.code).toContain('set:html="<span>raw</span>"');
		expect(RESULT?.code).toContain('class="page"');
		expect(RESULT?.code).toContain('class="main"');
		expect(RESULT?.code).toContain('class="hello-card"');
		expect(RESULT?.code).toContain('class="item"');
		expect(RESULT?.code).toContain('class="raw"');
		expect(RESULT?.code).toContain('class="inline"');
	});

	it('reads a quoted `${…}` as a placeholder in the markup, the frontmatter and a `<script>` alike', () => {
		const CODE = readFileSync(INDEX_FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['astro'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, INDEX_MODULE_ID);
		const FRONTMATTER = RESULT?.code.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
		const SCRIPT = RESULT?.code.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

		expect(warnings).toEqual([]);
		expect(RESULT?.code).toContain('const label = `cost ${price > 0 ? "paid" : "free"}`;');
		expect(RESULT?.code).toContain('<p class="price">{label}</p>');
		// Pinned, documented trade-off: a balanced literal `${" title="}` spans the next attribute and takes it along
		expect(RESULT?.code).toContain('<p class="spanned-title">spanned title</p>');
		// The nested-quote placeholders of both tagged templates are removed whole, and both scripts still parse
		expect(FRONTMATTER).toContain('const badge = html`<b class="badge">badge</b>`;');
		expect(SCRIPT).toContain('html`<b class="script-badge">script</b>`,');
		expect(parseSync('index.astro.ts', FRONTMATTER).errors).toEqual([]);
		expect(parseSync('index.astro.ts', SCRIPT).errors).toEqual([]);
	});

	it('reads a quoted `${…}` as a placeholder in the `<script>` sub-request of the page', () => {
		const { transform, warnings } = createHarness({ extensions: ['astro'], attributes: ['data-testid'] }, '/project');

		const RESULT = transform(
			'const markup = html`<b data-testid="${ok ? `a-${id}` : "b"}" class="k">`;',
			`${INDEX_MODULE_ID}?astro&type=script&index=0&lang.ts`,
		);

		expect(RESULT?.code).toBe('const markup = html`<b class="k">`;');
		expect(warnings).toEqual([]);
	});

	it('maps a token after the first removal back to its original line and column', () => {
		const CODE = readFileSync(INDEX_FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['astro'], attributes: ['data-testid', 'data-cy'] }, '/project');

		const RESULT = transform(CODE, INDEX_MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
		const GENERATED_LINES = RESULT.code.split('\n');
		const GENERATED_LINE = GENERATED_LINES.findIndex((line) => line.includes('class="page"')) + 1;
		const GENERATED_LINE_TEXT = GENERATED_LINES[GENERATED_LINE - 1] ?? '';
		const GENERATED_COLUMN = GENERATED_LINE_TEXT.indexOf('class="page"');

		const ORIGINAL = originalPositionFor(TRACER, { line: GENERATED_LINE, column: GENERATED_COLUMN });
		const ORIGINAL_LINE_TEXT = CODE.split('\n')[(ORIGINAL.line ?? 0) - 1];

		expect(ORIGINAL.line).not.toBeNull();
		expect(ORIGINAL_LINE_TEXT).toContain('class="page"');
	});
});

// ─── Compiled by Astro ────────────────────────────────────────────────────────

// Captured from a real Astro 7.3.4 build of `tests/fixtures/astro-compiled/*.astro`: what the plugin receives once
// `astro:build` compiled the component, the temporary project root renamed to `/project`
const COMPILED_INDEX_PATH = 'tests/fixtures/astro-compiled/index.compiled.js';
const COMPILED_CARD_PATH = 'tests/fixtures/astro-compiled/Card.compiled.js';
const ASTRO_FIRST = ['astro:build', 'remove-attributes'];
const DYNAMIC_PLACEHOLDER = '${$$addAttribute(id, "data-testid")}';

interface CompiledTransform {
	result: TransformResult;
	warnings: string[];
}

/**
 * Removes every occurrence of each snippet from a text.
 *
 * @param text - The text.
 * @param snippets - The exact snippets to remove.
 *
 * @returns The text without the snippets.
 */
function removeSnippets(text: string, snippets: readonly string[]): string {
	return snippets.reduce((result, snippet) => result.split(snippet).join(''), text);
}

/**
 * Transforms a module with `data-testid` configured for removal, under the given plugin orders.
 *
 * @param options.code - The module source.
 * @param options.id - The module ID.
 * @param options.configPlugins - The plugin names `configResolved` receives, in order.
 * @param options.environmentPlugins - The plugin names of the hook's environment, or `undefined` for a hook run
 *   without one, as on Vite 5.
 *
 * @returns The transform result and the warnings reported.
 */
function transformCompiled(options: {
	code: string;
	id: string;
	configPlugins: readonly string[];
	environmentPlugins?: readonly string[];
}): CompiledTransform {
	const PLUGIN = removeAttributesPlugin({ extensions: ['astro'], attributes: ['data-testid'] });
	const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
	const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => TransformResult;
	const WARNINGS: string[] = [];
	const ENVIRONMENT =
		options.environmentPlugins == null
			? undefined
			: { config: { plugins: options.environmentPlugins.map((name) => ({ name })) } };

	CONFIG_RESOLVED({
		root: '/project',
		plugins: options.configPlugins.map((name) => ({ name })),
	} as unknown as ResolvedConfig);

	return {
		result: TRANSFORM.call(
			{ warn: (message: string) => WARNINGS.push(message), environment: ENVIRONMENT },
			options.code,
			options.id,
		),
		warnings: WARNINGS,
	};
}

describe('Astro component compiled by Astro', () => {
	it('removes the dynamic attributes, the component props and the static attributes of a compiled page', () => {
		const CODE = readFileSync(COMPILED_INDEX_PATH, 'utf8');
		const { result, warnings } = transformCompiled({
			code: CODE,
			id: INDEX_MODULE_ID,
			configPlugins: [],
			environmentPlugins: ASTRO_FIRST,
		});
		const EXPECTED = removeSnippets(CODE, [
			' data-testid="static-main"',
			DYNAMIC_PLACEHOLDER,
			'${$$addAttribute(`template-${id}`, "data-testid")}',
			'${$$addAttribute(isActive ? "on" : "off", "data-TestId")}',
			'${$$addAttribute({ a: 1 }.a, "data-testid")}',
			'"data-testid": id,\n\t\t',
			'"data-testid": "static-card",\n\t\t',
			'${$$addAttribute(`item-${item}`, "data-testid")}',
			' data-testid="path"',
		]);

		expect(result?.code).toBe(EXPECTED);
		expect(warnings).toEqual([]);
		expect(parseSync('index.js', EXPECTED).errors).toEqual([]);
		// Runtime data keeps its attribute: the object spread onto an element, a string and the body of an inline script
		expect(EXPECTED).toContain('"data-testid": "spread"');
		expect(EXPECTED).toContain('${$$spreadAttributes(props)}');
		expect(EXPECTED).toContain('const markup = "<b data-testid=\\"in-string\\">";');
		expect(EXPECTED).toContain('const hint = \'<i data-testid="inline-body">\';');
		expect(EXPECTED).toContain('<p class="dynamic">dynamic</p>');
		expect(EXPECTED).toContain(
			'${$$renderComponent($$result, "my-element", "my-element", {\n\t\t"class": "custom"\n\t}',
		);
	});

	it('removes the dynamic attribute of a compiled component', () => {
		const CODE = readFileSync(COMPILED_CARD_PATH, 'utf8');
		const { result } = transformCompiled({
			code: CODE,
			id: CARD_MODULE_ID,
			configPlugins: [],
			environmentPlugins: ASTRO_FIRST,
		});

		expect(result?.code).toBe(removeSnippets(CODE, ['${$$addAttribute(`card-${title}`, "data-testid")}']));
	});

	it('maps a token after a removed placeholder back to the compiled module', () => {
		const CODE = readFileSync(COMPILED_INDEX_PATH, 'utf8');
		const { result } = transformCompiled({
			code: CODE,
			id: INDEX_MODULE_ID,
			configPlugins: [],
			environmentPlugins: ASTRO_FIRST,
		});

		if (result == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const GENERATED_LINES = result.code.split('\n');
		const GENERATED_LINE_INDEX = GENERATED_LINES.findIndex((line) => line.includes('class="dynamic"'));
		const GENERATED_COLUMN = (GENERATED_LINES[GENERATED_LINE_INDEX] ?? '').indexOf('class="dynamic"');
		const ORIGINAL = originalPositionFor(new TraceMap(result.map), {
			line: GENERATED_LINE_INDEX + 1,
			column: GENERATED_COLUMN,
		});

		expect(ORIGINAL.source).toBe(INDEX_MODULE_ID);
		expect(
			(CODE.split('\n')[(ORIGINAL.line ?? 0) - 1] ?? '').slice(ORIGINAL.column ?? 0).startsWith('class="dynamic"'),
		).toBe(true);
	});

	it('reads the plugin order of the configuration when the hook runs without an environment', () => {
		const { result } = transformCompiled({
			code: readFileSync(COMPILED_CARD_PATH, 'utf8'),
			id: CARD_MODULE_ID,
			configPlugins: ASTRO_FIRST,
		});

		expect(result?.code).not.toContain('data-testid');
	});

	it('reads the module as an Astro document when Astro does not compile it first', () => {
		const CODE = readFileSync(COMPILED_INDEX_PATH, 'utf8');
		const CASES = [
			{ id: INDEX_MODULE_ID, configPlugins: [] },
			{ id: INDEX_MODULE_ID, configPlugins: ['remove-attributes', 'astro:build'] },
			{ id: INDEX_MODULE_ID, configPlugins: ASTRO_FIRST, environmentPlugins: ['remove-attributes'] },
			{ id: `${INDEX_MODULE_ID}?astro&type=template`, configPlugins: ASTRO_FIRST, environmentPlugins: ASTRO_FIRST },
		];

		CASES.forEach((transformCase) => {
			const { result } = transformCompiled({ code: CODE, ...transformCase });

			expect(result?.code ?? CODE).toContain(DYNAMIC_PLACEHOLDER);
		});
	});
});
