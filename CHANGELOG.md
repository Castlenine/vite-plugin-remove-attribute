# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-09-27

### Fixed

- An `attributes` entry that was empty or whitespace-only matched arbitrary `= "…"` text anywhere in the
  source instead of matching nothing, corrupting the output; a non-string entry threw inside `transform`
  instead of being dropped.
- `name = value` with an unquoted value (e.g. `data-testid = foo`) removed the name but left the dangling
  `= value` behind.
- In `.svelte` files, a quoted value holding a mustache with nested quotes (`data-testid="{a ? "b" : "c"}"`)
  was cut at the first nested quote instead of the value's real closing quote, corrupting the tag.
- A `//` or `/* */` comment, or a regular expression literal, inside an `={…}` expression value could contain
  a brace that ended the removal at the wrong `}`.
- A removed attribute directly followed by another attribute with no whitespace between them
  (`data-testid="a"class="b"`) fused the tag name with the remaining attribute.
- JSX nested inside an expression value (`={…}`) is now read as markup rather than JavaScript: an apostrophe
  in element text (`data-testid={ok && <p>don't</p>}`), a `}` or `>` inside a nested element's attribute
  string, `/path` text, and an `a < /re/.test(b)` comparison no longer break or skip the removal.
- A TypeScript non-null assertion immediately before a comparison (`{n!<max}`) was misread as the start of an
  element; it is now read correctly.
- A tagged-template placeholder value directly after `=` (e.g. `data-testid=${id}`, including a nested
  `${cond ? 'a' : \`b${c}\`}`) is now removed as a whole; the unquoted-value reader previously stopped at the
  `{` and left `{id}` behind.
- `{a</re/.test(b)}` — a `</` immediately after a value — is now read as a comparison followed by a regular
  expression literal and the attribute is removed; it was previously left in place with a warning.
- A TypeScript generic parameter list inside an expression value (`={<T,>(x: T) => x}`,
  `={<T extends U>(x: T) => x}`) is now read as generics rather than an unclosed element, and the attribute is
  removed; an element whose first attribute is the bare word `extends` (`<Foo extends >`) is read as a generic
  list too. Old-style casts (`={<Foo>bar}`) remain ambiguous and are still left in place with a warning.
- A quoted value holding a `${…}` placeholder with nested quotes or a nested template literal
  (``data-testid="${ok ? "a" : `b-${id}`}"``, as in Lit or Angular inline templates, also inside the `<script>`
  block of a `.vue`, `.astro` or `.html` file) was cut at the first inner quote; it is now removed as a whole.
  An escaped `\${` opens no placeholder.
- An unquoted value was cut at a `{`, leaving `{b}` behind (`data-testid=a{b}`, which Svelte then read as a
  shorthand attribute; Solid's compiled `$\{…}` form was affected too). A balanced `{…}` now continues the
  value; an unbalanced one leaves the attribute in place and emits a warning.
- Once the failed-scan budget of a file that does not parse was spent, valid quoted values holding a mustache
  or a `${…}` placeholder were read as plain text and cut at an inner quote; they are now left in place and
  warned about.
- Generic JSX/TSX elements (`<Select<Option> …/>`) no longer stop removal for the rest of the module.
  `export default <jsx/>` and `export default /re/` scan correctly, and a keyword after `.` (`m.default`) is no
  longer treated as a keyword.
- `<script>` / `<style>` content inside template-literal markup (Lit, Angular inline templates, compiled Astro)
  is read as raw text. In `.ts` / `.mts` / `.cts` files only markup inside template literals is read; raw
  markup outside one, and non-HTML template syntaxes such as Pug, are not touched.
- Style sub-requests (`?vue&type=style…`, Svelte `type=style`, `html-proxy&inline-css`, CSS-language queries)
  are skipped entirely; CSS strings containing an attribute name were previously edited. html-proxy inline
  scripts and Vue/Astro `type=script` sub-requests are read as script.
- Astro: under a real Astro build the plugin receives compiled `.astro` modules and detects this per Vite
  environment. Expression values (`attr={expr}`, compiled to `${$$addAttribute(expr, "name")}`, matched
  case-insensitively), shorthand `{attr}`, and configured props on components, custom elements and
  `<Fragment>` are now removed; any other compiled shape is left untouched. This also applies when the plugin is
  registered through an integration's `astro:config:setup` hook.
- Ignore paths normalize `\` to `/` and drop (not resolve) a leading `./`, `../` or `/`, so
  `ignoreFolders: ['src\\tests']` now matches and `['../shared']` is the token `shared`, matching any `shared`
  path segment. Module ids ignore `?query` and `#hash` suffixes (a `#` followed by `/` is a
  folder name).
