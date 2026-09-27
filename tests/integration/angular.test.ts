import type { PluginOptions } from '@analogjs/vite-plugin-angular';

import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import angular from '@analogjs/vite-plugin-angular';

import { buildWithVite } from './build-helpers';
import removeAttributesPlugin, { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/angular');
const TSCONFIG = resolve(ROOT, 'tsconfig.json');

/**
 * Builds the Angular fixture with the plugin listed before `angular()` and strips every whitespace character from
 * the output, so the compiled `consts` arrays can be matched regardless of how Rolldown wraps them.
 *
 * @param angularOptions - Options passed to `@analogjs/vite-plugin-angular` on top of the fixture `tsconfig`.
 *
 * @returns The concatenated build output without whitespace.
 */
async function buildAngularFixture(angularOptions: PluginOptions): Promise<string> {
	const CODE = await buildWithVite({
		root: ROOT,
		plugins: [
			removeAttributesPlugin({
				attributes: ['data-testid', 'data-cy'],
				extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS],
			}),
			angular({ tsconfig: TSCONFIG, ...angularOptions }),
		],
	});

	return CODE.replace(/\s+/g, '');
}

describe('Angular (Analog) real build', () => {
	// `angular()` reads `VITEST` / `NODE_ENV` when it is created and switches to its Vitest mode (JIT, and no AOT
	// emit during `vite.build()`); a consumer's `vite build` runs with neither, so both are stubbed per test
	beforeEach(() => {
		vi.stubEnv('VITEST', '');
		vi.stubEnv('NODE_ENV', 'production');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('removes the attributes from the compiled template with fastCompile, and keeps the [attr.data-testid] binding', async () => {
		const CODE = await buildAngularFixture({ fastCompile: true });

		expect(CODE).not.toContain('data-cy');
		expect(CODE).not.toMatch(
			/wrapper|variant-compact|single-compact|literal-compact|apostrophes-template|apostrophes-cy|quotes-template/,
		);
		// The property binding compiles to a runtime attribute call and the text of a quoted template stays text: the
		// only two `data-testid` left in the bundle
		expect(CODE.match(/data-testid/g)).toEqual(['data-testid', 'data-testid']);
		expect(CODE).toContain('ɵɵattribute("data-testid",ctx.dynamicId)');
		expect(CODE).toContain('ɵɵtext(1,"data-testid=\\"text\\"")');

		[
			'["id","app",1,"container"]',
			'[1,"status"]',
			'[1,"btn",3,"click"]',
			'[1,"variant"]',
			'[1,"single"]',
			'[1,"literal"]',
			// The inline templates written as single- and double-quoted strings
			'[1,"apostrophes"]',
			'[1,"quotes"]',
			'ɵɵlistener("click"',
			'ɵɵattribute("title",ctx.dynamicId)',
		].forEach((compiled) => {
			expect(CODE).toContain(compiled);
		});

		expect(CODE).toMatch(/\["title","[^"]*",1,"kept"\]/);
	});

	// Pinned consumer-facing limitation: the default AOT compiler builds its TypeScript program from disk in
	// `buildStart`, before any `transform` runs, so the plugin's output never reaches the compiled template
	it('keeps every attribute in the compiled template with the default AOT compiler', async () => {
		const CODE = await buildAngularFixture({});

		[
			'["data-testid","wrapper","data-cy","wrapper-cy","id","app",1,"container"]',
			'["data-testid","increment",1,"btn",3,"click"]',
			'["data-testid","variant-compact",1,"variant"]',
			'["data-testid","single-compact",1,"single"]',
			'["data-testid","literal-compact",1,"literal"]',
			'["title","title-compact",1,"kept"]',
			'["data-testid","apostrophes-template","data-cy","apostrophes-cy",1,"apostrophes"]',
			'["data-testid","quotes-template",1,"quotes"]',
			'ɵɵattribute("data-testid",ctx.dynamicId)',
		].forEach((compiled) => {
			expect(CODE).toContain(compiled);
		});
	});
});
