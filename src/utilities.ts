import type { Options, ResolvedOptions } from './types';

import { relative, sep } from 'node:path';

/**
 * Built-in ignore tokens matched on every path segment, at any depth
 *
 * @remarks
 * Dependencies are nested by design (workspace packages, the pnpm store), so anchoring these two to the Vite
 * root would let a dependency's markup through.
 */
const ANY_DEPTH_DEFAULT_IGNORE_PATHS = [
	// Node modules
	'node_modules',

	// Git
	'.git',
] as const;

/**
 * Built-in ignore tokens matched only as the first segment under the Vite root
 *
 * @remarks
 * Every token here names a generated or tooling entry that lives at the root of a project. Matching them on
 * any segment silently skipped ordinary source files — `src/routes/public/+page.svelte`,
 * `src/lib/build/Step.svelte`, `src/e2e/Foo.tsx` — and shipped the attributes the plugin was asked to remove.
 */
const ROOT_ANCHORED_DEFAULT_IGNORE_PATHS = [
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

	// Nitro (Nuxt, SolidStart, TanStack Start)
	'.output', // Nitro production output
	'.nitro', // Nitro development folder
	'.data', // Nitro local data (e.g., the Nuxt development database)

	// React.js
	'.next', // Next.js generates this folder
	'out', // Next.js static export folder

	// Remix / React Router
	'.react-router', // React Router v7 generates its types here

	// Astro
	'.astro', // Astro generates its types and its content cache here

	// SolidStart
	'.solid', // SolidStart build folder
	'.vinxi', // Vinxi cache, used by SolidStart 1.x

	// TanStack Start
	'.tanstack', // TanStack Start generates this folder

	// Angular
	'.angular', // Angular CLI cache
	'e2e', // End-to-end tests in Angular
	'angular.json', // Angular CLI configuration
	'browserslist', // Browser compatibility list for Angular

	// Deploy adapters
	'.vercel', // Vercel build output
	'.netlify', // Netlify build output
	'.wrangler', // Cloudflare Workers and Pages local state

	'.cache', // Cache files for various tools
] as const;

/**
 * Every built-in ignore token, any-depth ones first
 */
const DEFAULT_IGNORE_PATHS = [...ANY_DEPTH_DEFAULT_IGNORE_PATHS, ...ROOT_ANCHORED_DEFAULT_IGNORE_PATHS] as const;

/**
 * JavaScript source extensions
 */
const JAVASCRIPT_EXTENSIONS: readonly string[] = Object.freeze(['js', 'mjs', 'cjs'] as const);

/**
 * TypeScript source extensions
 */
const TYPESCRIPT_EXTENSIONS: readonly string[] = Object.freeze(['ts', 'mts', 'cts'] as const);

/**
 * JSX and TSX source extensions, used by React, Preact, Solid, Qwik and Vue JSX
 */
const JSX_EXTENSIONS: readonly string[] = Object.freeze(['jsx', 'tsx'] as const);

/**
 * Every extension whose file is plain script: JavaScript, TypeScript and JSX
 */
const SCRIPT_EXTENSIONS: readonly string[] = Object.freeze([
	...JAVASCRIPT_EXTENSIONS,
	...TYPESCRIPT_EXTENSIONS,
	...JSX_EXTENSIONS,
] as const);

/**
 * Svelte single-file component extension (`.svelte.js` and `.svelte.ts` rune modules fall under the script presets)
 */
const SVELTE_EXTENSIONS: readonly string[] = Object.freeze(['svelte'] as const);

/**
 * Vue single-file component extension
 */
const VUE_EXTENSIONS: readonly string[] = Object.freeze(['vue'] as const);

/**
 * Astro component extension
 */
const ASTRO_EXTENSIONS: readonly string[] = Object.freeze(['astro'] as const);

/**
 * Entry HTML document extensions
 */
const HTML_EXTENSIONS: readonly string[] = Object.freeze(['html', 'htm'] as const);

/**
 * Every extension processed when `Options.extensions` is not provided: markup and JSX files
 */
const DEFAULT_EXTENSIONS: readonly string[] = Object.freeze([
	...JSX_EXTENSIONS,
	...SVELTE_EXTENSIONS,
	...VUE_EXTENSIONS,
	...ASTRO_EXTENSIONS,
	...HTML_EXTENSIONS,
] as const);

const REGEX_SPECIAL_CHARACTERS_REGEX = /[.*+?^${}()|[\]\\]/g;
const LEADING_RELATIVE_PREFIX_REGEX = /^(?:\/|\.\/|\.\.\/)+/;
const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_PARENT_SEGMENTS_REGEX = /^(?:\.\.\/)+/;
const LEADING_DOTS_REGEX = /^\.+/;
const WHITESPACE_REGEX = /\s/;
const IDENTIFIER_CHARACTER_REGEX = /[\w$]/;
// The first character of an element name, which is what tells `<div` from the `a < b` comparison
const IDENTIFIER_START_REGEX = /[A-Za-z_$]/;
// The rest of an element name, covering member (`Foo.Bar`), namespaced (`svg:rect`) and custom (`my-el`) ones
const ELEMENT_NAME_CHARACTER_REGEX = /[\w$.:-]/;
const ASSIGNMENT_REGEX = /\s*=\s*/y;
// One run of an unquoted attribute value, which ends at the next whitespace or tag delimiter; a `/` belongs to
// the run unless it opens `/>`, and a `$` unless it opens a `${…}` placeholder. A `{` ends the run too: the
// expression it opens, like a placeholder, is read as a run of its own
const UNQUOTED_VALUE_REGEX = /(?:[^\s"'`=<>{}/$]|\$(?!\{)|\/(?!>))+/y;
const BARE_ATTRIBUTE_END_REGEX = /[\s/>]/;
// The virtual extension a framework or Vite gives the stylesheet it extracts from a module, which ends the query of
// the sub-request (`?vue&type=style&index=0&lang.scss`, `?html-proxy&direct&index=0.css`)
const STYLE_LANGUAGE_SUFFIX_REGEX = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/i;
// The Vue modifier tail of a bound name (`:data-testid.attr.prop`), read only when a binding prefix was found.
// One `.` opens the whole run, so the pattern stays free of the nested quantifier a modifier-by-modifier form
// would need — every input has a single parse and the scan cannot backtrack
const BINDING_MODIFIERS_REGEX = /\.[\w.-]*/y;
const ASCII_LETTER_REGEX = /[A-Za-z]/;
// A closing tag as JSX writes one, which a tag frame pairs with its opening tag by name
const CLOSING_TAG_REGEX = /<\/([A-Za-z_$][\w$.:-]*)(?=[\s>])/g;
const MARKUP_TAG_NAME_REST_REGEX = /[^\s/>]*/y;
const ATTRIBUTE_NAME_REST_REGEX = /[^\s/>=]*/y;
// A value read the plain way once it could not be measured: everything up to the next whitespace or `>`
const UNQUOTED_RUN_REGEX = /[^\s>]*/y;
// eslint-disable-next-line security/detect-unsafe-regex -- linear: the letters, the whitespace run and `if` are disjoint classes, so each character has one possible owner
const SVELTE_BLOCK_NAME_REGEX = /[A-Za-z]*(?:\s+if(?![\w$]))?/y;
// The leading `---` fence of a front matter block, optionally preceded by a byte order mark, and the line break and
// `---` closing it, searched from the line break ending the opening fence
const FRONT_MATTER_OPENER_REGEX = /^\uFEFF?---[^\S\n]*\r?\n/;
const FRONT_MATTER_CLOSER_REGEX = /\n---/g;
// The opening fence of a Markdown fenced code block, read at the start of a line: up to three spaces of indentation,
// a run of at least three backticks or tildes, and the info string that follows it
const CODE_FENCE_OPENER_REGEX = /[ ]{0,3}(`{3,}|~{3,})([^\n]*)/y;
// The closing fence of a Markdown fenced code block, read at the start of a line: nothing but blanks may follow it
const CODE_FENCE_CLOSER_REGEX = /[ ]{0,3}(`{3,}|~{3,})[ \t]*(?=\r?\n|$)/y;
const HTML_PROXY_REGEX = /[?&]html-proxy\b/;
const HTML_PROXY_SCRIPT_SUFFIX = '.js';
const MARKUP_COMMENT_OPEN = '<!--';
const MARKUP_COMMENT_CLOSE = '-->';
const SCRIPT_TAG_NAME = 'script';
const STYLE_TAG_NAME = 'style';
const SCRIPT_CLOSER = '</script';
const STYLE_CLOSER = '</style';
const SVELTE_BLOCK_SIGILS = '#:@';
const SCRIPT_TYPE_PARAMETER = 'type=script';
const NOT_FOUND = -1;

/**
 * The value a tag mask holds for a character sitting in the attribute list of an opening tag
 */
const TAG_POSITION = 1;

/**
 * The value a tag mask holds for the `$` of a `${…}` placeholder written in the attribute list of an opening tag of
 * template-literal markup (`` `<p${attributes}>` ``)
 */
const TAG_PLACEHOLDER_POSITION = 2;

/**
 * The value a tag mask holds for the `$` of a `${…}` placeholder written in the text of template-literal markup
 */
const TEXT_PLACEHOLDER_POSITION = 3;

/**
 * Elements whose content template-literal markup reads as raw text, where no `<` opens a tag
 */
const RAW_TEXT_ELEMENT_NAMES = new Set([SCRIPT_TAG_NAME, STYLE_TAG_NAME]);

/**
 * Length of the longest name in {@link RAW_TEXT_ELEMENT_NAMES}, past which an element name is no longer tracked
 */
const LONGEST_RAW_TEXT_ELEMENT_NAME_LENGTH = 6;

/**
 * The runtime helper Astro's compiler renders a dynamic attribute with: `${$$addAttribute(value, "name")}`
 */
const ASTRO_ADD_ATTRIBUTE_PLACEHOLDER = '${$$addAttribute(';

/**
 * The runtime helper Astro's compiler renders a component or a custom element with:
 * `${$$renderComponent($$result, "Name", Name, { "prop": value }, slots)}`
 */
const ASTRO_RENDER_COMPONENT_PLACEHOLDER = '${$$renderComponent(';
const ASTRO_HELPER_PLACEHOLDER_OPEN = '${$$';
const ASTRO_ADD_ATTRIBUTE_ARGUMENT_COUNT = 2;
const ASTRO_RENDER_COMPONENT_PROPS_ARGUMENT_COUNT = 4;

/**
 * A string literal holding no escape sequence, the only attribute name or property key the compiled-Astro reading
 * accepts
 */
const PLAIN_STRING_LITERAL_REGEX = /^\s*"([^"\\\n]*)"\s*$/;
const PLAIN_PROPERTY_KEY_REGEX = /^"([^"\\\n]*)"\s*:/;
const LIST_OPENERS = '([{';
const LIST_CLOSERS = ')]}';

/**
 * Query parameters a framework plugin marks the `<script>` block it split out of a component with
 */
const FRAMEWORK_SCRIPT_MARKERS = new Set(['astro', 'vue']);

/**
 * `type` attribute values that make a `<script>` tag hold JavaScript
 */
const JAVASCRIPT_SCRIPT_TYPES = new Set([
	'application/ecmascript',
	'application/javascript',
	'application/x-ecmascript',
	'application/x-javascript',
	'module',
	'text/babel',
	'text/ecmascript',
	'text/javascript',
	'text/jscript',
	'text/jsx',
	'text/livescript',
	'text/x-ecmascript',
	'text/x-javascript',
]);

/**
 * `type` values and `lang` values that let the JavaScript of a `<script>` block hold JSX
 */
const JSX_SCRIPT_TYPES = new Set(['text/babel', 'text/jsx']);
const JSX_SCRIPT_LANGUAGES = new Set(['jsx', 'tsx']);

const JSX_SCRIPT_EXTENSION_SET = new Set<string>([...JAVASCRIPT_EXTENSIONS, ...JSX_EXTENSIONS]);
const TYPESCRIPT_EXTENSION_SET = new Set<string>(TYPESCRIPT_EXTENSIONS);
const HTML_EXTENSION_SET = new Set<string>(HTML_EXTENSIONS);
const ASTRO_EXTENSION_SET = new Set<string>(ASTRO_EXTENSIONS);
const VUE_EXTENSION_SET = new Set<string>(VUE_EXTENSIONS);

/**
 * Markdown-based template extensions (Markdown, MDX, mdsvex), whose fenced code blocks are text
 */
const MARKDOWN_EXTENSION_SET = new Set<string>(['md', 'mdx', 'svx']);

/**
 * Binding prefixes an attribute name may carry, longest first so `v-bind:` wins over `:`
 */
const BINDING_PREFIXES = ['v-bind:', ':'] as const;

/**
 * Characters that may sit directly in front of an attribute name, with no whitespace between them.
 *
 * @remarks
 * Each of them closes the value of the attribute before (`class="x"data-testid="y"`, `b={1}data-testid="y"`),
 * which minifiers emit and which is therefore a real attribute boundary — where a letter or a `-` in that
 * position only means the name is part of a longer one (`xdata-testid`, `foo-data-testid`).
 */
const ATTRIBUTE_BOUNDARY_CHARACTERS = new Set(['"', "'", '}']);

/**
 * How many times the length of the input may be spent on scans whose result is thrown away, before the rest of
 * that input is matched without scanning expressions at all.
 *
 * @remarks
 * Every unbalanced `={` scans to the end of the file, so a file holding thousands of them costs quadratic
 * time — and so does a value whose expressions balance but which is rejected afterward: an unquoted value
 * running into a character that cannot end it or into an expression that never closes, or a quoted one whose
 * quote never closes. A scan in a quoted value that loses track of the markup stops there and is charged what
 * it read. A well-formed file never spends any of this budget: a scan that finds its closing brace, inside a
 * value that is then removed, is free.
 */
const FAILED_EXPRESSION_SCAN_BUDGET_FACTOR = 4;

/**
 * Keywords after which a `/` opens a regular expression literal rather than a division operator — and a `<` an
 * element rather than a comparison. A keyword written as a property name (`module.default / 2`) is none of them.
 */
const REGULAR_EXPRESSION_KEYWORDS = new Set([
	'await',
	'case',
	'default',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield',
]);

/**
 * Length of `instanceof`, the longest entry of {@link REGULAR_EXPRESSION_KEYWORDS}
 *
 * @remarks
 * An identifier run is tracked one character past this length and then left alone: a run that long can no
 * longer equal a keyword, so the truncated prefix answers the question just as well and the tracked string
 * stays bounded however long the identifier in the source is.
 */
const LONGEST_REGULAR_EXPRESSION_KEYWORD_LENGTH = 10;

/**
 * Words that may follow a string literal on its own line: the binary operators spelled as keywords, and the
 * TypeScript assertions
 */
const OPERATOR_KEYWORDS = new Set(['as', 'in', 'instanceof', 'satisfies']);

/**
 * Length of `instanceof`, the longest entry of {@link OPERATOR_KEYWORDS}
 */
const LONGEST_OPERATOR_KEYWORD_LENGTH = 10;

/**
 * How many characters of an element name are tracked to pair a closing tag with its opening one
 *
 * @remarks
 * Two names agreeing over this many characters are read as the same element. That bounds the memory one scan
 * holds however long the names in the source are, and the collision it allows needs two differently named
 * elements sharing a 64-character prefix, nested one in the other, inside a single attribute value.
 */
const MAXIMUM_ELEMENT_NAME_LENGTH = 64;

/**
 * Punctuation after which an operand begins, so that a `<` right after it opens a nested element rather than
 * comparing two values.
 *
 * @remarks
 * `)` and `]` are absent because they close a value: `(a + b) < c` compares. `<` is absent as well, since no
 * element may follow one — it would only turn the `a << b` shift into a tag.
 */
const ELEMENT_START_CHARACTERS = new Set([
	'(',
	',',
	'=',
	':',
	'?',
	'!',
	'&',
	'|',
	'{',
	';',
	'[',
	'+',
	'-',
	'*',
	'%',
	'>',
	'~',
	'^',
]);

/**
 * Punctuation after which a `/` opens a regular expression literal rather than a division operator.
 *
 * @remarks
 * The operand positions of {@link ELEMENT_START_CHARACTERS} plus `<`: a `<` that was read as a comparison is
 * followed by an operand too, which is what makes `a < /re/.test(b)` a literal — and `a</re/.test(b)` just as
 * much. A `</` reaches this decision whenever no element could start there: inside a `text` frame it always
 * opens a closing tag, and inside an expression it opens one only at an operand position, where a closing tag
 * with no element open desynchronizes the scan instead.
 */
const REGULAR_EXPRESSION_START_CHARACTERS = new Set([...ELEMENT_START_CHARACTERS, '<']);

/**
 * Characters that cannot appear in the attribute list of an opening tag, before its first `=`.
 *
 * @remarks
 * Meeting one of them there means the `<` the frame was entered on opened a TypeScript generic parameter list
 * (`<T,>(x: T) => x`) rather than an element: up to its first assignment an attribute list holds nothing but
 * names and the `/` of a self-closing tag. The frame is popped, the `<` becomes the comparison-shaped operator
 * it is, and the character is read again as ordinary expression input.
 *
 * Past that first `=` the list is a tag beyond doubt, and its unquoted values carry these characters freely
 * (`<a href=x&y>`, `<i style=width:100%>`) — as does a closing tag, which no parameter list can follow.
 *
 * `-`, `.`, `:`, `#`, `@` and `=` are absent because attribute names carry them (`data-testid`, `.prop`,
 * `v-bind:x`, `#slot`, `@click`). The Lit prefixes `?disabled` and `` html`…` `` are no exception: a tagged
 * template is read as a `template` frame, which holds no tag of its own.
 */
const NON_TAG_CHARACTERS = new Set([',', '(', ')', ';', '|', '&', '+', '*', '?', '[', ']', '~', '^', '%', '`']);

/**
 * The keyword constraining a generic parameter, which a tag frame reads as the first word after its name
 */
const GENERIC_CONSTRAINT_KEYWORD = 'extends';

/**
 * The property of an Angular component decorator whose value is its inline template, which a quoted string holds as
 * often as a template literal does
 */
const TEMPLATE_PROPERTY_KEY = 'template';

/**
 * Punctuation after which an identifier is a property key of an object literal (`{ template: …}`, `…, template: …`)
 * rather than the operand of a ternary (`a ? template : …`) or of a `case` clause
 */
const PROPERTY_KEY_START_CHARACTERS = new Set(['{', ',']);

const CHARACTER_CLASS_WHITESPACE = 1;
const CHARACTER_CLASS_IDENTIFIER = 2;
const CHARACTER_CLASS_IDENTIFIER_START = 4;
const CHARACTER_CLASS_ELEMENT_NAME = 8;
const ASCII_LIMIT = 128;

/**
 * The regular expression defining each character class, paired with the bit the class sets in
 * {@link ASCII_CHARACTER_CLASSES}
 */
const CHARACTER_CLASS_DEFINITIONS = [
	[WHITESPACE_REGEX, CHARACTER_CLASS_WHITESPACE],
	[IDENTIFIER_CHARACTER_REGEX, CHARACTER_CLASS_IDENTIFIER],
	[IDENTIFIER_START_REGEX, CHARACTER_CLASS_IDENTIFIER_START],
	[ELEMENT_NAME_CHARACTER_REGEX, CHARACTER_CLASS_ELEMENT_NAME],
] as const;

/**
 * The bit of every class each ASCII code unit belongs to, derived from {@link CHARACTER_CLASS_DEFINITIONS} so that it
 * answers exactly what those regular expressions answer
 */
