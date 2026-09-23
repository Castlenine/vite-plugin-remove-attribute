import type { InlineConfig, Logger, PluginOption } from 'vite';

import { stripVTControlCharacters } from 'node:util';

import { build } from 'vite';

interface BuildWithViteOptions {
	root: string;
	// `PluginOption` (not `Plugin`) so framework plugin factories that return an array (`svelte()`, `preact()`) or a
	// falsy value can be passed directly, the way a consumer's own `plugins` array would
	plugins: PluginOption[];
	extraConfig?: InlineConfig;
	/** The logger the build reports through. Default: Vite's own, silenced */
	logger?: Logger;
}

interface OutputChunk {
	type: 'chunk' | 'asset';
	code?: string;
	source?: string | Uint8Array;
}

interface RolldownBuildResult {
	output: OutputChunk[];
}

/**
 * Tells whether a `vite.build()` result carries the Rollup/Rolldown `{ output: [...] }` shape used when
 * `build.write` is `false`.
 *
 * @remarks
 * `vite.build()` also returns an array (multiple outputs) or a `RollupWatcher` (watch mode) depending on the
 * config passed in. Neither of those is produced by the plain `{ write: false }` calls this helper makes, but
 * narrowing here keeps the concatenation below from reading `.output` off a value that lacks it.
 *
 * @param result - The value `vite.build()` resolved to.
 *
 * @returns `true` when `result` has an `output` array.
 */
function hasOutput(result: unknown): result is RolldownBuildResult {
	return result != null && typeof result === 'object' && 'output' in result && Array.isArray(result.output);
}

/**
 * Runs a real `vite.build()` against a fixture and concatenates every emitted chunk and asset into one string.
 *
 * @remarks
 * `build.write: false` makes Vite 8 (Rolldown) return the built output in memory instead of writing it to disk,
 * so the integration tests can assert on the emitted text directly. Chunks expose `.code`; assets (like an
 * emitted `index.html`) expose `.source` instead.
 *
 * @param options.root - The fixture directory to build.
 * @param options.plugins - The Vite plugins to run, in order.
 * @param options.extraConfig - Additional `InlineConfig` fields merged into the build (e.g. `esbuild`, `build.rollupOptions.input`).
 * @param options.logger - The logger the build reports through, instead of Vite's own silenced one.
 *
 * @returns The concatenated text of every emitted chunk and asset.
 */
async function buildWithVite(options: BuildWithViteOptions): Promise<string> {
	const { root, plugins, extraConfig, logger } = options;

	const RESULT = await build({
		root,
		configFile: false,
		logLevel: 'silent',
		...(logger == null ? {} : { customLogger: logger }),
		plugins,
		...extraConfig,
		build: {
			write: false,
			minify: false,
			...extraConfig?.build,
		},
	});

	if (!hasOutput(RESULT)) {
		throw new Error('Expected vite.build() to return a single { output: [...] } result with build.write: false');
	}

	return RESULT.output
		.map((item) => (item.type === 'chunk' ? (item.code ?? '') : String(item.source ?? '')))
		.join('\n');
}

/**
 * Creates a logger recording every message it receives, without the ANSI color codes Vite adds when the terminal
 * (or `CI`) enables colors.
 *
 * @returns The logger and the recorded `info` and `warn` messages.
 */
function createRecordingLogger(): { logger: Logger; infos: string[]; warnings: string[] } {
	const INFOS: string[] = [];
	const WARNINGS: string[] = [];

	const LOGGER: Logger = {
		info: (message) => {
			INFOS.push(stripVTControlCharacters(message));
		},
		warn: (message) => {
			WARNINGS.push(stripVTControlCharacters(message));
		},
		warnOnce: (message) => {
			WARNINGS.push(stripVTControlCharacters(message));
		},
		error: () => undefined,
		clearScreen: () => undefined,
		hasErrorLogged: () => false,
		hasWarned: false,
	};

	return { logger: LOGGER, infos: INFOS, warnings: WARNINGS };
}

export { buildWithVite, createRecordingLogger };
