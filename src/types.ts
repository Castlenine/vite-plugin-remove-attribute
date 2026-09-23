interface Options {
	/**
	 * File extensions to process, without the leading dot (e.g. `['svelte', 'vue', 'ts']`). Default:
	 * `DEFAULT_EXTENSIONS`
	 *
	 * Compose the exported presets to narrow the list (e.g. `[...JSX_EXTENSIONS, ...SVELTE_EXTENSIONS]`), or pass a
	 * preset directly (e.g. `DEFAULT_EXTENSIONS`). An empty array processes no file at all.
	 */
	extensions?: readonly string[];
	/**
	 * Attribute names to remove (e.g. `['data-testid']`)
	 */
	attributes: readonly string[];
	/**
	 * Folders to skip (e.g. `['src/tests', 'fixtures']`)
	 *
	 * A token is matched against the module path relative to the Vite root, with that path's own leading `../`
	 * segments dropped. Windows `\` separators are read as `/`, so `src\tests` works too. It matches a run of whole
	 * path segments at any depth, never anchored to the root: `src/tests` skips `src/tests/a.svelte` and
	 * `lib/src/tests/a.svelte` alike, while `build` matches `build/app.js` but never `buildhome/app.js`. `*` matches
	 * any characters within a single segment (e.g. `*.stories`).
	 *
	 * Leading `./`, `../` and `/` segments of a token are dropped rather than resolved, so they anchor nothing:
	 * `../shared` is the token `shared`, which skips every path holding a `shared` segment — `src/shared/a.ts` and
	 * `shared/a.ts` under the root as much as `../shared/a.ts` or `../other/shared/a.ts` outside it.
	 */
	ignoreFolders?: readonly string[];
	/**
	 * Files to skip (e.g. `['Header.svelte', 'src/components/Modal.svelte']`)
	 *
	 * Same matching rules as `ignoreFolders`: relative to the Vite root, `\` read as `/`, leading `./`, `../` and `/`
	 * dropped, matched on whole path segments at any depth, so `Header.svelte` skips `src/layouts/Header.svelte`.
	 */
	ignoreFiles?: readonly string[];
	/**
	 * Apply the built-in ignore list (`node_modules`, `.git`, `build`, `dist`, `public`, `.svelte-kit`, …) on top of
	 * `ignoreFolders` / `ignoreFiles`. Default: `true`
	 *
	 * `node_modules` and `.git` match on any path segment. Every other built-in token matches only as the first
	 * segment under the Vite root, so `build/App.svelte` is skipped while `src/lib/build/Step.svelte` is still
	 * processed. Tokens listed in `ignoreFolders` / `ignoreFiles` always match on any segment.
	 */
	ignoreDefaults?: boolean;
	/**
	 * Also remove the attributes of markup written in a plain `'…'` or `"…"` string of script code
	 * (`el.innerHTML = '<div data-testid="x"></div>'`, Svelte `{@html '<em data-testid="y">'}`). Default: `false`
	 *
	 * The strings read are those of a script or TypeScript module, of a `<script>` block, of Astro frontmatter, and of
	 * the `{…}` / `{{ … }}` expressions of a component. Only a string that closes on its own line holding at least one
	 * `<`, and whose every tag, quoted value and comment closes inside it, counts as markup. Anything else stays
	 * byte-identical: a string holding a backslash or a line break, a tag split across concatenated strings
	 * (`'<div data-testid="' + id + '">'`), an unclosed tag (`'<div data-testid'`), and a JSX attribute value.
	 *
	 * Every such string changes, whatever the code does with it: one compared against literal HTML
	 * (`html === '<b data-testid="x"></b>'`) no longer holds the same text.
	 */
	removeInStrings?: boolean;
}

type ResolvedOptions = Required<Omit<Options, 'extensions'>> & { extensions: string[] };

export type { Options, ResolvedOptions };
