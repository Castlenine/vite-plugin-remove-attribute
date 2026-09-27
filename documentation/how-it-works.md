# How it works

This page explains how `@castlenine/vite-plugin-remove-attribute` works internally, for contributors. Installation, options, examples and limitations are in the [README](../README.md).

## Table of Contents

- [Pipeline](#pipeline)
- [File kinds](#file-kinds)
- [Finding an attribute](#finding-an-attribute)
- [Values that cannot be parsed](#values-that-cannot-be-parsed)
- [Framework notes](#framework-notes)
  - [Script and style sub-requests](#script-and-style-sub-requests)
  - [Compiled Astro modules](#compiled-astro-modules)
  - [HTML entries](#html-entries)
- [Ignore matching](#ignore-matching)
- [Warnings](#warnings)
- [Sourcemaps](#sourcemaps)
- [Multi-environment and concurrent builds](#multi-environment-and-concurrent-builds)

## Pipeline

`removeAttribute()` returns one plugin, `remove-attributes`, with `enforce: 'pre'`. Its `transform` hook returns `null`, leaving the module untouched, when:

- no attribute name survived option cleaning;
- the id is virtual (`\0…`), its extension is not in `extensions`, or it is a style sub-request;
- the path, relative to the Vite root, matches an ignore token.

Otherwise the matcher returns a list of `[start, end)` ranges plus the positions of attributes it had to leave in place. `removeRanges` cuts the ranges out in one forward pass, and `generateRemovalSourceMap` maps the result back to the original.

Every matcher (attributes, extensions, ignore paths) compiles its patterns once per plugin instance, not once per module.

## File kinds

The kind decides where an attribute may sit in a module. It comes from the module's extension, not from the preset that listed it, and a compound name uses its last extension, so `Counter.svelte.ts` is a `ts` module. The extension still has to be in `extensions` for the file to be scanned at all.

| Kind | Resolves from | Where attributes are removed |
| - | - | - |
| `script` | `JAVASCRIPT_EXTENSIONS`, `JSX_EXTENSIONS`; an HTML entry's inline-script proxy (`…?html-proxy&index=N.js`); a Vue or Astro `<script>` sub-request (`App.vue?vue&type=script…`, `Page.astro?astro&type=script…`) | Opening tags of JSX elements and of markup inside template literals. Strings, comments, regular expressions and JSX text are left alone, except the closed markup of an Angular `template:` string, and of every plain string once `removeInStrings` is on. |
| `ts` | `.ts`, `.mts`, `.cts` | Same as `script`, but `<` never opens a JSX element, since TypeScript forbids JSX there. A type assertion (`<T>value`) never turns the code after it into element text. |
| `markup` | `SVELTE_EXTENSIONS`, plus any extension no other kind claims | Opening tags. `<script>` blocks and `{…}` expressions are read as `script`. Text, comments, `<style>` and a leading `---` front-matter block are left alone. |
| `vue` | `VUE_EXTENSIONS` | Same as `markup`, except a single `{` opens nothing. Only a `{{ … }}` interpolation is an expression. |
| `markdown` | `.md`, `.mdx`, `.svx` | Same as `markup`, except a fenced code block is text, whatever it holds. |
| `astro` | `ASTRO_EXTENSIONS` | Same as `markup`, except the leading `---` fence holds the component's TypeScript. In a real Astro build the module arrives compiled and is scanned as `ts` (see [Compiled Astro modules](#compiled-astro-modules)). |
| `html` | `HTML_EXTENSIONS` | Opening tags. A `{` is text, and only a JavaScript `<script>` block is code. |

What a `<script>` block holds depends on its opening tag:

- no `type`, an empty one, `module` or a JavaScript MIME type: code, compared on the MIME essence (`text/javascript; charset=utf-8` counts);
- `lang="jsx"` / `lang="tsx"`, `text/babel` or `text/jsx`: code that may hold JSX;
- `text/html` or a type ending in `template` (`text/x-template`): markup, read like the rest of the document;
- any other type (`application/json`, `importmap`), or a tag with `src`: data, never edited.

The README lists the matched value forms under [How matching works](../README.md#how-matching-works).

## Finding an attribute

The configured names are compiled into one case-insensitive alternation, longest name first, so a configured `data-testid-extra` wins over a configured `data-testid`. A literal-led pattern lets the regex engine skip ahead with a fast search, so a module that mentions none of the names costs a single pass.

The tag mask is built on the first hit only. It marks, one byte per character, which positions belong to the attribute list of an opening tag, plus the `${` placeholders of template literals. A hit that doesn't start inside an attribute list is text, a comment, a string or another value, and is ignored.

Each remaining hit is checked in both directions:

- Backward: an optional `:` or `v-bind:` prefix, then whitespace or a `"`, `'` or `}` closing the previous value. Any other character means the name ends a longer one (`xdata-testid`), which never matches.
- Forward: the value form (quoted, `={…}`, unquoted, `${…}` placeholder, or bare), read by the value scanners.

The whitespace in front of the attribute joins the range only when the attribute is followed by whitespace, `/`, `>` or the end of the input. That way, removing an attribute on its own line leaves no blank line, and `class="x"data-testid="y">` keeps its `>`.

The scan resumes at the end of each accepted range, so ranges come out sorted and non-overlapping without a merge pass. `assertRangeFollowsPrevious` throws if that ever breaks, because `removeRanges` and the sourcemap generator both rely on it.

Quoted values are read in one of two modes. In `.svelte` files, a `{…}` inside a quoted value is a JavaScript expression (which also covers `${…}`). In every other file, only a `${…}` placeholder is, as in a Lit `html` template.

## Values that cannot be parsed

When a value can't be bounded (an unbalanced `={`, an unbalanced `{` in an unquoted value, an element opened inside the value and never closed), the attribute stays in place and its position is recorded for a warning.

Each matcher call carries an `ExpressionScanBudget` of 4 × the input length. It pays for scan work that gets thrown away: expressions that never close, and values rejected after their expressions balanced. Once it runs out, a value that would need a scan is treated like an unbalanced expression, and a quoted value holding a mustache or placeholder is left in place, since its closing quote may sit inside the expression. This keeps a call linear in the input length, even for a file with thousands of unbalanced `={`.

With `removeInStrings`, a range that would cross the bounds of the string holding the markup is not removed either. It is recorded for the same warning.

## Framework notes

### Script and style sub-requests

A Vue or Astro component's extracted `<script>` sub-request keeps its `.vue` / `.astro` extension but holds plain script, so it is scanned as `script`. The query is split into parameters first, so a parameter spelled `mytype=script` doesn't count.

Style sub-requests (`?vue&type=style…`, Svelte's `type=style`, `html-proxy&inline-css`, a query ending in a CSS language such as `lang.scss`) are skipped before any scan. A configured name there is selector text or a `content` string, never an attribute.

### Compiled Astro modules

Astro registers its `astro:build` plugin (`enforce: 'pre'`) ahead of every user plugin, so a `.astro` module reaches this plugin already compiled, under the component's unchanged id. When the resolved plugin list has `astro:build` before `remove-attributes`, the main module (an id with no `?`) is scanned as `ts`. The compiled template keeps its markup inside template literals, so static and bare attributes are found the normal way.

Two compiled shapes need extra handling, merged into the regular ranges by `mergeRanges`:

- `${$$addAttribute(value, "data-testid")}` placeholders inside a tag, which is what `data-testid={value}` compiles to. The name is matched case-insensitively.
- Configured props passed to components, custom elements and `<Fragment>`, found in the placeholders between tags.

A range that starts inside one already kept is dropped, so an attribute nested in a removed value isn't cut twice. Any other compiled shape is left untouched.

### HTML entries

Vite only passes entry HTML through `transform` during `vite build`; the dev server serves it without calling the hook. The page's inline module scripts come back as separate html-proxy modules and are scanned as `script`. Their sourcemaps are named after the proxy id, not the page.

## Ignore matching

Ignore tokens match against the module path relative to the Vite root, with its `?query` and `#hash` removed. User tokens (`ignoreFolders`, `ignoreFiles`) and the built-in `node_modules` and `.git` match on whole segments at any depth. Every other built-in token matches only as the first segment under the root, so `build/App.svelte` is skipped while `src/lib/build/Step.svelte` is not.

Since `node_modules` is ignored by default, dependency files are processed only with `ignoreDefaults: false`.

## Warnings

A module with attributes left in place gets one warning through the bundler's `this.warn`, with the first skipped attribute's index as the position, so the bundler prints a code frame. It can be filtered in `onwarn`:

```text
remove-attributes: left N attribute(s) in place in <file> — the value could not be parsed
```

Each module warns once per plugin instance: the client and SSR environments share that record, and `vite build --watch` doesn't repeat it on rebuild. Called without a plugin context (a unit test calling `plugin.transform` directly), the hook skips the warning instead of failing.

An `attributes` or `extensions` list that ends up empty after cleaning gets one warning through Vite's logger per plugin instance, even when Vite resolves the config more than once. It names each rejected entry, printing non-strings by type (`<object>`) because converting an arbitrary value to a string can throw. The build never fails over it.

## Sourcemaps

The README's [Sourcemaps](../README.md#sourcemaps) section says when a map is generated. The transform skips map generation entirely when the build wouldn't use it: during `vite build` with a falsy `build.sourcemap` (Vite's default), it returns `map: null`. A config that was never resolved, because the plugin runs outside Vite, keeps the map.

`src/sourcemap.ts` builds the map without a runtime dependency. Each line gets word-boundary segments, the same as magic-string's `hires: 'boundary'`, so original lines and columns survive the cut, including when a removed attribute sat on its own line. Every map includes the original source in `sourcesContent`.

## Multi-environment and concurrent builds

On Vite 6+, three things are read from the running hook's environment rather than from the last `configResolved` call: the root used for ignore matching, the `build.sourcemap` setting, and whether Astro compiles first. Two builds sharing one plugin instance can therefore use different roots and settings without interfering. On Vite 5 and earlier there is no environment, and every build uses the values from the last resolved config.

The record of reported warnings is shared across environments on purpose, so a module transformed by both client and SSR warns once.