const ASCII_CHARACTER_CLASSES = Uint8Array.from({ length: ASCII_LIMIT }, (_, code) =>
	CHARACTER_CLASS_DEFINITIONS.reduce(
		(classes, [regex, characterClass]) => (regex.test(String.fromCharCode(code)) ? classes | characterClass : classes),
		0,
	),
);

/**
 * Reports whether a single character belongs to a character class, reading the ASCII class table instead of testing a
 * regular expression.
 *
 * @remarks
 * Every class but whitespace is an ASCII-only character set, so a code unit past ASCII can only be whitespace
 * (U+00A0, U+2028, U+FEFF, …), which the defining regular expression answers for that rare case. A code unit of a
 * surrogate pair belongs to no class, which is what testing any of them on that single unit reports too.
 *
 * @param character - The character to classify, possibly the empty string past the end of the input.
 * @param characterClass - The `CHARACTER_CLASS_*` bit to test.
 *
 * @returns `true` when the character belongs to the class; `false` for the empty string.
 */
function hasCharacterClass(character: string, characterClass: number): boolean {
	const CODE = character.charCodeAt(0);
	// The empty string reads as `NaN`, which is no index of the table and which the regular expression rejects too
	const CLASSES = CODE < ASCII_LIMIT ? ASCII_CHARACTER_CLASSES[CODE] : undefined;

	if (CLASSES != null) {
		return (CLASSES & characterClass) !== 0;
	}

	return characterClass === CHARACTER_CLASS_WHITESPACE && WHITESPACE_REGEX.test(character);
}

function isWhitespace(character: string): boolean {
	return hasCharacterClass(character, CHARACTER_CLASS_WHITESPACE);
}

function isIdentifierCharacter(character: string): boolean {
	return hasCharacterClass(character, CHARACTER_CLASS_IDENTIFIER);
}

function isIdentifierStart(character: string): boolean {
	return hasCharacterClass(character, CHARACTER_CLASS_IDENTIFIER_START);
}

function isElementNameCharacter(character: string): boolean {
	return hasCharacterClass(character, CHARACTER_CLASS_ELEMENT_NAME);
}

