import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/vue/App.vue';
const MODULE_ID = '/project/src/App.vue';

const EXPECTED_OUTPUT = `<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
const items = ref(['a', 'b']);
const config = ref({ 'data-testid': 1, title: 'r' });
const isHighlighted = ref(true);
const badgeId = 'x';

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

const badge = html\`<b class="badge">badge</b>\`;

function increment() {
	count.value++;
}
</script>

<template>
	<div class="container" id="app">
		<p class="count">{{ count }}</p>
		<ul>
			<li v-for="item in items" :key="item" class="item">{{ item }}</li>
		</ul>
		<button @click="increment" class="btn">+</button>
		<p class="dollar">dollar</p>
		<p class="spanned-title">spanned title</p>
		<span v-html="badge" class="badge-host"></span>
		<Child>
			<template #footer>
				<span v-bind="config" class="footer">footer</span>
				<span v-bind="{ 'data-testid': 1 }" class="footer-literal">footer-literal</span>
			</template>
		</Child>
	</div>
</template>

<style scoped>
.container {
	color: red;
}
</style>
`;

describe('Vue fixture', () => {
	it('removes :data-testid, v-bind:data-testid.camel and the bare form, keeps v-bind object literals and control attributes', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['vue'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(warnings).toEqual([]);

		// `data-testid` survives only inside the pinned `v-bind="{ … }"` object literal and the script string
		expect(RESULT?.code).toContain(`v-bind="{ 'data-testid': 1 }"`);
		expect(RESULT?.code).toContain(`ref({ 'data-testid': 1, title: 'r' })`);
		// Only the two pinned string-literal occurrences remain — no attribute-shaped `data-testid` survives
		expect(RESULT?.code.match(/data-testid/g)).toHaveLength(2);
		expect(RESULT?.code).not.toContain('data-cy');

		// Control attributes survive
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="count"');
		expect(RESULT?.code).toContain('class="item"');
		expect(RESULT?.code).toContain('class="btn"');
		expect(RESULT?.code).toContain('class="footer"');
		expect(RESULT?.code).toContain('class="footer-literal"');
		expect(RESULT?.code).toContain('v-for="item in items"');
		expect(RESULT?.code).toContain(':key="item"');
		expect(RESULT?.code).toContain('@click="increment"');
		expect(RESULT?.code).toContain('#footer');
	});

	it('reads a quoted `${…}` as a placeholder, in the template and in the `<script setup>` tagged template alike', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['vue'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);
		const SCRIPT = RESULT?.code.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? '';

		expect(warnings).toEqual([]);
		expect(RESULT?.code).toContain('<p class="dollar">dollar</p>');
		// Pinned, documented trade-off: a balanced literal `${" title="}` spans the next attribute and takes it along
		expect(RESULT?.code).toContain('<p class="spanned-title">spanned title</p>');
		// The nested-quote placeholder of the tagged template is removed whole, and the script still parses
		expect(SCRIPT).toContain('const badge = html`<b class="badge">badge</b>`;');
		expect(parseSync('App.vue.ts', SCRIPT).errors).toEqual([]);
	});

	it('reads a quoted `${…}` as a placeholder in the `<script setup lang="ts">` sub-request of the component', () => {
		const { transform, warnings } = createHarness({ extensions: ['vue'], attributes: ['data-testid'] }, '/project');

		const RESULT = transform(
			'const markup = html`<b data-testid="${ok ? `a-${id}` : "b"}" class="k">`;',
			`${MODULE_ID}?vue&type=script&setup=true&lang.ts`,
		);

		expect(RESULT?.code).toBe('const markup = html`<b class="k">`;');
		expect(parseSync('App.vue.ts', RESULT?.code ?? '').errors).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it('maps a token after the first removal back to its original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['vue'], attributes: ['data-testid', 'data-cy'] }, '/project');

		const RESULT = transform(CODE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
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