- Ignore paths are resolved against each build's own root (`this.environment.config.root` on Vite 6+), so
  concurrent builds sharing one plugin instance stay independent.
- An Angular inline `template:` string whose tag, quoted value, comment or raw-text element was not
  closed inside the string (e.g. a tag split across concatenated strings) could have an attribute removed across the string boundary; such a string is now left
  untouched.

### Added

- An `attributes` or `extensions` option that resolves to an empty list logs one `[remove-attributes]` warning
  per plugin instance through Vite's logger, naming the rejected entries (strings quoted, others by type, e.g.
  `<object>`); the build never fails.
- Integration tests for multi-environment builds (`createBuilder` + `buildApp`) and concurrent builds.

- Nine frozen, composable extension presets as named exports: `JAVASCRIPT_EXTENSIONS`, `TYPESCRIPT_EXTENSIONS`,
  `JSX_EXTENSIONS`, `SCRIPT_EXTENSIONS`, `SVELTE_EXTENSIONS`, `VUE_EXTENSIONS`, `ASTRO_EXTENSIONS`,
  `HTML_EXTENSIONS` and `DEFAULT_EXTENSIONS`. Mutating one throws; compose them by spreading.
  `DEFAULT_EXTENSIONS` covers markup and JSX files (`jsx`, `tsx`, `svelte`, `vue`, `astro`, `html`, `htm`);
  the script presets (`JAVASCRIPT_EXTENSIONS`, `TYPESCRIPT_EXTENSIONS`, `SCRIPT_EXTENSIONS`) are opt-in.
- The CommonJS entry exposes every named export as a property of the required function
  (`require('…').SVELTE_EXTENSIONS`), and `dist/index.d.cts` declares them.
- The unquoted attribute value form is now removed too (`data-testid=foo`, `data-testid = foo`,
  `<input data-testid=foo/>`, and a tagged-template placeholder value such as `data-testid=${id}` in Lit
  `html` templates).
- A Vue binding modifier tail is now removed with the attribute (`:data-testid.attr="x"`,
  `v-bind:data-testid.camel.prop="x"`).
- An attribute directly following a closing `"`, `'` or `}` with no whitespace in between is now matched
  (`class="x"data-testid="y"`, as minified HTML emits it), including two removed attributes fused together.
- The `transform` hook now emits a build warning when an attribute has to be left in place because its value
  could not be parsed — one warning per module, pointing at the position of the first occurrence.
- `removeInStrings` option (default `false`; only a literal `true` enables it): markup inside a plain single- or
  double-quoted JS string in script code (`<script>` blocks, script/TS modules, Astro frontmatter, Svelte `{…}` /
  `{@html …}` expressions, Vue `{{ }}`) is read as markup again, restoring the 2.0.3 removal from strings such as
  `innerHTML = '<div data-testid="x"></div>'`. Strings with no `<`, with a backslash or line break, with a tag or
  quoted value not closed inside the string, and attribute values inside JSX tags stay byte-identical. Every
  plain quoted string holding closed markup is edited, not only strings used as markup: object keys, TypeScript
  string-literal types, import specifiers and every string of a compiled Astro module. In `.svelte` files, a
  value opening a mustache inside a string (`'<p data-testid="{">'`) is left in place with a warning when it
  cannot be bounded inside the string.

### Changed

- **Behavior change:** attributes are only removed inside real opening tags; markup inside JS strings is no
  longer edited (e.g. `innerHTML = '<div data-testid>'`, Svelte `{@html '…'}`, Vue `{{ '<…>' }}`), except
  Angular `template:` strings. Text nodes, `<pre>` content, HTML/JS/template comments, JS strings, regular
  expression literals, JSX text, template text outside tags, `<style>`, JSON / importmap / `src` script bodies,
  Markdown fences and non-Astro front matter stay byte-identical. Script code such as `let title = 'Home'` with
  `attributes: ['title']` no longer breaks the build. The previous result for markup inside quoted JS strings
  can be restored with `removeInStrings: true`.
- Angular inline `template:` values (the value of a `template` key after `{` or `,`), given as a template
  literal or a single/double-quoted string, are read as markup and stripped. A quoted string holding no `<`,
  containing a backslash or a line break, reaching the region end, or whose tag, quoted value, comment or
  raw-text element (e.g. `<textarea>`, `<script>`) does not close inside the string stays a plain string; ternary values and quoted
  `'template':` keys are not recognized.
