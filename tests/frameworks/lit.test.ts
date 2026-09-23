import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '../../src/index';
import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/lit/my-element.ts';
const MODULE_ID = '/project/src/my-element.ts';

const EXPECTED_OUTPUT = `function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

function css(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => \`\${accumulator}\${part}\${String(values[index] ?? '')}\`, '');
}

const STYLES = css\`
	.wrapper {
		color: red;
	}
\`;

class MyElement {
	id = 'x';
	disabled = false;
	value = 'v';

	onClick(): void {
		console.log('clicked');
	}

	render(): string {
		return html\`
			<div class="wrapper">
				<span class="label">label</span>
				<input
					?disabled=\${this.disabled}
					.value=\${this.value}
					@click=\${() => this.onClick()}
					class="field"
				/>
				<p class="double">double</p>
				<p class="single">single</p>
				<p class="other">other</p>
				<p class="literal">literal</p>
				<p class="placeholders">placeholders</p>
				<p class="object">object</p>
				<p class="brace">brace</p>
				<p class="comment">comment</p>
				<p class="regex">regex</p>
				<section class="nested">
					nested
				</section>
				<p
					class="multi-line"
				>
					multi-line
				</p>
				<p class="minified">minified</p>
				<p class="back-to-back">back-to-back</p>
				<p class="lone-dollar">lone dollar</p>
				<p class="escaped">escaped</p>
				<p title="\${this.disabled ? "lit-kept-on" : "lit-kept-off"}" class="kept">kept</p>
			</div>
		\`;
	}
}

export { MyElement, STYLES };
`;

describe('Lit (TS tagged template) fixture', () => {
	it('removes the placeholder and quoted-placeholder forms and keeps ?attr / .prop / @event and css untouched', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(RESULT?.code).not.toContain('data-testid');
		expect(RESULT?.code).not.toContain('data-cy');
		expect(warnings).toEqual([]);

		// Pinned: `?attr=`, `.prop=` and `@event=` are different attribute names entirely, and the tagged `css`
		// template is never scanned for markup — none of these are removal targets
		expect(RESULT?.code).toContain('?disabled=${this.disabled}');
		expect(RESULT?.code).toContain('.value=${this.value}');
		expect(RESULT?.code).toContain('@click=${() => this.onClick()}');
		expect(RESULT?.code).toContain('const STYLES = css`');
		expect(RESULT?.code).toContain('class="wrapper"');
		expect(RESULT?.code).toContain('class="label"');
		expect(RESULT?.code).toContain('class="field"');
	});

	it('removes every quoted value holding a placeholder whole, nested quotes and template literals included', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(warnings).toEqual([]);
		// A value cut at the first inner quote would leave a stray backtick behind and break the module
		expect(parseSync(MODULE_ID, RESULT?.code ?? '').errors).toEqual([]);
		// Every string literal a removed placeholder held is gone with it — only the kept `title` still reads one
		expect(RESULT?.code.match(/"lit-[\w-]+"/g)).toEqual(['"lit-kept-on"', '"lit-kept-off"']);
		expect(RESULT?.code).not.toContain('lit-inner-');
		expect(RESULT?.code).not.toContain('class="inner"');

		// A non-target attribute with the same nested-quote placeholder shape survives byte for byte
		expect(RESULT?.code).toContain('<p title="${this.disabled ? "lit-kept-on" : "lit-kept-off"}" class="kept">');

		// The minified neighbors keep the whitespace in front of the removed pair, and every neighbor survives
		expect(RESULT?.code).toContain('<p class="minified">');
		expect(RESULT?.code).toContain('<p class="back-to-back">');
		expect(RESULT?.code).toContain('<p class="lone-dollar">');
		expect(RESULT?.code).toContain('<p class="escaped">');
		expect(RESULT?.code).toContain('<section class="nested">');
		expect(RESULT?.code).toContain('<p\n\t\t\t\t\tclass="multi-line"\n\t\t\t\t>');
	});

	it('maps the neighbors of the placeholder removals back to their original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
		const GENERATED_LINES = RESULT.code.split('\n');
		const ORIGINAL_LINES = CODE.split('\n');

		['class="literal"', 'class="nested"', 'class="multi-line"', 'class="minified"', 'class="kept"'].forEach((token) => {
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
		const { transform } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		if (RESULT == null) {
			throw new Error('Expected the transform to remove at least one attribute');
		}

		const TRACER = new TraceMap(RESULT.map);
		const GENERATED_LINES = RESULT.code.split('\n');
		const GENERATED_LINE = GENERATED_LINES.findIndex((line) => line.includes('class="wrapper"')) + 1;
		const GENERATED_LINE_TEXT = GENERATED_LINES[GENERATED_LINE - 1] ?? '';
		const GENERATED_COLUMN = GENERATED_LINE_TEXT.indexOf('class="wrapper"');

		const ORIGINAL = originalPositionFor(TRACER, { line: GENERATED_LINE, column: GENERATED_COLUMN });
		const ORIGINAL_LINE_TEXT = CODE.split('\n')[(ORIGINAL.line ?? 0) - 1];

		expect(ORIGINAL.line).not.toBeNull();
		expect(ORIGINAL_LINE_TEXT).toContain('class="wrapper"');
	});
});
