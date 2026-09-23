import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/solid/App.tsx';
const MODULE_ID = '/project/src/App.tsx';

const EXPECTED_OUTPUT = `import { createSignal, For, Show } from 'solid-js';

interface Props {
	id: string;
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

function Price(props: { price: number }) {
	return <span class="price">{props.price}</span>;
}

function App(props: Props) {
	const [count, setCount] = createSignal(0);
	const items = ['a', 'b'];

	return (
		<div class="container" id="app">
			<Show when={count() > 0} fallback={<p class="empty">empty</p>}>
				<p class="count">
					{count()}
				</p>
			</Show>
			<For each={items}>
				{(item) => (
					<span class="item">
						{item}
					</span>
				)}
			</For>
			<div classList={{ active: count() > 0, box: true }} class="box">
				box
			</div>
			<button on:click={() => setCount(count() + 1)} class="btn">
				+
			</button>
			<i class="literal-placeholder" />
			<i class="unbalanced" />
			<div
				innerHTML={html\`<b class="tagged">tagged</b>\`}
				class="inner-html"
			/>
			<i />
		</div>
	);
}

export default App;
`;

describe('Solid (TSX) fixture', () => {
	it('removes data-testid and data-cy from <Show>, <For>, classList and props-driven forms', () => {
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

		expect(RESULT?.code).toContain('<Show when={count() > 0} fallback={<p class="empty">empty</p>}>');
		expect(RESULT?.code).toContain('<For each={items}>');
		expect(RESULT?.code).toContain('classList={{ active: count() > 0, box: true }}');
		expect(RESULT?.code).toContain('on:click={() => setCount(count() + 1)}');
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="box"');
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

		// A balanced literal `${props.id}` is removed with its value
		expect(RESULT?.code).toContain('<i class="literal-placeholder" />');
		// A literal `${` whose markup stops reading as JavaScript — here the string opened by its own closing quote
		// runs into a newline — falls back to the plain read, so the value ends at that quote. On the last element
		// of a component this holds too: the brace closing the component does not close the value
		expect(RESULT?.code).toContain('<i class="unbalanced" />');
		expect(RESULT?.code).toContain('\treturn <span class="price">{props.price}</span>;\n}\n');
		// The tagged template is removed whole, nested quotes and nested template literal included
		expect(RESULT?.code).toContain('innerHTML={html`<b class="tagged">tagged</b>`}');
		expect(RESULT?.code).not.toContain('tagged-');
		expect(RESULT?.code).toContain('class="inner-html"');
		// Pinned, documented trade-off: a balanced literal `${" class="}` spans the next attribute and takes it along
		expect(RESULT?.code).toContain('\t\t\t<i />\n');
		expect(RESULT?.code).not.toContain('class="}"');
	});

	// Listed after `solid()`, which is `enforce: 'pre'` as well, the plugin reads Solid's compiled template, where a
	// JSX string holding a literal `${` becomes the unquoted value `$\{…}`: the unquoted read continues through the
	// escaped brace to the separator ending the value
	it('removes an unquoted `$\\{…}` value of a compiled Solid template whole', () => {
		const { transform, warnings } = createHarness({ extensions: ['tsx'], attributes: ['data-testid'] }, '/project');

		const RESULT = transform('const _tmpl$ = template(`<i data-testid=$\\{props.id} class=item>`);', MODULE_ID);

		expect(RESULT?.code).toBe('const _tmpl$ = template(`<i class=item>`);');
		expect(parseSync(MODULE_ID, RESULT?.code ?? '').errors).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it('takes the attribute a balanced literal `$\\{…}` spans with it in a compiled Solid template', () => {
		// Pinned, documented trade-off, the compiled twin of the JSX `data-testid="${" class="}"`
		const { transform, warnings } = createHarness({ extensions: ['tsx'], attributes: ['data-testid'] }, '/project');

		const RESULT = transform('const _tmpl$ = template(`<i data-testid=$\\{ class=}>`);', MODULE_ID);

		expect(RESULT?.code).toBe('const _tmpl$ = template(`<i>`);');
		expect(warnings).toEqual([]);
	});

	it('leaves an unbalanced `$\\{` value of a compiled Solid template in place and warns about it', () => {
		// Cutting the value at its brace would leave `{ class=item` behind as markup of its own
		const { transform, warnings } = createHarness({ extensions: ['tsx'], attributes: ['data-testid'] }, '/project');
		const CODE = 'const _tmpl$ = template(`<i data-testid=$\\{ class=item>`);';

		expect(transform(CODE, MODULE_ID)).toBeNull();
		expect(warnings).toEqual([
			{
				message: `remove-attributes: left 1 attribute(s) in place in ${MODULE_ID} — the value could not be parsed`,
				position: CODE.indexOf('data-testid'),
			},
		]);
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
