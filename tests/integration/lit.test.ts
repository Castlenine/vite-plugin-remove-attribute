import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin, { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/lit');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

// lit is not installed; the fixture defines its own tagged `html`/`css` stubs, so no runtime package is resolved.
describe('Lit real build', () => {
	it('removes data-testid from the html`…` template in the built chunk', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [
				removeAttributesPlugin({
					attributes: ['data-testid'],
					extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS],
				}),
			],
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('class="wrapper"');
		expect(CODE).toContain('class="label"');
		expect(CODE).toContain('class="field"');
	});

	// Cutting a quoted value at the first quote inside its `${…}` placeholder left a stray backtick of the nested
	// template literal behind, and the build failed to parse the module
	it('builds the quoted values holding nested quotes and template literals, and leaks none of their text', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [
				removeAttributesPlugin({
					attributes: ['data-testid', 'data-cy'],
					extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS],
				}),
			],
		});

		expect(CODE).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).not.toContain('data-cy');
		// Only the non-target `title` still holds its placeholder literals
		expect([...new Set(CODE.match(/lit-[\w-]+/g))]).toEqual(['lit-kept-on', 'lit-kept-off']);

		[
			'<p class="double">double</p>',
			'<p class="single">single</p>',
			'<p class="other">other</p>',
			'<p class="literal">literal</p>',
			'<p class="placeholders">placeholders</p>',
			'<p class="object">object</p>',
			'<p class="brace">brace</p>',
			'<p class="comment">comment</p>',
			'<p class="regex">regex</p>',
			'<section class="nested">',
			'class="multi-line"',
			'<p class="minified">minified</p>',
			'<p class="back-to-back">back-to-back</p>',
			'<p class="lone-dollar">lone dollar</p>',
			'<p class="escaped">escaped</p>',
			'class="kept">kept</p>',
		].forEach((markup) => {
			expect(CODE).toContain(markup);
		});
	});
});
