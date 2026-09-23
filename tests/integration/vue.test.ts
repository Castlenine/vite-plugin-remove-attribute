import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import vue from '@vitejs/plugin-vue';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/vue');
const ENTRY = resolve(ROOT, 'main.ts');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

/**
 * Asserts that the quoted `${…}` values of the fixture were read as placeholders: the `<script setup>` tagged
 * template lost its nested-quote value whole and still built, and the balanced literal `${" title="}` of the
 * template took the `title` it spans along (pinned trade-off).
 *
 * @param code - The concatenated build output.
 */
function expectPlaceholderValuesBuilt(code: string): void {
	expect(code).toContain('<b class="badge">badge</b>');
	expect(code).not.toContain('badge-off');
	expect(code).toContain('badge-host');
	expect(code).toContain('dollar');
	expect(code).toContain('spanned-title');
	expect(code).not.toMatch(/title(?:: |=)"\}"/);
}

describe('Vue real build', () => {
	it('removes data-testid when the plugin runs after vue() (README order)', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [vue(), removeAttributesPlugin({ attributes: ['data-testid'] })],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectPlaceholderValuesBuilt(CODE);
	});

	// The plugin declares `enforce: 'pre'`, so Vite always runs its `transform` hook before `vue()`'s —
	// regardless of array order — meaning listing it before `vue()` here does not reverse execution order
	// from the README's recommended placement; data-testid is still removed.
	it('removes data-testid even when the plugin is listed before vue() (enforce: "pre" runs it first regardless)', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] }), vue()],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectPlaceholderValuesBuilt(CODE);
	});
});