function escapeRegExp(value: string): string {
	return value.replace(REGEX_SPECIAL_CHARACTERS_REGEX, '\\$&');
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * Keeps the usable entries of a consumer-supplied list of names: non-blank strings, trimmed and de-duplicated.
 *
 * @remarks
 * Plugin options are a trust boundary — a JavaScript consumer can pass anything. Unusable entries are dropped
 * rather than thrown on, which is how `extensions` has always behaved.
 *
 * @param values - The raw list as supplied by the consumer.
 *
 * @returns A new array of unique, trimmed, non-empty strings.
 */
function cleanNameTokens(values: readonly unknown[]): string[] {
	return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
}

/**
 * Resolves the consumer-supplied {@link Options} into the internal {@link ResolvedOptions}.
 *
 * @remarks
 * `extensions` and `attributes` are filtered through {@link cleanNameTokens}, so a blank or non-string entry
 * is dropped instead of producing a regex that matches everything. An `attributes` list that resolves to
 * empty makes the plugin a no-op. `removeInStrings` rewrites more of the output than the default, so only `true`
 * enables it — a truthy value of another type does not.
 *
 * @param options - The consumer-supplied options, or `undefined`.
 *
 * @returns The resolved options, with every missing value defaulted.
 */
function getOptions(options: Options | undefined): ResolvedOptions {
	const RAW: Partial<Options> = options ?? {};

	return {
		extensions: Array.isArray(RAW.extensions) ? cleanNameTokens(RAW.extensions) : [...DEFAULT_EXTENSIONS],
		attributes: Array.isArray(RAW.attributes) ? cleanNameTokens(RAW.attributes) : [],
		ignoreFolders: Array.isArray(RAW.ignoreFolders) ? RAW.ignoreFolders : [],
		ignoreFiles: Array.isArray(RAW.ignoreFiles) ? RAW.ignoreFiles : [],
		ignoreDefaults: RAW.ignoreDefaults !== false,
		removeInStrings: RAW.removeInStrings === true,
	};
}

/**
 * Normalizes a user-supplied ignore token by trimming whitespace, turning Windows separators into `/`, removing
 * leading './', '../' or '/', and stripping trailing '/' characters.
 *
 * @remarks
 * The matcher compares tokens against paths relative to the Vite root with their leading `../` segments stripped, so
 * a token keeping one of those segments, or a `\` separator, could never match anything.
 *
 * @param path - The ignore token to normalize.
 *
 * @returns The normalized ignore token.
 */
function cleanIgnoredPath(path: string): string {
	return path
		.trim()
		.replaceAll('\\', '/')
		.replace(LEADING_RELATIVE_PREFIX_REGEX, '')
		.replace(TRAILING_SLASHES_REGEX, '');
}

/**
 * Normalizes and de-duplicates ignore tokens by:
 * - Trimming whitespace from each path
 * - Turning Windows separators into `/`
 * - Removing leading './', '../' or '/', and trailing '/' characters
 * - Dropping empty and root-only entries (such as `''`, `.`, `..`, `/`, and `./`)
 * - Removing duplicate entries in the result
 *
 * @param paths - An array of ignore path tokens to be cleaned and de-duplicated.
 *
 * @returns A new array containing unique, cleaned ignore tokens, with all empty or root-only entries omitted.
 */
function cleanIgnoredPaths(paths: readonly unknown[]): string[] {
	const CLEANED = paths
		.filter((path): path is string => typeof path === 'string')
		.map(cleanIgnoredPath)
		.filter((path) => path !== '' && path !== '.' && path !== '..');

	return [...new Set(CLEANED)];
}

/**
 * Removes the `?query` and `#hash` suffixes that Vite keeps on module IDs.
 *
 * For example, given `/src/App.svelte?svelte&type=style&lang.css`, this function will return `/src/App.svelte`, and
 * given `/src/App.svelte#hash` or `/src/App.svelte?raw#hash`, it will return `/src/App.svelte`.
 *
 * @remarks
 * A `#` is only read as the start of a hash when no `/` follows it, so a `#` written in a folder name, as in
 * `/src/#internal/App.svelte`, stays part of the path.
 *
 * @param id - The module ID which may include a `?query` and/or `#hash` suffix.
 *
 * @returns The module ID without any `?query` or `#hash` part.
 */
function stripQuery(id: string): string {
	const QUERY_INDEX = id.indexOf('?');
	const PATH = QUERY_INDEX === -1 ? id : id.slice(0, QUERY_INDEX);
	const HASH_INDEX = PATH.lastIndexOf('#');
	const IS_HASH_SUFFIX = HASH_INDEX !== -1 && !PATH.includes('/', HASH_INDEX);

	return IS_HASH_SUFFIX ? PATH.slice(0, HASH_INDEX) : PATH;
}

/**
 * Reports whether a module ID is the stylesheet a framework or Vite extracted from a markup module.
 *
 * @remarks
 * `App.vue?vue&type=style&index=0&lang.css`, `App.svelte?svelte&type=style&lang.css` and
 * `index.html?html-proxy&inline-css&index=0.css` keep the extension of the module they come from, but hold CSS, where
 * no attribute can sit and where a configured name is text of a selector or a `content` string. The query is split
 * into parameters before being read, so that a parameter spelled `mytype=style` cannot pass for one of them.
 *
 * @param id - The module ID, possibly including a `?query` suffix.
 *
 * @returns `true` when the module holds a stylesheet.
 */
function isStyleRequest(id: string): boolean {
	const QUERY_INDEX = id.indexOf('?');

	if (QUERY_INDEX === -1) {
		return false;
	}

	const QUERY = id.slice(QUERY_INDEX + 1);

	return (
		STYLE_LANGUAGE_SUFFIX_REGEX.test(QUERY) ||
		QUERY.split('&').some((parameter) => parameter === 'type=style' || parameter === 'inline-css')
	);
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
 * Builds the regex body matching one ignore token, where `*` matches any run of characters inside a single
 * path segment and every other character is literal.
 *
 * @param token - The ignore token, possibly containing `*` wildcards.
 *
 * @returns The regex source for the token, without segment boundaries.
 */
function toSegmentPattern(token: string): string {
	return token.split('*').map(escapeRegExp).join('[^/]*');
}

/**
 * Tells whether a module, given by its path relative to the Vite root, must be skipped
 */
type IgnoreMatcher = (relativePath: string) => boolean;

/**
 * Compiles the ignore tokens of one plugin instance into a single matcher.
 *
 * @remarks
 * Configured `ignoreFolders` / `ignoreFiles` tokens match on any path segment. The built-in defaults are
 * split: {@link ANY_DEPTH_DEFAULT_IGNORE_PATHS} also match on any segment, while
 * {@link ROOT_ANCHORED_DEFAULT_IGNORE_PATHS} match only as the first segment under the root.
 *
 * Absolute IDs are never tested, which avoids false positives from folder names that coincidentally contain
 * an ignore token. For example, in environments like Cloudflare where a repo may be cloned to a directory
 * such as `/opt/buildhome/repo`, a token like `build` must not match just because it is part of the parent
 * path. Leading `../` segments are stripped from the path so that modules resolved outside the root
 * (e.g. `../../.pnpm/x/node_modules/y/index.js`) still have the opportunity to match.
 *
 * @param options - The resolved options holding `ignoreFolders`, `ignoreFiles` and the `ignoreDefaults` flag.
 *
 * @returns A matcher reporting whether a relative path is ignored.
 */
function createIgnoreMatcher(options: ResolvedOptions): IgnoreMatcher {
	const CONFIGURED = cleanIgnoredPaths([...options.ignoreFolders, ...options.ignoreFiles]);
	const ANY_DEPTH_TOKENS = options.ignoreDefaults
		? [...new Set([...CONFIGURED, ...ANY_DEPTH_DEFAULT_IGNORE_PATHS])]
		: CONFIGURED;
	const ROOT_ANCHORED_TOKENS = options.ignoreDefaults ? [...ROOT_ANCHORED_DEFAULT_IGNORE_PATHS] : [];
	const ALTERNATIVES: string[] = [];

	if (ANY_DEPTH_TOKENS.length > 0) {
		ALTERNATIVES.push(`(?:^|/)(?:${ANY_DEPTH_TOKENS.map(toSegmentPattern).join('|')})(?:/|$)`);
	}

	if (ROOT_ANCHORED_TOKENS.length > 0) {
		ALTERNATIVES.push(`^(?:${ROOT_ANCHORED_TOKENS.map(toSegmentPattern).join('|')})(?:/|$)`);
	}

	// An empty alternation would match every path, so a plugin without any ignore token keeps every file
	if (ALTERNATIVES.length === 0) {
		return () => false;
	}

	// eslint-disable-next-line security/detect-non-literal-regexp -- every token is regex-escaped by `toSegmentPattern`
	const PATTERN = new RegExp(ALTERNATIVES.join('|'));

	return (relativePath) => PATTERN.test(relativePath.replace(LEADING_PARENT_SEGMENTS_REGEX, ''));
}

/**
 * Tells whether a module ID, query suffix included, carries one of the configured extensions
 */
type ExtensionMatcher = (id: string) => boolean;

/**
 * Keeps the usable entries of a list of file extensions: non-blank strings, trimmed, without their leading dots,
 * and de-duplicated.
 *
 * @param extensions - An array of file extension strings (with or without leading dots).
 *
 * @returns A new array of unique extensions, each without a leading dot; empty when no entry is usable.
 */
function cleanExtensions(extensions: readonly unknown[]): string[] {
	const CLEANED = cleanNameTokens(extensions)
		.map((extension) => extension.replace(LEADING_DOTS_REGEX, ''))
		.filter((extension) => extension !== '');

	return [...new Set(CLEANED)];
}

/**
 * Compiles a list of file extensions into a single case-insensitive suffix matcher.
 *
 * Extensions are accepted with or without their leading dot; blank and non-string entries are dropped.
 *
 * @param extensions - An array of file extension strings (with or without leading dots).
 *
 * @returns A matcher reporting whether a module ID (query suffix stripped) ends with one of the extensions.
 */
function createExtensionMatcher(extensions: readonly string[]): ExtensionMatcher {
	const CLEANED = cleanExtensions(extensions);

	if (CLEANED.length === 0) {
		return () => false;
	}

	// eslint-disable-next-line security/detect-non-literal-regexp -- every extension is regex-escaped above
	const PATTERN = new RegExp(`\\.(?:${CLEANED.map(escapeRegExp).join('|')})$`, 'i');

	return (id) => PATTERN.test(stripQuery(id));
}

interface ExpressionFrame {
	kind: 'expression';
	depth: number;
}

interface TemplateFrame {
	kind: 'template';
	/**
	 * Where the reading of the markup the template literal holds stands, or `null` when the scan does not read it
	 */
	markup: TemplateMarkup | null;
}

interface TagFrame {
	kind: 'tag';
	/**
	 * Whether the tag opened with `</`, so that its `>` ends the element rather than starting its children
	 */
	isClosing: boolean;
	/**
	 * The element name read so far, empty for a `<>` fragment and truncated at
	 * {@link MAXIMUM_ELEMENT_NAME_LENGTH}
	 */
	name: string;
	/**
	 * Whether the scan is still inside the name, which ends at the first character that cannot belong to one
	 */
	isNameOpen: boolean;
	/**
	 * Whether an `=` has been read in the attribute list, which settles the tag as a tag
	 */
	hasSeenAssignment: boolean;
	/**
	 * The first word read after the element name, capped at the length of {@link GENERIC_CONSTRAINT_KEYWORD},
	 * or `null` once that word can no longer be the keyword
	 */
	pendingWord: string | null;
}

interface TextFrame {
	kind: 'text';
	/**
	 * The name of the element whose children this frame holds, which its closing tag has to repeat
	 */
	name: string;
}

/**
 * The type argument list written right after the name of a generic JSX element (`<Select<Option> … />`), read as one
 * balanced `<…>` list so that none of its characters counts as part of the attribute list
 */
interface TypeArgumentsFrame {
	kind: 'type-arguments';
	/**
	 * How many `<` of the list are still open, outside every bracket
	 */
	angleDepth: number;
	/**
	 * How many `(`, `[` and `{` of the list are still open
	 */
	bracketDepth: number;
	/**
	 * The quote delimiting the string literal type being read, empty outside one
	 */
	quote: string;
	isEscaped: boolean;
	/**
	 * The character read last, which tells the `>` of an arrow (`() => void`) from one closing the list
	 */
	previousCharacter: string;
}

/**
 * A quoted string holding closed markup — an Angular inline template (`template: '<p a="b"></p>'`), or any such
 * string once `removeInStrings` is on — read like the text of a template literal
 */
interface MarkupStringFrame {
	kind: 'markup-string';
	/**
	 * Index of the closing quote
	 */
	end: number;
	markup: TemplateMarkup;
}

type Frame = ExpressionFrame | MarkupStringFrame | TemplateFrame | TagFrame | TextFrame | TypeArgumentsFrame;

type ScanStep = 'closed' | 'continue' | 'skip-next';

type CommentKind = '' | 'block' | 'line';

/**
 * Which part of the markup a template literal holds the character being read belongs to
 */
type MarkupState =
	'attributes' | 'comment' | 'quoted-value' | 'raw-text' | 'tag-name' | 'text' | 'unquoted-value' | 'value-start';

/**
 * The reading of the markup held by one template literal, which its `${…}` placeholders interrupt and resume
 */
interface TemplateMarkup {
	state: MarkupState;
	/**
	 * The quote delimiting the value being read, empty outside a quoted value
	 */
	quote: string;
	/**
	 * The lower-cased name of the last opening tag read, tracked up to one character past
	 * {@link LONGEST_RAW_TEXT_ELEMENT_NAME_LENGTH}
	 */
	tagName: string;
}

/**
 * Reads one entry of a list of positions at an index the caller knows to be in range.
 *
 * @param positions - The positions.
 * @param index - An index below the length of the list.
 *
 * @returns The position at the index.
 *
 * @throws When the index is out of range, which is a bug of the caller.
 */
function readPosition(positions: readonly number[], index: number): number {
	const POSITION = positions[index];

	/* v8 ignore next 3 -- offensive invariant: every caller reads an index below the length of the list */
	if (POSITION == null) {
		throw new Error(`remove-attributes: position index ${index} is out of range`);
	}

	return POSITION;
}

/**
 * Where every closing tag of a file sits, grouped by element name, indexed on the first question asked.
 *
 * @remarks
 * A `<Name>` written with nothing between its name and its `>` is a TypeScript type parameter list or type
 * assertion (`type F = <T>(x: T) => T`, `<T>value`) as often as an element — and only an element is ever closed
 * by a `</Name>`. Answering that question for every such `<Name>` with a search of its own would cost the rest of
 * the file each time; one pass collecting every closer answers all of them with a binary search.
 */
class ClosingTagIndex {
	readonly #input: string;
	#positions: Map<string, number[]> | null = null;

	constructor(input: string) {
		this.#input = input;
	}

	/**
	 * Reports whether a closing tag of the given element sits after an index and before another.
	 *
	 * @param options.name - The element name, truncated as a tag frame tracks it.
	 * @param options.from - The index the closing tag must start after.
	 * @param options.to - The index the closing tag must start before.
	 *
	 * @returns `true` when such a closing tag exists.
	 */
	has(options: { name: string; from: number; to: number }): boolean {
		const { name, from, to } = options;
		const POSITIONS = this.#getPositions().get(name);

		if (POSITIONS == null) {
			return false;
		}

		let low = 0;
		let high = POSITIONS.length;

		// The positions are ascending, so the halving settles on the first one past `from`
		while (low < high) {
			const MIDDLE = Math.floor((low + high) / 2);

			if (readPosition(POSITIONS, MIDDLE) <= from) {
				low = MIDDLE + 1;
			} else {
				high = MIDDLE;
			}
		}

		return low < POSITIONS.length && readPosition(POSITIONS, low) < to;
	}

	#getPositions(): Map<string, number[]> {
		if (this.#positions != null) {
			return this.#positions;
		}

		const POSITIONS = new Map<string, number[]>();

		CLOSING_TAG_REGEX.lastIndex = 0;

		for (let match = CLOSING_TAG_REGEX.exec(this.#input); match != null; match = CLOSING_TAG_REGEX.exec(this.#input)) {
			// The match is the `</` and the name, the whitespace or `>` after it being only looked ahead at
			const NAME = match[0].slice('</'.length, '</'.length + MAXIMUM_ELEMENT_NAME_LENGTH);
			const NAME_POSITIONS = POSITIONS.get(NAME);

			if (NAME_POSITIONS == null) {
				POSITIONS.set(NAME, [match.index]);
			} else {
				NAME_POSITIONS.push(match.index);
			}
		}

		this.#positions = POSITIONS;

		return POSITIONS;
	}
}

/**
 * What a scanner reading a whole region of code needs on top of the characters it steps through
 */
interface RegionReading {
	/**
	 * The source the region belongs to, which the markup of a template literal is read ahead in
	 */
	input: string;
	/**
	 * Exclusive end of the region, which bounds the closing-tag lookup
	 */
	end: number;
	/**
	 * Whether a `<` at an operand position may open a JSX element, which a TypeScript module never allows
	 */
	hasJsx: boolean;
	closers: ClosingTagIndex;
	/**
	 * Whether every `'` or `"` string holding closed markup is read as that markup, rather than only the value of an
	 * Angular `template` property key
	 */
	shouldReadMarkupStrings: boolean;
	/**
	 * The content range of every string read as markup so far, in source order, which the file's tag mask carries
	 */
	markupStrings: Range[];
}

/**
 * Reports whether a `<` read in the text of template-literal markup opens a tag: a letter follows it, or the `${`
 * of a placeholder naming the element (`` html`<${tag} a="b">` ``).
 *
 * @param input - The source.
 * @param index - The index of the `<`.
 *
 * @returns `true` when the `<` opens a tag.
 */
function opensTemplateTag(input: string, index: number): boolean {
	const NEXT = input.charAt(index + 1);

	return ASCII_LETTER_REGEX.test(NEXT) || (NEXT === '$' && input.charAt(index + 2) === '{');
}

/**
 * Reports whether a `<` read in the raw text of template-literal markup opens the closing tag of its element.
 *
 * @remarks
 * A template literal may escape the slash of the closer, which Astro's compiler always does (`<\/script>`).
 *
 * @param options.input - The source.
 * @param options.index - The index of the `<`.
 * @param options.name - The lower-cased name of the raw-text element.
 *
 * @returns `true` when the `<` opens `</name`.
 */
function closesRawText(options: { input: string; index: number; name: string }): boolean {
	const { input, index, name } = options;
	const SLASH_INDEX = input.charAt(index + 1) === '\\' ? index + 2 : index + 1;
	const NAME_START = SLASH_INDEX + 1;

	return (
		input.charAt(SLASH_INDEX) === '/' &&
		input.slice(NAME_START, NAME_START + name.length).toLowerCase() === name &&
		!isElementNameCharacter(input.charAt(NAME_START + name.length))
	);
}

/**
 * Moves the reading of template-literal markup past the `>` ending an opening tag, into the content of its element.
 *
 * @param markup - The reading to advance.
 */
function enterTemplateElementContent(markup: TemplateMarkup): void {
	markup.state = RAW_TEXT_ELEMENT_NAMES.has(markup.tagName) ? 'raw-text' : 'text';
}

/**
 * Moves the reading of template-literal markup over one character of the content between its tags: text, the raw
 * text of a `<script>` or `<style>` element, or a comment.
 *
 * @param markup - The reading to advance, standing in content.
 * @param input - The source.
 * @param index - The index of the character.
 */
function advanceTemplateContent(markup: TemplateMarkup, input: string, index: number): void {
	if (markup.state === 'comment') {
		if (input.startsWith(MARKUP_COMMENT_CLOSE, index)) {
			markup.state = 'text';
		}

		return;
	}

	if (input.charAt(index) !== '<') {
		return;
	}

	if (markup.state === 'raw-text') {
		if (closesRawText({ input, index, name: markup.tagName })) {
			markup.state = 'text';
		}
	} else if (input.startsWith(MARKUP_COMMENT_OPEN, index)) {
		markup.state = 'comment';
	} else if (opensTemplateTag(input, index)) {
		markup.state = 'tag-name';
		markup.tagName = '';
	}
}

/**
 * Moves the reading of template-literal markup over one character of its text.
 *
 * @remarks
 * The reading follows the tokenization of an HTML start tag closely enough to tell its attribute list from its text,
 * its values and its comments; the template literal itself — its end, its escapes and its placeholders — is the
 * scanner's business, which calls this on every character of the literal's text and never on a placeholder.
 *
 * @param markup - The reading to advance.
 * @param input - The source.
 * @param index - The index of the character, whose cooked value an escape sequence has already resolved to.
 */
function advanceTemplateMarkup(markup: TemplateMarkup, input: string, index: number): void {
	const CHARACTER = input.charAt(index);

	switch (markup.state) {
		case 'text':
		case 'raw-text':
		case 'comment': {
			advanceTemplateContent(markup, input, index);

			return;
		}

		case 'tag-name': {
			if (CHARACTER === '>') {
				enterTemplateElementContent(markup);
			} else if (CHARACTER === '/' || isWhitespace(CHARACTER)) {
				markup.state = 'attributes';
			} else if (markup.tagName.length <= LONGEST_RAW_TEXT_ELEMENT_NAME_LENGTH) {
				markup.tagName += CHARACTER.toLowerCase();
			}

			return;
		}

		case 'attributes': {
			if (CHARACTER === '>') {
				enterTemplateElementContent(markup);
			} else if (CHARACTER === '=') {
				markup.state = 'value-start';
			}

			return;
		}

		case 'value-start': {
			if (CHARACTER === '"' || CHARACTER === "'") {
				markup.state = 'quoted-value';
				markup.quote = CHARACTER;
			} else if (CHARACTER === '>') {
				enterTemplateElementContent(markup);
			} else if (!isWhitespace(CHARACTER)) {
				markup.state = 'unquoted-value';
			}

			return;
		}

		case 'quoted-value': {
			if (CHARACTER === markup.quote) {
				markup.state = 'attributes';
				markup.quote = '';
			}

			return;
		}

		case 'unquoted-value': {
			if (CHARACTER === '>') {
				enterTemplateElementContent(markup);
			} else if (isWhitespace(CHARACTER)) {
				markup.state = 'attributes';
			}
		}
	}
}

/**
 * Finds the closing quote of a `'` or `"` string literal whose every character is the character it cooks to.
 *
 * @remarks
 * Its markup is read on the source, and removing an attribute edits the source: that is only faithful when no escape
 * sequence stands between the two. A `\'` or `\"` would let a removed value take the closing quote of the literal
 * with it, and a `\n` is whitespace to the markup but not to the source — so a literal holding any backslash, or
 * running into a line break it cannot hold, is left to be read as a plain string.
 *
 * @param options.input - The source.
 * @param options.quoteIndex - The index of the opening quote.
 * @param options.end - The exclusive end of the region the literal must close in.
 *
 * @returns The index of the closing quote, or `-1` when the literal holds an escape or does not close on its line.
 */
function findPlainStringLiteralEnd(options: { input: string; quoteIndex: number; end: number }): number {
	const { input, quoteIndex, end } = options;
	const QUOTE = input.charAt(quoteIndex);

	for (let index = quoteIndex + 1; index < end; index++) {
		const CHARACTER = input.charAt(index);

		if (CHARACTER === QUOTE) {
			return index;
		}

		if (CHARACTER === '\\' || CHARACTER === '\n' || CHARACTER === '\r') {
			return NOT_FOUND;
		}
	}

	return NOT_FOUND;
}

/**
 * Reports whether a range of the source holds a `<`, the one character no markup goes without.
 *
 * @param options.input - The source.
 * @param options.start - The index the range starts at.
 * @param options.end - The exclusive end of the range.
 *
 * @returns `true` when a `<` sits in the range.
 */
function hasTagOpener(options: { input: string; start: number; end: number }): boolean {
	const { input, start, end } = options;

	for (let index = start; index < end; index++) {
		if (input.charAt(index) === '<') {
			return true;
		}
	}

	return false;
}

/**
 * Reports whether the text of a string holds markup whose every tag, quoted value, comment and raw-text element closes
 * inside it.
 *
 * @remarks
 * Only such markup can be edited without reaching past the string: an attribute list still open at the closing quote
 * belongs to a tag the code finishes elsewhere (`'<div data-testid="' + id + '">'`), and removing an attribute from it
 * would take the quote, and the code after it, along.
 *
 * @param options.input - The source.
 * @param options.start - The index just past the opening quote.
 * @param options.end - The index of the closing quote.
 *
 * @returns `true` when the reading of the markup ends in text.
 */
function isClosedMarkup(options: { input: string; start: number; end: number }): boolean {
	const { input, start, end } = options;
	const MARKUP: TemplateMarkup = { state: 'text', quote: '', tagName: '' };

	for (let index = start; index < end; index++) {
		advanceTemplateMarkup(MARKUP, input, index);
	}

	return MARKUP.state === 'text';
}

/**
 * Finds the closing quote of a `'` or `"` string literal read as markup.
 *
 * @remarks
 * A string is read as markup when it is the value of a `template` property key, or any string once the region reads
 * markup strings, and passes three checks, cheapest first: every character is the one it cooks to
 * ({@link findPlainStringLiteralEnd}), it holds a `<`, and its markup closes ({@link isClosedMarkup}). Each check
 * reads the string at most once, so the scan of a region stays linear.
 *
 * @param options.region - The region the literal sits in.
 * @param options.quoteIndex - The index of the opening quote.
 * @param options.isTemplateValue - Whether the literal follows the `:` of a `template` property key.
 *
 * @returns The index of the closing quote, or `-1` when the literal is to be read as a plain string.
 */
function findMarkupStringEnd(options: { region: RegionReading; quoteIndex: number; isTemplateValue: boolean }): number {
	const { region, quoteIndex, isTemplateValue } = options;

	if (!isTemplateValue && !region.shouldReadMarkupStrings) {
		return NOT_FOUND;
	}

	const END = findPlainStringLiteralEnd({ input: region.input, quoteIndex, end: region.end });
	const CONTENT = { input: region.input, start: quoteIndex + 1, end: END } as const;
	const IS_MARKUP = END !== NOT_FOUND && hasTagOpener(CONTENT) && isClosedMarkup(CONTENT);

	return IS_MARKUP ? END : NOT_FOUND;
}

/**
 * Character-by-character scanner for the expression an attribute value opens with a brace — an `={…}` value,
 * or the `{…}` / `${…}` interpolated into an unquoted or a quoted one: tracks nested braces, quoted strings,
 * template literals and their `${…}` placeholders, comments, regular expression literals and the elements the
 * expression may hold, and reports when the opening brace is closed.
 *
 * @remarks
 * A frame says which syntax the scan is reading. `expression` and `template` read JavaScript, where a quote
 * opens a string and a `/` may open a regular expression literal. `tag` reads an element's attribute list and
 * `text` its children, where an apostrophe, a slash and a backslash are content rather than syntax — reading
 * those two as JavaScript is what made `{ok && <p>don't</p>}` swallow everything after it. `type-arguments` reads
 * the type argument list of a generic element (`<Select<Option> />`) as one balanced `<…>` list, and
 * `markup-string` the closed markup of a `'` or `"` string an Angular `template:` key holds — or of any such string
 * when the region reads markup strings ({@link findMarkupStringEnd}).
 *
 * Elements are matched by name, and a closing tag the scan cannot pair with an element it is inside means the
 * value holds markup this scanner cannot follow — whether it names another element, stands where no element
 * is open, or follows one that has already closed. Re-synchronizing on it would read past the end of the
 * value and report a brace belonging to the module as the one closing the attribute. The scan is marked
 * desynchronized instead, never reports a close, and the caller leaves the attribute in place.
 *
 * A brace inside a quoted value may be no expression at all: a JSX string attribute holding a literal `${`
 * reads as one. Such a scan reads the markup after the value as JavaScript, and a later brace of the module —
 * the one closing the enclosing function — would close it. Two things valid code never does desynchronize it:
 * a `'` or `"` string running into a newline, and an operand or a brace written right after a string on the
 * same line (`" className="p`), where only an operator may follow one.
 *
 * The same scanner reads a whole region of code — a module, a `<script>` block, a `{…}` slot — when it is given a
 * {@link RegionReading}. It then also follows the markup of every template literal, reports through
 * {@link ExpressionScanner.isAtAttributePosition} which characters sit in an attribute list, never reads JSX where
 * the region forbids it, and reads a `<Name>` no `</Name` closes as a TypeScript type rather than an element.
 */
class ExpressionScanner {
	readonly #frames: Frame[] = [{ kind: 'expression', depth: 1 }];
	/**
	 * Whether the brace the scan started from sits inside a quoted value, where it may be literal text
	 */
	readonly #isInQuotedValue: boolean;
	#stringQuote = '';
	#isMarkupString = false;
	#isEscaped = false;
	#commentKind: CommentKind = '';
	#isInRegularExpression = false;
	#isInCharacterClass = false;
	/**
	 * Whether the regular expression literal being read was opened by the `/` of a `</` read as a comparison,
	 * which the literal has to end on its own line to have been
	 */
	#isComparisonRegularExpression = false;
	#isDesynchronized = false;
	#previousSignificantCharacter = '';
	#previousIdentifier = '';
	#isIdentifierOpen = false;
	/**
	 * The significant character read in front of the identifier the scan read last, which tells a keyword from a
	 * property name (`.default`) and a property key from any other word
	 */
	#characterBeforeIdentifier = '';
	/**
	 * Whether the last significant character read was the `:` following a `template` property key
	 */
	#isAfterTemplateKey = false;
	/**
	 * Whether the last token read was an element that closed, which no `</` may follow
	 */
	#isAfterElement = false;
	/**
	 * The word read so far right after a string on the same line — empty while only spaces followed it — or
	 * `null` when no string has just ended. Only tracked inside a quoted value, and capped at
	 * {@link LONGEST_OPERATOR_KEYWORD_LENGTH}
	 */
	#wordAfterString: string | null = null;
	/**
	 * What a scan reading a whole region of code knows about it, or `null` for the scan of one attribute value
	 */
	readonly #region: RegionReading | null;

	constructor(options: { isInQuotedValue: boolean; region?: RegionReading }) {
		this.#isInQuotedValue = options.isInQuotedValue;
		this.#region = options.region ?? null;
	}

	/**
	 * Whether the scan has lost track of the markup, after which no brace can be trusted to close the value
	 */
	get isDesynchronized(): boolean {
		return this.#isDesynchronized;
	}

	/**
	 * Whether the next character sits in the attribute list of an opening tag — a JSX one, or one of the markup a
	 * template literal holds — outside the element name and every value.
	 */
	get isAtAttributePosition(): boolean {
		if (this.#commentKind !== '' || this.#isInRegularExpression || this.#stringQuote !== '' || this.#isEscaped) {
			return false;
		}

		const FRAME = this.#frames.at(-1);

		if (FRAME?.kind === 'tag') {
			return !FRAME.isClosing && !FRAME.isNameOpen;
		}

		const IS_MARKUP_FRAME = FRAME?.kind === 'template' || FRAME?.kind === 'markup-string';

		return IS_MARKUP_FRAME && FRAME.markup?.state === 'attributes';
	}

	/**
	 * The reading of the markup the next character belongs to, or `null` when it is no unescaped character of a
	 * template literal whose markup the scan follows.
	 */
	get templateMarkup(): TemplateMarkup | null {
		const FRAME = this.#frames.at(-1);

		return this.#isEscaped || FRAME?.kind !== 'template' ? null : FRAME.markup;
	}

	/**
	 * Whether the next character is code of the expression the scan started in rather than of a string, a comment, a
	 * regular expression, a template literal or one of its placeholders.
	 */
	get isInBaseExpression(): boolean {
		return (
			this.#frames.length === 1 && this.#commentKind === '' && !this.#isInRegularExpression && this.#stringQuote === ''
		);
	}

	step(character: string, next: string, index: number): ScanStep {
		if (this.#commentKind !== '') {
			return this.#stepComment(character, next);
		}

		if (this.#isInRegularExpression) {
			return this.#stepRegularExpression(character);
		}

		if (this.#stringQuote !== '') {
			return this.#stepString(character);
		}

		const FRAME = this.#frames.at(-1);

		// The bottom frame is the brace the scan was started from, and nothing ever pops it
		/* v8 ignore next 3 -- offensive invariant: only a tag, text or template frame, or an expression frame above the bottom one, is ever popped */
		if (!FRAME) {
			throw new Error('remove-attributes: expression scanner lost its bottom frame');
		}

		if (FRAME.kind === 'tag') {
			return this.#stepTag(FRAME, character, next, index);
		}

		if (FRAME.kind === 'text') {
			return this.#stepText(character, next);
		}

		if (FRAME.kind === 'template') {
			return this.#stepTemplate(FRAME, character, next, index);
		}

		if (FRAME.kind === 'markup-string') {
			return this.#stepMarkupString(FRAME, character, index);
		}

		if (FRAME.kind === 'type-arguments') {
			return this.#stepTypeArguments(FRAME, character);
		}

		return this.#stepExpression(FRAME, character, next, index);
	}

	#stepComment(character: string, next: string): ScanStep {
		if (this.#commentKind === 'line') {
			if (character === '\n') {
				this.#commentKind = '';
			}

			return 'continue';
		}

		if (character === '*' && next === '/') {
			this.#commentKind = '';

			return 'skip-next';
		}

		return 'continue';
	}

	#stepString(character: string): ScanStep {
		// An attribute string of an element carries no escape sequence and may span lines, so nothing but its
		// own quote closes it — a `\` in `<T a='\' />` is one backslash of content
		if (this.#isMarkupString) {
			if (character === this.#stringQuote) {
				this.#endString();
			}

			return 'continue';
		}

		if (this.#isEscaped) {
			this.#isEscaped = false;

			return 'continue';
		}

		if (character === '\\') {
			this.#isEscaped = true;

			return 'continue';
		}

		if (character === this.#stringQuote) {
			this.#endString();

			if (this.#isInQuotedValue) {
				this.#wordAfterString = '';
			}

			return 'continue';
		}

		// A `'` or `"` string of JavaScript cannot span lines, so an unescaped newline ends it as surely as the
		// closing quote does. Without that rule an unterminated string swallows the rest of the file. Inside a
		// quoted value it also proves the scan is reading markup as code, as no valid expression holds one
		if (character === '\n') {
			this.#endString();

			if (this.#isInQuotedValue) {
				this.#isDesynchronized = true;
			}
		}

		return 'continue';
	}

	/**
	 * Reads the character following a string on its own line, which may only continue an operator.
	 *
	 * @remarks
	 * An identifier, a number, another string or an opening brace written there follows the string with nothing
	 * joining the two — the markup after a literal `${"` (`" className="p"`, `" :class="{a: b}"`) rather than
	 * code. A newline ends the tracking instead, since automatic semicolon insertion lets a statement follow a
	 * string on the next line.
	 *
	 * @param word - The word read so far after the string, empty while only spaces followed it.
	 * @param character - The character just read in code context.
	 *
	 * @returns `true` when the character proves the scan is reading something other than JavaScript.
	 */
	#hasOperandAfterString(word: string, character: string): boolean {
		if (isIdentifierCharacter(character)) {
			// A word longer than every operator keyword can no longer be one
			if (word.length === LONGEST_OPERATOR_KEYWORD_LENGTH) {
				this.#wordAfterString = null;

				return true;
			}

			this.#wordAfterString = word + character;

			return false;
		}

		if (word === '' && (character === ' ' || character === '\t')) {
			return false;
		}

		this.#wordAfterString = null;

		return word === '' ? character === '"' || character === "'" || character === '{' : !OPERATOR_KEYWORDS.has(word);
	}

	#endString(): void {
		this.#rememberCharacter(this.#stringQuote);
		this.#stringQuote = '';
	}

	/**
	 * Records the token the scan just read, which is what tells a later `/` from a division operator and a
	 * later `<` from a comparison.
	 *
	 * @remarks
	 * Whitespace closes the identifier run without replacing the token, so `return /re/` still reads `return`
	 * while `a b /2/` reads `b` rather than `ab`.
	 *
	 * @param character - The character just read in code context.
	 */
	#rememberCharacter(character: string): void {
		if (isWhitespace(character)) {
			this.#isIdentifierOpen = false;

			return;
		}

		const PREVIOUS_SIGNIFICANT_CHARACTER = this.#previousSignificantCharacter;

		this.#previousSignificantCharacter = character;
		// Whatever the token is, it is not the element that closed before it
		this.#isAfterElement = false;

		if (!isIdentifierCharacter(character)) {
			this.#previousIdentifier = '';
			this.#isIdentifierOpen = false;

			return;
		}

		if (!this.#isIdentifierOpen) {
			this.#previousIdentifier = character;
			this.#isIdentifierOpen = true;
			this.#characterBeforeIdentifier = PREVIOUS_SIGNIFICANT_CHARACTER;

			return;
		}

		if (this.#previousIdentifier.length <= LONGEST_REGULAR_EXPRESSION_KEYWORD_LENGTH) {
			this.#previousIdentifier += character;
		}
	}

	#stepRegularExpression(character: string): ScanStep {
		if (this.#isEscaped) {
			this.#isEscaped = false;

			return 'continue';
		}

		if (character === '\\') {
			this.#isEscaped = true;

			return 'continue';
		}

		if (this.#isInCharacterClass) {
			if (character === ']') {
				this.#isInCharacterClass = false;
			}

			return 'continue';
		}

		if (character === '[') {
			this.#isInCharacterClass = true;
		} else if (character === '/') {
			this.#isInRegularExpression = false;
			this.#isComparisonRegularExpression = false;
			this.#rememberCharacter('/');
		} else if (character === '\n') {
			// A regular expression literal cannot span lines either: a newline means the `/` was a division
			// operator after all, so the scan returns to plain code
			this.#isInRegularExpression = false;

			// Behind a `<` there is nothing for it to divide: the two opened a closing tag with no element for
			// it, and the markup that follows is markup this scan cannot measure
			if (this.#isComparisonRegularExpression) {
				this.#isDesynchronized = true;
			}

			this.#isComparisonRegularExpression = false;
		}

		return 'continue';
	}

	#stepTemplate(frame: TemplateFrame, character: string, next: string, index: number): ScanStep {
		if (this.#isEscaped) {
			this.#isEscaped = false;
			this.#readTemplateMarkup(frame, index);

			return 'continue';
		}

		if (character === '\\') {
			this.#isEscaped = true;

			return 'continue';
		}

		if (character === '`') {
			this.#rememberCharacter(character);
			this.#frames.pop();
		} else if (character === '$' && next === '{') {
			// A placeholder standing where a value begins is that value (`data-testid=${id}`)
			if (frame.markup?.state === 'value-start') {
				frame.markup.state = 'unquoted-value';
			}

			this.#rememberCharacter('{');
			this.#frames.push({ kind: 'expression', depth: 1 });

			return 'skip-next';
		} else {
			this.#readTemplateMarkup(frame, index);
		}

		return 'continue';
	}

	#readTemplateMarkup(frame: MarkupStringFrame | TemplateFrame, index: number): void {
		if (frame.markup != null && this.#region != null) {
			advanceTemplateMarkup(frame.markup, this.#region.input, index);
		}
	}

	#stepMarkupString(frame: MarkupStringFrame, character: string, index: number): ScanStep {
		if (index === frame.end) {
			this.#frames.pop();
			this.#rememberCharacter(character);
		} else {
			this.#readTemplateMarkup(frame, index);
		}

		return 'continue';
	}

	/**
	 * Reads one character of the type argument list of a generic element, and returns to its attribute list once the
	 * list is balanced.
	 *
	 * @remarks
	 * A string literal type may hold any bracket, and the `>` of an arrow (`(x: T) => U`) closes nothing, so neither
	 * counts. A bracket closing more than the list opened means the `<` opened no such list after all: the scan has lost
	 * track of the code.
	 *
	 * @param frame - The type argument list being read.
	 * @param character - The character just read inside it.
	 *
	 * @returns Always `'continue'`.
	 */
	#stepTypeArguments(frame: TypeArgumentsFrame, character: string): ScanStep {
		const PREVIOUS_CHARACTER = frame.previousCharacter;

		frame.previousCharacter = character;

		if (frame.quote !== '') {
			if (frame.isEscaped) {
				frame.isEscaped = false;
			} else if (character === '\\') {
				frame.isEscaped = true;
			} else if (character === frame.quote) {
				frame.quote = '';
			}

			return 'continue';
		}

		if (character === "'" || character === '"' || character === '`') {
			frame.quote = character;
		} else if (LIST_OPENERS.includes(character)) {
			frame.bracketDepth++;
		} else if (LIST_CLOSERS.includes(character)) {
			frame.bracketDepth--;

			if (frame.bracketDepth < 0) {
				this.#isDesynchronized = true;
			}
		} else if (frame.bracketDepth === 0 && character === '<') {
			frame.angleDepth++;
		} else if (frame.bracketDepth === 0 && character === '>' && PREVIOUS_CHARACTER !== '=') {
			frame.angleDepth--;

			if (frame.angleDepth === 0) {
				this.#frames.pop();
			}
		}

		return 'continue';
	}

	/**
	 * Opens the `'` or `"` string literal the character starts, read as markup when {@link findMarkupStringEnd} finds
	 * its closing quote, and recorded in the region's markup strings then.
	 *
	 * @param options.quote - The quote opening the literal.
	 * @param options.index - The index of the quote.
	 * @param options.isTemplateValue - Whether the literal follows the `:` of a `template` property key.
	 *
	 * @throws When the literal starts before the last markup string recorded ends, which a scan reading forward never
	 *   does.
	 */
	#openString(options: { quote: string; index: number; isTemplateValue: boolean }): void {
		const { quote, index, isTemplateValue } = options;
		const REGION = this.#region;
		const END =
			REGION == null ? NOT_FOUND : findMarkupStringEnd({ region: REGION, quoteIndex: index, isTemplateValue });

		if (REGION == null || END === NOT_FOUND) {
			this.#stringQuote = quote;
			this.#isMarkupString = false;

			return;
		}

		const PREVIOUS_END = REGION.markupStrings.at(-1)?.[1] ?? NOT_FOUND;

		/* v8 ignore next 3 -- offensive invariant: regions are read in source order, and a slot that never closes drops the strings it recorded */
		if (index < PREVIOUS_END) {
			throw new Error(`remove-attributes: markup string at ${index} starts before the one ending at ${PREVIOUS_END}`);
		}

		REGION.markupStrings.push([index + 1, END]);
		this.#frames.push({ kind: 'markup-string', end: END, markup: { state: 'text', quote: '', tagName: '' } });
	}

	/**
	 * Whether the `:` just read follows a `template` property key of an object literal.
	 *
	 * @returns `true` when the next operand is the value of that key.
	 */
	#hasTemplateKey(): boolean {
		return (
			this.#previousIdentifier === TEMPLATE_PROPERTY_KEY &&
			PROPERTY_KEY_START_CHARACTERS.has(this.#characterBeforeIdentifier)
		);
	}

	#stepExpression(frame: ExpressionFrame, character: string, next: string, index: number): ScanStep {
		const WORD_AFTER_STRING = this.#wordAfterString;

		if (WORD_AFTER_STRING != null && this.#hasOperandAfterString(WORD_AFTER_STRING, character)) {
			this.#isDesynchronized = true;

			return 'continue';
		}

		const IS_TEMPLATE_VALUE = this.#isAfterTemplateKey;

		if (!isWhitespace(character)) {
			this.#isAfterTemplateKey = character === ':' && this.#hasTemplateKey();
		}

		if (character === '/') {
			return this.#stepSlash(next);
		}

		if (character === '<') {
			// A `</` is a closing tag with no element open in this expression both where an element could start
			// and right after one that closed: the value holds markup the scan cannot follow, so it must not
			// report any later brace as the one closing the attribute
			if (next === '/' && (this.#hasOperandPosition(ELEMENT_START_CHARACTERS) || this.#isAfterElement)) {
				this.#isDesynchronized = true;

				return 'skip-next';
			}

			if (this.#hasElementStart(next)) {
				this.#frames.push({
					kind: 'tag',
					isClosing: false,
					name: '',
					isNameOpen: true,
					hasSeenAssignment: false,
					pendingWord: '',
				});

				return 'continue';
			}

			// Anywhere else the `<` compares, and a `/` behind it opens the literal `a < /re/.test(b)` spaces
			// out — one that has to end on its line, or the `</` was a closing tag after all
			this.#isComparisonRegularExpression = next === '/';
		}

		// A `!` that is not at an operand position is the TypeScript non-null assertion, which ends a value
		// rather than starting one: `n!<max` compares where `ok && !<p>x</p>` nests an element
		if (character === '!' && !this.#hasOperandPosition(ELEMENT_START_CHARACTERS)) {
			this.#rememberCharacter(')');

			return 'continue';
		}

		this.#rememberCharacter(character);

		if (character === "'" || character === '"') {
			this.#openString({ quote: character, index, isTemplateValue: IS_TEMPLATE_VALUE });
		} else if (character === '`') {
			this.#frames.push({
				kind: 'template',
				markup: this.#region == null ? null : { state: 'text', quote: '', tagName: '' },
			});
		} else if (character === '{') {
			frame.depth++;
		} else if (character === '}') {
			return this.#closeBrace(frame);
		}

		return 'continue';
	}

	#stepSlash(next: string): ScanStep {
		// The flag was raised on the character right in front of this `/`, so it describes this one and no other
		const IS_AFTER_COMPARISON = this.#isComparisonRegularExpression;

		this.#isComparisonRegularExpression = false;

		if (next === '/' || next === '*') {
			this.#commentKind = next === '/' ? 'line' : 'block';

			return 'skip-next';
		}

		// Division and a regular expression literal are told apart by the token before the `/`, which is what a
		// JavaScript tokenizer keys off as well — though it reads a full token stream where this scan tracks
		// only the last one. A residual misreading is possible and bounded: a literal never runs past the end
		// of its line
		if (this.#hasOperandPosition(REGULAR_EXPRESSION_START_CHARACTERS)) {
			this.#isInRegularExpression = true;
			this.#isInCharacterClass = false;
			this.#isComparisonRegularExpression = IS_AFTER_COMPARISON;
		} else {
			this.#rememberCharacter('/');
		}

		return 'continue';
	}

	/**
	 * Whether the `<` just read opens an element rather than comparing two values.
	 *
	 * @remarks
	 * What follows has to look like a tag — a name, or nothing at all for the `<>` fragment — and the token
	 * before the `<` has to leave the scan where an operand begins, since an element is a value. That second
	 * half is the test a `/` goes through as well, which is what keeps `a < b`, `a<b` and `x > 1 && y < 2`
	 * comparisons.
	 *
	 * @param next - The character following the `<`.
	 *
	 * @returns `true` when the scan must enter a `tag` frame.
	 */
	#hasElementStart(next: string): boolean {
		if (this.#region?.hasJsx === false || (next !== '>' && !isIdentifierStart(next))) {
			return false;
		}

		return this.#hasOperandPosition(ELEMENT_START_CHARACTERS);
	}

	/**
	 * Whether the token read so far leaves the scan at the start of an operand.
	 *
	 * @param startCharacters - The punctuation an operand may follow.
	 *
	 * @returns `true` when a value begins here, `false` when the scan is in the middle of one.
	 */
	#hasOperandPosition(startCharacters: ReadonlySet<string>): boolean {
		// An identifier decides on its own: only a keyword may precede an operand, so `retin / 2` divides — and so
		// does `module.default / 2`, where the keyword names a property
		if (this.#previousIdentifier !== '') {
			return REGULAR_EXPRESSION_KEYWORDS.has(this.#previousIdentifier) && this.#characterBeforeIdentifier !== '.';
		}

		return this.#previousSignificantCharacter === '' || startCharacters.has(this.#previousSignificantCharacter);
	}

	/**
	 * Accumulates the element name a tag frame opened with.
	 *
	 * @remarks
	 * The name is tracked up to a fixed length, so two names agreeing that far are read as the same element.
	 * That keeps the memory of one scan bounded however long the names in the source are, and costs nothing
	 * in practice: an opening and a closing tag agreeing over that many characters are the same element.
	 *
	 * @param frame - The tag frame being read.
	 * @param character - The character just read inside the tag.
	 *
	 * @returns `true` while the character belongs to the name, `false` on the one that closes it.
	 */
	#readElementName(frame: TagFrame, character: string): boolean {
		if (!isElementNameCharacter(character)) {
			frame.isNameOpen = false;

			return false;
		}

		if (frame.name.length < MAXIMUM_ELEMENT_NAME_LENGTH) {
			frame.name += character;
		}

		return true;
	}

	/**
	 * Buffers the first word following the element name, which is what tells `<T extends U>` from a tag.
	 *
	 * @remarks
	 * Buffering the word on the frame is what keeps the scan free of any lookahead over the input, and the
	 * buffer is bounded by the length of the keyword: a longer word, or anything that is not a word at all,
	 * can no longer be it and ends the tracking for the rest of the tag. A word closed by anything but
	 * whitespace is a name of the attribute list (`extends="x"` is an attribute, `extends U` a constraint).
	 *
	 * @param frame - The tag frame being read.
	 * @param character - The character just read inside the tag, the name already closed.
	 *
	 * @returns `true` when the word just closed was the `extends` of a generic parameter list.
	 */
	#readPendingWord(frame: TagFrame, character: string): boolean {
		if (frame.pendingWord == null) {
			return false;
		}

		if (isIdentifierCharacter(character)) {
			if (frame.pendingWord.length === GENERIC_CONSTRAINT_KEYWORD.length) {
				frame.pendingWord = null;
			} else {
				frame.pendingWord += character;
			}

			return false;
		}

		const IS_WHITESPACE = isWhitespace(character);
		const HAS_CONSTRAINT = IS_WHITESPACE && frame.pendingWord === GENERIC_CONSTRAINT_KEYWORD;

		// The whitespace run in front of the word is not the word closing, so the tracking stays open over it
		if (!IS_WHITESPACE || frame.pendingWord !== '') {
			frame.pendingWord = null;
		}

		return HAS_CONSTRAINT;
	}

	/**
	 * Leaves a tag frame whose `<` turned out to open a TypeScript generic parameter list, and reads the
	 * character that revealed it as ordinary expression input.
	 *
	 * @param character - The character that cannot belong to an attribute list.
	 * @param next - The character following it.
	 * @param index - The index of the character.
	 *
	 * @returns The step the expression frame underneath takes on the character, or `'continue'` when the frame
	 *   left behind reads markup rather than code, where the scan gives up instead.
	 */
	#escapeGenericParameterList(character: string, next: string, index: number): ScanStep {
		this.#frames.pop();
		// The `<` opened no element, so it is the comparison-shaped operator it looks like: what follows it
		// begins an operand, exactly as `a < b` does
		this.#rememberCharacter('<');

		const FRAME = this.#frames.at(-1);

		// A generic parameter list cannot sit in the text of an element: the scan is reading markup it cannot
		// follow, and must not report a later brace as the one closing the value
		if (FRAME?.kind !== 'expression') {
			this.#isDesynchronized = true;

			return 'continue';
		}

		return this.#stepExpression(FRAME, character, next, index);
	}

	/**
	 * Whether the `>` just read ends a `<Name>` that a whole-region scan must read as TypeScript rather than as an
	 * element: nothing stands between the name and the `>`, the `<` sat where an expression operand does, and no
	 * `</Name` closes it anywhere further in the region.
	 *
	 * @remarks
	 * That shape is a type parameter list or a type assertion (`type F = <T>(x: T) => T`, `<T>value`) — neither of
	 * which ever holds an attribute — and reading it as an element would take the rest of the module for its
	 * children. The scan of one attribute value never asks: an element it cannot close leaves the value unmeasured.
	 *
	 * @param frame - The opening tag frame the `>` ends.
	 * @param index - The index of the `>`.
	 *
	 * @returns `true` when the tag frame must be left without entering the children of an element.
	 */
	#isTypeParameterList(frame: TagFrame, index: number): boolean {
		const REGION = this.#region;

		if (REGION == null || frame.name === '' || this.#frames.at(-2)?.kind !== 'expression') {
			return false;
		}

		return (
			REGION.input.charAt(index - frame.name.length - 1) === '<' &&
			!REGION.closers.has({ name: frame.name, from: index, to: REGION.end })
		);
	}

	#stepTag(frame: TagFrame, character: string, next: string, index: number): ScanStep {
		const IS_NAME_OPEN = frame.isNameOpen;

		// Every character a name may hold is inert in an attribute list, so the name reads on its own
		if (IS_NAME_OPEN && this.#readElementName(frame, character)) {
			return 'continue';
		}

		// A `<` right after the name opens the type arguments of a generic element (`<Select<Option> />`)
		if (IS_NAME_OPEN && character === '<' && frame.name !== '' && !frame.isClosing) {
			this.#frames.push({
				kind: 'type-arguments',
				angleDepth: 1,
				bracketDepth: 0,
				quote: '',
				isEscaped: false,
				previousCharacter: character,
			});

			return 'continue';
		}

		// A closing tag opens no generic parameter list, and neither does an attribute list that has assigned a
		// value: past its first `=` a tag is a tag, and its unquoted values hold what they like
		const HAS_PARAMETER_LIST_SHAPE = !frame.isClosing && !frame.hasSeenAssignment;

		if (HAS_PARAMETER_LIST_SHAPE && (NON_TAG_CHARACTERS.has(character) || this.#readPendingWord(frame, character))) {
			return this.#escapeGenericParameterList(character, next, index);
		}

		if (character === '=') {
			frame.hasSeenAssignment = true;

			return 'continue';
		}

		if (character === '"' || character === "'") {
			this.#stringQuote = character;
			this.#isMarkupString = true;

			return 'continue';
		}

		// An attribute value of the element (`key={index}`, `{...props}`) is JavaScript again, starting with an operand
		if (character === '{') {
			this.#rememberCharacter('{');
			this.#frames.push({ kind: 'expression', depth: 1 });

			return 'continue';
		}

		if (character === '/' && next === '>') {
			this.#popTag();

			return 'skip-next';
		}

		if (character === '>') {
			if (!frame.isClosing && this.#isTypeParameterList(frame, index)) {
				this.#frames.pop();
				// What follows a type parameter list or a type assertion begins an operand, as after any `>`
				this.#rememberCharacter('>');

				return 'continue';
			}

			this.#popTag();

			// An opening tag is followed by the children of the element; a closing tag ends them
			if (frame.isClosing) {
				this.#closeText(frame.name);
			} else {
				this.#frames.push({ kind: 'text', name: frame.name });
			}
		}

		return 'continue';
	}

	#stepText(character: string, next: string): ScanStep {
		if (character === '{') {
			this.#rememberCharacter('{');
			this.#frames.push({ kind: 'expression', depth: 1 });

			return 'continue';
		}

		if (character !== '<') {
			return 'continue';
		}

		// The `/` of a closing tag is part of the tag rather than of the text, so it is consumed here
		if (next === '/') {
			this.#frames.push({
				kind: 'tag',
				isClosing: true,
				name: '',
				isNameOpen: true,
				hasSeenAssignment: false,
				pendingWord: '',
			});

			return 'skip-next';
		}

		if (next === '>' || isIdentifierStart(next)) {
			this.#frames.push({
				kind: 'tag',
				isClosing: false,
				name: '',
				isNameOpen: true,
				hasSeenAssignment: false,
				pendingWord: '',
			});
		}

		return 'continue';
	}

	#popTag(): void {
		this.#frames.pop();
		// An element is a value like any other: the `/` of `<A /> / 2` divides rather than opening a literal
		this.#rememberCharacter(')');
		// A `</` is no comparison against one either, since the element it would close has closed already
		this.#isAfterElement = true;
	}

	/**
	 * Ends the element a closing tag names, or gives up on the scan when it names another one.
	 *
	 * @param name - The element name the closing tag carried.
	 */
	#closeText(name: string): void {
		const FRAME = this.#frames.at(-1);

		if (FRAME?.kind !== 'text' || FRAME.name !== name) {
			this.#isDesynchronized = true;

			return;
		}

		this.#frames.pop();
	}

	#closeBrace(frame: ExpressionFrame): ScanStep {
		frame.depth--;

		if (frame.depth > 0) {
			return 'continue';
		}

		// The bottom frame is the brace the scan was started from; every nested construct sits above it, so one
		// frame left means the value itself has just closed
		if (this.#frames.length === 1) {
			if (!this.#isDesynchronized) {
				return 'closed';
			}

			// The scan lost track of the markup, so no brace can be trusted to be the one ending the value:
			// it reads on to the end of the input and the attribute is reported as one it could not measure
			frame.depth = 1;

			return 'continue';
		}

		this.#frames.pop();

		return 'continue';
	}
}

