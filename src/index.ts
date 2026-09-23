import type { Logger, Plugin } from 'vite';
import type { Options } from './types';

import {
	ASTRO_EXTENSIONS,
	cleanExtensions,
	createAttributeMatcher,
	createExtensionMatcher,
	createIgnoreMatcher,
	DEFAULT_EXTENSIONS,
	getFileKind,
	getOptions,
	HTML_EXTENSIONS,
	HTML_PROXY_REGEX,
	isStyleRequest,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	removeRanges,
	SCRIPT_EXTENSIONS,
	stripQuery,
	SVELTE_EXTENSIONS,
	toRelativePath,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
} from './utilities';
import { generateRemovalSourceMap } from './sourcemap';

export type { Options } from './types';

/**
 * The part of the bundler's plugin context this plugin uses.
 *
 * @remarks
 * Declared structurally rather than imported from one bundler's type package: Vite has run on Rollup 2, 3 and
 * 4 and now also on Rolldown, and every one of them gives the `transform` hook the same `warn` — a message and
 * an optional character offset, which the bundler resolves into the line, the column and a code frame of the
 * module being transformed.
 */
interface WarningContext {
	warn: (message: string, position?: number) => void;
}

/**
 * The part of a resolved Vite configuration the sourcemap decision reads, declared optional so that a plugin driven
 * outside Vite is handled too
 */
interface SourcemapAwareConfig {
	command?: 'build' | 'serve';
	build?: { sourcemap?: unknown };
}

/**
 * The part of a resolved Vite configuration the plugin-order decision reads
 */
interface PluginAwareConfig {
	plugins?: readonly { name: string }[];
}

/**
 * The plugin context of a hook. On Vite 6 or later it carries the environment the hook runs in, together with that
 * environment's own resolved configuration; the older Vite versions the peer range allows provide none.
 */
interface EnvironmentAwareContext {
	environment?: { config?: SourcemapAwareConfig & PluginAwareConfig & { root?: string } };
}

const PLUGIN_NAME = 'remove-attributes';
const ASTRO_COMPILER_PLUGIN_NAME = 'astro:build';
const NOT_FOUND = -1;

/**
 * Reports whether the running transform must return a source map for the module it changed.
 *
 * @remarks
 * The dev server always wants one, whatever the build setting says. A build wants one when its resolved
 * `build.sourcemap` is truthy (`true`, `'inline'`, `'hidden'`), the environment's own setting winning over the
 * top-level one on Vite 6+. A setting that was never resolved — the plugin driven outside Vite — keeps the map.
 *
 * @param context - The `this` value the hook received.
 * @param config - The configuration `configResolved` received, or `null` before it ran.
 *
 * @returns `true` when the map must be generated.
 */
function isSourcemapWanted(context: unknown, config: SourcemapAwareConfig | null): boolean {
	const ENVIRONMENT_CONFIG = (context as EnvironmentAwareContext | null | undefined)?.environment?.config;

	if ((ENVIRONMENT_CONFIG?.command ?? config?.command) !== 'build') {
		return true;
	}

	const ENVIRONMENT_SETTING = ENVIRONMENT_CONFIG?.build?.sourcemap;
	const SETTING = ENVIRONMENT_SETTING ?? config?.build?.sourcemap;

	return SETTING == null || Boolean(SETTING);
}

/**
 * Reports whether Astro compiles its components before this plugin reads them.
 *
 * @remarks
 * `astro:build` is an `enforce: 'pre'` plugin Astro registers ahead of every user plugin, in the dev server as in a
 * build, so the `.astro` main module reaches this plugin as the JavaScript Astro compiled it, under the unchanged id
 * of the component.
 *
 * @param plugins - The resolved plugins, in the order they run, or `undefined` when the configuration lists none.
 *
 * @returns `true` when the Astro compiler runs first.
 */
function isCompiledByAstroFirst(plugins: readonly { name: string }[] | undefined): boolean {
	const NAMES = (plugins ?? []).map((plugin) => plugin.name);
	const ASTRO_INDEX = NAMES.indexOf(ASTRO_COMPILER_PLUGIN_NAME);

	return ASTRO_INDEX !== NOT_FOUND && ASTRO_INDEX < NAMES.indexOf(PLUGIN_NAME);
}

/**
 * Reports whether Astro compiles its components before this plugin reads them, in the build a hook runs in.
 *
 * @param context - The `this` value the hook received.
 * @param isCompiledFirstByDefault - The answer for the configuration `configResolved` received, used when the hook
 *   runs without an environment.
 *
 * @returns `true` when the Astro compiler runs first.
 */
function isAstroCompiledFirstIn(context: unknown, isCompiledFirstByDefault: boolean): boolean {
	const PLUGINS = (context as EnvironmentAwareContext | null | undefined)?.environment?.config?.plugins;

	return PLUGINS == null ? isCompiledFirstByDefault : isCompiledByAstroFirst(PLUGINS);
}