- `extensions` is now optional and defaults to `DEFAULT_EXTENSIONS`, the markup-and-JSX preset described above.
  Omitting it (or passing a non-array) previously processed no file at all; it now processes that default list.
  Configurations that pass `extensions` are unaffected.
- Non-string and blank `extensions` entries are dropped instead of throwing on the first transformed module.
  `attributes` entries are now cleaned the same way: non-string, empty or whitespace-only entries are dropped,
  and the rest are trimmed and de-duplicated. With no valid attribute name left, the plugin does nothing.
- `extensions` is typed `readonly string[]`, so a frozen preset can be passed without spreading. `attributes`,
  `ignoreFolders` and `ignoreFiles` are typed `readonly string[]` as well. Existing `string[]` values remain
  assignable.
- **Behavior change:** built-in ignore tokens other than `node_modules` and `.git` are now anchored to the
  first path segment under the Vite root instead of matching at any depth. Folders such as `src/routes/public/`,
  `src/**/build/`, `src/**/logs/`, `src/**/e2e/`, and a workspace package resolved outside the Vite root
  (e.g. `../other/dist/…`), are no longer skipped by default. Add the folder to `ignoreFolders` to keep the
  previous behavior.
- **Behavior change (ignore list):** root-anchored `.output`, `.nitro`, `.data` (Nitro: Nuxt, SolidStart,
  TanStack Start), `out` (Next.js static export), `.react-router`, `.astro`, `.solid`, `.vinxi`, `.tanstack`,
  `.angular`, and the deploy-adapter directories `.vercel`, `.netlify` and `.wrangler` were added to the
  built-in ignore list; `.remix` was removed, since no Remix version generates that folder.
- README: the plugin declares `enforce: 'pre'`, which puts it before normal-phase plugins (such as
  `@vitejs/plugin-vue`) whatever its position in the array. Next to another `pre` plugin (Solid, Preact, Qwik,
  Analog's `angular()`, Svelte's preprocess step), Vite keeps array order. The README's claim that order does
  not matter was corrected, and a Plugin order section was added.
- Internal only: the integration suite (`pnpm test:integration`) now runs a real build for Lit, React, Preact,
  Solid, Svelte, Vue, Astro, entry HTML and Angular (through Analog).
- **Known limitation (documented, not a code change):** in every non-Svelte file, a literal `${` inside a
  quoted value is read as a placeholder; when it happens to balance across a quote, as in
  `data-testid="${" class="}"`, the following attribute is removed too, without a warning.
- **Known limitation (documented, not a code change):** Angular through Analog (`@analogjs/vite-plugin-angular`)
  needs `fastCompile: true` and `removeAttribute()` listed before `angular()`. With Analog's default AOT
  compiler nothing is removed, because it reads the files from disk in `buildStart`, before any Vite
  `transform` runs.
- Sourcemaps are skipped during `vite build` when the resolved `build.sourcemap` is off (the per-environment
  setting wins on Vite 6+); the dev server always gets a map. Segments are word-boundary granular (magic-string
  `hires: 'boundary'` equivalent), and html-proxy inline-script maps are named after the proxy id with
  `sourcesContent`.
- The "left N attribute(s) in place" warning fires once per module per plugin instance: client + SSR builds warn
  once, and watch mode no longer repeats it on rebuild.
- `dist/` no longer ships sourcemaps, JSDoc or type-test declarations (about 373 KB down to about 172 KB raw
  across 10 files).
  CJS `require()` returns the plugin with a typed `readonly default`, `.d.ts` inline `import()` specifiers carry
  extensions, the build uses `rolldownOptions`, and `lib: ES2022` guards against APIs newer than Node 18.
- Internal only: the 100 % coverage threshold is enforced by `pnpm test:coverage` (unit project);
  `pnpm test` runs the `unit` and `performance` projects; the linear-time property checks moved from
  `tests/property/` to `tests/performance/` (`pnpm test:performance`); `pnpm test:integration` no longer passes
  with no tests; `.ncurc.js` replaces `.ncurc` and blocks upgrades
  that other devDependencies' peer ranges do not accept yet.
- **Known limitation (documented, not a code change):** Markdown inline code spans and tags inside
  `<textarea>` / `<title>` content are still edited. Attributes passed through an Astro spread (`{...props}`)
  and names inside `set:html` strings or inline-script text survive. Markdown 4-space indented code blocks are
  still edited (only fenced blocks are protected). External Angular `templateUrl` `.html` templates are not
  stripped: Angular reads them from disk, so they never pass through Vite's `transform`.

### Performance

- The scanner is about 42 % faster, using a character-class lookup table; the smaller table also makes the
  plugin import about 6 ms faster.