/**
 * Where one expression scan stopped reading
 */
interface ExpressionScan {
	/**
	 * Index of the brace closing the expression, or `-1` when the scan found none
	 */
	closingBraceIndex: number;
	/**
	 * How many characters the scan read from its opening brace on
	 */
	readLength: number;
}

/**
 * Scans the expression an opening brace starts, up to its closing brace or the end of the input.
 *
 * @remarks
 * A scan started inside a quoted value also stops where it loses track of the markup: its value falls back to
 * the plain read at once, and a literal `${` in the markup of a file then costs the characters up to that point
 * rather than the rest of the file — which a handful of them would otherwise spend the whole budget on.
 *
 * @param options.input - The markup being scanned.
 * @param options.openingBraceIndex - The index of the opening `{`.
 * @param options.isInQuotedValue - Whether the brace sits inside a quoted value, where it may be literal text.
 *
 * @returns The closing brace found, if any, and how much of the input the scan read.
 */
function scanExpression(options: {
	input: string;
	openingBraceIndex: number;
	isInQuotedValue: boolean;
}): ExpressionScan {
	const { input, openingBraceIndex, isInQuotedValue } = options;
	const SCANNER = new ExpressionScanner({ isInQuotedValue });

	for (let index = openingBraceIndex + 1; index < input.length; index++) {
		const STEP = SCANNER.step(input.charAt(index), input.charAt(index + 1), index);

		if (STEP === 'closed') {
			return { closingBraceIndex: index, readLength: index + 1 - openingBraceIndex };
		}

		if (isInQuotedValue && SCANNER.isDesynchronized) {
			return { closingBraceIndex: -1, readLength: index + 1 - openingBraceIndex };
		}

		if (STEP === 'skip-next') {
			index++;
		}
	}

	return { closingBraceIndex: -1, readLength: input.length - openingBraceIndex };
}

