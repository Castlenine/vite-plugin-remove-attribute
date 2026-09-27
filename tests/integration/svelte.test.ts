import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { svelte } from '@sveltejs/vite-plugin-svelte';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/svelte');
const ENTRY = resolve(ROOT, 'main.ts');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

/**
 * Asserts that the nested-quote and `${`-led mustache values of the fixture were removed whole, leaving none of
 * their literals behind and their neighbors in place.
 *
 * @param code - The concatenated build output.
 */
function expectMustacheValuesRemoved(code: string): void {
	expect(code).not.toMatch(/"yes"|single-|nested-|cost /);
	expect(code).toContain('<span class="status">status</span>');
	expect(code).toContain('<span class="single">single</span>');
	expect(code).toContain('<span class="price">price</span>');
	expect(code).toContain('<span class="nested">nested</span>');
}

describe('Svelte real build', () => {
	it('removes data-testid when the plugin runs before svelte()', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] }), svelte({ configFile: false })],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectMustacheValuesRemoved(CODE);
	});

	// Vite runs `enforce: 'pre'` plugins in array order, so here `vite-plugin-svelte:preprocess` (also `pre`)
	// runs before this plugin — which only matters for markup preprocessors such as Pug. Compilation happens in
	// `vite-plugin-svelte:compile-module` (`enforce: 'post'`), which always runs after this plugin, so
	// data-testid is still removed.
	it('removes data-testid even when the plugin is listed after svelte() (compilation is enforce: "post")', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [svelte({ configFile: false }), removeAttributesPlugin({ attributes: ['data-testid'] })],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectMustacheValuesRemoved(CODE);
	});
});
