import type { Options, ResolvedOptions } from './types';

import { relative, sep } from 'node:path';

const DEFAULT_IGNORE_PATHS = [
	// Node modules
	'node_modules',

	// Git
	'.git',

	// IDE configurations
	'.idea', // JetBrains IDEs (e.g., WebStorm)
	'.vscode', // Visual Studio Code

	// OS generated files
	'.DS_Store', // macOS
	'Thumbs.db', // Windows

	// Environment variables
	'.env',
	'.env.*', // .env.development, .env.production, etc.

	// Logs
	'logs',
	'*.log',

	// Svelte
	'public', // Svelte.js public folder
	'build', // Svelte.js build folder

	// SvelteKit
	'.svelte-kit', // SvelteKit generates this folder

	// Dist
	'dist', // Distribution folder

	// Vue.js
	'.nuxt', // Nuxt.js generates this folder

	// React.js
	'.next', // Next.js generates this folder

	// Remix.js
	'.remix', // Remix.js cache

	// Angular
	'e2e', // End-to-end tests in Angular
	'angular.json', // Angular CLI configuration
	'browserslist', // Browser compatibility list for Angular

	'.cache', // Cache files for various tools
] as const;

const REGEX_SPECIAL_CHARACTERS_REGEX = /[.*+?^${}()|[\]\\]/g;
const LEADING_RELATIVE_PREFIX_REGEX = /^(?:\.\/|\/)+/;
const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_PARENT_SEGMENTS_REGEX = /^(?:\.\.\/)+/;
const LEADING_DOTS_REGEX = /^\.+/;

const TOKEN_REGEX_CACHE = new Map<string, RegExp>();
const EXTENSION_REGEX_CACHE = new Map<string, RegExp>();

function escapeRegExp(value: string): string {
	return value.replace(REGEX_SPECIAL_CHARACTERS_REGEX, '\\$&');
}

function getOptions(options: Options): ResolvedOptions {
	return {
		extensions: Array.isArray(options.extensions) ? options.extensions : [],
		attributes: Array.isArray(options.attributes) ? options.attributes : [],
		ignoreFolders: Array.isArray(options.ignoreFolders) ? options.ignoreFolders : [],
		ignoreFiles: Array.isArray(options.ignoreFiles) ? options.ignoreFiles : [],
		ignoreDefaults: options.ignoreDefaults !== false,
	};
}

/**
 * Normalizes a user-supplied ignore token by trimming whitespace,
 * removing leading './' or '/', and stripping trailing '/' characters.
 *
 * @param path - The ignore token to normalize.
 *
 * @returns The normalized ignore token.
 */
function cleanIgnoredPath(path: string): string {
	return path.trim().replace(LEADING_RELATIVE_PREFIX_REGEX, '').replace(TRAILING_SLASHES_REGEX, '');
}

/**
 * Normalizes and de-duplicates ignore tokens by:
 * - Trimming whitespace from each path
 * - Removing leading './' or '/', and trailing '/' characters
 * - Dropping empty and root-only entries (such as `''`, `.`, `/`, and `./`)
 * - Removing duplicate entries in the result
 *
 * @param paths - An array of ignore path tokens to be cleaned and de-duplicated.
 *
 * @returns A new array containing unique, cleaned ignore tokens, with all empty or root-only entries omitted.
 */
function cleanIgnoredPaths(paths: string[]): string[] {
	const CLEANED = paths
		.filter((path): path is string => typeof path === 'string')
		.map(cleanIgnoredPath)
		.filter((path) => path !== '' && path !== '.');

	return [...new Set(CLEANED)];
}

/**
 * Returns the combined and cleaned list of ignored paths based on the provided {@link ResolvedOptions}.
 *
 * @remarks
 * - Merges `ignoreFolders` and `ignoreFiles` into a single list.
 * - Cleans each entry using {@link cleanIgnoredPaths}.
 * - If `ignoreDefaults` is not explicitly set to `false`, the list also includes {@link DEFAULT_IGNORE_PATHS}.
 * - The resulting list is de-duplicated.
 *
 * @param options - The resolved options containing `ignoreFolders`, `ignoreFiles` and the `ignoreDefaults` flag.
 *
 * @returns An array of unique, cleaned ignore path tokens, including the built-in defaults unless
 *   {@link ResolvedOptions.ignoreDefaults} is `false`.
 */
function getIgnoredPaths(options: ResolvedOptions): string[] {
	const CONFIGURED = cleanIgnoredPaths([...options.ignoreFolders, ...options.ignoreFiles]);

	return options.ignoreDefaults ? [...new Set([...CONFIGURED, ...DEFAULT_IGNORE_PATHS])] : CONFIGURED;
}