/**
 * Finds the closing brace for an `={…}` attribute value in a string of markup. Returns the index of the closing
 * brace, or `-1` if the braces are unbalanced or not found.
 *
 * @remarks
 * A regular expression cannot do this: the expression may hold a template literal whose `${…}` placeholders nest
 * further braces, and a brace inside a string, a comment, a regular expression literal or the text of a nested
 * element is text rather than structure. The scanner tracks all of them.
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
	return scanExpression({ input, openingBraceIndex, isInQuotedValue: false }).closingBraceIndex;
}

/**
 * Budget bounding the work one matcher call may spend on expression scans that find no closing brace.
 *
 * @remarks
 * A scan that fails is charged every character it read — up to the end of the input, or to where a scan in a
 * quoted value lost track of the markup — and refusing further scans once the budget runs out keeps a whole
 * matcher call linear in the length of the input. A value rejected after its expressions balanced is charged the characters it
 * read as well, since that work is thrown away just the same.
 *
 * An exhausted budget is not an error: an unquoted or `={…}` value that would need a scan is then treated
 * exactly as an unbalanced expression already is, and a quoted value reaching a mustache or a placeholder is
 * left in place — its closing quote may sit inside the expression, so no plain read can be trusted to find it.
 */
class ExpressionScanBudget {
	#remaining: number;

	constructor(inputLength: number) {
		this.#remaining = inputLength * FAILED_EXPRESSION_SCAN_BUDGET_FACTOR;
	}

	get hasBudget(): boolean {
		return this.#remaining > 0;
	}

	spend(characters: number): void {
		this.#remaining -= characters;
	}
}

/**
 * Finds the closing brace of the expression an attribute value opens — an `={…}` value, or a `{…}` / `${…}`
 * interpolated into an unquoted or a quoted one — under a matcher call's failed-scan budget.
 *
 * @param options.input - The markup being scanned.
 * @param options.openingBraceIndex - The index of the opening `{`.
 * @param options.isInQuotedValue - Whether the brace sits inside a quoted value, where it may be literal text.
 * @param options.budget - The budget of the matcher call.
 *
 * @returns The index of the matching `}`, or `-1` when it is unbalanced, the scan lost track of the markup or the
 *   budget is spent.
 */
function findBudgetedExpressionEnd(options: {
	input: string;
	openingBraceIndex: number;
	isInQuotedValue: boolean;
	budget: ExpressionScanBudget;
}): number {
	const { input, openingBraceIndex, isInQuotedValue, budget } = options;

	if (!budget.hasBudget) {
		return -1;
	}

	const SCAN = scanExpression({ input, openingBraceIndex, isInQuotedValue });

	if (SCAN.closingBraceIndex === -1) {
		budget.spend(SCAN.readLength);
	}

	return SCAN.closingBraceIndex;
}

/**
 * Half-open `[start, end)` range of characters in the original input
 */
type Range = readonly [start: number, end: number];

interface AttributeMatchOptions {
	/**
	 * Whether a quoted value may hold `{…}` mustaches, which only Svelte allows (`title="{a ? 'b' : 'c'}"`).
	 *
	 * In every other syntax a brace inside quotes is literal text, and scanning it as an expression would
	 * swallow the attributes that follow.
	 */
	hasQuotedMustache: boolean;
	/**
	 * Whether a quoted value may hold `${…}` placeholders, which a tagged template interpolates into its markup
	 * (`` html`<div title="${a ? "b" : "c"}">` ``). Default: `false`
	 *
	 * A placeholder may hold the very quote delimiting the value, so reading up to the first matching quote would
	 * cut the value inside the placeholder. An escaped `\${` opens none. A literal `${` inside a JSX string
	 * attribute, a Vue, Astro or HTML attribute, or an ordinary string literal of a script, is read as a
	 * placeholder too. Its value falls back to the plain read when the scan finds no closing brace, and when the
	 * markup it reads stops parsing as JavaScript — a string running into a newline, or an operand or a brace
	 * written right after a string (`data-testid="${" className="p"`) — so a brace of the module further on
	 * cannot close it. One whose markup keeps reading as JavaScript up to a closing brace
	 * (`data-testid="${" class="}"`) takes every attribute up to that brace with it.
	 */
	hasQuotedPlaceholder?: boolean;
	/**
	 * The kind of source the input is, which decides where an attribute may sit in it. Default: `'markup'`
	 *
	 * A configured name counts only where the {@link FileKind} places an attribute list: the opening tags of a
	 * document, the JSX elements of a script and the markup of its template literals — never text, a comment, a
	 * string (unless the matcher reads its markup), a Markdown fence or a `<style>` block.
	 */
	fileKind?: FileKind;
	/**
	 * Whether the input is an Astro component module compiled by Astro's compiler, whose template renders a dynamic
	 * attribute as a `${$$addAttribute(value, "name")}` placeholder and the props of a component or a custom element as
	 * the object literal a `${$$renderComponent(…)}` placeholder passes. Default: `false`
	 *
	 * The placeholder, or the prop, of a configured name is removed whole when the call has exactly the shape the
	 * compiler emits, and left alone otherwise. The module is JavaScript without JSX whose markup sits in template
	 * literals, which the `ts` kind reads.
	 */
	isCompiledAstro?: boolean;
}

/**
 * How a matcher is compiled, once per plugin instance
 */
interface AttributeMatcherOptions {
	/**
	 * Whether a `'` or `"` string of script code holding closed markup is read as that markup, so that its attributes
	 * are removed too
	 */
	removeInStrings: boolean;
}

/**
 * What one matcher call found in a markup string
 */
interface AttributeMatchResult {
	/**
	 * The sorted, non-overlapping ranges of every configured attribute that can be removed
	 */
	ranges: Range[];
	/**
	 * The name-start index of every configured attribute left in place because its value could not be measured
	 */
	skipped: number[];
}

/**
 * Finds every configured attribute in a markup string, both the removable ones and those left in place
 */
type AttributeMatcher = (input: string, options: AttributeMatchOptions) => AttributeMatchResult;

/**
 * The two indices a removal range may start at
 */
interface AttributeStart {
	/**
	 * Index of the binding prefix, or of the name itself when there is none
	 */
	prefixStart: number;
	/**
	 * Index where the whitespace run in front of the attribute begins
	 */
	whitespaceStart: number;
}

/**
 * Walks back from an attribute-name match over an optional `:` / `v-bind:` binding prefix and the whitespace
 * run that may precede it.
 *
 * @remarks
 * What precedes the prefix must separate the attribute from the one before it: a whitespace run, or one of the
 * {@link ATTRIBUTE_BOUNDARY_CHARACTERS} closing the previous value with nothing in between. Any other
 * character means the name merely ends a longer one (`xdata-testid`, `foo-data-testid`), which never matches.
 * Both starts are reported because whether the whitespace run joins the range depends on what follows the
 * attribute, which the caller alone knows.
 *
 * @param input - The markup being scanned.
 * @param nameStart - Index of the first character of the matched name.
 *
 * @returns The two candidate start indices, or `null` when the match is not a standalone attribute.
 */
function findAttributeStart(input: string, nameStart: number): AttributeStart | null {
	let prefixStart = nameStart;

	for (const PREFIX of BINDING_PREFIXES) {
		if (
			prefixStart >= PREFIX.length &&
			input.slice(prefixStart - PREFIX.length, prefixStart).toLowerCase() === PREFIX
		) {
			prefixStart -= PREFIX.length;
			break;
		}
	}

	if (prefixStart === 0) {
		return null;
	}

	const PRECEDING_CHARACTER = input.charAt(prefixStart - 1);

	// A value closing right against the name leaves nothing in front of the attribute to consume
	if (!isWhitespace(PRECEDING_CHARACTER)) {
		return ATTRIBUTE_BOUNDARY_CHARACTERS.has(PRECEDING_CHARACTER)
			? { prefixStart, whitespaceStart: prefixStart }
			: null;
	}

	let whitespaceStart = prefixStart;

	while (whitespaceStart > 0 && isWhitespace(input.charAt(whitespaceStart - 1))) {
		whitespaceStart--;
	}

	return { prefixStart, whitespaceStart };
}

/**
 * Whether the character at the given index already separates an attribute from whatever follows it.
 *
 * @param input - The markup being scanned.
 * @param index - Index just past the attribute.
 *
 * @returns `true` for whitespace, `/`, `>` and the end of the input.
 */
function hasSeparatorAt(input: string, index: number): boolean {
	const CHARACTER = input.charAt(index);

	return CHARACTER === '' || CHARACTER === '/' || CHARACTER === '>' || isWhitespace(CHARACTER);
}

/**
 * Finds the index just past the closing quote of a quoted value, reading the value as plain text.
 *
 * @param input - The markup being scanned.
 * @param quoteIndex - Index of the opening quote.
 *
 * @returns The index just past the closing quote, or `-1` when the value is never closed.
 */
function findPlainQuotedValueEnd(input: string, quoteIndex: number): number {
	const CLOSING_QUOTE_INDEX = input.indexOf(input.charAt(quoteIndex), quoteIndex + 1);

	return CLOSING_QUOTE_INDEX === -1 ? -1 : CLOSING_QUOTE_INDEX + 1;
}

/**
 * Finds the index just past the closing quote of a quoted value, stepping over Svelte mustaches and
 * tagged-template placeholders when the syntax allows them.
 *
 * @remarks
 * An expression that does not balance, or whose markup stops reading as JavaScript before it does, means the
 * brace was literal text rather than an expression, and the value is read as plain text instead. One the spent
 * budget no longer lets the scan measure leaves the attribute in place: its closing quote may sit inside the
 * expression, where a plain read would cut the value.
 *
 * @param options.input - The markup being scanned.
 * @param options.quoteIndex - Index of the opening quote.
 * @param options.hasQuotedMustache - Whether a `{…}` inside the value opens a JavaScript expression.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside the value opens a JavaScript expression.
 * @param options.budget - The failed-scan budget of the matcher call.
 *
 * @returns The index just past the closing quote, or `-1` when the value is never closed or cannot be measured.
 */
function findQuotedValueEnd(options: {
	input: string;
	quoteIndex: number;
	hasQuotedMustache: boolean;
	hasQuotedPlaceholder: boolean;
	budget: ExpressionScanBudget;
}): number {
	const { input, quoteIndex, hasQuotedMustache, hasQuotedPlaceholder, budget } = options;

	if (!hasQuotedMustache && !hasQuotedPlaceholder) {
		return findPlainQuotedValueEnd(input, quoteIndex);
	}

	const QUOTE = input.charAt(quoteIndex);

	for (let index = quoteIndex + 1; index < input.length; index++) {
		const CHARACTER = input.charAt(index);
		const NEXT = input.charAt(index + 1);

		if (CHARACTER === QUOTE) {
			return index + 1;
		}

		// Inside a template literal a backslash escapes the `$` or the backslash after it, so `\${` opens no
		// placeholder while `\\${` still does
		if (hasQuotedPlaceholder && CHARACTER === '\\' && (NEXT === '$' || NEXT === '\\')) {
			index++;

			continue;
		}

		const IS_PLACEHOLDER = hasQuotedPlaceholder && CHARACTER === '$' && NEXT === '{';

		if (!IS_PLACEHOLDER && !(hasQuotedMustache && CHARACTER === '{')) {
			continue;
		}

		if (!budget.hasBudget) {
			return -1;
		}

		const CLOSING_BRACE_INDEX = findBudgetedExpressionEnd({
			input,
			openingBraceIndex: IS_PLACEHOLDER ? index + 1 : index,
			isInQuotedValue: true,
			budget,
		});

		if (CLOSING_BRACE_INDEX === -1) {
			return findPlainQuotedValueEnd(input, quoteIndex);
		}

		index = CLOSING_BRACE_INDEX;
	}

	budget.spend(input.length - quoteIndex);

	return -1;
}

/**
 * Finds the index just past an unquoted value, which may interpolate expressions into its text.
 *
 * @remarks
 * A `${` opens the placeholder a tagged template interpolates part of an unquoted value from (`` html`<div
 * data-testid=${id}>` ``), and a bare `{` the expression Svelte interpolates the same way (`data-testid=a{b}`)
 * — or the `$\{…}` a compiled Solid template escapes a literal `${` into. A value takes as many of them as it
 * likes (`data-testid=${a}-${b}`), so it is read run by run until the attribute ends at a separator. A `$` that
 * opens no placeholder is an ordinary character of such a run, which `data-testid=$foo` keeps. Only a value
 * starting with `{` ends at its own brace, and that `={…}` form never reaches this function.
 *
 * A run stopping anywhere but at a separator, or an expression that does not balance, means the value does not
 * read as one: the attribute is left in place rather than cut at a character that is not its end, which would
 * leave the rest of the value behind as markup of its own (`<i {b} class="k">`).
 *
 * @param options.input - The markup being scanned.
 * @param options.valueStart - Index of the first character of the value.
 * @param options.budget - The failed-scan budget of the matcher call.
 *
 * @returns The index just past the value, or `-1` when no value can be read.
 */
function findUnquotedValueEnd(options: { input: string; valueStart: number; budget: ExpressionScanBudget }): number {
	const { input, valueStart, budget } = options;
	let index = valueStart;

	// The end of the input separates as surely as whitespace does, so the run count is bounded by its length
	while (!hasSeparatorAt(input, index)) {
		const CHARACTER = input.charAt(index);
		const IS_PLACEHOLDER = CHARACTER === '$' && input.charAt(index + 1) === '{';

		if (IS_PLACEHOLDER || CHARACTER === '{') {
			const CLOSING_BRACE_INDEX = findBudgetedExpressionEnd({
				input,
				openingBraceIndex: IS_PLACEHOLDER ? index + 1 : index,
				isInQuotedValue: false,
				budget,
			});

			if (CLOSING_BRACE_INDEX !== -1) {
				index = CLOSING_BRACE_INDEX + 1;

				continue;
			}
		} else {
			UNQUOTED_VALUE_REGEX.lastIndex = index;

			if (UNQUOTED_VALUE_REGEX.test(input)) {
				index = UNQUOTED_VALUE_REGEX.lastIndex;

				continue;
			}
		}

		// The expressions read so far balanced for free, and a value rejected after them must not be: one spanning
		// the next attribute would otherwise be rescanned by every one of them. A failed scan charged its own part
		budget.spend(index - valueStart);

		return -1;
	}

	return index === valueStart ? -1 : index;
}

/**
 * Finds the index just past the value that follows `name=`, whichever form the value takes.
 *
 * @remarks
 * An `={…}` value ends at its own closing brace, whatever follows it — a minifier writes the next attribute
 * right against it. Every other unquoted form is read by {@link findUnquotedValueEnd}.
 *
 * @param options.input - The markup being scanned.
 * @param options.valueStart - Index of the first character of the value.
 * @param options.hasQuotedMustache - Whether a `{…}` inside a quoted value opens a JavaScript expression.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside a quoted value opens a JavaScript expression.
 * @param options.budget - The failed-scan budget of the matcher call.
 *
 * @returns The index just past the value, or `-1` when no value can be read.
 */
function findValueEnd(options: {
	input: string;
	valueStart: number;
	hasQuotedMustache: boolean;
	hasQuotedPlaceholder: boolean;
	budget: ExpressionScanBudget;
}): number {
	const { input, valueStart, hasQuotedMustache, hasQuotedPlaceholder, budget } = options;
	const CHARACTER = input.charAt(valueStart);

	if (CHARACTER === '"' || CHARACTER === "'" || CHARACTER === '`') {
		return findQuotedValueEnd({ input, quoteIndex: valueStart, hasQuotedMustache, hasQuotedPlaceholder, budget });
	}

	if (CHARACTER === '{') {
		const CLOSING_BRACE_INDEX = findBudgetedExpressionEnd({
			input,
			openingBraceIndex: valueStart,
			isInQuotedValue: false,
			budget,
		});

		// An unbalanced expression means the source does not parse as written: leave it alone rather than
		// cutting the file at an arbitrary point
		return CLOSING_BRACE_INDEX === -1 ? -1 : CLOSING_BRACE_INDEX + 1;
	}

	return findUnquotedValueEnd({ input, valueStart, budget });
}

/**
 * Where an attribute ends, and whether the name was an attribute at all
 */
interface AttributeEnd {
	/**
	 * Index just past the attribute, or `-1` when no end can be read
	 */
	index: number;
	/**
	 * Whether the name is a standalone attribute, however its value turned out to read
	 */
	isAttribute: boolean;
}

/**
 * Finds the index just past an attribute whose name has already been matched.
 *
 * @remarks
 * A bound name may carry Vue modifiers (`:data-testid.attr`), which are part of the attribute and are consumed
 * before its value. Without a binding prefix they are not modifiers at all, so `data-testid.attr` stays the
 * unrelated name it reads as.
 *
 * An assignment is what makes the hit an attribute even when its value cannot be read: a name followed by
 * neither `=` nor a separator only prefixes a longer name (`data-testid-extra`) and is no attribute to begin
 * with. Telling the two apart is what keeps the plugin from warning about names it was never asked to touch.
 *
 * @param options.input - The markup being scanned.
 * @param options.nameEnd - Index just past the last character of the matched name.
 * @param options.hasBindingPrefix - Whether the name carries a `:` or `v-bind:` prefix.
 * @param options.hasQuotedMustache - Whether a `{…}` inside a quoted value opens a JavaScript expression.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside a quoted value opens a JavaScript expression.
 * @param options.budget - The failed-scan budget of the matcher call.
 *
 * @returns The index just past the attribute, and whether the hit is an attribute at all.
 */