/**
 * Returns the Vite root of the build a hook runs in.
 *
 * @remarks
 * Two builds sharing one plugin instance each resolve their own configuration, so the root is read from the running
 * hook's environment rather than kept from `configResolved`, which the second build to resolve would overwrite.
 *
 * @param context - The `this` value the hook received.
 * @param fallbackRoot - The root of the last configuration resolved, used when the hook runs without an environment.
 *
 * @returns The root ignore tokens are matched against.
 */
function getRootIn(context: unknown, fallbackRoot: string): string {
	return (context as EnvironmentAwareContext | null | undefined)?.environment?.config?.root ?? fallbackRoot;
}

/**
 * Formats the entries of an option list that resolved to nothing, every one of which was therefore rejected.
 *
 * @remarks
 * An entry is only printed when it is a string: anything else is named by its type, since converting an arbitrary
 * value to a string can throw (`Object.create(null)` has no `toString`) and a warning must never fail the build.
 *
 * @param entries - The entries the consumer passed, which are not guaranteed to be strings.
 *
 * @returns The rejected entries, formatted for a log line.
 */
function getRejectedEntries(entries: readonly unknown[]): string[] {
	return entries.map((entry) => (typeof entry === 'string' ? `"${entry}"` : `<${typeof entry}>`));
}

/**
 * Formats the list of rejected entries appended to an empty-list warning.
 *
 * @param entries - The option value the consumer passed, which is not guaranteed to be an array.
 * @param noun - What a usable entry of the list is.
 *
 * @returns The parenthesized detail, or the empty string when the consumer passed no entry at all.
 */
function formatRejectedDetail(entries: unknown, noun: string): string {
	const REJECTED = Array.isArray(entries) ? getRejectedEntries(entries) : [];

	return REJECTED.length > 0 ? ` (no usable ${noun} among ${REJECTED.join(', ')})` : '';
}

/**
 * Warns about every option list that resolved to nothing, which silently turns the plugin into a no-op.
 *
 * @remarks
 * `getOptions` drops each entry it cannot use, so a list holding only blank or non-string entries disables the
 * plugin as surely as an empty one does. The build is never failed over it: a misconfigured optional plugin must not
 * stop a release.
 *
 * @param options.options - The options the consumer passed.
 * @param options.attributes - The attribute names `getOptions` resolved from them.
 * @param options.extensions - The extensions left once cleaned the way the extension matcher cleans them.
 * @param options.logger - The logger of the resolved configuration.
 */
function warnAboutEmptyLists(options: {
	options: Options | undefined;
	attributes: readonly string[];
	extensions: readonly string[];
	logger: Pick<Logger, 'warn'>;
}): void {
	const { attributes, extensions, logger } = options;

	if (attributes.length === 0) {
		logger.warn(
			`[${PLUGIN_NAME}] the "attributes" option resolved to an empty list${formatRejectedDetail(options.options?.attributes, 'attribute name')}, so the plugin will not remove anything`,
		);
	}

	if (extensions.length === 0) {
		logger.warn(
			`[${PLUGIN_NAME}] the "extensions" option resolved to an empty list${formatRejectedDetail(options.options?.extensions, 'extension')}, so the plugin will not process any file`,
		);
	}
}

/**
 * Tells whether the value a hook was called with can report build warnings.
 *
 * @remarks
 * Vite always calls `transform` with a plugin context, but the hook is a plain function that anything may
 * call — a unit test invoking `plugin.transform` directly gets no context at all, and a warning must never be
 * what breaks such a call.
 *
 * @param context - The `this` value the hook received.
 *
 * @returns `true` when `warn` can be called on it.
 */
function hasWarningContext(context: unknown): context is WarningContext {
	return typeof (context as WarningContext | null | undefined)?.warn === 'function';
}

/**
 * Warns once about the attributes a module kept because their values could not be parsed.
 *
 * @remarks
 * One warning per module rather than one per occurrence: a file holding thousands of unbalanced expressions
 * would otherwise flood the build log. The index of the first attribute left in place is passed as the
 * position, so the bundler points the consumer at it. A module every environment of an app build transforms (the
 * client and the SSR one) is warned about once, not once per environment.
 *
 * @param options.context - The `this` value the `transform` hook received.
 * @param options.skipped - The name-start index of every attribute left in place.
 * @param options.id - The module id, which tells the modules of every build apart.
 * @param options.file - The module path to name in the message.
 * @param options.reported - The id and message of every warning the plugin instance reported so far.
 */
function warnSkippedAttributes(options: {
	context: unknown;
	skipped: number[];
	id: string;
	file: string;
	reported: Set<string>;
}): void {
	const { context, skipped, id, file, reported } = options;
	const [FIRST_SKIPPED_INDEX] = skipped;

	if (FIRST_SKIPPED_INDEX == null || !hasWarningContext(context)) {
		return;
	}

	const MESSAGE = `remove-attributes: left ${skipped.length} attribute(s) in place in ${file} — the value could not be parsed`;
	const KEY = `${id}\0${MESSAGE}`;

	if (reported.has(KEY)) {
		return;
	}

	reported.add(KEY);
	context.warn(MESSAGE, FIRST_SKIPPED_INDEX);
}