/**
 * Removes the `?query` suffix that Vite appends to module IDs.
 *
 * For example, given `/src/App.svelte?svelte&type=style&lang.css`, this function will return `/src/App.svelte`.
 *
 * @param id - The module ID which may include a `?query` suffix.
 *
 * @returns The module ID without any `?query` part.
 */
function stripQuery(id: string): string {
	const QUERY_INDEX = id.indexOf('?');

	return QUERY_INDEX === -1 ? id : id.slice(0, QUERY_INDEX);
}

/**
 * Returns the path of a module ID relative to the Vite root directory, using POSIX separators.
 *
 * @param id - The module ID to be converted to a relative path.
 * @param root - The root directory to which the path will be made relative.
 *
 * @returns The relative path from the root to the module ID, using '/' as the separator.
 */
function toRelativePath(id: string, root: string): string {
	return relative(root, stripQuery(id)).split(sep).join('/');
}

/**
 * Returns a cached or newly-created regular expression to match a path segment token,
 * supporting `*` wildcards matching within a segment (but not across path separators).
 *
 * The regular expression is built so that `*` matches any sequence of characters except '/'.
 * The regex is cached for subsequent calls with the same token.
 *
 * @param token - The ignore token, possibly containing `*` wildcards.
 *
 * @returns The regular expression corresponding to the token, matching segment boundaries.
 */
function getTokenRegex(token: string): RegExp {
	const CACHED = TOKEN_REGEX_CACHE.get(token);

	if (CACHED) {
		return CACHED;
	}

	// `*` matches within a single segment; everything else is literal
	const PATTERN = token.split('*').map(escapeRegExp).join('[^/]*');
	// eslint-disable-next-line security/detect-non-literal-regexp -- the token is regex-escaped above
	const REGEX = new RegExp(`(?:^|/)${PATTERN}(?:/|$)`);

	TOKEN_REGEX_CACHE.set(token, REGEX);

	return REGEX;
}

/**
 * Checks if the given relative path matches any of the provided ignore tokens,
 * comparing on path-segment boundaries. Ignores leading parent directory segments.
 *
 * @remarks
 * This function ignores absolute IDs to avoid false positives from folder names that coincidentally
 * contain ignore tokens. For example, in environments like Cloudflare where a repo may be cloned
 * to a directory such as `/opt/buildhome/repo`, a token like `build` should not match simply
 * because it's part of the parent path. Only the path relative to the Vite root is considered.
 *
 * Leading `../` segments are stripped from the path so that modules resolved outside the root
 * (e.g. `../../.pnpm/x/node_modules/y/index.js`) still have the opportunity to match ignore tokens
 * like `node_modules` against their segments.
 *
 * @param relativePath - The path of the module relative to the Vite root.
 * @param tokens - The list of ignore tokens, possibly including `*` wildcards.
 *
 * @returns `true` if the relative path matches any ignore token; otherwise, `false`.
 */
function hasIgnorePath(relativePath: string, tokens: readonly string[]): boolean {
	const PATH = relativePath.replace(LEADING_PARENT_SEGMENTS_REGEX, '');

	return tokens.some((token) => getTokenRegex(token).test(PATH));
}

/**
 * Returns a regular expression that matches any of the provided file extensions at the end of a string.
 *
 * The extensions are matched case-insensitively and can be provided with or without leading dots.
 * The resulting regex is cached for subsequent calls with the same set of extensions.
 *
 * @param extensions - An array of file extension strings (with or without leading dots).
 *
 * @returns A RegExp instance matching any of the specified extensions as a file suffix.
 */
function getExtensionRegex(extensions: string[]): RegExp {
	const KEY = extensions.join('|');
	const CACHED = EXTENSION_REGEX_CACHE.get(KEY);

	if (CACHED) {
		return CACHED;
	}

	const PATTERN = extensions.map((extension) => escapeRegExp(extension.replace(LEADING_DOTS_REGEX, ''))).join('|');
	// eslint-disable-next-line security/detect-non-literal-regexp -- the extensions are regex-escaped above
	const REGEX = new RegExp(`\\.(?:${PATTERN})$`, 'i');

	EXTENSION_REGEX_CACHE.set(KEY, REGEX);

	return REGEX;
}

/**
 * Determines whether the provided module id (with query suffix stripped) ends with one of the specified extensions.
 *
 * @param id - The module identifier, possibly including a query suffix (e.g., `file.js?raw`).
 * @param extensions - An array of file extension strings (with or without leading dots).
 *
 * @returns `true` if the module id (excluding the query suffix) ends with one of the provided extensions;
 *   otherwise, `false`.
 */
