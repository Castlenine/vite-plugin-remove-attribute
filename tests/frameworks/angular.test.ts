import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '../../src/index';
import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/angular/app.component.ts';
const MODULE_ID = '/project/src/app.component.ts';

const EXPECTED_OUTPUT = `import { Component } from '@angular/core';

import { ApostrophesComponent, QuotesComponent } from './quoted.component';

const VARIANT = 'compact';

@Component({
	selector: 'app-root',
	imports: [ApostrophesComponent, QuotesComponent],
	template: \`
		<app-apostrophes />
		<app-quotes />
		<div class="container" id="app">
			<p [attr.data-testid]="dynamicId" class="status">status</p>
			<button (click)="increment()" class="btn">+</button>
			<p class="variant">variant</p>
			<p [attr.title]="dynamicId" class="single">single</p>
			<p class="literal">literal</p>
			<p title="\${VARIANT === 'compact' ? "title-compact" : "title-wide"}" class="kept">kept</p>
		</div>
	\`,
})
class AppComponent {
	dynamicId = 'x';

	increment(): void {
		console.log('increment');
	}
}

export { AppComponent };
`;

const QUOTED_FIXTURE_PATH = 'tests/fixtures/angular/quoted.component.ts';
const QUOTED_MODULE_ID = '/project/src/quoted.component.ts';

const QUOTED_EXPECTED_OUTPUT = `import { Component } from '@angular/core';

@Component({
	selector: 'app-apostrophes',
	template: '<p class="apostrophes">data-testid="text"</p>',
})
class ApostrophesComponent {}

@Component({ selector: 'app-quotes', template: "<p class='quotes'>quotes</p>" })
class QuotesComponent {}

export { ApostrophesComponent, QuotesComponent };
`;

describe('Angular inline-template (TS) fixture', () => {
	it('removes the plain data-testid form and keeps the pinned [attr.data-testid] binding untouched', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(warnings).toEqual([]);

		// Pinned: `[attr.data-testid]` is a property binding target, not the attribute itself — the matcher never
		// touches the name inside the brackets
		expect(RESULT?.code).toContain('[attr.data-testid]="dynamicId"');
		expect(RESULT?.code.match(/data-testid/g)).toHaveLength(1);
		expect(RESULT?.code).not.toContain('data-cy');

		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="status"');
		expect(RESULT?.code).toContain('class="btn"');
		expect(RESULT?.code).toContain('(click)="increment()"');
	});

	it('removes a quoted value whose placeholder holds nested quotes whole, and keeps the bindings beside it', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(warnings).toEqual([]);
		// A value cut at the first inner quote would leave the nested template literal's backtick behind
		expect(parseSync(MODULE_ID, RESULT?.code ?? '').errors).toEqual([]);
		expect(RESULT?.code).not.toMatch(/variant-|single-|literal-/);
		expect(RESULT?.code).toContain('<p class="variant">variant</p>');
		expect(RESULT?.code).toContain('<p [attr.title]="dynamicId" class="single">single</p>');
		expect(RESULT?.code).toContain('<p class="literal">literal</p>');
		// A non-target attribute with the same placeholder shape survives byte for byte
		expect(RESULT?.code).toContain(
			`<p title="\${VARIANT === 'compact' ? "title-compact" : "title-wide"}" class="kept">`,
		);
	});

	it('removes the attributes of an inline template written as a single- or double-quoted string', () => {
		const { transform, warnings } = createHarness(
			{ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(readFileSync(QUOTED_FIXTURE_PATH, 'utf8'), QUOTED_MODULE_ID);

		expect(RESULT?.code).toBe(QUOTED_EXPECTED_OUTPUT);
		expect(warnings).toEqual([]);
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
		const GENERATED_LINE = GENERATED_LINES.findIndex((line) => line.includes('class="container"')) + 1;
		const GENERATED_LINE_TEXT = GENERATED_LINES[GENERATED_LINE - 1] ?? '';
		const GENERATED_COLUMN = GENERATED_LINE_TEXT.indexOf('class="container"');

		const ORIGINAL = originalPositionFor(TRACER, { line: GENERATED_LINE, column: GENERATED_COLUMN });
		const ORIGINAL_LINE_TEXT = CODE.split('\n')[(ORIGINAL.line ?? 0) - 1];

		expect(ORIGINAL.line).not.toBeNull();
		expect(ORIGINAL_LINE_TEXT).toContain('class="container"');
	});
});
