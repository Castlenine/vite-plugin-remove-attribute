import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/react');
const ENTRY = resolve(ROOT, 'main.tsx');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

// react is not installed; the fixture defines its own `h`/`Fragment` and esbuild is told to target them directly
// (`jsx: 'transform'`), so no JSX runtime package is resolved.
describe('React (esbuild classic JSX) real build', () => {
	it('removes data-testid and keeps the control class attribute', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] })],
			extraConfig: {
				esbuild: { jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment' },
				build: { rollupOptions: { input: ENTRY } },
			},
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expect(CODE).toContain('"literal-placeholder"');
		expect(CODE).toContain('"unbalanced"');
		expect(CODE).toContain('"inner-html"');
		// The tagged template's nested-quote placeholder is removed whole and none of its literals survive
		expect(CODE).toContain('<b class="tagged">tagged</b>');
		expect(CODE).not.toContain('tagged-');
		// Pinned trade-off: the balanced literal `${" class="}` took the `class` it spans with it
		expect(CODE).not.toContain('"}"');
	});
});
