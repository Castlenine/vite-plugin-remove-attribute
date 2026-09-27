import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/qwik/routes/index.tsx';
const MODULE_ID = '/project/src/routes/index.tsx';

const EXPECTED_OUTPUT = `import { component$, useSignal } from '@builder.io/qwik';

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

const Price = component$((props: { price: number }) => {
	return <span class="price">{props.price}</span>;
});

export default component$(() => {
	const sig = useSignal(0);

	return (
		<div class="container" id="app">
			<p class="count">
				{sig.value}
			</p>
			<button onClick$={() => sig.value++} class="btn">
				+
			</button>
			<i class="literal-placeholder" />
			<i class="unbalanced" />
			<div
				dangerouslySetInnerHTML={html\`<b class="tagged">tagged</b>\`}
				class="inner-html"
			/>
			<i />
		</div>
	);
});
`;

describe('Qwik (TSX) fixture', () => {
	it('removes data-testid and data-cy, including the pinned data-testid={sig.value} member-access value', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['tsx'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(RESULT?.code).not.toContain('data-testid');
		expect(RESULT?.code).not.toContain('data-cy');
		expect(warnings).toEqual([]);

		expect(RESULT?.code).toContain('component$(() => {');
		expect(RESULT?.code).toContain('onClick$={() => sig.value++}');
		expect(RESULT?.code).toContain('useSignal(0)');
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="count"');
		expect(RESULT?.code).toContain('class="btn"');
	});

	it('reads a literal `${` in a JSX string attribute as a placeholder, and a tagged template in the module as markup', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['tsx'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(warnings).toEqual([]);
		expect(parseSync(MODULE_ID, RESULT?.code ?? '').errors).toEqual([]);

		// A balanced literal `${sig.value}` is removed with its value
		expect(RESULT?.code).toContain('<i class="literal-placeholder" />');
		// A literal `${` whose markup stops reading as JavaScript — here the string opened by its own closing quote
		// runs into a newline — falls back to the plain read, so the value ends at that quote. On the last element
		// of a component this holds too: the brace closing the component does not close the value
		expect(RESULT?.code).toContain('<i class="unbalanced" />');
		expect(RESULT?.code).toContain('\treturn <span class="price">{props.price}</span>;\n});\n');
		// The tagged template is removed whole, nested quotes and nested template literal included
		expect(RESULT?.code).toContain('dangerouslySetInnerHTML={html`<b class="tagged">tagged</b>`}');
		expect(RESULT?.code).not.toContain('tagged-');
		expect(RESULT?.code).toContain('class="inner-html"');
		// Pinned, documented trade-off: a balanced literal `${" class="}` spans the next attribute and takes it along
		expect(RESULT?.code).toContain('\t\t\t<i />\n');
		expect(RESULT?.code).not.toContain('class="}"');
	});

	it('maps the neighbors of the placeholder removals back to their original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['tsx'], attributes: ['data-testid', 'data-cy'] }, '/project');

		const RESULT = transform(CODE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
		const GENERATED_LINES = RESULT.code.split('\n');
		const ORIGINAL_LINES = CODE.split('\n');

		[
			'class="price"',
			'class="literal-placeholder"',
			'class="unbalanced"',
			'class="tagged"',
			'class="inner-html"',
		].forEach((token) => {
			const GENERATED_LINE = GENERATED_LINES.findIndex((line) => line.includes(token));
			const ORIGINAL_LINE = ORIGINAL_LINES.findIndex((line) => line.includes(token));
			const GENERATED_COLUMN = GENERATED_LINES[GENERATED_LINE]?.indexOf(token) ?? -1;

			expect(originalPositionFor(TRACER, { line: GENERATED_LINE + 1, column: GENERATED_COLUMN })).toMatchObject({
				line: ORIGINAL_LINE + 1,
				column: ORIGINAL_LINES[ORIGINAL_LINE]?.indexOf(token),
			});
		});
	});

	it('maps a token after the first removal back to its original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['tsx'], attributes: ['data-testid', 'data-cy'] }, '/project');

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
