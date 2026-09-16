<div align="center">

# `@castlenine/vite-plugin-remove-attribute`

[![npm.badge]][npm] [![download.badge]][download] [![contribution.badge]][contribution]

Vite plugin that allows the removal of specified attributes and supports a variety of options, including file extensions, attributes, ignored folders, and files.
</div>

## Table of Contents

- [Disclaimer](#disclaimer)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
  - [Prerequisites](#prerequisites)
  - [Notes](#notes)
  - [Options](#options)
  - [Ignore matching](#ignore-matching)
  - [Sourcemaps](#sourcemaps)
- [Examples](#examples)
  - [SvelteKit](#sveltekit-example-1-removing-data-testid-attributes-from-svelte-files)
  - [Vue.js](#vuejs-example-1-removing-data-testid-attributes-from-vue-files)
  - [Opting out of the built-in ignore list](#opting-out-of-the-built-in-ignore-list)
  - [CommonJS](#commonjs)
- [Changelog](#changelog)
- [Acknowledgement](#acknowledgement)
- [License](#license)

## Disclaimer

**Only tested with Svelte, SvelteKit and Vue.js projects**. Please open an issue if you encounter any problems with other frameworks.

## Features

- Removes specified attributes in their quoted, expression (`={…}`) and bare forms
- Allows you to specify the file extensions to be processed
- Can ignore certain folders or files based on configuration
- Emits a sourcemap for every transformed file, so stack traces and debuggers keep pointing at the original code
- Ensures clean production code by removing unnecessary attributes, like `data-testid` used in testing

## Requirements

| Requirement | Version                     |
| ----------- | --------------------------- |
| Node.js     | `>=18.0.0`                  |
| Vite        | `>=2.0.0` (peer dependency) |

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

### Prerequisites

To use this plugin, you must have a Vite config file set up in your project. If you don't have one, create a `vite.config.js` or `vite.config.ts` file in the root of your project.

### Notes

For some frameworks, like Svelte & SvelteKit, this plugin should be placed first (before the framework's plugin) in the `plugins` array and for others, like Vue.js, it should be placed after the framework's plugin.

### Options

| Option           | Type       | Default | Description                                                                                 |
| ---------------- | ---------- | ------- | ------------------------------------------------------------------------------------------- |
| `extensions`     | `string[]` | —       | File extensions to process, without the leading dot (e.g. `['svelte', 'vue']`)              |
| `attributes`     | `string[]` | —       | Attribute names to remove (e.g. `['data-testid']`)                                          |
| `ignoreFolders`  | `string[]` | `[]`    | Folders to skip, relative to the Vite root (e.g. `['src/tests']`)                           |
| `ignoreFiles`    | `string[]` | `[]`    | Files to skip, relative to the Vite root (e.g. `['Header.svelte', 'src/lib/Modal.svelte']`) |
| `ignoreDefaults` | `boolean`  | `true`  | Apply the built-in ignore list on top of `ignoreFolders` / `ignoreFiles`                    |

The attribute is removed in its quoted form (`data-testid="a"`), its expression form (`data-testid={value}`, including template literals with nested `${…}`), its bare form (`<input data-testid />`) and with a Vue binding prefix (`:data-testid`, `v-bind:data-testid`). Matching is case-insensitive on the attribute name, and longer names such as `data-testid-extra` are left untouched.

### Ignore matching

Ignore tokens are matched against the module path **relative to the Vite root**, on path-segment boundaries: `build` matches `build/app.js` but not `buildhome/app.js`, and `src/tests` matches `src/tests/a.svelte` but not `src/tests-e2e/a.svelte`. A `*` matches any characters within a single segment (`*.stories.svelte`, `.env.*`).

The built-in ignore list covers `node_modules`, `.git`, `.idea`, `.vscode`, `.DS_Store`, `Thumbs.db`, `.env`, `.env.*`, `logs`, `*.log`, `public`, `build`, `.svelte-kit`, `dist`, `.nuxt`, `.next`, `.remix`, `e2e`, `angular.json`, `browserslist` and `.cache`. Set `ignoreDefaults: false` to keep only your own tokens.

### Sourcemaps

Every transformed file returns a sourcemap (generated without any runtime dependency), so a `build.sourcemap` setting in your Vite config keeps mapping the generated code to the original lines and columns even when an attribute sat on its own line.

## Examples

### SvelteKit example 1: Removing 'data-testid' attributes from `.svelte` files

This configuration will remove `data-testid` attributes from all `.svelte` files in the production build only.

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig(({ mode }) => ({
 plugins: [
  mode === 'production'
   ? removeAttribute({
     extensions: ['svelte'],
     attributes: ['data-testid'],
    })
   : null,

  sveltekit(), // SvelteKit plugin should be placed after removeAttribute
 ],
}));
```

### SvelteKit example 2: Ignoring specific folders and files

This configuration will remove `data-testid` and `data-id` attributes from all `.svelte`, `.ts`, and `.js` files, with the exception of those located in the `src/tests` and `src/utilities` folders, as well as the `Header.svelte`, `src/components/Modal.svelte`, and `src/layouts/LayoutAuth.svelte` files in all builds.

```typescript
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig({
 plugins: [
  removeAttribute({
   extensions: ['svelte', 'ts', 'js'],
   attributes: ['data-testid', 'data-id'],
   ignoreFolders: ['src/tests', 'src/utilities'],
   ignoreFiles: ['Header.svelte', 'src/components/Modal.svelte', 'src/layouts/LayoutAuth.svelte'],
  }),

  sveltekit(), // SvelteKit plugin should be placed after removeAttribute
 ],
});
```

### Vue.js example 1: Removing 'data-testid' attributes from `.vue` files

This configuration will remove `data-testid` attributes from all `.vue` files in the production build only.

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig(({ mode }) => ({
 plugins: [
  vue(), // Vue plugin should be placed before removeAttribute
  mode === 'production'
   ? removeAttribute({
     extensions: ['vue'],
     attributes: ['data-testid'],
    })
   : null,
 ],
}));
```

### Vue.js example 2: Ignoring specific folders and files

This configuration will remove `data-testid` and `data-id` attributes from all `.vue`, `.ts`, and `.js` files, with the exception of those located in the `src/tests` and `src/utilities` folders, as well as the `Header.vue`, `src/components/Modal.vue`, and `src/layouts/LayoutAuth.vue` files in all builds.

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

import removeAttribute from '@castlenine/vite-plugin-remove-attribute';

export default defineConfig({
 plugins: [
  vue(), // Vue plugin should be placed before removeAttribute
  removeAttribute({
   extensions: ['vue', 'ts', 'js'],
   attributes: ['data-testid', 'data-id'],
   ignoreFolders: ['src/tests', 'src/utilities'],
   ignoreFiles: ['Header.vue', 'src/components/Modal.vue', 'src/layouts/LayoutAuth.vue'],
  }),
 ],
});
```

### Opting out of the built-in ignore list

With `ignoreDefaults: false` only your own `ignoreFolders` / `ignoreFiles` tokens apply, so files under `public/` or `build/` are processed too.

```typescript
removeAttribute({
 extensions: ['svelte'],
 attributes: ['data-testid'],
 ignoreDefaults: false,
 ignoreFolders: ['node_modules'],
});
```

### CommonJS

The package also ships a CommonJS entry. `require()` returns the plugin function directly (`.default` is available as well):

```javascript
// vite.config.cjs
const { defineConfig } = require('vite');
const removeAttribute = require('@castlenine/vite-plugin-remove-attribute');

module.exports = defineConfig({
 plugins: [removeAttribute({ extensions: ['svelte'], attributes: ['data-testid'] })],
});
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Acknowledgement

This project is a fork of [mustafadalga/remove-attr](https://github.com/mustafadalga/remove-attr). See
[ACKNOWLEDGEMENT.md](./ACKNOWLEDGEMENT.md).

## License

[MIT](./LICENSE)

[npm]: https://www.npmjs.com/package/@castlenine/vite-plugin-remove-attribute
[npm.badge]: https://img.shields.io/npm/v/@castlenine/vite-plugin-remove-attribute
[download]: https://www.npmjs.com/package/@castlenine/vite-plugin-remove-attribute
[download.badge]: https://img.shields.io/npm/d18m/@castlenine/vite-plugin-remove-attribute
[contribution]: https://github.com/Castlenine/vite-plugin-remove-attribute
[contribution.badge]: https://img.shields.io/badge/contributions-welcome-green
