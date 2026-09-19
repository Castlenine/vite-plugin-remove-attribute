# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.3] - 2026-09-19

### Changed

- Internal only: contributor tooling and documentation, with no behaviour change.
- The root `prepare` script was removed; the Lefthook git hooks are now installed by Lefthook's own `postinstall`, approved through `allowBuilds` in `pnpm-workspace.yaml`. If the hooks are missing, run `pnpm exec lefthook install`.
- The unused `esbuild` and `unrs-resolver` entries were dropped from `allowBuilds`, leaving `lefthook` as the only approved build.
- `pnpm lint`, `pnpm lint:fix`, `pnpm format` and `pnpm format:check` no longer use the ESLint / Prettier caches.
- Nothing in the published `dist/` output changed.

## [2.0.2] - 2026-09-19

### Changed

- Internal only: contributor tooling and documentation, with no behaviour change.
- Markdown is now linted with markdownlint-cli2, and the pre-commit hook runs an optional ggshield secret scan.
- Contributors need pnpm `>=12.4.2`, enforced through `devEngines.packageManager`; the `packageManager` field was dropped and pnpm is no longer auto-downloaded.
- `ACKNOWLEDGEMENT.md` was renamed to `ACKNOWLEDGMENT.md`, and the README links and anchor follow (`#acknowledgement` is now `#acknowledgment`).
- Development dependencies were refreshed (`@types/node`, `prettier`).
- Nothing in the published `dist/` output changed.

## [2.0.1] - 2026-09-16

### Changed

- Internal only: the source was realigned with the project code conventions (`#` private members, function declarations, `!= null` checks) with no behaviour change.
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
- `engines.node` is declared as `>=18.0.0`. The bundle targets ES2022, which Node 18 runs natively, so the plugin works with every Vite version from 2 to 8 on any Node release those versions support from 18 upwards.
- `CHANGELOG.md` ships in the npm tarball.

### Changed

- The package has been renamed from `@castlenine/vite-remove-attribute` to `@castlenine/vite-plugin-remove-attribute` to align with the Vite plugin naming convention. Uninstall the old name, install the new one and update the import specifier; the default export, the options and the behaviour documented above are otherwise the same.
- The CommonJS entry moved from `dist/index.umd.cjs` to `dist/index.cjs`. `require()` still returns the plugin function and `.default` is also available; the entry is typed by `dist/index.d.cts`.

[2.0.3]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/Castlenine/vite-plugin-remove-attribute/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Castlenine/vite-plugin-remove-attribute/releases/tag/v2.0.0