function hasExtension(id: string, extensions: string[]): boolean {
	if (extensions.length === 0) {
		return false;
	}

	return getExtensionRegex(extensions).test(stripQuery(id));
}

interface ExpressionFrame {
	kind: 'expression';
	depth: number;
}

interface TemplateFrame {
	kind: 'template';
}

type Frame = ExpressionFrame | TemplateFrame;

type ScanStep = 'closed' | 'continue' | 'skip-next';

/**
 * Character-by-character scanner for an `={…}` expression: tracks nested braces, quoted strings, template literals
 * and their `${…}` placeholders, and reports when the opening brace is closed
 */
class ExpressionScanner {
	readonly #frames: Frame[] = [{ kind: 'expression', depth: 1 }];
	#stringQuote = '';
	#isEscaped = false;

	step(character: string, next: string): ScanStep {
		if (this.#isEscaped) {
			this.#isEscaped = false;

			return 'continue';
		}

		if (character === '\\') {
			this.#isEscaped = true;

			return 'continue';
		}

		if (this.#stringQuote !== '') {
			if (character === this.#stringQuote) {
				this.#stringQuote = '';
			}

			return 'continue';
		}

		const FRAME = this.#frames.at(-1);

		if (!FRAME) {
			return 'continue';
		}

		return FRAME.kind === 'template' ? this.#stepTemplate(character, next) : this.#stepExpression(FRAME, character);
	}

	#stepTemplate(character: string, next: string): ScanStep {
		if (character === '`') {
			this.#frames.pop();
		} else if (character === '$' && next === '{') {
			this.#frames.push({ kind: 'expression', depth: 1 });

			return 'skip-next';
		}

		return 'continue';
	}

	#stepExpression(frame: ExpressionFrame, character: string): ScanStep {
		if (character === "'" || character === '"') {
			this.#stringQuote = character;
		} else if (character === '`') {
			this.#frames.push({ kind: 'template' });
		} else if (character === '{') {
			frame.depth++;
		} else if (character === '}') {
			return this.#closeBrace(frame);
		}

		return 'continue';
	}

	#closeBrace(frame: ExpressionFrame): ScanStep {
		frame.depth--;

		if (frame.depth > 0) {
			return 'continue';
		}

		if (this.#frames.length === 1) {
			return 'closed';
		}

		this.#frames.pop();

		return 'continue';
	}
}

/**
 * Finds the closing brace for an `={…}` attribute value in a string of markup. Returns the index of the closing
 * brace, or `-1` if the braces are unbalanced or not found.
 *
 * @remarks
 * A regular expression cannot do this: the expression may hold a template literal whose `${…}` placeholders nest
 * further braces, and a brace inside a string is text rather than structure. The scanner tracks both.
 *
 * @param input - The input string containing the markup or code.
 * @param openingBraceIndex - The index of the opening `{` character to start scanning from.
 *
 * @returns The index of the corresponding closing `}` brace, or `-1` if unmatched.
 *
 * @example
 * ```ts
 * findExpressionEnd('foo={a + {b: `1${two}`}}', 4); // returns the index of the matching }
 * ```
 */
function findExpressionEnd(input: string, openingBraceIndex: number): number {
	const SCANNER = new ExpressionScanner();

	for (let index = openingBraceIndex + 1; index < input.length; index++) {
		const STEP = SCANNER.step(input.charAt(index), input.charAt(index + 1));

		if (STEP === 'closed') {
			return index;
		}

		if (STEP === 'skip-next') {
			index++;
		}
	}

	return -1;
}

/**
 * Half-open `[start, end)` range of characters in the original input
 */
type Range = readonly [start: number, end: number];

/**
 * Finds all ranges (start and end indices) for a specific attribute in the given markup input.
 *
 * Handles quoted values, expression values (i.e., `={...}`), and bare attributes, including optional
 * `:` or `v-bind:` prefixes. The detection accounts for whitespace before the attribute, as well as attributes
 * written on their own line. If an attribute value is an expression (`={...}`), this function uses
 * {@link findExpressionEnd} to locate the closing brace, and gracefully skips unbalanced or invalid expressions.
 *
 * @remarks
 * The returned ranges are suitable for text replacements: all whitespace before the attribute is included
 * so that removing the attribute does not leave a dangling blank line or extra spaces.
 *
 * @param input - The input markup string to search for the attribute within.
 * @param attribute - The name of the attribute to locate (e.g., `"data-testid"`).
 *
 * @returns An array of `[start, end)` ranges (as type `Range`) for each found occurrence of the attribute.
 */
