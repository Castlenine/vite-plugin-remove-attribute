<div align="center">

# `@castlenine/vite-plugin-remove-attribute`

[![npm.badge]][npm] [![download.badge]][download] [![contribution.badge]][contribution]

Vite plugin that removes specified attributes, such as 'data-testid' used in testing. Options cover file extensions, attributes, and folders and files to ignore.
</div>

## Table of Contents

- [Disclaimer](#disclaimer)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Quick start](#quick-start)
  - [Upgrading from 2.0.x](#upgrading-from-20x)
  - [Plugin order](#plugin-order)
  - [Options](#options)
    - [attributes](#attributes)
    - [extensions](#extensions)
    - [ignoreFolders and ignoreFiles](#ignorefolders-and-ignorefiles)
    - [ignoreDefaults](#ignoredefaults)
    - [removeInStrings](#removeinstrings)
  - [How matching works](#how-matching-works)
    - [Forms that are removed](#forms-that-are-removed)
    - [When a value cannot be parsed](#when-a-value-cannot-be-parsed)
  - [Good to know](#good-to-know)
  - [Framework notes](#framework-notes)
    - [Astro](#astro)
    - [Angular through Analog](#angular-through-analog)
    - [Not supported](#not-supported)
  - [Known limitations](#known-limitations)
  - [Sourcemaps](#sourcemaps)
- [Examples](#examples)
  - [SvelteKit](#sveltekit-example-1-removing-data-testid-attributes-from-svelte-files)
  - [Vue.js](#vuejs-example-removing-data-testid-attributes-from-vue-files)
  - [CommonJS](#commonjs)
- [How it works](#how-it-works)
- [Changelog](#changelog)
- [Acknowledgment](#acknowledgment)
- [License](#license)

## Disclaimer

**Tested against real `vite build` runs** with Svelte / SvelteKit, Vue.js, React, Preact, Solid, Astro, Lit (`html` templates in `.ts`), entry HTML and Angular through Analog with `fastCompile`. Qwik is verified on the transform only, because Qwik 1.20 does not yet support Vite 8. Please open an issue if you run into problems with these or other frameworks.

## Features

- Removes an attribute in every form it is written in: quoted, expression (`={…}`), unquoted, bare, and behind a Vue `:` / `v-bind:` prefix with modifiers.
- Processes markup and JSX files out of the box (`DEFAULT_EXTENSIONS`); plain script files are opt-in.
- Ships frozen extension presets (`SVELTE_EXTENSIONS`, `VUE_EXTENSIONS`, `SCRIPT_EXTENSIONS`, …) that you compose instead of listing extensions by hand.
- Handles `${…}` placeholders inside quoted values, so a Lit-style value with nested quotes is removed whole.
- Edits only real opening tags.
- Leaves an attribute it cannot parse in place and emits a build warning.
- Skips the folders and files you configure, on top of a built-in ignore list.
- Emits a sourcemap for each changed file when sourcemaps are enabled.

## Requirements

| Requirement | Version |
| - | - |
| Node.js | `>=18.0.0` |
| Vite | `>=2.0.0` (peer dependency) |

## Installation

Use your package manager to install it as a development dependency:

```shell
pnpm add -D @castlenine/vite-plugin-remove-attribute
# or
npm i -D @castlenine/vite-plugin-remove-attribute
# or
yarn add -D @castlenine/vite-plugin-remove-attribute
```

## Usage

### Quick start

List `removeAttribute()` first in `plugins`:

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig({
  plugins: [removeAttribute({ attributes: ['data-testid'] }), sveltekit()],
});
```

This removes `data-testid` from every markup and JSX file (`DEFAULT_EXTENSIONS`).

Most projects only want the attributes gone from production builds. Enable the plugin in production mode only:

```typescript
export default defineConfig(({ mode }) => ({
  plugins: [mode === 'production' ? removeAttribute({ attributes: ['data-testid'] }) : null, sveltekit()],
}));
```

That keeps test IDs in dev and in Vitest (which runs with `mode: 'test'`), where Testing Library's `getByTestId` needs them. Vite ignores falsy entries in `plugins`, so `mode === 'production' && removeAttribute(...)` is equivalent to the ternary.

### Upgrading from 2.0.x

Existing configs keep working unchanged. One option was added ([`removeInStrings`](#removeinstrings)), `extensions` became optional, and the option types were widened to `readonly string[]`. The output can differ, though:

- Markup inside JS strings is no longer stripped. Set `removeInStrings: true` to get the old behavior back.
- The built-in ignore list changed (see [`ignoreDefaults`](#ignoredefaults)). Tokens other than `node_modules` and `.git` now match only as the first folder under the Vite root; add nested folders to `ignoreFolders` if you still want them skipped. The list gained `.output`, `.nitro`, `.data`, `out`, `.react-router`, `.astro`, `.solid`, `.vinxi`, `.tanstack`, `.angular`, `.vercel`, `.netlify` and `.wrangler`, and dropped `.remix`. Workspace packages resolved outside the Vite root (`../other/dist/…`) are no longer skipped by default.
- A JS config that omits `extensions` now processes [`DEFAULT_EXTENSIONS`](#extensions). Before, it processed nothing.
- The build can now log warnings for values the plugin cannot parse and for option lists that end up empty. These never fail the build.

See the [CHANGELOG.md](./CHANGELOG.md) for the full list.

### Plugin order

The plugin declares `enforce: 'pre'`. Vite sorts plugins by `enforce` (`pre`, then normal, then `post`) and keeps array order within `pre`. So the position in `plugins` only matters next to another `pre` plugin that compiles markup. Listing `removeAttribute()` first works for every framework except Svelte with a markup preprocessor, and it is the recommended setup.

| Framework | Order |
| - | - |
| Vue (`@vitejs/plugin-vue`) | Any order: it has no `pre` plugin |
| Lit, entry HTML | Any order: no framework plugin is involved |
| React (`@vitejs/plugin-react` 5.x, 6.x default; `@vitejs/plugin-react-swc` default) | Any order: JSX is compiled by Vite core (oxc / esbuild) or in the normal phase |
| React with a `pre` compile step | List `removeAttribute()` first. This covers plugin-react 6's `compiler` option (React Compiler), plugin-react-swc with SWC `plugins` or `useAtYourOwnRisk_mutateSwcOptions` in build, and a Babel `pre` plugin (such as `@rolldown/plugin-babel`) that reprints the code |
| Svelte / SvelteKit (`vite-plugin-svelte` 7) | Any order: compilation is `post`. With a markup preprocessor such as Pug, list `removeAttribute()` after `sveltekit()` / `svelte()` so it reads the preprocessed markup |
| Solid (`vite-plugin-solid`), Preact (`@preact/preset-vite`) | Both orders work (integration-tested). When listed after them, the plugin reads their compiled output |
| Astro | Any order: `astro:build` is `pre` and registered before user plugins, so Astro always compiles first (see [Astro](#astro)) |
| Angular through Analog | Must come before `angular()` (see [Angular through Analog](#angular-through-analog)) |
| Qwik (`qwikVite()`, 1.x and v2 beta) | List `removeAttribute()` before `qwikVite()`, which compiles JSX in a `pre` transform. This is the only tested order |

### Options

Only `attributes` is required.

| Option | Type | Default | Description |
| - | - | - | - |
| `extensions` | `readonly string[]` | [`DEFAULT_EXTENSIONS`](#extensions) | File extensions to process, without the dot |
| `attributes` | `readonly string[]` | — | Attribute names to remove (e.g. `['data-testid']`) |
| `ignoreFolders` | `readonly string[]` | `[]` | Folders to skip (e.g. `['src/tests']`) |
| `ignoreFiles` | `readonly string[]` | `[]` | Files to skip (e.g. `['Header.svelte', 'src/lib/Modal.svelte']`) |
| `ignoreDefaults` | `boolean` | `true` | Also apply the built-in ignore list |
| `removeInStrings` | `boolean` | `false` | Also remove attributes from markup inside quoted JS strings |

In `attributes` and `extensions`, entries that are not strings, or are empty or whitespace-only, are dropped. The rest are trimmed and de-duplicated. If either list ends up empty, the plugin logs one `[remove-attributes]` warning per plugin instance through Vite's logger, naming the rejected entries. The build does not fail.

#### `attributes`

The attribute names to remove, matched case-insensitively. Longer names such as `data-testid-extra` are left alone. With no valid name left after cleaning, the plugin does nothing.

Only attributes inside real opening tags are removed, so a name that is also a JavaScript identifier (`title`, `id`, …) leaves script code such as `let title = 'Home'` untouched.

```typescript
removeAttribute({ attributes: ['data-testid', 'data-cy'] });
```

#### `extensions`

The file extensions to process, written without the leading dot.

When `extensions` is omitted, `DEFAULT_EXTENSIONS` applies: markup and JSX only (`jsx`, `tsx`, `svelte`, `vue`, `astro`, `html`, `htm`). Plain script files (`js`, `mjs`, `cjs`, `ts`, `mts`, `cts`) are processed only if you add `JAVASCRIPT_EXTENSIONS`, `TYPESCRIPT_EXTENSIONS` or `SCRIPT_EXTENSIONS`.

The package exports nine frozen preset arrays. `Options.extensions` is typed `readonly string[]`, so you can pass a preset directly (`extensions: DEFAULT_EXTENSIONS`) or spread several into a new array. Mutating a preset throws.

| Constant | Extensions | Typical use |
| - | - | - |
| `JAVASCRIPT_EXTENSIONS` | `js`, `mjs`, `cjs` | Opt-in: plain JavaScript; also Lit |
| `TYPESCRIPT_EXTENSIONS` | `ts`, `mts`, `cts` | Opt-in: plain TypeScript; also Lit and Angular |
| `JSX_EXTENSIONS` | `jsx`, `tsx` | React, Preact, Solid, Qwik, Vue JSX (none has an extension of its own) |
| `SCRIPT_EXTENSIONS` | Union of the three above | Opt-in: the 8 extensions Vite treats as script |
| `SVELTE_EXTENSIONS` | `svelte` | Svelte / SvelteKit (`.svelte.js` / `.svelte.ts` rune modules fall under the script presets) |
| `VUE_EXTENSIONS` | `vue` | Vue single-file components |
| `ASTRO_EXTENSIONS` | `astro` | Astro components |
| `HTML_EXTENSIONS` | `html`, `htm` | Entry HTML files (`vite build` only, see [Good to know](#good-to-know)) |
| `DEFAULT_EXTENSIONS` | Union of `JSX_`, `SVELTE_`, `VUE_`, `ASTRO_` and `HTML_EXTENSIONS` | Used when `extensions` is omitted |

Compose presets to cover exactly the file kinds a project uses:

```typescript
import removeAttribute, { JSX_EXTENSIONS, SVELTE_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';

removeAttribute({ extensions: [...JSX_EXTENSIONS, ...SVELTE_EXTENSIONS], attributes: ['data-testid'] });
```

Extend the default set with a custom extension:

```typescript
import removeAttribute, { DEFAULT_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';

removeAttribute({ extensions: [...DEFAULT_EXTENSIONS, 'svx'], attributes: ['data-testid'] });
```

Or opt script files in for a Lit or Angular inline template:

```typescript
import removeAttribute, { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';

removeAttribute({ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid'] });
```

Script extensions are opt-in because they add scan time for little gain:

- In a plain script file, the plugin only removes attributes written as markup, such as inside a Lit `html` template or an Angular inline `template:`. Other JS strings are edited only with [`removeInStrings`](#removeinstrings), and object-style props like `h('div', { 'data-testid': 'x' })` or `createElement` props are never matched.
- Adding a script preset means every script module in the project gets scanned.

A plain array of strings without any preset is still valid (see the [Vue.js example](#vuejs-example-removing-data-testid-attributes-from-vue-files)).

#### `ignoreFolders` and `ignoreFiles`

Folders and files the plugin skips. Each entry is a token written with `/` separators and matched against the module path **relative to the Vite root**:

- `\` is normalized to `/`, and a leading `./`, `../` or `/` is dropped, not resolved: `'src\\tests'` is `src/tests`, `'../shared'` is `shared`.
- Matching happens on path-segment boundaries. `build` matches `build/app.js` but not `buildhome/app.js`, and `src/tests` matches `src/tests/a.svelte` but not `src/tests-e2e/a.svelte`.
- A `*` matches any characters within one segment (`*.stories.svelte`, `.env.*`).
- Your tokens are never root-anchored: they match a run of whole segments **at any depth**. `src/tests` skips both `src/tests/a.svelte` and `lib/src/tests/a.svelte`, and `'../shared'` matches `shared/a.ts` and `src/shared/a.ts` but not `sharedx/`.
- A module id's `?query` and `#hash` suffixes are ignored (a `#` followed by `/` is part of a folder name).
- Each build resolves tokens against its own root, so concurrent builds sharing one plugin instance stay independent.

```typescript
removeAttribute({ attributes: ['data-testid'], ignoreFolders: ['src/tests'] });
removeAttribute({ attributes: ['data-testid'], ignoreFiles: ['Header.svelte', 'src/lib/Modal.svelte'] });
```

#### `ignoreDefaults`

Whether the built-in ignore list applies on top of `ignoreFolders` / `ignoreFiles` (default `true`).

Only `node_modules` and `.git` match at any depth. Every other built-in token matches only as the **first path segment under the Vite root**. So `build/App.svelte` is skipped, while `src/routes/public/+page.svelte`, `src/lib/build/Step.svelte` and `src/e2e/Foo.svelte` are processed like any other source file.

| Framework / tool | Ignored tokens |
| - | - |
| IDE / OS | `.idea`, `.vscode`, `.DS_Store`, `Thumbs.db` |
| Environment / logs | `.env`, `.env.*`, `logs`, `*.log` |
| Svelte / SvelteKit | `public`, `build`, `.svelte-kit` |
| Vue.js / Nuxt | `.nuxt` |
| Nitro (Nuxt, SolidStart, TanStack Start) | `.output`, `.nitro`, `.data` |
| React.js / Next.js | `.next`, `out` |
| React Router | `.react-router` |
| Astro | `.astro` |
| SolidStart | `.solid`, `.vinxi` |
| TanStack Start | `.tanstack` |
| Angular | `.angular`, `e2e`, `angular.json`, `browserslist` |
| Deploy adapters | `.vercel`, `.netlify`, `.wrangler` |
| Build output / cache | `dist`, `.cache` |

Set `ignoreDefaults: false` to keep only your own tokens. Files under `public/` or `build/` are then processed too:

```typescript
removeAttribute({
  extensions: ['svelte'],
  attributes: ['data-testid'],
  ignoreDefaults: false,
  ignoreFolders: ['node_modules'],
});
```

#### `removeInStrings`

Whether markup inside plain quoted JS strings is edited too (default `false`; only a literal `true` enables it).

When enabled, a single- or double-quoted string in script code that holds well-formed markup is read as markup. That covers `<script>` blocks, whole script/TS modules, Astro frontmatter, Svelte `{…}` / `{@html …}` expressions and Vue `{{ }}`:

```typescript
removeAttribute({ attributes: ['data-testid'], removeInStrings: true });

// Before
el.innerHTML = '<div data-testid="panel"></div>';
// After
el.innerHTML = '<div></div>';
```

Svelte `{@html '<em data-testid="note">Note</em>'}` becomes `{@html '<em>Note</em>'}` the same way.

Even when enabled, these stay byte-identical:

- strings with no `<`;
- strings containing a backslash (such as escaped quotes, `"<div data-testid=\"x\">"`) or a line break;
- strings whose tag or quoted value is not closed inside the string, such as concatenation (`'<div data-testid="' + id + '">'`) or `'<div data-testid'`;
- attribute values inside JSX tags.

Every plain quoted string holding closed markup is edited, not only strings used as markup (`innerHTML` and the like). That includes object keys (`{ '<b data-testid="x"></b>': 1 }` becomes `{ '<b></b>': 1 }`), TypeScript string-literal types, import specifiers and every string of a compiled Astro module. Code that compares a string against literal HTML (`outerHTML === '<div data-testid="x"></div>'`) sees the changed value.

In `.svelte` files, a value that opens a mustache inside a string (`'<p data-testid="{">'`) is removed within the string when it can be bounded there. Otherwise it is left in place with the "left N attribute(s) in place" warning.

Template literals and Angular inline `template:` strings are read as markup without this option.

### How matching works

#### Forms that are removed

- Quoted: `data-testid="a"`.
- Expression: `data-testid={value}`, including template literals with nested `${…}`.
- Unquoted: `data-testid=foo`, also `data-testid = foo` and `<input data-testid=foo/>`. The value may continue through a balanced `{…}`, such as `data-testid=a{b}`, or Solid's compiled `$\{…}` form when the plugin runs after `vite-plugin-solid`.
- Tagged-template placeholder: `data-testid=${id}`, also `data-testid=${a}-${b}`, as used in Lit `html` templates.
- Bare: `<input data-testid />`.
- With a Vue binding prefix: `:data-testid`, `v-bind:data-testid`. Modifiers go with the prefix (`:data-testid.attr="x"`, `v-bind:data-testid.camel.prop="x"`).
- Right after a closing `"`, `'` or `}` with no whitespace (`class="x"data-testid="y"`, as minifiers emit it). Two removed attributes written back-to-back are both taken out.

Inside an expression value (`={…}`):

- `//` and `/* */` comments and regular expression literals are read past, so a brace inside them does not end the value.
- Nested JSX elements (tags, their attribute strings, text content and fragments) are read as markup. An apostrophe, a `}` or a `<` inside them does not end the scan early.

Inside a quoted value:

- In `.svelte` files, a value holding a mustache with nested quotes (`data-testid="{ok ? "a" : "b"}"`, which also covers `${…}`) is read as an expression and removed whole.
- In every other file type (`js`/`ts`, `jsx`/`tsx`, `.vue`, `.astro`, `.html`), the value steps over `${…}` placeholders. A tagged-template value with nested quotes or nested template literals (``data-testid="${ok ? "a" : `b-${id}`}"``) is removed whole, including a Lit-style template inside a `<script>` block of a `.vue`, `.astro` or `.html` file.
- An escaped `\${` opens no placeholder. A placeholder that does not balance falls back to reading the value up to its first closing quote.

#### When a value cannot be parsed

The attribute stays in place and the plugin emits a build warning (one per module, pointing at the first occurrence). This happens with:

- an unbalanced `={`;
- an unbalanced `{` inside an unquoted value (`data-testid=a{b`);
- an element opened inside the value that is never closed, or is closed by a differently named tag. An old-style cast (`={<Foo>bar}`) counts, since it reads as an unclosed element.

A file with several unbalanced `={` expressions does not parse. To keep the transform linear, the plugin stops scanning expression values for the rest of that file, leaves those attributes untouched and warns about them. Quoted values holding a mustache or a `${…}` placeholder are left in place and warned about too, rather than cut at an inner quote.

### Good to know

- Entry HTML (`index.html`) only passes through the plugin during `vite build`. The dev server serves it without calling `transform`, so the attributes stay in dev.
- Attributes are removed only inside real opening tags. Text nodes, `<pre>` content, HTML/JS/template comments, JS strings, regular expression literals, JSX text, template text outside tags, `<style>`, JSON / importmap / `src` script bodies, Markdown fences and non-Astro front matter stay byte-identical. `<script>` / `<style>` content inside template-literal markup (Lit, Angular inline templates, compiled Astro) is read as raw text.
- Style sub-requests (`?vue&type=style…`, Svelte `type=style`, `html-proxy&inline-css`, CSS-language queries) are skipped entirely.
- In `.ts` / `.mts` / `.cts` files, only markup inside template literals is read, since TypeScript has no JSX there. Raw markup outside a template literal and non-HTML template syntaxes such as Pug are not touched.
- The "left N attribute(s) in place" warning fires once per module per plugin instance. A client + SSR build warns once, and watch mode does not repeat it on rebuild.

### Framework notes

#### Astro

Astro compiles `.astro` files before the plugin sees them (see [Plugin order](#plugin-order)), so the plugin works on compiled modules; it detects this per Vite environment. It removes static and bare attributes, expression values (`data-testid={id}`, compiled to `${$$addAttribute(id, "data-testid")}` and matched case-insensitively), shorthand `{data-testid}`, and configured props on components, custom elements and `<Fragment>`. Any other compiled shape is left untouched.

Attributes passed through a spread (`{...props}`) and inline-script text survive. Names inside `set:html` strings survive by default; with [`removeInStrings`](#removeinstrings) they are removed (compiled `$$unescapeHTML("<span data-testid='x'>raw</span>")` becomes `<span>raw</span>`). Registering the plugin through an integration's `astro:config:setup` hook behaves the same way.

#### Angular through Analog

With Analog (`@analogjs/vite-plugin-angular`), list `removeAttribute()` before `angular()` and enable `fastCompile`. With Analog's default AOT compiler nothing is removed: it builds its TypeScript program from the files on disk in `buildStart`, before any Vite `transform` runs.

An inline `template:` (the value of a `template` key after `{` or `,`) is read as markup when written as a template literal or a single/double-quoted string, even without [`removeInStrings`](#removeinstrings). A quoted string is left as a plain string when it holds no `<`, contains a backslash or a line break, reaches the region end, or has a tag, quoted value, comment or raw-text element (such as `<textarea>` or `<script>`) that does not close inside the string. Ternary values and quoted `'template':` keys are not recognized. External `templateUrl` templates are not stripped (see [Known limitations](#known-limitations)).

Under `fastCompile`, a plain attribute in an inline template (`data-testid="…"`, including a value with `${…}` placeholders) is removed. A property binding (`[attr.data-testid]="…"`) is left alone and still sets the attribute at runtime. `fastCompile` skips Angular's template type-checking and compiles a quoted value containing `${…}` to an empty string; both are Analog's own behavior, independent of this plugin.

```typescript
import angular from '@analogjs/vite-plugin-angular';
import removeAttribute, { DEFAULT_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    removeAttribute({ extensions: [...DEFAULT_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS], attributes: ['data-testid'] }),
    angular({ fastCompile: true }),
  ],
});
```

#### Not supported

- The Markdown family (`md`, `svx`, `mdx`) has no preset. You can add an extension to `extensions` manually; fenced code samples are left untouched, but inline code spans and 4-space indented code blocks are still edited.
- Astro re-reads `.md` content from disk rather than passing it through Vite's module graph, so the plugin has no effect on Astro Markdown either way.
- Marko (`.marko`), Riot (`.riot`) and Ripple (`.tsrx`) are unverified with a `pre`-enforced transform. They have no preset; add their extension manually and at your own risk.
- Imba, Civet, CoffeeScript, ReScript, Elm and Gleam are separate languages, not HTML/JSX markup, and must never be added to `extensions`.

### Known limitations

- **Angular `templateUrl`.** External `.html` templates are not stripped: Angular reads them from disk, so they never pass through Vite's `transform`.
- **Files that do not parse.** Several unbalanced `={` expressions stop expression scanning for the rest of the file (see [When a value cannot be parsed](#when-a-value-cannot-be-parsed)).

#### Scanner edge cases

- **`/` and `<` inside `={…}`.** Whether a `/` starts a regular expression or divides, and whether a `<` opens an element or compares, is decided from the previous token (punctuation, a keyword such as `return` / `typeof`, or a TypeScript non-null `!`). Misreads remain possible but rare.
- **Stray `{` in Svelte.** A quoted value with a stray unclosed `{` (`data-testid="{" class="}c"`, which is not valid Svelte) can take the next attribute with it, with no warning.
- **Literal `${` outside Svelte.** It is read as a placeholder, so `data-testid="${" class="}"` also removes `class`, with no warning. In `.astro` files, Astro escapes it as `\${` first, so `class` survives in a real build.
- **Fallback to the plain read.** A literal `${` (or Svelte `{`) whose continuation stops reading as JavaScript, such as a string running into a line break or followed directly by a word, number, string or `{`, falls back to the plain read even if a component brace follows later.
- **Undetectable markup.** Markup that reads as JavaScript token for token up to a `}` cannot be told apart from a template literal: `<b data-testid="${">x</b><i title="}">y</i>` becomes `<b>y</i>`.
- **`<textarea>` / `<title>` content.** Tags written inside their content are still edited.

### Sourcemaps

The plugin builds sourcemaps itself, with no runtime dependency, using word-boundary segments (the magic-string `hires: 'boundary'` equivalent), so code keeps mapping to the original lines and columns even when an attribute sat on its own line. The dev server always gets a map. During `vite build`, a map is produced only when the resolved `build.sourcemap` is on (on Vite 6+ the per-environment setting wins). An html-proxy inline-script map is named after the proxy id and carries `sourcesContent`.

## Examples

### SvelteKit example 1: Removing 'data-testid' attributes from `.svelte` files

Removes `data-testid` from all `.svelte` files, in the production build only.

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

import removeAttribute, { SVELTE_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === 'production'
      ? removeAttribute({
          extensions: [...SVELTE_EXTENSIONS],
          attributes: ['data-testid'],
        })
      : null,

    sveltekit(), // Either order works: vite-plugin-svelte compiles in the post phase
  ],
}));
```

### SvelteKit example 2: Ignoring specific folders and files

Removes `data-testid` and `data-id` from all `.svelte`, `.ts` and `.js` files in every build, except files in `src/tests` and `src/utilities` and the files `Header.svelte`, `src/components/Modal.svelte` and `src/layouts/LayoutAuth.svelte`.

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

import removeAttribute, { JAVASCRIPT_EXTENSIONS, SVELTE_EXTENSIONS, TYPESCRIPT_EXTENSIONS } from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig({
  plugins: [
    removeAttribute({
      extensions: [...SVELTE_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS, ...JAVASCRIPT_EXTENSIONS],
      attributes: ['data-testid', 'data-id'],
      ignoreFolders: ['src/tests', 'src/utilities'],
      ignoreFiles: ['Header.svelte', 'src/components/Modal.svelte', 'src/layouts/LayoutAuth.svelte'],
    }),

    sveltekit(), // Either order works: vite-plugin-svelte compiles in the post phase
  ],
});
```

### Vue.js example: Removing 'data-testid' attributes from `.vue` files

Removes `data-testid` from all `.vue` files, in the production build only.

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === 'production'
      ? removeAttribute({
          extensions: ['vue'],
          attributes: ['data-testid'],
        })
      : null,

    vue(), // Any order works: plugin-vue has no pre plugin
  ],
}));
```

### CommonJS

The package also ships a CommonJS entry. `require()` returns the plugin function directly (`.default` works too), and every extension preset (`SVELTE_EXTENSIONS`, `DEFAULT_EXTENSIONS`, …) is a property of that function:

```javascript
// vite.config.cjs
const { defineConfig } = require('vite');
const removeAttribute = require('@castlenine/vite-plugin-remove-attribute');

module.exports = defineConfig({
  plugins: [
    removeAttribute({
      extensions: [...removeAttribute.SVELTE_EXTENSIONS],
      attributes: ['data-testid'],
    }),
  ],
});
```

## How it works

For the internals (file kinds, how a match is verified, the scan budget, compiled Astro modules, sourcemaps and concurrent builds), see [documentation/how-it-works.md](./documentation/how-it-works.md).

## Changelog

For more information, refer to the [CHANGELOG.md](./CHANGELOG.md).

## Acknowledgment

This project is a fork of [mustafadalga/remove-attr](https://github.com/mustafadalga/remove-attr). See [ACKNOWLEDGMENT.md](./ACKNOWLEDGMENT.md) for more details.

## License

[MIT](./LICENSE)

[npm]: https://www.npmjs.com/package/@castlenine/vite-plugin-remove-attribute
[npm.badge]: https://img.shields.io/npm/v/@castlenine/vite-plugin-remove-attribute
[download]: https://www.npmjs.com/package/@castlenine/vite-plugin-remove-attribute
[download.badge]: https://img.shields.io/npm/d18m/@castlenine/vite-plugin-remove-attribute
[contribution]: https://github.com/Castlenine/vite-plugin-remove-attribute
[contribution.badge]: https://img.shields.io/badge/contributions-welcome-green