- Attribute, ignore and extension matching now compile their patterns once per plugin instance instead of once
  per transformed module: one ignore test per module instead of one per configured token, and one pass over
  the source for every configured attribute instead of one pass per attribute.
- Removed quadratic scanning on long runs of whitespace (a 40,000-character run went from roughly 2.4 seconds
  to under 1 millisecond) and on files holding many unterminated `={…}` expressions.
- Removed quadratic scanning on rejected unquoted placeholder values (a 64,000-character input went from
  roughly 6 seconds to about 20 milliseconds).

## [2.0.3] - 2026-09-19

### Changed

- Internal only: contributor tooling and documentation, with no behavior change.
- The root `prepare` script was removed; the Lefthook git hooks are now installed by Lefthook's own `postinstall`, approved through `allowBuilds` in `pnpm-workspace.yaml`. If the hooks are missing, run `pnpm exec lefthook install`.
- The unused `esbuild` and `unrs-resolver` entries were dropped from `allowBuilds`, leaving `lefthook` as the only approved build.
- `pnpm lint`, `pnpm lint:fix`, `pnpm format` and `pnpm format:check` no longer use the ESLint / Prettier caches.
- Nothing in the published `dist/` output changed.

## [2.0.2] - 2026-09-19

### Changed

- Internal only: contributor tooling and documentation, with no behavior change.
- Markdown is now linted with markdownlint-cli2, and the pre-commit hook runs an optional ggshield secret scan.
- Contributors need pnpm `>=12.4.2`, enforced through `devEngines.packageManager`; the `packageManager` field was dropped and pnpm is no longer auto-downloaded.
- `ACKNOWLEDGEMENT.md` was renamed to `ACKNOWLEDGMENT.md`, and the README links and anchor follow (`#acknowledgement` is now `#acknowledgment`).
- Development dependencies were refreshed (`@types/node`, `prettier`).
- Nothing in the published `dist/` output changed.

## [2.0.1] - 2026-09-16

### Changed

- Internal only: the source was realigned with the project code conventions (`#` private members, function declarations, `!= null` checks) with no behavior change.
- Tests now cover escaped quotes inside `attribute={…}` values.
- A contributing guide and GitHub issue / pull request templates were added.
- Nothing in the published `dist/` output changed.

## [2.0.0] - 2026-09-15

### Fixed

- Ignore tokens were matched as substrings of the **absolute** module id, so a checkout path containing `build`, `dist`, `public`, `logs`, `e2e`, `.cache` or `.env` (Cloudflare Workers clones into `/opt/buildhome/repo`) disabled the plugin entirely. Tokens are now matched on path-segment boundaries against the path relative to the Vite root: `build` matches `build/app.js` but no longer `buildhome/app.js`. Multi-segment tokens such as `src/tests` and `src/components/Modal.svelte` keep working.
- The expression form `attribute={…}` was never removed. Brace-balanced values, template literals and nested `${…}` placeholders are now handled; an unbalanced expression is left untouched.
- A bare attribute closing a self-closing tag (`<input data-testid />`) was not removed.
- The `?query` suffix of a Vite module id is stripped before extension and ignore matching.
- Attribute names and extensions are regex-escaped.
- `transform` returns `null` when a module is skipped or unchanged instead of echoing the source back.

### Added

- Every transformed module now carries a sourcemap (generated in-house, the package still has no runtime dependency), so the consumer's sourcemaps keep pointing at the original lines and columns.
- `ignoreDefaults` option (default `true`) to opt out of the built-in ignore list.
- `*` in an ignore token matches within a single path segment (`*.log`, `.env.*`, `*.stories.svelte`).
- The `Options` type is exported.
- `engines.node` is declared as `>=18.0.0`. The bundle targets ES2022, which Node 18 runs natively, so the plugin works with every Vite version from 2 to 8 on any Node release those versions support from 18 upward.
- `CHANGELOG.md` ships in the npm tarball.

### Changed

- The package has been renamed from `@castlenine/vite-remove-attribute` to `@castlenine/vite-plugin-remove-attribute` to align with the Vite plugin naming convention. Uninstall the old name, install the new one and update the import specifier; the default export, the options and the behavior documented above are otherwise the same.
- The CommonJS entry moved from `dist/index.umd.cjs` to `dist/index.cjs`. `require()` still returns the plugin function and `.default` is also available; the entry is typed by `dist/index.d.cts`.

[2.1.0]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.3...v2.1.0
[2.0.3]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Castlenine/vite-plugin-remove-attribute/releases/tag/v2.0.0