function findAttributeEnd(options: {
	input: string;
	nameEnd: number;
	hasBindingPrefix: boolean;
	hasQuotedMustache: boolean;
	hasQuotedPlaceholder: boolean;
	budget: ExpressionScanBudget;
}): AttributeEnd {
	const { input, nameEnd, hasBindingPrefix, hasQuotedMustache, hasQuotedPlaceholder, budget } = options;

	BINDING_MODIFIERS_REGEX.lastIndex = nameEnd;

	// Modifiers are optional: with no `.` right after the name the sticky pattern does not match, and the
	// attribute simply ends where its name does
	const TAIL_START =
		hasBindingPrefix && BINDING_MODIFIERS_REGEX.test(input) ? BINDING_MODIFIERS_REGEX.lastIndex : nameEnd;

	ASSIGNMENT_REGEX.lastIndex = TAIL_START;

	if (ASSIGNMENT_REGEX.test(input)) {
		// Dropping the name alone would leave a dangling `=` behind, so an unreadable value keeps the whole
		// attribute
		return {
			index: findValueEnd({
				input,
				valueStart: ASSIGNMENT_REGEX.lastIndex,
				hasQuotedMustache,
				hasQuotedPlaceholder,
				budget,
			}),
			isAttribute: true,
		};
	}

	// A bare attribute ends where the name ends: anything else means the name only prefixes a longer one
	return BARE_ATTRIBUTE_END_REGEX.test(input.charAt(TAIL_START))
		? { index: TAIL_START, isAttribute: true }
		: { index: -1, isAttribute: false };
}

/**
 * What one attribute-name hit resolves to
 */
interface AttributeHit {
	/**
	 * The `[start, end)` range to remove, or `null` when nothing can be removed for this hit
	 */
	range: Range | null;
	/**
	 * Whether the hit is an attribute left in place because its value could not be measured, as opposed to a
	 * name that is not an attribute at all
	 */
	isSkipped: boolean;
}

/**
 * Reads one range of a list at an index the caller knows to be in range.
 *
 * @param ranges - The ranges.
 * @param index - An index below the length of the list.
 *
 * @returns The range at the index.
 *
 * @throws When the index is out of range, which is a bug of the caller.
 */
function readRange(ranges: readonly Range[], index: number): Range {
	const RANGE = ranges[index];

	/* v8 ignore next 3 -- offensive invariant: every caller reads an index below the length of the list */
	if (RANGE == null) {
		throw new Error(`remove-attributes: range index ${index} is out of range`);
	}

	return RANGE;
}

/**
 * Finds the string read as markup whose content holds an index.
 *
 * @param markupStrings - The content range of every string read as markup, ascending and disjoint.
 * @param index - The index to look up.
 *
 * @returns The content range holding the index, or `null` when the index sits in no such string.
 */
function findEnclosingMarkupString(markupStrings: readonly Range[], index: number): Range | null {
	let low = 0;
	let high = markupStrings.length;

	// The ranges are ascending, so the halving settles on the first one starting past `index`
	while (low < high) {
		const MIDDLE = Math.floor((low + high) / 2);

		if (readRange(markupStrings, MIDDLE)[0] <= index) {
			low = MIDDLE + 1;
		} else {
			high = MIDDLE;
		}
	}

	if (low === 0) {
		return null;
	}

	const CANDIDATE = readRange(markupStrings, low - 1);

	return index < CANDIDATE[1] ? CANDIDATE : null;
}

/**
 * Turns one attribute-name hit into the range to remove.
 *
 * @remarks
 * The whitespace run in front of the attribute joins the range so that removing an attribute written on its
 * own line leaves no blank line behind — unless nothing separates the attribute from what follows it
 * (`data-testid="a"class="b"`), where taking the whitespace as well would fuse the two neighbors into one
 * token.
 *
 * A hit whose name reads as an attribute but whose value does not parse (an unbalanced `={…}`, an unterminated
 * quoted value, a spent scan budget) is reported as skipped rather than silently dropped, so the plugin can
 * tell the consumer which attributes it had to leave in the output.
 *
 * An attribute of a string read as markup must end inside that string. The mask only marks a string whose markup
 * closes in it, but the value is measured by {@link findAttributeEnd}, which may read further: a Svelte mustache
 * (`'<b data-testid="{">'`) scans on as JavaScript past the closing quote. When no later `}` closes it, the value
 * falls back to the plain read, which ends inside the string, and the attribute is removed. When one does
 * (`'<b data-testid="{">'; x = "}";`), the value ends past the string, and the hit is skipped rather than removed
 * along with the code after the string.
 *
 * @param options.input - The markup being scanned.
 * @param options.nameStart - Index of the first character of the matched name.
 * @param options.nameEnd - Index just past the last character of the matched name.
 * @param options.hasQuotedMustache - Whether a `{…}` inside a quoted value opens a JavaScript expression.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside a quoted value opens a JavaScript expression.
 * @param options.budget - The failed-scan budget of the matcher call.
 * @param options.tagMask - The tag mask of the input, which a hit counts in only where it starts an attribute.
 *
 * @returns The range to remove and whether the hit was an unreadable attribute.
 */
function toAttributeHit(options: {
	input: string;
	nameStart: number;
	nameEnd: number;
	hasQuotedMustache: boolean;
	hasQuotedPlaceholder: boolean;
	budget: ExpressionScanBudget;
	tagMask: TagMask;
}): AttributeHit {
	const { input, nameStart, nameEnd, hasQuotedMustache, hasQuotedPlaceholder, budget, tagMask } = options;
	const START = findAttributeStart(input, nameStart);

	// A name outside the attribute list of an opening tag is text, a comment, a string or a value — not an attribute
	if (START == null || tagMask.positions[START.prefixStart] !== TAG_POSITION) {
		return { range: null, isSkipped: false };
	}

	const END = findAttributeEnd({
		input,
		nameEnd,
		hasBindingPrefix: START.prefixStart !== nameStart,
		hasQuotedMustache,
		hasQuotedPlaceholder,
		budget,
	});

	if (END.index === -1) {
		return { range: null, isSkipped: END.isAttribute };
	}

	const RANGE: Range = [hasSeparatorAt(input, END.index) ? START.whitespaceStart : START.prefixStart, END.index];
	const MARKUP_STRING = findEnclosingMarkupString(tagMask.markupStrings, START.prefixStart);
	const IS_CROSSING_STRING_BOUNDARY =
		MARKUP_STRING != null && (RANGE[0] < MARKUP_STRING[0] || RANGE[1] > MARKUP_STRING[1]);

	if (IS_CROSSING_STRING_BOUNDARY) {
		return { range: null, isSkipped: true };
	}

	return { range: RANGE, isSkipped: false };
}

/**
 * Fails fast when a range would break the ordering {@link removeRanges} and the sourcemap generator rely on.
 *
 * @remarks
 * Both consumers cut the input in one forward pass, so an empty, reversed or overlapping range would silently
 * corrupt the emitted code and its sourcemap. The matcher produces ranges in source order by construction:
 * a violation is a bug in this module, not bad input.
 *
 * @param ranges - The ranges collected so far.
 * @param range - The range about to be collected.
 *
 * @throws When `range` is empty or starts before the previous range ends.
 */
function assertRangeFollowsPrevious(ranges: readonly Range[], range: Range): void {
	if (range[0] >= range[1]) {
		throw new Error(`remove-attributes: empty removal range [${range[0]}, ${range[1]})`);
	}

	const PREVIOUS = ranges.at(-1);

	if (PREVIOUS != null && range[0] < PREVIOUS[1]) {
		throw new Error(
			`remove-attributes: removal range [${range[0]}, ${range[1]}) overlaps [${PREVIOUS[0]}, ${PREVIOUS[1]})`,
		);
	}
}

// ─── Regions ──────────────────────────────────────────────────────────────────

/**
 * Source kind, which decides where an attribute may sit in a file.
 *
 * @remarks
 * - `script`: a JavaScript or JSX module. Attributes sit in the opening tags of its JSX elements and of the markup
 *   its template literals hold; its strings, comments, regular expressions and JSX text are left alone — except the
 *   closed markup of an Angular `template:` string, and of every string once `removeInStrings` is on.
 * - `ts`: a `.ts`, `.mts` or `.cts` module, read as `script` except that no `<` ever opens a JSX element, which
 *   TypeScript forbids there — a type assertion (`<T>value`) never turns the code after it into element text.
 * - `markup`: a component document (`.svelte`, and every unrecognized extension). Attributes sit in its opening
 *   tags; its `<script>` blocks and `{…}` expressions are read as `script`, while its text, comments, `<style>`
 *   blocks and leading `---` front matter are left alone.
 * - `vue`: a `.vue` component, read as `markup` except that a single `{` opens nothing: only a `{{ … }}`
 *   interpolation is an expression.
 * - `markdown`: a Markdown-based template (`.md`, `.mdx`, `.svx`), read as `markup` except that a fenced code
 *   block is text, whatever it holds.
 * - `astro`: a `markup` document whose leading `---` fence holds the TypeScript of the component.
 * - `html`: a document where a `{` is text and only a JavaScript `<script>` block is code.
 */
type FileKind = 'astro' | 'html' | 'markdown' | 'markup' | 'script' | 'ts' | 'vue';

/**
 * What a `<script>` block holds, as far as finding attributes goes: JavaScript, with or without JSX, markup (a
 * template a script reads, or the rest of a document when the tag closes itself), or data no attribute sits in
 */
type ScriptContent = 'code' | 'data' | 'document' | 'jsx';

/**
 * How the tag mask of one file is built
 */
interface TagMaskOptions {
	fileKind: FileKind;
	hasQuotedMustache: boolean;
	hasQuotedPlaceholder: boolean;
	/**
	 * Whether every `'` or `"` string of script code holding closed markup is read as that markup
	 */
	shouldReadMarkupStrings: boolean;
}

/**
 * Where the attribute lists of one file sit
 */
interface TagMask {
	/**
	 * One byte per character, {@link TAG_POSITION} for a character of an attribute list,
	 * {@link TAG_PLACEHOLDER_POSITION} / {@link TEXT_PLACEHOLDER_POSITION} for the `$` of a template-literal placeholder
	 * in an attribute list / in text, and `0` for any other
	 */
	positions: Uint8Array;
	/**
	 * The content range of every `'` or `"` string read as markup — from just past its opening quote to its closing
	 * quote — ascending and disjoint, which no removal may reach past
	 */
	markupStrings: Range[];
}

/**
 * Where the reading of one part of an opening tag stopped
 */
interface TagRead {
	/**
	 * Index just past the part, or — when the tag cannot be read any further — the index the document scan resumes at
	 */
	index: number;
	/**
	 * Whether the rest of the tag can still be read
	 */
	isReadable: boolean;
}

/**
 * A markup opening tag, from its `<` to its `>`
 */
interface OpeningTag {
	/**
	 * Lower-cased name
	 */
	name: string;
	/**
	 * Index just past the `>`, or the index the document scan resumes at when the tag cannot be read to its end
	 */
	end: number;
	isComplete: boolean;
	isSelfClosing: boolean;
	/**
	 * The first value written for each attribute, keyed by lower-cased name, empty for a bare or `{…}` one
	 */
	attributes: Map<string, string>;
}

/**
 * Returns the lower-cased extension of a module ID, its query and hash left out.
 *
 * @param id - The module ID.
 *
 * @returns The extension, or the empty string when the path has none.
 */
function getExtension(id: string): string {
	const PATH = stripQuery(id);
	const DOT_INDEX = PATH.lastIndexOf('.');

	return DOT_INDEX === NOT_FOUND ? '' : PATH.slice(DOT_INDEX + 1).toLowerCase();
}

/**
 * Reports whether the module is the `<script>` block a framework plugin split out of a component file.
 *
 * @remarks
 * `App.vue?vue&type=script&setup=true&lang.ts` and `Page.astro?astro&type=script&index=0&lang.ts` keep the extension of
 * the component they come from but hold its plain script. The query is split into parameters before being read, so
 * that a parameter spelled `mytype=script` cannot pass for one of them.
 *
 * @param id - The module ID, possibly including a `?query` suffix.
 *
 * @returns `true` when the module holds the code of a component's `<script>` block.
 */
function isFrameworkScriptRequest(id: string): boolean {
	const QUERY_INDEX = id.indexOf('?');

	if (QUERY_INDEX === NOT_FOUND) {
		return false;
	}

	const PARAMETERS = id.slice(QUERY_INDEX + 1).split('&');

	return (
		PARAMETERS.includes(SCRIPT_TYPE_PARAMETER) &&
		PARAMETERS.some((parameter) => FRAMEWORK_SCRIPT_MARKERS.has(parameter))
	);
}

/**
 * Classifies a module ID as one of the {@link FileKind} values.
 *
 * @remarks
 * The inline `<script>` of an HTML entry comes back through `transform` under the page's ID plus an `html-proxy`
 * query, and a framework plugin hands a component's `<script>` block back under the component's ID plus a
 * `type=script` query: both hold plain JavaScript, so they resolve as `script`. A compound name resolves on its final
 * extension (`Counter.svelte.ts` is a `ts` module), and an extension no preset names resolves as `markup`, the kind
 * that edits the least.
 *
 * @param id - The module ID, possibly including a `?query` suffix.
 *
 * @returns The kind of source the module holds.
 */
function getFileKind(id: string): FileKind {
	if ((HTML_PROXY_REGEX.test(id) && id.endsWith(HTML_PROXY_SCRIPT_SUFFIX)) || isFrameworkScriptRequest(id)) {
		return 'script';
	}

	const EXTENSION = getExtension(id);

	if (JSX_SCRIPT_EXTENSION_SET.has(EXTENSION)) {
		return 'script';
	}

	if (TYPESCRIPT_EXTENSION_SET.has(EXTENSION)) {
		return 'ts';
	}

	if (HTML_EXTENSION_SET.has(EXTENSION)) {
		return 'html';
	}

	if (ASTRO_EXTENSION_SET.has(EXTENSION)) {
		return 'astro';
	}

	if (VUE_EXTENSION_SET.has(EXTENSION)) {
		return 'vue';
	}

	return MARKDOWN_EXTENSION_SET.has(EXTENSION) ? 'markdown' : 'markup';
}

/**
 * Returns the index just past a sticky regular expression matched at an index, which a sticky pattern able to match
 * the empty string always does.
 *
 * @param regex - A sticky (`y`) regular expression.
 * @param input - The source.
 * @param index - The index the match must start at.
 *
 * @returns The index just past the match.
 */
function findStickyMatchEnd(regex: RegExp, input: string, index: number): number {
	regex.lastIndex = index;
	regex.test(input);

	return regex.lastIndex;
}

function skipWhitespace(input: string, fromIndex: number): number {
	let index = fromIndex;

	while (index < input.length && isWhitespace(input.charAt(index))) {
		index++;
	}

	return index;
}

/**
 * Finds the next occurrence of a `</script` or `</style` closer, matched case-insensitively.
 *
 * @remarks
 * Only `<` positions are compared, and they are compared on the original source rather than on a lower-cased copy,
 * whose offsets may differ (`'İ'.toLowerCase()` takes two code units).
 *
 * @param options.input - The document source.
 * @param options.closer - The lower-cased closer, from its `<` to the end of its name.
 * @param options.fromIndex - The index to start searching at.
 *
 * @returns The index of the closer's `<`, or `-1` when the source holds no further occurrence.
 */
function findTagNameIndex(options: { input: string; closer: string; fromIndex: number }): number {
	const { input, closer, fromIndex } = options;

	let index = input.indexOf('<', fromIndex);

	while (index !== NOT_FOUND) {
		if (input.slice(index, index + closer.length).toLowerCase() === closer) {
			return index;
		}

		index = input.indexOf('<', index + 1);
	}

	return NOT_FOUND;
}

/**
 * Finds the closing tag of a raw-text block (`</script>`, `</style>`), which HTML lets hold whitespace between its
 * name and its `>` and nothing else.
 *
 * @param options.input - The document source.
 * @param options.closer - The lower-cased closer, from its `<` to the end of its name.
 * @param options.fromIndex - The index the block's content starts at.
 *
 * @returns The `[start, end)` range of the closing tag, or `null` when the block is never closed.
 */
function findTagCloser(options: { input: string; closer: string; fromIndex: number }): Range | null {
	const { input, closer, fromIndex } = options;

	let index = findTagNameIndex({ input, closer, fromIndex });

	while (index !== NOT_FOUND) {
		const END = skipWhitespace(input, index + closer.length);

		if (input.charAt(END) === '>') {
			return [index, END + 1];
		}

		index = findTagNameIndex({ input, closer, fromIndex: index + 1 });
	}

	return null;
}

/**
 * Tells what the body of a `<script>` block holds, from the attributes of its opening tag.
 *
 * @remarks
 * A tag with no `type`, an empty one, `module` or a JavaScript MIME type holds code — compared on the MIME essence, so
 * `text/javascript; charset=utf-8` still does — and `lang="jsx"` / `lang="tsx"`, `text/babel` or `text/jsx` let that
 * code hold JSX. A template type (`text/x-template`, `text/html`) holds markup, read like the rest of the document;
 * any other type (`application/json`, `importmap`) holds data, and so does the ignored body of a tag carrying `src`.
 * A tag closing itself has no body at all, so the document simply goes on after it.
 *
 * @param tag - The opening tag of the block.
 *
 * @returns What the body holds.
 */
function getScriptContent(tag: OpeningTag): ScriptContent {
	if (tag.isSelfClosing) {
		return 'document';
	}

	if (tag.attributes.has('src')) {
		return 'data';
	}

	const TYPE = tag.attributes.get('type') ?? '';
	const PARAMETERS_INDEX = TYPE.indexOf(';');
	const ESSENCE = (PARAMETERS_INDEX === NOT_FOUND ? TYPE : TYPE.slice(0, PARAMETERS_INDEX)).trim().toLowerCase();

	if (ESSENCE !== '' && !JAVASCRIPT_SCRIPT_TYPES.has(ESSENCE)) {
		return ESSENCE === 'text/html' || ESSENCE.endsWith('template') ? 'document' : 'data';
	}

	const LANGUAGE = (tag.attributes.get('lang') ?? '').trim().toLowerCase();

	return JSX_SCRIPT_TYPES.has(ESSENCE) || JSX_SCRIPT_LANGUAGES.has(LANGUAGE) ? 'jsx' : 'code';
}

/**
 * Returns the text of an attribute value, without the quotes delimiting it.
 *
 * @param value - The value as written, quotes included — a quoted one always ends on its closing quote.
 *
 * @returns The value's text.
 */
function unquoteValue(value: string): string {
	const QUOTE = value.charAt(0);

	return QUOTE === '"' || QUOTE === "'" ? value.slice(1, -1) : value;
}

/**
 * Classifies the `${` of a placeholder by where it stands in the markup of its template literal.
 *
 * @param state - Where the reading of the markup stands at the `$`, `undefined` outside the text of a template literal.
 * @param previousCharacter - The character in front of the `$`.
 *
 * @returns {@link TAG_PLACEHOLDER_POSITION} in the attribute list of an opening tag — never in place of its name —,
 *   {@link TEXT_PLACEHOLDER_POSITION} in text, `0` anywhere else.
 */
function getPlaceholderPosition(state: MarkupState | undefined, previousCharacter: string): number {
	if (state === 'text') {
		return TEXT_PLACEHOLDER_POSITION;
	}

	const IS_IN_ATTRIBUTE_LIST = state === 'attributes' || (state === 'tag-name' && previousCharacter !== '<');

	return IS_IN_ATTRIBUTE_LIST ? TAG_PLACEHOLDER_POSITION : 0;
}