/**
 * Vite plugin to remove specified attributes from markup files.
 *
 * This plugin scans files with configured extensions and removes
 * attributes as defined in the option list. It also produces
 * accurate source maps to ensure the original line and column numbers
 * are preserved for consumers of the Vite build chain.
 *
 * Files can be ignored based on path token matching. Ignore patterns
 * are resolved relative to the Vite root.
 *
 * @param options - Plugin configuration including which attributes
 *   to remove, and optionally which file extensions to target and
 *   which paths to ignore. `extensions` defaults to `DEFAULT_EXTENSIONS`.
 *
 * @returns A Vite plugin object that removes attributes during
 *   transformation steps.
 */
function removeAttributesPlugin(options: Options): Plugin {
	const OPTIONS = getOptions(options);
	// Every matcher compiles its patterns once per plugin instance rather than once per transformed module
	const matchAttributes = createAttributeMatcher(OPTIONS.attributes, { removeInStrings: OPTIONS.removeInStrings });
	const hasIgnorePath = createIgnoreMatcher(OPTIONS);
	const hasExtension = createExtensionMatcher(OPTIONS.extensions);
	const hasSvelteExtension = createExtensionMatcher(SVELTE_EXTENSIONS);
	const HAS_ATTRIBUTE_TO_REMOVE = OPTIONS.attributes.length > 0;

	// Ignore tokens are matched against paths relative to the Vite root, not to the process working directory. These
	// are the values of the last configuration resolved, which a Vite 6+ hook only falls back on when its environment
	// carries none
	let root = process.cwd();
	let resolvedConfig: SourcemapAwareConfig | null = null;
	let isAstroCompiledFirst = false;
	// Vite resolves the configuration of a plugin instance more than once in some setups, but a misconfiguration is
	// reported only once
	let hasCheckedLists = false;
	const REPORTED_WARNINGS = new Set<string>();

	return {
		name: PLUGIN_NAME,
		enforce: 'pre',
		configResolved(config) {
			root = config.root;
			resolvedConfig = config;
			isAstroCompiledFirst = isCompiledByAstroFirst(config.plugins);

			if (!hasCheckedLists) {
				hasCheckedLists = true;
				warnAboutEmptyLists({
					options,
					attributes: OPTIONS.attributes,
					extensions: cleanExtensions(OPTIONS.extensions),
					logger: config.logger,
				});
			}
		},
		transform(code, id) {
			// No usable attribute name survived option validation: there is nothing to remove in any file
			if (!HAS_ATTRIBUTE_TO_REMOVE) {
				return null;
			}

			// Virtual modules (`\0…`) never carry markup, and a stylesheet extracted from a component or an HTML page
			// holds no attribute
			if (
				id.startsWith('\0') ||
				!hasExtension(id) ||
				isStyleRequest(id) ||
				hasIgnorePath(toRelativePath(id, getRootIn(this, root)))
			) {
				return null;
			}

			// Svelte is the one supported syntax where a quoted value may hold a `{…}` expression, which already
			// covers a `${…}` inside it. Every other file may hold a tagged template interpolating a `${…}`
			// placeholder into a quoted value — a script module, or the `<script>` of a Vue, Astro or HTML file.
			// The kind of the file decides where an attribute may sit in it at all
			const IS_SVELTE = hasSvelteExtension(id);
			const FILE_KIND = getFileKind(id);
			// Astro hands its component back compiled under the unchanged id, and only its main module: a query names a
			// sub-request, whose kind the id already tells. The compiled module is JavaScript whose markup sits in
			// template literals and holds no JSX
			const IS_COMPILED_ASTRO =
				FILE_KIND === 'astro' && !id.includes('?') && isAstroCompiledFirstIn(this, isAstroCompiledFirst);
			const { ranges, skipped } = matchAttributes(code, {
				hasQuotedMustache: IS_SVELTE,
				hasQuotedPlaceholder: !IS_SVELTE,
				fileKind: IS_COMPILED_ASTRO ? 'ts' : FILE_KIND,
				isCompiledAstro: IS_COMPILED_ASTRO,
			});

			const FILE = stripQuery(id);

			warnSkippedAttributes({ context: this, skipped, id, file: FILE, reported: REPORTED_WARNINGS });

			if (ranges.length === 0) {
				return null;
			}

			const TRANSFORMED_CODE = removeRanges(code, ranges);

			// A build wanting no source map would only discard it, so it is not even generated
			if (!isSourcemapWanted(this, resolvedConfig)) {
				return { code: TRANSFORMED_CODE, map: null };
			}

			// A removal shifts every later column (and every later line when the attribute sat on its own line), so the
			// map keeps the consumer's sourcemaps pointing at the original positions. The inline script of an HTML page
			// is a module of its own, which Vite names by its `html-proxy` id in the maps it emits: naming the page
			// would pair the page's path with the script's columns
			return {
				code: TRANSFORMED_CODE,
				map: generateRemovalSourceMap(code, ranges, HTML_PROXY_REGEX.test(id) ? id : FILE),
			};
		},
	};
}

export default removeAttributesPlugin;

export {
	ASTRO_EXTENSIONS,
	DEFAULT_EXTENSIONS,
	HTML_EXTENSIONS,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	SVELTE_EXTENSIONS,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
};
