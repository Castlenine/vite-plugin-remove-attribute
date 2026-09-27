import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/html');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;

describe('HTML real build', () => {
	it('removes data-testid from the emitted index.html and its inline/linked script chunks', async () => {
		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] })],
		});

		// A comment holds no tag, so the attribute written inside the page's comment is kept
		expect(CODE.replaceAll(/<!--[\s\S]*?-->/g, '')).not.toMatch(DATA_TESTID_REGEX);
		expect(CODE).toContain('<!-- a <b data-testid="comment"> written inside a comment is kept');
		expect(CODE).toContain('class="page-title"');
		expect(CODE).toContain('class="container"');

		// The quoted `${…}` values are read as placeholders: the balanced literal `${" title="}` takes the `title` it
		// spans along (pinned trade-off), and the nested-quote value of the inline script's Lit-style tagged template
		// is removed whole, so the script still builds
		expect(CODE).toContain('<p class="dollar">dollar</p>');
		expect(CODE).toContain('<p class="spanned-title">spanned title</p>');
		expect(CODE).toContain('<b class="inline-markup">inline</b>');
		expect(CODE).toContain('<b class="lit-markup">lit</b>');
		expect(CODE).not.toContain('lit-empty');
	});
});