/**
 * Reads one region of code — a module, a `<script>` block, an Astro frontmatter or a `{…}` expression — marking in
 * the mask every character that sits in the attribute list of an opening tag, and the `$` of every placeholder its
 * template literals interpolate into the attribute list or the text of their markup.
 *
 * @remarks
 * The region is read by an {@link ExpressionScanner}, which already follows JavaScript, JSX and the elements an
 * expression holds, and which additionally reads the markup of every template literal here. A module may hold a `}`
 * that balances nothing: the scan then starts over on the code after it, which a fresh scanner reads exactly as it
 * reads the start of a module. A scan that loses track of the markup stops marking, so that nothing it reads
 * afterward can pass for a tag.
 *
 * @param options.input - The source.
 * @param options.mask - The tag mask to mark, and to record the strings read as markup in.
 * @param options.start - The index the region starts at.
 * @param options.end - The exclusive end of the region.
 * @param options.hasJsx - Whether a `<` at an operand position may open a JSX element.
 * @param options.isSlot - Whether the region is the expression the brace in front of `start` opens, which ends at
 *   the brace closing it.
 * @param options.closers - The closing tags of the source.
 * @param options.shouldReadMarkupStrings - Whether every `'` or `"` string holding closed markup is read as that
 *   markup.
 *
 * @returns For a slot, the index of the brace closing it; `-1` when the scan reached the end of the region or lost
 *   track of the markup, and for every region that is not a slot.
 */
function markCodeRegion(options: {
	input: string;
	mask: TagMask;
	start: number;
	end: number;
	hasJsx: boolean;
	isSlot: boolean;
	closers: ClosingTagIndex;
	shouldReadMarkupStrings: boolean;
}): number {
	const { input, mask, start, end, hasJsx, isSlot, closers, shouldReadMarkupStrings } = options;
	const POSITIONS = mask.positions;
	const REGION: RegionReading = {
		input,
		end,
		hasJsx,
		closers,
		shouldReadMarkupStrings,
		markupStrings: mask.markupStrings,
	};

	let scanner = new ExpressionScanner({ isInQuotedValue: false, region: REGION });

	for (let index = start; index < end; index++) {
		const CHARACTER = input.charAt(index);
		const NEXT = index + 1 < end ? input.charAt(index + 1) : '';

		if (scanner.isAtAttributePosition) {
			POSITIONS[index] = TAG_POSITION;
		}

		if (CHARACTER === '$' && NEXT === '{') {
			const PLACEHOLDER_POSITION = getPlaceholderPosition(scanner.templateMarkup?.state, input.charAt(index - 1));

			if (PLACEHOLDER_POSITION !== 0) {
				POSITIONS[index] = PLACEHOLDER_POSITION;
			}
		}

		const STEP = scanner.step(CHARACTER, NEXT, index);

		if (scanner.isDesynchronized) {
			return NOT_FOUND;
		}

		if (STEP === 'closed') {
			if (isSlot) {
				return index;
			}

			scanner = new ExpressionScanner({ isInQuotedValue: false, region: REGION });
		} else if (STEP === 'skip-next') {
			index++;
		}
	}

	return NOT_FOUND;
}

/**
 * Single forward pass over a document (`markup`, `vue`, `markdown`, `astro` or `html`), marking in the mask the
 * attribute names of every opening tag and handing every region of code to {@link markCodeRegion}.
 *
 * @remarks
 * The regions of code are the Astro frontmatter, the body of every `<script>` block holding JavaScript, and — outside
 * `html` — every `{…}` expression: in the text or a tag (`markup`, `markdown`, `astro`, where a Svelte block tag has
 * its sigil and name skipped and a closing one holds no expression), or a `{{ … }}` interpolation (`vue`). Everything
 * else that is not an opening tag stays unmarked: text, `<!-- … -->` comments, closing tags and declarations, the body
 * of a `<style>` block and of a data `<script>`, a leading `---` front matter, and in `markdown` every fenced code
 * block.
 *
 * Attribute values are measured by {@link findValueEnd}, the very reader the matcher measures a configured
 * attribute with, so the two agree on where every value ends; a `{…}` value outside `html` and `vue` is a region of
 * code instead, so that the elements it holds are read too. A value that cannot be measured is stepped over the plain
 * way, so that the attributes after it are still read.
 *
 * The pass stays linear. Values are measured under a failed-scan budget of their own, a slot that never closes
 * disables every later slot and unmarks what its scan read, and a raw-text closer a search proved absent is never
 * searched again.
 */
class DocumentTagScanner {
	readonly #input: string;
	readonly #mask: TagMask;
	readonly #fileKind: FileKind;
	readonly #hasQuotedMustache: boolean;
	readonly #hasQuotedPlaceholder: boolean;
	readonly #shouldReadMarkupStrings: boolean;
	readonly #budget: ExpressionScanBudget;
	readonly #closers: ClosingTagIndex;
	/**
	 * Smallest index the document is known to hold no closer from, per closer
	 */
	readonly #noCloserFrom = new Map<string, number>();
	/**
	 * Whether a `{` may still open an expression: never in `html`, and no longer once a slot failed to close
	 */
	#hasSlots: boolean;

	constructor(input: string, mask: TagMask, options: TagMaskOptions) {
		this.#input = input;
		this.#mask = mask;
		this.#fileKind = options.fileKind;
		this.#hasQuotedMustache = options.hasQuotedMustache;
		this.#hasQuotedPlaceholder = options.hasQuotedPlaceholder;
		this.#shouldReadMarkupStrings = options.shouldReadMarkupStrings;
		this.#budget = new ExpressionScanBudget(input.length);
		this.#closers = new ClosingTagIndex(input);
		this.#hasSlots = options.fileKind !== 'html';
	}

	scan(): void {
		const INPUT = this.#input;
		const HAS_CODE_FENCES = this.#fileKind === 'markdown';

		let index = this.#skipFrontMatter();

		while (index < INPUT.length) {
			const CHARACTER = INPUT.charAt(index);
			const IS_LINE_START = index === 0 || INPUT.charAt(index - 1) === '\n';
			const FENCE_END = HAS_CODE_FENCES && IS_LINE_START ? this.#findCodeFenceEnd(index) : NOT_FOUND;

			let nextIndex = index + 1;

			if (FENCE_END !== NOT_FOUND) {
				nextIndex = FENCE_END;
			} else if (CHARACTER === '<') {
				nextIndex = this.#scanAngleBracket(index);
			} else if (CHARACTER === '{' && this.#hasSlots) {
				nextIndex = this.#scanTextSlot(index);
			}

			/* v8 ignore next 3 -- offensive invariant: every branch above moves past the character it read */
			if (nextIndex <= index) {
				throw new Error(`remove-attributes: document scan did not advance past index ${index}`);
			}

			index = nextIndex;
		}
	}

	/**
	 * Skips a leading `---` block, which only an Astro component executes: the same three dashes open a YAML front
	 * matter block in every other template format, where the text they delimit is data.
	 *
	 * @returns The index the rest of the document starts at.
	 */
	#skipFrontMatter(): number {
		const OPENER = FRONT_MATTER_OPENER_REGEX.exec(this.#input);

		if (OPENER == null) {
			return 0;
		}

		const START = OPENER[0].length;

		// The search starts on the line break ending the opening fence, which lets an empty block close right away
		FRONT_MATTER_CLOSER_REGEX.lastIndex = START - 1;

		const CLOSER = FRONT_MATTER_CLOSER_REGEX.exec(this.#input);

		if (CLOSER == null) {
			return 0;
		}

		if (this.#fileKind === 'astro') {
			this.#markCode({ start: START, end: CLOSER.index + 1, hasJsx: false, isSlot: false });
		}

		return CLOSER.index + CLOSER[0].length;
	}

	/**
	 * Finds the end of a Markdown fenced code block opening on the line that starts at an index.
	 *
	 * @remarks
	 * The block runs to the first later line holding a closing fence of the same character, at least as long as the
	 * opening one, or to the end of the document when no line does. A backtick fence whose info string holds a
	 * backtick is no fence at all, as in CommonMark.
	 *
	 * @param lineStart - The index the line starts at.
	 *
	 * @returns The index just past the closing fence, or `-1` when the line opens no fenced code block.
	 */
	#findCodeFenceEnd(lineStart: number): number {
		const INPUT = this.#input;

		CODE_FENCE_OPENER_REGEX.lastIndex = lineStart;

		const OPENER = CODE_FENCE_OPENER_REGEX.exec(INPUT);
		const FENCE = OPENER?.[1];

		if (FENCE == null || (FENCE.startsWith('`') && OPENER?.[2]?.includes('`') === true)) {
			return NOT_FOUND;
		}

		for (
			let lineEnd = INPUT.indexOf('\n', lineStart);
			lineEnd !== NOT_FOUND;
			lineEnd = INPUT.indexOf('\n', lineEnd + 1)
		) {
			CODE_FENCE_CLOSER_REGEX.lastIndex = lineEnd + 1;

			const CLOSER = CODE_FENCE_CLOSER_REGEX.exec(INPUT);
			const CLOSING_FENCE = CLOSER?.[1];

			if (
				CLOSER != null &&
				CLOSING_FENCE?.startsWith(FENCE.charAt(0)) === true &&
				CLOSING_FENCE.length >= FENCE.length
			) {
				return lineEnd + 1 + CLOSER[0].length;
			}
		}

		return INPUT.length;
	}

	#markCode(region: { start: number; end: number; hasJsx: boolean; isSlot: boolean }): number {
		return markCodeRegion({
			input: this.#input,
			mask: this.#mask,
			closers: this.#closers,
			shouldReadMarkupStrings: this.#shouldReadMarkupStrings,
			...region,
		});
	}

	#scanAngleBracket(index: number): number {
		const INPUT = this.#input;

		if (INPUT.startsWith(MARKUP_COMMENT_OPEN, index)) {
			const CLOSE_INDEX = INPUT.indexOf(MARKUP_COMMENT_CLOSE, index + MARKUP_COMMENT_OPEN.length);

			return CLOSE_INDEX === NOT_FOUND ? INPUT.length : CLOSE_INDEX + MARKUP_COMMENT_CLOSE.length;
		}

		const NEXT = INPUT.charAt(index + 1);

		if (ASCII_LETTER_REGEX.test(NEXT)) {
			return this.#scanElement(index);
		}

		const IS_DECLARATION =
			NEXT === '!' || NEXT === '?' || (NEXT === '/' && ASCII_LETTER_REGEX.test(INPUT.charAt(index + 2)));

		if (!IS_DECLARATION) {
			return index + 1;
		}

		// A closing tag, a doctype or a processing instruction holds no attribute
		const CLOSE_INDEX = INPUT.indexOf('>', index);

		return CLOSE_INDEX === NOT_FOUND ? INPUT.length : CLOSE_INDEX + 1;
	}

	#scanElement(index: number): number {
		const TAG = this.#readOpeningTag(index);

		if (!TAG.isComplete) {
			return TAG.end;
		}

		if (TAG.name === SCRIPT_TAG_NAME) {
			return this.#scanScriptElement(TAG);
		}

		if (TAG.name === STYLE_TAG_NAME) {
			return this.#findCloser(STYLE_CLOSER, TAG.end)?.[1] ?? TAG.end;
		}

		return TAG.end;
	}

	#scanScriptElement(tag: OpeningTag): number {
		const CONTENT = getScriptContent(tag);

		if (CONTENT === 'document') {
			return tag.end;
		}

		const CLOSER = this.#findCloser(SCRIPT_CLOSER, tag.end);

		// An opener no closing tag follows is not a block: its content is read as the document it then is
		if (CLOSER == null) {
			return tag.end;
		}

		if (CONTENT !== 'data') {
			this.#markCode({ start: tag.end, end: CLOSER[0], hasJsx: CONTENT === 'jsx', isSlot: false });
		}

		return CLOSER[1];
	}

	/**
	 * Finds the closing tag of a raw-text block, remembering where a search proved there is none left.
	 *
	 * @param closer - The lower-cased closer.
	 * @param fromIndex - The index the block's content starts at.
	 *
	 * @returns The range of the closing tag, or `null` when the document holds none after `fromIndex`.
	 */
	#findCloser(closer: string, fromIndex: number): Range | null {
		if (fromIndex >= (this.#noCloserFrom.get(closer) ?? Number.POSITIVE_INFINITY)) {
			return null;
		}

		const CLOSER = findTagCloser({ input: this.#input, closer, fromIndex });

		if (CLOSER == null) {
			this.#noCloserFrom.set(closer, fromIndex);
		}

		return CLOSER;
	}

	/**
	 * Reads an opening tag, marking its attribute names and reading the regions of code it holds.
	 *
	 * @param index - The index of the tag's `<`.
	 *
	 * @returns The tag, complete when it was read up to its `>`.
	 */
	#readOpeningTag(index: number): OpeningTag {
		const INPUT = this.#input;
		const NAME_END = findStickyMatchEnd(MARKUP_TAG_NAME_REST_REGEX, INPUT, index + 1);
		const NAME = INPUT.slice(index + 1, NAME_END).toLowerCase();
		const ATTRIBUTES = new Map<string, string>();

		let cursor = NAME_END;
		let hasTrailingSlash = false;

		while (cursor < INPUT.length) {
			const CHARACTER = INPUT.charAt(cursor);

			if (CHARACTER === '>') {
				return {
					name: NAME,
					end: cursor + 1,
					isComplete: true,
					isSelfClosing: hasTrailingSlash,
					attributes: ATTRIBUTES,
				};
			}

			// A `/` separates attributes like whitespace does, and closes the tag when it comes last
			if (CHARACTER === '/' || isWhitespace(CHARACTER)) {
				hasTrailingSlash = CHARACTER === '/' || hasTrailingSlash;
				cursor++;

				continue;
			}

			hasTrailingSlash = false;

			const READ =
				CHARACTER === '{' && this.#hasTagSlots() ? this.#readTagSlot(cursor) : this.#readAttribute(cursor, ATTRIBUTES);

			if (!READ.isReadable) {
				return { name: NAME, end: READ.index, isComplete: false, isSelfClosing: false, attributes: ATTRIBUTES };
			}

			cursor = READ.index;
		}

		return { name: NAME, end: INPUT.length, isComplete: false, isSelfClosing: false, attributes: ATTRIBUTES };
	}

	/**
	 * Reads one attribute of an opening tag, marking its name.
	 *
	 * @param start - The index of the attribute name's first character.
	 * @param attributes - The attributes read so far, which the attribute is added to unless it is already there.
	 *
	 * @returns Where the reading stopped.
	 */
	#readAttribute(start: number, attributes: Map<string, string>): TagRead {
		const INPUT = this.#input;
		const NAME_END = findStickyMatchEnd(ATTRIBUTE_NAME_REST_REGEX, INPUT, start + 1);
		const NAME = INPUT.slice(start, NAME_END).toLowerCase();
		const EQUALS_INDEX = skipWhitespace(INPUT, NAME_END);

		this.#mask.positions.fill(TAG_POSITION, start, NAME_END);

		if (INPUT.charAt(EQUALS_INDEX) !== '=') {
			addFirstAttribute(attributes, NAME, '');

			return { index: NAME_END, isReadable: true };
		}

		const VALUE_START = skipWhitespace(INPUT, EQUALS_INDEX + 1);

		if (INPUT.charAt(VALUE_START) === '{' && this.#hasTagSlots()) {
			addFirstAttribute(attributes, NAME, '');

			return this.#readTagSlot(VALUE_START);
		}

		const VALUE_END = findValueEnd({
			input: INPUT,
			valueStart: VALUE_START,
			hasQuotedMustache: this.#hasQuotedMustache,
			hasQuotedPlaceholder: this.#hasQuotedPlaceholder,
			budget: this.#budget,
		});

		if (VALUE_END === NOT_FOUND) {
			return this.#skipUnmeasuredValue(VALUE_START);
		}

		addFirstAttribute(attributes, NAME, unquoteValue(INPUT.slice(VALUE_START, VALUE_END)));

		return { index: VALUE_END, isReadable: true };
	}

	/**
	 * Steps over a value that cannot be measured — its expression never closes, its markup stops reading as
	 * JavaScript, or the budget is spent — reading it the plain way, so that the attributes after it stay readable.
	 *
	 * @remarks
	 * A quoted value runs to the next copy of its quote, and any other value to the next whitespace or `>`. Only a
	 * quote that never closes again ends the reading of the tag, which then resumes just past that quote: no later
	 * value can open with the same quote and fail the same search, so the document holds at most one such search per
	 * quote character and the pass stays linear.
	 *
	 * @param valueStart - The index of the value's first character.
	 *
	 * @returns Where the reading stopped.
	 */
	#skipUnmeasuredValue(valueStart: number): TagRead {
		const INPUT = this.#input;
		const QUOTE = INPUT.charAt(valueStart);

		if (QUOTE !== '"' && QUOTE !== "'" && QUOTE !== '`') {
			return { index: findStickyMatchEnd(UNQUOTED_RUN_REGEX, INPUT, valueStart), isReadable: true };
		}

		const VALUE_END = findPlainQuotedValueEnd(INPUT, valueStart);

		return VALUE_END === NOT_FOUND
			? { index: valueStart + 1, isReadable: false }
			: { index: VALUE_END, isReadable: true };
	}

	#hasTagSlots(): boolean {
		return this.#hasSlots && this.#fileKind !== 'vue';
	}

	#readTagSlot(openIndex: number): TagRead {
		const CLOSE_INDEX = this.#scanSlot(openIndex, { hasJsx: true, hasBlocks: false });

		return CLOSE_INDEX === NOT_FOUND
			? this.#skipUnmeasuredValue(openIndex)
			: { index: CLOSE_INDEX + 1, isReadable: true };
	}

	/**
	 * Reads the expression a `{` opens in the text: a `{…}` slot, or in `vue` the `{{ … }}` interpolation, whose
	 * inner brace is read as the one opening the expression.
	 *
	 * @param index - The index of the `{`.
	 *
	 * @returns The index the document scan goes on at.
	 */
	#scanTextSlot(index: number): number {
		if (this.#fileKind !== 'vue') {
			const CLOSE_INDEX = this.#scanSlot(index, { hasJsx: true, hasBlocks: true });

			return CLOSE_INDEX === NOT_FOUND ? index + 1 : CLOSE_INDEX + 1;
		}

		if (this.#input.charAt(index + 1) !== '{') {
			return index + 1;
		}

		const CLOSE_INDEX = this.#scanSlot(index + 1, { hasJsx: false, hasBlocks: false });

		return CLOSE_INDEX === NOT_FOUND ? index + 2 : CLOSE_INDEX + 1;
	}

	/**
	 * Reads the expression a `{` opens as a region of code.
	 *
	 * @param openIndex - The index of the `{`.
	 * @param options.hasJsx - Whether the expression may hold JSX elements.
	 * @param options.hasBlocks - Whether a Svelte block tag may open it (`{#if …}`, `{:else}`, `{@html …}`, `{/if}`).
	 *
	 * @returns The index of the `}` closing the expression, or `-1` when it never closes, which also disables every
	 *   later slot, and unmarks everything the scan read and drops the markup strings it recorded.
	 */
	#scanSlot(openIndex: number, options: { hasJsx: boolean; hasBlocks: boolean }): number {
		const INPUT = this.#input;

		let start = openIndex + 1;

		if (options.hasBlocks) {
			const FIRST_INDEX = skipWhitespace(INPUT, openIndex + 1);
			const FIRST = INPUT.charAt(FIRST_INDEX);
			const IS_BLOCK_TAG = ASCII_LETTER_REGEX.test(INPUT.charAt(FIRST_INDEX + 1));

			// `{/if}` closes a Svelte block and holds no expression, whose `/` would read as a regular expression
			if (FIRST === '/' && IS_BLOCK_TAG) {
				const CLOSE_INDEX = INPUT.indexOf('}', FIRST_INDEX);

				this.#hasSlots = CLOSE_INDEX !== NOT_FOUND;

				return CLOSE_INDEX;
			}

			if (FIRST !== '' && SVELTE_BLOCK_SIGILS.includes(FIRST) && IS_BLOCK_TAG) {
				start = findStickyMatchEnd(SVELTE_BLOCK_NAME_REGEX, INPUT, FIRST_INDEX + 1);
			}
		}

		const CLOSE_INDEX = this.#markCode({ start, end: INPUT.length, hasJsx: options.hasJsx, isSlot: true });

		if (CLOSE_INDEX === NOT_FOUND) {
			const MARKUP_STRINGS = this.#mask.markupStrings;
			const FIRST_UNREAD_INDEX = MARKUP_STRINGS.findIndex((markupString) => markupString[0] >= start);

			this.#mask.positions.fill(0, start);

			// The rest of the document is read again, and a `<script>` block in it records its strings anew
			if (FIRST_UNREAD_INDEX !== NOT_FOUND) {
				MARKUP_STRINGS.splice(FIRST_UNREAD_INDEX);
			}

			this.#hasSlots = false;
		}

		return CLOSE_INDEX;
	}
}

