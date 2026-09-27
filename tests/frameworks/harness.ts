import type { Options } from '../../src/index';
import type { Plugin, ResolvedConfig } from 'vite';
import type { SourceMap } from '../../src/sourcemap';

import removeAttributesPlugin from '../../src/index';

type TransformResult = null | { code: string; map: SourceMap };

interface Warning {
	message: string;
	position: number | undefined;
}

interface Harness {
	plugin: Plugin;
	/**
	 * Calls the hook with a plugin context collecting into `warnings`, the way the bundler does
	 */
	transform: (code: string, id: string) => TransformResult;
	warnings: Warning[];
}

/**
 * Creates a minimal test harness for `removeAttributesPlugin`, shared across the per-framework fixture tests.
 *
 * @param options - Plugin options to configure attribute removal.
 * @param root - The root directory to use for the Vite config.
 *
 * @returns An object holding the initialized plugin, a `transform` entry point, and the warnings collected.
 */
function createHarness(options: Options, root: string): Harness {
	const PLUGIN = removeAttributesPlugin(options);
	const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
	const TRANSFORM = PLUGIN.transform as (this: unknown, code: string, id: string) => TransformResult;
	const WARNINGS: Warning[] = [];
	const CONTEXT = {
		warn: (message: string, position?: number) => {
			WARNINGS.push({ message, position });
		},
	};

	CONFIG_RESOLVED({ root } as ResolvedConfig);

	return {
		plugin: PLUGIN,
		transform: (code, id) => TRANSFORM.call(CONTEXT, code, id),
		warnings: WARNINGS,
	};
}

export type { Harness, TransformResult, Warning };

export { createHarness };
