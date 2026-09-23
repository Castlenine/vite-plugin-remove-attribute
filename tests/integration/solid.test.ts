import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import solid from 'vite-plugin-solid';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/solid');
const ENTRY = resolve(ROOT, 'main.tsx');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

/**
 * Asserts that the tagged template of the fixture built with its nested-quote placeholder removed whole.
 *
 * @param code - The concatenated build output.
 */
function expectTaggedTemplateBuilt(code: string): void {
	expect(code).toContain('<b class="tagged">tagged</b>');
	expect(code).not.toContain('tagged-');
	expect(code).toContain('class=inner-html');
}

describe('Solid real build', () => {
	it('removes data-testid when the plugin runs after solid()', async () => {
		const WARNINGS: string[] = [];
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [solid(), removeAttributesPlugin({ attributes: ['data-testid'] })],
			extraConfig: {
				build: {
					target: 'esnext',
					rollupOptions: {
						input: ENTRY,
						onwarn: (warning) => {
							WARNINGS.push(warning.message);
						},
					},
				},
			},
		});

		expect(CODE).toContain('container');
		expectTaggedTemplateBuilt(CODE);

		// `solid()` is `enforce: 'pre'` too and listed first, so the plugin reads Solid's compiled template, where a
		// JSX string holding a literal `${` becomes the unquoted `data-testid=$\{…}`. A balanced one is removed whole
		// — the pathological `${" class="}` taking its `class` along, as in the reversed order — while the unbalanced
		// ones are left in place and warned about rather than cut at a brace: the `unbalanced` element, and the last
		// element of the unused `Price` component, which the bundle then drops
		expect(CODE).toContain(
			'<i class=literal-placeholder></i><i data-testid=$\\{ class=unbalanced></i><div class=inner-html></div><i>',
		);
		expect(CODE.match(new RegExp(DATA_TESTID_REGEX, 'g'))).toEqual(['data-testid=']);
		expect(WARNINGS.filter((message) => message.startsWith('remove-attributes:'))).toEqual([
			`remove-attributes: left 2 attribute(s) in place in ${resolve(ROOT, 'App.tsx')} — the value could not be parsed`,
		]);
	});

	it('removes data-testid when the plugin runs before solid() (reversed order)', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] }), solid()],
			extraConfig: { build: { target: 'esnext', rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('container');
		expectTaggedTemplateBuilt(CODE);

		// The JSX string values are removed whole, and the balanced literal `${" class="}` takes the `class` it
		// spans with it (pinned trade-off)
		expect(CODE).toContain('<i class=literal-placeholder></i><i class=unbalanced></i><div class=inner-html></div><i>');
	});
});
