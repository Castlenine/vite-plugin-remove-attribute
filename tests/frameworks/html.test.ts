import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { parseSync } from 'vite';

import { createHarness } from './harness';

const FIXTURE_PATH = 'tests/fixtures/html/index.html';
const MODULE_ID = '/project/index.html';

const EXPECTED_OUTPUT = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title class="page-title">HTML fixture</title>
	</head>
	<body class="page">
		<!-- a <b data-testid="comment"> written inside a comment is kept — a comment holds no tag -->
		<div class="container" id="app">
			<input class="field" />
			<button class="btn">bare</button>
			<p class="text">quoted</p>
			<p class="dollar">dollar</p>
			<p class="spanned-title">spanned title</p>
		</div>
		<script type="module">
			const name = 'data-testid';
			const html = String.raw;
			console.log(name);
			document.body.insertAdjacentHTML('beforeend', \`<b class="inline-markup">inline</b>\`);
			document.body.insertAdjacentHTML(
				'beforeend',
				html\`<b class="lit-markup">lit</b>\`,
			);
		</script>
		<script type="module" src="./main.ts"></script>
	</body>
</html>
`;

describe('HTML fixture', () => {
	it('removes the quoted, unquoted and bare forms, and keeps the comment and the quoted script string', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['html'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);

		expect(RESULT?.code).toBe(EXPECTED_OUTPUT);
		expect(warnings).toEqual([]);

		// Only opening tags hold attributes: the one written in the comment and the `'data-testid'` string of the inline
		// module script survive untouched
		expect(RESULT?.code).toContain(`const name = 'data-testid';`);
		expect(RESULT?.code).toContain('<!-- a <b data-testid="comment"> written inside a comment is kept');
		expect(RESULT?.code.match(/data-testid/g)).toHaveLength(2);
		expect(RESULT?.code).not.toContain('data-cy');

		// Control attributes survive
		expect(RESULT?.code).toContain('class="page-title"');
		expect(RESULT?.code).toContain('class="page"');
		expect(RESULT?.code).toContain('class="container"');
		expect(RESULT?.code).toContain('id="app"');
		expect(RESULT?.code).toContain('class="field"');
		expect(RESULT?.code).toContain('class="btn"');
		expect(RESULT?.code).toContain('class="text"');
	});

	it('reads a quoted `${…}` as a placeholder, in the markup and in an inline script alike', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform, warnings } = createHarness(
			{ extensions: ['html'], attributes: ['data-testid', 'data-cy'] },
			'/project',
		);

		const RESULT = transform(CODE, MODULE_ID);
		const SCRIPT = RESULT?.code.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? '';

		expect(warnings).toEqual([]);
		expect(RESULT?.code).toContain('<p class="dollar">dollar</p>');
		// Pinned, documented trade-off: a balanced literal `${" title="}` spans the next attribute and takes it along
		expect(RESULT?.code).toContain('<p class="spanned-title">spanned title</p>');
		expect(SCRIPT).toContain('document.body.insertAdjacentHTML(\'beforeend\', `<b class="inline-markup">inline</b>`);');
		// The nested-quote placeholder of the Lit-style tagged template is removed whole, and the script still parses
		expect(SCRIPT).toContain('html`<b class="lit-markup">lit</b>`,');
		expect(parseSync('index.html.js', SCRIPT).errors).toEqual([]);
	});

	it('removes a nested-quote placeholder of an inline script whole under its html-proxy id', () => {
		const { transform, warnings } = createHarness({ extensions: ['html'], attributes: ['data-testid'] }, '/project');
		const SCRIPT = 'const markup = html`<b data-testid="${ok ? `a-${id}` : "b"}" class="k">`;';
		const RESULT = transform(SCRIPT, '/project/index.html?html-proxy&index=0.js');

		expect(RESULT?.code).toBe('const markup = html`<b class="k">`;');
		expect(parseSync('index.html.js', RESULT?.code ?? '').errors).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it('maps a token after the first removal back to its original line and column', () => {
		const CODE = readFileSync(FIXTURE_PATH, 'utf8');
		const { transform } = createHarness({ extensions: ['html'], attributes: ['data-testid', 'data-cy'] }, '/project');

		const RESULT = transform(CODE, MODULE_ID);

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
