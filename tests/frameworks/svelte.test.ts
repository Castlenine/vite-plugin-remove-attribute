import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/svelte/App.svelte';
const MODULE_ID = '/project/src/routes/+page.svelte';

const HTML_FIXTURE_PATH = 'tests/fixtures/svelte/Html.svelte';
const HTML_MODULE_ID = '/project/src/lib/Html.svelte';

const HTML_EXPECTED_OUTPUT = `<script lang="ts">
	let label = $state('Save');

	const BADGE = '<span class="badge">new</span>';
	const PARTIAL = '<em data-testid="' + label + '">';
</script>

<div class="container">
	{@html '<strong class="title">Title</strong>'}
	{@html BADGE}
	{@html PARTIAL}
	<button class="btn">{label}</button>
</div>
`;

const EXPECTED_OUTPUT = `<script lang="ts">
	let count = $state(0);
	let items = $state(['a', 'b']);
	let rest = $state({ title: 'r' });
	let selected = $state(true);
</script>

<div class="container" id="app">
	{#if count > 0}
		<p class="count">{count}</p>
	{/if}
	{#each items as item}
		<span class="item">{item}</span>
	{/each}
	<span class="status">status</span>
	<span class="single">single</span>
	<span class="price">price</span>
	<span class="nested">nested</span>
	<input bind:value={count} class="field" />
	<button onclick={() => count++} class="btn">+</button>
	<button onclick={() => count--} class="btn">-</button>
	<div class:active={count > 0} class="box">box</div>
	<Child {...rest} class="child" />
	{@render children?.()}
</div>

<style>
	.container {
		color: red;
	}
</style>
`;

describe('Svelte fixture', () => {
	it('removes data-testid and data-cy from every Svelte form and keeps control attributes', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['svelte'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(RESULT?.code).not.toMatch(/\sdata-testid\b|[:"'}]data-testid\b/);
		expect(RESULT?.code).not.toContain('data-cy');
		expect(warnings).toEqual([]);

		// Control attributes survive
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="count"');
		expect(RESULT?.code).toContain('class="item"');
		expect(RESULT?.code).toContain('class="status"');
		expect(RESULT?.code).toContain('class="field"');
		expect(RESULT?.code).toContain('class="btn"');
		expect(RESULT?.code).toContain('class="box"');
		expect(RESULT?.code).toContain('class="child"');
		expect(RESULT?.code).toContain('bind:value={count}');
		expect(RESULT?.code).toContain('onclick={() => count--}');
		expect(RESULT?.code).toContain('class:active={count > 0}');
		expect(RESULT?.code).toContain('{...rest}');
		expect(RESULT?.code).toContain('{@render children?.()}');
	});

	it('removes nested-quote mustaches in either quote whole, and reads `${` as a `$` before a mustache', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['svelte'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(warnings).toEqual([]);
		expect(RESULT?.code).not.toMatch(/yes|single-|nested-|cost/);
		expect(RESULT?.code).toContain('\t<span class="status">status</span>\n');
		expect(RESULT?.code).toContain('\t<span class="single">single</span>\n');
		expect(RESULT?.code).toContain('\t<span class="price">price</span>\n');
		expect(RESULT?.code).toContain('\t<span class="nested">nested</span>\n');
	});

	it('leaves the mustache values in place and warns once the failed-scan budget is spent, without corrupting them', () => {
		// Every unbalanced `={` scans to the end of the file, and a handful of them spend the budget before the
		// component's own markup is reached
		const BUDGET_EXHAUSTING_PREFIX = '<i data-testid={ />\n'.repeat(8);
		const CODE = `${BUDGET_EXHAUSTING_PREFIX}${readFileSync(FIXTURE_PATH, 'utf8')}`;
		const { transform, warnings } = createHarness(
			{ extensions: ['svelte'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		// A value whose closing quote may sit inside its mustache cannot be measured any more, so it is kept byte
		// for byte instead of being cut at its first inner quote
		expect(RESULT?.code).toContain(`${BUDGET_EXHAUSTING_PREFIX}<script lang="ts">`);
		expect(RESULT?.code).toContain('<span data-testid={`${item}-item`} class="item">');
		expect(RESULT?.code).toContain('<span data-testid="{selected ? "yes" : "no"}" class="status">');
		expect(RESULT?.code).toContain(`<span data-testid='{selected ? 'single-yes' : 'single-no'}' class="single">`);
		expect(RESULT?.code).toContain('<span data-testid="cost ${count}" class="price">');
		expect(RESULT?.code).toContain(
			'<span data-testid="{selected ? `nested-${count}` : "nested-no"}-{count}" class="nested">',
		);

		// A quoted value holding no mustache needs no scan, so it is still removed
		expect(RESULT?.code).toContain('<div class="container" id="app">');
		expect(RESULT?.code).toContain('<p class="count">{count}</p>');
		expect(RESULT?.code).toContain('<input bind:value={count} class="field" />');

		expect(warnings).toEqual([
			{
				message:
					'remove-attributes: left 13 attribute(s) in place in /project/src/routes/+page.svelte — the value could not be parsed',
				position: '<i '.length,
			},
		]);
	});

	it('maps a token after the first removal back to its original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['svelte'], attributes: ['data-testid', 'data-cy'] }, '/project');

		const RESULT = transform(CODE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
		// `class="container"` sits right after the removed `data-testid`/`data-cy` pair, on the generated line 8
		const GENERATED_LINES = RESULT.code.split('\n');
		const GENERATED_LINE = GENERATED_LINES.findIndex((line) => line.includes('class="container"')) + 1;
		const GENERATED_LINE_TEXT = GENERATED_LINES[GENERATED_LINE - 1] ?? '';
		const GENERATED_COLUMN = GENERATED_LINE_TEXT.indexOf('class="container"');

		const ORIGINAL = originalPositionFor(TRACER, { line: GENERATED_LINE, column: GENERATED_COLUMN });
		const ORIGINAL_LINE_TEXT = CODE.split('\n')[(ORIGINAL.line ?? 0) - 1];

		expect(ORIGINAL.line).not.toBeNull();
		expect(ORIGINAL_LINE_TEXT).toContain('class="container"');
	});
});

describe('Svelte {@html} fixture', () => {
	it('keeps the markup of every string by default', () => {
		const CODE = readFileSync(HTML_FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness({ extensions: ['svelte'], attributes: ['data-testid'] }, '/project');

		const RESULT = transform(CODE, HTML_MODULE_ID);

		expect(RESULT?.code).toBe(CODE.replace(' data-testid="wrapper"', '').replace(' data-testid="save"', ''));
		expect(RESULT?.code).toContain('{@html \'<strong data-testid="title" class="title">Title</strong>\'}');
		expect(warnings).toEqual([]);
	});

	it('removes the attributes of closed markup strings with removeInStrings on, and keeps a tag split across strings', () => {
		const CODE = readFileSync(HTML_FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['svelte'], attributes: ['data-testid'], removeInStrings: true },
			'/project',
		);

		expect(transform(CODE, HTML_MODULE_ID)?.code).toBe(HTML_EXPECTED_OUTPUT);
		expect(warnings).toEqual([]);
	});
});
