import type { Options } from './types';
import type { Plugin } from 'vite';

import {
	ASTRO_EXTENSIONS,
	DEFAULT_EXTENSIONS,
	findAttributeRanges,
	getIgnoredPaths,
	getOptions,
	hasExtension,
	hasIgnorePath,
	HTML_EXTENSIONS,
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
	const IGNORED_PATHS = getIgnoredPaths(OPTIONS);

	// Ignore tokens are matched against paths relative to the Vite root, not to the process working directory
	let root = process.cwd();

	return {
		name: 'remove-attributes',
		enforce: 'pre',
		configResolved(config) {
			root = config.root;
		},
		transform(code, id) {
			// Virtual modules (`\0…`) never carry markup
			if (
				id.startsWith('\0') ||
				!hasExtension(id, OPTIONS.extensions) ||
				hasIgnorePath(toRelativePath(id, root), IGNORED_PATHS)
			) {
				return null;
			}

			const RANGES = findAttributeRanges(code, OPTIONS.attributes);

			if (RANGES.length === 0) {
				return null;
			}

			// A removal shifts every later column (and every later line when the attribute sat on its own line), so the
			// map keeps the consumer's sourcemaps pointing at the original positions
			return { code: removeRanges(code, RANGES), map: generateRemovalSourceMap(code, RANGES, stripQuery(id)) };
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
