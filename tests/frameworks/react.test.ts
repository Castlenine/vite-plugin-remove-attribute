import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/react/App.tsx';
const MODULE_ID = '/project/src/App.tsx';

const EXPECTED_OUTPUT = `interface Props {
	id: string;
}

function h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
	return { type, props, children };
}

function Fragment(props: { children?: unknown[] }): unknown {
	return props.children;
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

function identity<T,>(value: T): T {
	return value;
}

function Child(props: { id: string }) {
	return <span class="child-inner">{props.id}</span>;
}

function Price(props: { price: number }) {
	return <span class="price">{props.price}</span>;
}

function App(props: Props) {
	const label = identity(props.id);
	const items = ['a', 'b'];

	return (
		<div class="container" id="app">
			{/* a JSX comment sitting between the wrapper and the label paragraph */}
			<p class="status">
				{label}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item} class="item">
						{item}
					</li>
				))}
			</ul>
			<Child {...{ id: label }} class="child" />
			<>
				<span class="frag">
					frag
				</span>
			</>
			<i class="literal-placeholder" />
			<i class="unbalanced" />
			<div
				dangerouslySetInnerHTML={{
					__html: html\`<b class="tagged">tagged</b>\`,
				}}
				class="inner-html"
			/>
			<i />
		</div>
	);
}

export default App;
`;

describe('React (TSX) fixture', () => {
	it('removes data-testid and data-cy from every JSX form and keeps control attributes and the generic arrow', () => {
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

		// The generic parameter list survives untouched (this is the fix under test, not a removal target)
		expect(RESULT?.code).toContain('function identity<T,>(value: T): T {');

		// Control attributes and forms survive
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="status"');
		expect(RESULT?.code).toContain('class="item"');
		expect(RESULT?.code).toContain('class="child"');
		expect(RESULT?.code).toContain('class="frag"');
		expect(RESULT?.code).toContain('key={item}');
		expect(RESULT?.code).toContain('{...{ id: label }}');
		expect(RESULT?.code).toContain('<>');
		expect(RESULT?.code).toContain('{/* a JSX comment sitting between the wrapper and the label paragraph */}');
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

		// A balanced literal `${label}` is removed with its value
		expect(RESULT?.code).toContain('<i class="literal-placeholder" />');
		// A literal `${` whose markup stops reading as JavaScript — here the string opened by its own closing quote
		// runs into a newline — falls back to the plain read, so the value ends at that quote. On the last element
		// of a component this holds too: the brace closing the component does not close the value
		expect(RESULT?.code).toContain('<i class="unbalanced" />');
		expect(RESULT?.code).toContain('\treturn <span class="price">{props.price}</span>;\n}\n');
		// The tagged template is removed whole, nested quotes and nested template literal included
		expect(RESULT?.code).toContain('__html: html`<b class="tagged">tagged</b>`,');
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
