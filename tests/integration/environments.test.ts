import type { Options } from '../../src/index';
import type { Plugin } from 'vite';

import { resolve } from 'node:path';

import { createBuilder } from 'vite';
import { describe, expect, it } from 'vitest';

import { createRecordingLogger } from './build-helpers';
import removeAttributesPlugin from '../../src/index';

const ROOT = resolve(import.meta.dirname, '../fixtures/environments');
const ENTRY = resolve(ROOT, 'entry.js');
const PLUGIN_NAME = 'remove-attributes';

/**
 * Creates a plugin collecting the code every environment of an app build emits.
 *
 * @returns The plugin, and the emitted code keyed by environment name.
 */
function createOutputCollector(): { plugin: Plugin; outputs: Map<string, string> } {
	const OUTPUTS = new Map<string, string>();

	return {
		plugin: {
			name: 'output-collector',
			generateBundle(_outputOptions, bundle) {
				const CODE = Object.values(bundle)
					.map((file) => (file.type === 'chunk' ? file.code : ''))
					.join('\n');

				OUTPUTS.set(this.environment.name, CODE);
			},
		},
		outputs: OUTPUTS,
	};
}

/**
 * Runs `buildApp()` over a client and an SSR environment sharing one plugin instance.
 *
 * @param options - The plugin options.
 *
 * @returns The code each environment emitted and the plugin's warnings the build logged.
 */
async function buildApp(options: Options): Promise<{ outputs: Map<string, string>; warnings: string[] }> {
	const { logger, warnings } = createRecordingLogger();
	const COLLECTOR = createOutputCollector();

	const BUILDER = await createBuilder({
		root: ROOT,
		configFile: false,
		envDir: false,
		logLevel: 'silent',
		customLogger: logger,
		plugins: [removeAttributesPlugin(options), COLLECTOR.plugin],
		build: { write: false, minify: false, emptyOutDir: false },
		builder: {},
		environments: {
			client: { build: { rolldownOptions: { input: ENTRY } } },
			ssr: { build: { ssr: ENTRY } },
		},
	});

	await BUILDER.buildApp();

	return {
		outputs: COLLECTOR.outputs,
		warnings: warnings.filter((message) => message.includes(PLUGIN_NAME)),
	};
}

describe('Multi-environment app build (`createBuilder` + `buildApp`)', () => {
	it('removes the attribute in the client and the SSR output, and warns once about the module', async () => {
		const { outputs, warnings } = await buildApp({ attributes: ['data-testid'], extensions: ['js'] });

		expect([...outputs.keys()].sort()).toEqual(['client', 'ssr']);

		outputs.forEach((code) => {
			expect(code).not.toContain('removed-environment');
			expect(code).toContain('<div class="kept-environment">removed</div>');
			expect(code).toContain('<p data-testid={ unreadable-environment>');
		});

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(
			`${PLUGIN_NAME}: left 1 attribute(s) in place in ${ENTRY} — the value could not be parsed`,
		);
	});

	it('warns exactly once about an empty `extensions` list', async () => {
		const { outputs, warnings } = await buildApp({ attributes: ['data-testid'], extensions: [] });

		expect(warnings).toEqual([
			`[${PLUGIN_NAME}] the "extensions" option resolved to an empty list, so the plugin will not process any file`,
		]);
		outputs.forEach((code) => {
			expect(code).toContain('data-testid="removed-environment"');
		});
	});
});