function addFirstAttribute(attributes: Map<string, string>, name: string, value: string): void {
	if (!attributes.has(name)) {
		attributes.set(name, value);
	}
}

/**
 * Maps a source file: which of its characters sit in the attribute list of a real opening tag.
 *
 * @remarks
 * A regular expression cannot do this: an attribute name written in text, a comment, a string, a Markdown fence or a
 * `<style>` block reads exactly like one written in a tag. A script is a single region of code, where JSX is read
 * unless the kind is `ts`; a document is walked by a {@link DocumentTagScanner}.
 *
 * @param input - The source to map.
 * @param options - The kind of source, how its quoted values are read, and whether its strings may hold markup.
 *
 * @returns The position of every character, and the strings read as markup.
 */
function createTagMask(input: string, options: TagMaskOptions): TagMask {
	const MASK: TagMask = { positions: new Uint8Array(input.length), markupStrings: [] };

	if (options.fileKind === 'script' || options.fileKind === 'ts') {
		markCodeRegion({
			input,
			mask: MASK,
			start: 0,
			end: input.length,
			hasJsx: options.fileKind === 'script',
			isSlot: false,
			closers: new ClosingTagIndex(input),
			shouldReadMarkupStrings: options.shouldReadMarkupStrings,
		});
	} else {
		new DocumentTagScanner(input, MASK, options).scan();
	}

	return MASK;
}

// ─── Compiled Astro ───────────────────────────────────────────────────────────

/**
 * Where the reading of the items of one list stands
 */
interface ListReading {
	/**
	 * The brackets still open, the one opening the list first
	 */
	openers: string[];
	items: Range[];
	itemStart: number;
	maximumItems: number;
}

/**
 * What one character read at the base of a list does to it: `'done'` once its items are read, `'failed'` on a bracket
 * closing another one than the last opened
 */
type ListStep = 'continue' | 'done' | 'failed';

/**
 * Reads one character of a list that sits outside every string, comment, regular expression and template literal.
 *
 * @param reading - The reading of the list, which the character advances.
 * @param character - The character.
 * @param index - The index of the character.
 *
 * @returns What the character does to the list.
 */
function readListCharacter(reading: ListReading, character: string, index: number): ListStep {
	if (LIST_OPENERS.includes(character)) {
		reading.openers.push(character);

		return 'continue';
	}

	if (LIST_CLOSERS.includes(character)) {
		if (reading.openers.pop() !== LIST_OPENERS.charAt(LIST_CLOSERS.indexOf(character))) {
			return 'failed';
		}

		if (reading.openers.length > 0) {
			return 'continue';
		}

		reading.items.push([reading.itemStart, index]);

		return 'done';
	}

	if (character !== ',' || reading.openers.length !== 1) {
		return 'continue';
	}

	reading.items.push([reading.itemStart, index]);
	reading.itemStart = index + 1;

	return reading.items.length === reading.maximumItems ? 'done' : 'continue';
}

/**
 * Splits the list a bracket opens — the arguments of a call, the properties of an object literal — into its items.
 *
 * @remarks
 * The characters are read by an {@link ExpressionScanner}, so a comma or a bracket inside a string, a comment, a
 * regular expression or a template literal separates nothing; the brackets of the expression itself are paired here.
 *
 * @param options.input - The source.
 * @param options.openIndex - The index of the `(` or `{` opening the list.
 * @param options.maximumItems - How many items to read at most.
 *
 * @returns The `[start, end)` range of every item read, each ending on the comma or the bracket after it, or `null`
 *   when the list does not close on the bracket matching its opener.
 */
function readListItems(options: { input: string; openIndex: number; maximumItems: number }): Range[] | null {
	const { input, openIndex, maximumItems } = options;
	const REGION: RegionReading = {
		input,
		end: input.length,
		hasJsx: false,
		closers: new ClosingTagIndex(input),
		shouldReadMarkupStrings: false,
		markupStrings: [],
	};

	const SCANNER = new ExpressionScanner({ isInQuotedValue: false, region: REGION });
	const READING: ListReading = {
		openers: [input.charAt(openIndex)],
		items: [],
		itemStart: openIndex + 1,
		maximumItems,
	};

	for (let index = openIndex + 1; index < input.length; index++) {
		const CHARACTER = input.charAt(index);
		const LIST_STEP = SCANNER.isInBaseExpression ? readListCharacter(READING, CHARACTER, index) : 'continue';

		if (LIST_STEP !== 'continue') {
			return LIST_STEP === 'done' ? READING.items : null;
		}

		if (SCANNER.step(CHARACTER, input.charAt(index + 1), index) === 'skip-next') {
			index++;
		}

		if (SCANNER.isDesynchronized) {
			return null;
		}
	}

	return null;
}

/**
 * Measures the `${$$addAttribute(value, "name")}` placeholder Astro's compiler renders a dynamic attribute with.
 *
 * @param input - The compiled module.
 * @param placeholderStart - The index of the `$` opening a placeholder in the attribute list of an opening tag.
 * @param names - The lower-cased attribute names to remove.
 *
 * @returns The range of the whole placeholder, or `null` when it renders another attribute or its shape differs from
 *   the one the compiler emits: two arguments, a name written as a plain string literal and nothing after the call.
 */
function findAddAttributeRange(input: string, placeholderStart: number, names: ReadonlySet<string>): Range | null {
	if (!input.startsWith(ASTRO_ADD_ATTRIBUTE_PLACEHOLDER, placeholderStart)) {
		return null;
	}

	const ARGUMENTS = readListItems({
		input,
		openIndex: placeholderStart + ASTRO_ADD_ATTRIBUTE_PLACEHOLDER.length - 1,
		maximumItems: ASTRO_ADD_ATTRIBUTE_ARGUMENT_COUNT + 1,
	});

	const [VALUE, NAME] = ARGUMENTS ?? [];

	if (ARGUMENTS?.length !== ASTRO_ADD_ATTRIBUTE_ARGUMENT_COUNT || VALUE == null || NAME == null) {
		return null;
	}

	const CALL_END = NAME[1];
	const PLACEHOLDER_END = CALL_END + 2;
	const ATTRIBUTE_NAME = PLAIN_STRING_LITERAL_REGEX.exec(input.slice(NAME[0], CALL_END))?.[1];
	// Whatever follows the placeholder has to stay apart from whatever precedes it, which the compiler guarantees by
	// writing a space in front of every attribute it renders as text
	const IS_WHOLE_PLACEHOLDER =
		input.charAt(CALL_END) === ')' &&
		input.charAt(CALL_END + 1) === '}' &&
		(hasSeparatorAt(input, PLACEHOLDER_END) || input.startsWith('${', PLACEHOLDER_END));

	if (
		!IS_WHOLE_PLACEHOLDER ||
		ATTRIBUTE_NAME == null ||
		!names.has(ATTRIBUTE_NAME.toLowerCase()) ||
		input.slice(VALUE[0], VALUE[1]).trim() === ''
	) {
		return null;
	}

	return [placeholderStart, PLACEHOLDER_END];
}

/**
 * Measures the configured props in the object literal a `${$$renderComponent($$result, "Name", Name, { … }, slots)}`
 * placeholder passes — the call Astro's compiler renders a component or a custom element with.
 *
 * @remarks
 * A removed prop takes the comma and the whitespace separating it from the next one along; the last prop leaves the
 * comma in front of it, which an object literal accepts as a trailing comma. Only a key written as a plain string
 * literal is read, which is how the compiler writes every prop — a spread (`...props`) is left alone.
 *
 * @param input - The compiled module.
 * @param placeholderStart - The index of the `$` opening a placeholder in the text of template-literal markup.
 * @param names - The lower-cased attribute names to remove.
 *
 * @returns The ranges of the configured props, empty when the placeholder renders no component or its props are not an
 *   object literal.
 */
function findComponentPropRanges(input: string, placeholderStart: number, names: ReadonlySet<string>): Range[] {
	if (!input.startsWith(ASTRO_RENDER_COMPONENT_PLACEHOLDER, placeholderStart)) {
		return [];
	}

	const PROPS = readListItems({
		input,
		openIndex: placeholderStart + ASTRO_RENDER_COMPONENT_PLACEHOLDER.length - 1,
		maximumItems: ASTRO_RENDER_COMPONENT_PROPS_ARGUMENT_COUNT,
	})?.[ASTRO_RENDER_COMPONENT_PROPS_ARGUMENT_COUNT - 1];

	if (PROPS == null) {
		return [];
	}

	const OBJECT_START = skipWhitespace(input, PROPS[0]);
	const PROPERTIES =
		input.charAt(OBJECT_START) === '{'
			? readListItems({ input, openIndex: OBJECT_START, maximumItems: input.length })
			: null;
	const LAST_PROPERTY = PROPERTIES?.at(-1);

	// The argument has to be the object literal and nothing else
	if (PROPERTIES == null || LAST_PROPERTY == null || skipWhitespace(input, LAST_PROPERTY[1] + 1) !== PROPS[1]) {
		return [];
	}

	return PROPERTIES.flatMap((property, index): Range[] => {
		const PROPERTY_START = skipWhitespace(input, property[0]);
		const KEY = PLAIN_PROPERTY_KEY_REGEX.exec(input.slice(PROPERTY_START, property[1]))?.[1];

		if (KEY == null || !names.has(KEY.toLowerCase())) {
			return [];
		}

		const NEXT_PROPERTY = PROPERTIES[index + 1];
		const PROPERTY_END =
			NEXT_PROPERTY == null
				? PROPERTY_START + input.slice(PROPERTY_START, property[1]).trimEnd().length
				: skipWhitespace(input, NEXT_PROPERTY[0]);

		return [[PROPERTY_START, PROPERTY_END]];
	});
}

/**
 * Measures the dynamic attributes and the component props an Astro component compiled by Astro's compiler renders
 * under a configured name.
 *
 * @param options.input - The compiled module.
 * @param options.tagMask - The tag mask of the module, which locates the placeholders of its template literals.
 * @param options.names - The lower-cased attribute names to remove.
 *
 * @returns The ranges to remove, in source order, a range nested in another one included.
 */
function findCompiledAstroRanges(options: { input: string; tagMask: Uint8Array; names: ReadonlySet<string> }): Range[] {
	const { input, tagMask, names } = options;
	const RANGES: Range[] = [];

	for (
		let index = input.indexOf(ASTRO_HELPER_PLACEHOLDER_OPEN);
		index !== NOT_FOUND;
		index = input.indexOf(ASTRO_HELPER_PLACEHOLDER_OPEN, index + 1)
	) {
		if (tagMask[index] === TAG_PLACEHOLDER_POSITION) {
			const RANGE = findAddAttributeRange(input, index, names);

			if (RANGE != null) {
				RANGES.push(RANGE);
			}
		} else if (tagMask[index] === TEXT_PLACEHOLDER_POSITION) {
			RANGES.push(...findComponentPropRanges(input, index, names));
		}
	}

	return RANGES;
}

/**
 * Merges two lists of removal ranges into one sorted, non-overlapping list.
 *
 * @remarks
 * A range starting inside one already kept is dropped, so that an attribute written in a value or a prop removed
 * whole is not cut a second time. No two ranges start together: each starts on the `$` of a placeholder, the key of a
 * prop or the whitespace or name of a markup attribute.
 *
 * @param options.first - One list of ranges.
 * @param options.second - The other.
 *
 * @returns The merged ranges.
 */
function mergeRanges(options: { first: readonly Range[]; second: readonly Range[] }): Range[] {
	const { first, second } = options;

	return [...first, ...second]
		.sort((left, right) => left[0] - right[0])
		.reduce<Range[]>((merged, range) => {
			const PREVIOUS = merged.at(-1);

			if (PREVIOUS == null || range[0] >= PREVIOUS[1]) {
				merged.push(range);
			}

			return merged;
		}, []);
}

/**
 * Compiles the attribute names of one plugin instance into a single matcher.
 *
 * The matcher handles quoted values (including Svelte mustaches and tagged-template placeholders, each behind
 * its {@link AttributeMatchOptions} flag), expression values (`={…}`), unquoted values (`=foo`) and bare
 * attributes, each with an optional `:` or `v-bind:` binding prefix. Names match case-insensitively. The
 * whitespace before an attribute joins its range, so removing an attribute written on its own line leaves no
 * blank line behind.
 *
 * @remarks
 * One alternation of the escaped names is compiled, longest name first, and every hit is verified backward
 * (binding prefix and whitespace) and forward (value form). A literal-led pattern lets the engine skip ahead
 * with a fast literal search, where a whitespace-led one rescanned every whitespace run for every attribute.
 *
 * A hit counts only where the tag mask of the input ({@link createTagMask}) places an attribute list, so a name
 * written in text, a comment, a string, a Markdown fence or a style block is never touched — a string only once
 * `removeInStrings` reads the markup it holds, where a hit also has to end inside the string. The mask is built on the
 * first hit, so a module holding none of the names costs nothing more than the literal search.
 *
 * Each call carries its own {@link ExpressionScanBudget}, which bounds the total work spent on values whose
 * scan is thrown away — expressions that never close, and values rejected after theirs balanced — and keeps a
 * call linear in the length of its input.
 *
 * The scan restarts at the end of each accepted range, so ranges come out sorted and non-overlapping without
 * a merge pass; {@link assertRangeFollowsPrevious} guards that invariant. Only a compiled Astro module
 * ({@link AttributeMatchOptions.isCompiledAstro}) merges in the placeholders and props its compiler rendered the
 * configured names with.
 *
 * @param attributes - The attribute names to remove (e.g. `['data-testid']`).
 * @param options - What the plugin instance reads beyond its tags. Default: nothing more.
 * @param options.removeInStrings - Whether a `'` or `"` string of script code holding closed markup is read as that
 *   markup, so that its attributes are removed too.
 *
 * @returns A matcher returning the ranges to remove from a markup string, and the attributes left in place.
 */
function createAttributeMatcher(
	attributes: readonly string[],
	{ removeInStrings }: AttributeMatcherOptions = { removeInStrings: false },
): AttributeMatcher {
	// Longest first so a configured `data-testid-extra` is preferred over a configured `data-testid`
	const NAMES = cleanNameTokens(attributes).sort((first, second) => second.length - first.length);

	if (NAMES.length === 0) {
		return () => ({ ranges: [], skipped: [] });
	}

	// eslint-disable-next-line security/detect-non-literal-regexp -- every name is regex-escaped above
	const NAME_PATTERN = new RegExp(NAMES.map(escapeRegExp).join('|'), 'gi');
	const LOWER_CASED_NAMES: ReadonlySet<string> = new Set(NAMES.map((name) => name.toLowerCase()));

	return (input, options) => {
		const RANGES: Range[] = [];
		const SKIPPED: number[] = [];
		const BUDGET = new ExpressionScanBudget(input.length);
		const HAS_QUOTED_PLACEHOLDER = options.hasQuotedPlaceholder ?? false;

		NAME_PATTERN.lastIndex = 0;

		let match = NAME_PATTERN.exec(input);
		// Built on the first hit only, so that a module holding none of the names costs a single literal search
		let tagMask: TagMask | null = null;

		while (match != null) {
			tagMask ??= createTagMask(input, {
				fileKind: options.fileKind ?? 'markup',
				hasQuotedMustache: options.hasQuotedMustache,
				hasQuotedPlaceholder: HAS_QUOTED_PLACEHOLDER,
				shouldReadMarkupStrings: removeInStrings,
			});

			const HIT = toAttributeHit({
				input,
				nameStart: match.index,
				nameEnd: match.index + match[0].length,
				hasQuotedMustache: options.hasQuotedMustache,
				hasQuotedPlaceholder: HAS_QUOTED_PLACEHOLDER,
				budget: BUDGET,
				tagMask,
			});

			if (HIT.isSkipped) {
				SKIPPED.push(match.index);
			}

			if (HIT.range != null) {
				assertRangeFollowsPrevious(RANGES, HIT.range);
				RANGES.push(HIT.range);
				NAME_PATTERN.lastIndex = HIT.range[1];
			}

			match = NAME_PATTERN.exec(input);
		}

		// A configured name the module never mentions cannot be the one a compiled placeholder renders either
		if (options.isCompiledAstro === true && tagMask != null) {
			const COMPILED_RANGES = findCompiledAstroRanges({
				input,
				tagMask: tagMask.positions,
				names: LOWER_CASED_NAMES,
			});

			return { ranges: mergeRanges({ first: RANGES, second: COMPILED_RANGES }), skipped: SKIPPED };
		}

		return { ranges: RANGES, skipped: SKIPPED };
	};
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
 * @remarks
 * A one-shot helper: it compiles a matcher for every call, where the plugin compiles one per instance. The input is
 * read as a `markup` document, and quoted values as plain text, stepping over neither the Svelte mustaches the
 * plugin reads in `.svelte` files nor the tagged-template placeholders it reads in every other file. The markup of a
 * plain string is never read, as with `removeInStrings` off. An attribute the matcher had to leave in place is simply
 * kept, where the plugin warns about it.
 *
 * @param input - The original markup string from which attributes should be removed.
 * @param attributes - An array of attribute names to remove from the markup.
 *
 * @returns A new string representing the markup with the specified attributes removed.
 *
 * @see createAttributeMatcher
 */
function removeAttributes(input: string, attributes: readonly string[]): string {
	return removeRanges(
		input,
		createAttributeMatcher(attributes, { removeInStrings: false })(input, { hasQuotedMustache: false }).ranges,
	);
}

export type {
	AttributeMatcher,
	AttributeMatchOptions,
	AttributeMatchResult,
	ExtensionMatcher,
	FileKind,
	IgnoreMatcher,
	Range,
};

export {
	ANY_DEPTH_DEFAULT_IGNORE_PATHS,
	assertRangeFollowsPrevious,
	ASTRO_EXTENSIONS,
	cleanExtensions,
	cleanIgnoredPath,
	cleanIgnoredPaths,
	createAttributeMatcher,
	createExtensionMatcher,
	createIgnoreMatcher,
	createTagMask,
	DEFAULT_EXTENSIONS,
	DEFAULT_IGNORE_PATHS,
	escapeRegExp,
	findExpressionEnd,
	getFileKind,
	getOptions,
	HTML_EXTENSIONS,
	HTML_PROXY_REGEX,
	isStyleRequest,
	JAVASCRIPT_EXTENSIONS,
	JSX_EXTENSIONS,
	removeAttributes,
	removeRanges,
	ROOT_ANCHORED_DEFAULT_IGNORE_PATHS,
	SCRIPT_EXTENSIONS,
	stripQuery,
	SVELTE_EXTENSIONS,
	toRelativePath,
	TYPESCRIPT_EXTENSIONS,
	VUE_EXTENSIONS,
};