function findAttributeRangesFor(input: string, attribute: string): Range[] {
	const NAME = escapeRegExp(attribute);
	// The leading `\s+` swallows all whitespace before the attribute, so an attribute on its own line leaves no
	// blank line behind. Three forms follow: quoted value (group 1 = quote), expression value (group 2 = opening
	// brace, measured by `findExpressionEnd`), or bare attribute followed by whitespace, `/` or `>`
	// eslint-disable-next-line security/detect-non-literal-regexp -- the attribute name is regex-escaped above
	const PATTERN = new RegExp(
		`\\s+(?::|v-bind:)?${NAME}(?:\\s*=\\s*(?:(['"\`])(?:(?!\\1)[\\s\\S])*\\1|(\\{))|(?=[\\s/>]))`,
		'gi',
	);
	const RANGES: Range[] = [];

	let match = PATTERN.exec(input);

	while (match != null) {
		const MATCH_END = match.index + match[0].length;

		let attributeEnd = MATCH_END;

		if (match[2] != null) {
			const CLOSING_BRACE_INDEX = findExpressionEnd(input, MATCH_END - 1);

			// An unbalanced expression means the source does not parse as written: leave it alone rather than
			// cutting the file at an arbitrary point
			if (CLOSING_BRACE_INDEX === -1) {
				match = PATTERN.exec(input);
				continue;
			}

			attributeEnd = CLOSING_BRACE_INDEX + 1;
		}

		RANGES.push([match.index, attributeEnd]);
		PATTERN.lastIndex = attributeEnd;
		match = PATTERN.exec(input);
	}

	return RANGES;
}

/**
 * Returns the merged ranges of every occurrence of the given attributes (in quoted, `={expression}`,
 * or bare form, with optional `:` or `v-bind:` prefix) within the markup string. The resulting
 * ranges are sorted by start index, and any touching or overlapping ranges are merged.
 *
 * All attributes are located in the same original input, so the returned ranges can be used
 * for sourcemap-aware or batch editing operations.
 *
 * @param input - The markup string to search for the attributes.
 * @param attributes - An array of attribute names to search for (e.g., `['data-testid', 'data-id']`).
 *
 * @returns An array of `Range` tuples, each representing [start, end) of a matched attribute occurrence,
 *          with adjacent and overlapping ranges merged.
 */
function findAttributeRanges(input: string, attributes: string[]): Range[] {
	const RANGES = attributes
		.flatMap((attribute) => findAttributeRangesFor(input, attribute))
		.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
	const MERGED: [number, number][] = [];

	for (const [start, end] of RANGES) {
		const LAST = MERGED.at(-1);

		if (LAST && start <= LAST[1]) {
			LAST[1] = Math.max(LAST[1], end);
		} else {
			MERGED.push([start, end]);
		}
	}

	return MERGED;
}

/**
 * Returns a copy of the input string with the specified ranges removed.
 *
 * The provided ranges must be sorted by start index and non-overlapping.
 * Each range is specified as a tuple [start, end), with `start` inclusive and `end` exclusive.
 * The function concatenates the segments of the input string outside of these ranges.
 *
 * @param input - The original string from which to remove segments.
 * @param ranges - An array of `[start, end)` index ranges (sorted, non-overlapping) to cut out from the input.
 *
 * @returns The resulting string after all specified ranges have been removed from the input.
 */
function removeRanges(input: string, ranges: Range[]): string {
	if (ranges.length === 0) {
		return input;
	}

	const SEGMENTS: string[] = [];

	let lastEnd = 0;

	for (const [start, end] of ranges) {
		SEGMENTS.push(input.slice(lastEnd, start));
		lastEnd = end;
	}

	SEGMENTS.push(input.slice(lastEnd));

	return SEGMENTS.join('');
}

/**
 * Removes all occurrences of the specified attributes from the provided markup string.
 *
 * This function finds every instance of the given attribute names within the input markup (using
 * {@link findAttributeRanges}), then removes them, returning the markup with those attributes omitted.
 *
 * @param input - The original markup string from which attributes should be removed.
 * @param attributes - An array of attribute names to remove from the markup.
 *
 * @returns A new string representing the markup with the specified attributes removed.
 *
 * @see findAttributeRanges
 */
function removeAttributes(input: string, attributes: string[]): string {
	return removeRanges(input, findAttributeRanges(input, attributes));
}

export type { Range };

export {
	cleanIgnoredPath,
	cleanIgnoredPaths,
	DEFAULT_IGNORE_PATHS,
	escapeRegExp,
	findAttributeRanges,
	findExpressionEnd,
	getIgnoredPaths,
	getOptions,
	hasExtension,
	hasIgnorePath,
	removeAttributes,
	removeRanges,
	stripQuery,
	toRelativePath,
};
