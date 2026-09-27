import type { Plugin } from 'vite';

import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildWithVite, createRecordingLogger } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ENVIRONMENTS_ROOT = resolve(import.meta.dirname, '../fixtures/environments');
const CONCURRENT_ROOT = resolve(import.meta.dirname, '../fixtures/concurrent');
const PLUGIN_NAME = 'remove-attributes';

/**
 * Creates a plugin announcing that the configuration of the build it belongs to was resolved.
 *
 * @returns The plugin, and the promise it settles once `configResolved` ran.
 */
function createResolvedSignal(): { plugin: Plugin; resolved: Promise<void> } {
	let announce: () => void = () => undefined;

	const RESOLVED = new Promise<void>((resolvePromise) => {
		announce = resolvePromise;
	});

	return {
		plugin: {
			name: 'resolved-signal',
			enforce: 'post',
			configResolved() {
				announce();
			},
		},
		resolved: RESOLVED,
	};
}

describe('Two concurrent builds with different roots sharing one plugin instance', () => {
	let environmentsCode = '';
	let concurrentCode = '';
	let environmentsWarnings: string[] = [];
	let concurrentWarnings: string[] = [];

	beforeAll(async () => {
		// Relative to the root of the other build, the module of each build sits under a folder named after its
		// fixture, which these tokens ignore; relative to its own root, it does not
		const PLUGIN = removeAttributesPlugin({
			attributes: ['data-testid'],
			extensions: ['js'],
			ignoreFolders: ['environments', 'concurrent'],
		});

		const ENVIRONMENTS_RECORDING = createRecordingLogger();
		const CONCURRENT_RECORDING = createRecordingLogger();
		const ENVIRONMENTS_RESOLVED = createResolvedSignal();
		const CONCURRENT_RESOLVED = createResolvedSignal();

		// The `environments` build resolves its configuration first, and only transforms once the `concurrent` build
		// resolved its own, so the last configuration resolved names the other build's root
		const ENVIRONMENTS_BUILD = buildWithVite({
			root: ENVIRONMENTS_ROOT,
			plugins: [
				PLUGIN,
				ENVIRONMENTS_RESOLVED.plugin,
				{ name: 'wait-for-concurrent-build', buildStart: () => CONCURRENT_RESOLVED.resolved },
			],
			extraConfig: { envDir: false, build: { rolldownOptions: { input: resolve(ENVIRONMENTS_ROOT, 'entry.js') } } },
			logger: ENVIRONMENTS_RECORDING.logger,
		});

		await ENVIRONMENTS_RESOLVED.resolved;

		const CONCURRENT_BUILD = buildWithVite({
			root: CONCURRENT_ROOT,
			plugins: [PLUGIN, CONCURRENT_RESOLVED.plugin],
			extraConfig: { envDir: false, build: { rolldownOptions: { input: resolve(CONCURRENT_ROOT, 'entry.js') } } },
			logger: CONCURRENT_RECORDING.logger,
		});

		[environmentsCode, concurrentCode] = await Promise.all([ENVIRONMENTS_BUILD, CONCURRENT_BUILD]);
		environmentsWarnings = ENVIRONMENTS_RECORDING.warnings.filter((message) => message.includes(PLUGIN_NAME));
		concurrentWarnings = CONCURRENT_RECORDING.warnings.filter((message) => message.includes(PLUGIN_NAME));
	});

	it('matches the ignore tokens of each build against its own root', () => {
		expect(environmentsCode).not.toContain('removed-environment');
		expect(environmentsCode).toContain('<div class="kept-environment">removed</div>');
		expect(concurrentCode).not.toContain('removed-concurrent');
		expect(concurrentCode).toContain('<div class="kept-concurrent">removed</div>');
	});

	it('reports the warning of each build through its own logger', () => {
		expect(environmentsWarnings).toHaveLength(1);
		expect(environmentsWarnings[0]).toContain(
			`${PLUGIN_NAME}: left 1 attribute(s) in place in ${resolve(ENVIRONMENTS_ROOT, 'entry.js')} — the value could not be parsed`,
		);
		expect(concurrentWarnings).toEqual([]);
	});
});
