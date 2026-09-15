interface Options {
	/**
	 * File extensions to process, without the leading dot (e.g. `['svelte', 'vue', 'ts']`)
	 */
	extensions: string[];
	/**
	 * Attribute names to remove (e.g. `['data-testid']`)
	 */
	attributes: string[];
	/**
	 * Folders to skip, relative to the Vite root (e.g. `['src/tests', 'fixtures']`)
	 *
	 * A token matches on path-segment boundaries only: `build` matches `build/app.js` but not `buildhome/app.js`.
	 * `*` matches any characters within a single segment (e.g. `*.stories`).
	 */
	ignoreFolders?: string[];
	/**
	 * Files to skip, relative to the Vite root (e.g. `['Header.svelte', 'src/components/Modal.svelte']`)
	 *
	 * Same matching rules as `ignoreFolders`.
	 */
	ignoreFiles?: string[];
	/**
	 * Apply the built-in ignore list (`node_modules`, `.git`, `build`, `dist`, `public`, `.svelte-kit`, …) on top of
	 * `ignoreFolders` / `ignoreFiles`. Default: `true`
	 */
	ignoreDefaults?: boolean;
}

type ResolvedOptions = Required<Options>;

export type { Options, ResolvedOptions };
