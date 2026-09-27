import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import preact from '@preact/preset-vite';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/preact');
const ENTRY = resolve(ROOT, 'main.tsx');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

/**
 * Asserts that the JSX placeholder cases of the fixture built with their neighbors intact.
 *
 * @param code - The concatenated build output.
 */
function expectPlaceholderCasesBuilt(code: string): void {
	expect(code).toContain('literal-placeholder');
	expect(code).toContain('unbalanced');
	expect(code).toContain('inner-html');
	// The tagged template's nested-quote placeholder is removed whole and none of its literals survive
	expect(code).toContain('<b class="tagged">tagged</b>');
	expect(code).not.toContain('tagged-');
	// Pinned trade-off: the balanced literal `${" class="}` took the `class` it spans with it
	expect(code).not.toMatch(/class(?:: |=)"?\}/);
}

describe('Preact real build', () => {
	it('removes data-testid when the plugin runs after preact()', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [preact(), removeAttributesPlugin({ attributes: ['data-testid'] })],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectPlaceholderCasesBuilt(CODE);
	});

	it('removes data-testid when the plugin runs before preact() (reversed order)', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] }), preact()],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectPlaceholderCasesBuilt(CODE);
	});
});
