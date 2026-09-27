import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/qwik');
const ENTRY = resolve(ROOT, 'routes/index.tsx');

// @builder.io/qwik 1.20 declares peer vite >=5 <8; unskip once Qwik supports Vite 8
describe.skip('Qwik real build', () => {
	it('removes data-testid when the plugin runs before qwikVite()', async () => {
		// @builder.io/qwik is not installed (peer vite >=5 <8), so no type declarations are available for this
		// specifier; this dynamic import is unreachable while the describe block above is skipped, and only resolves
		// once the block is unskipped against a compatible release
		// @ts-expect-error -- @builder.io/qwik/optimizer has no type declarations until the package is installed
		const { qwikVite } = await import('@builder.io/qwik/optimizer');

		const CODE = await buildWithVite({
			root: ROOT,
			plugins: [removeAttributesPlugin({ attributes: ['data-testid'] }), qwikVite()],
			extraConfig: { build: { rollupOptions: { input: ENTRY } } },
		});

		expect(CODE).not.toMatch(/data-testid\s*=|\sdata-testid[\s/>]/);
		// The tagged template's nested-quote placeholder is removed whole and none of its literals survive
		expect(CODE).toContain('<b class="tagged">tagged</b>');
		expect(CODE).not.toContain('tagged-');
	});
});
