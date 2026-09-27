# Contributing to `@castlenine/vite-plugin-remove-attribute`

Thank you for your interest in contributing!

Whether you are reporting a bug, suggesting a feature, or submitting a pull request, your help is appreciated.

## Prerequisites

| Requirement                    | Version         | Notes                                                                                                                                                      |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/) | v24.15+ or v26+ | Enforced by `devEngines` in `package.json` (`.nvmrc` pins the exact version for `nvm use`); the published plugin itself supports Node `>=18` for consumers |
| [pnpm](https://pnpm.io/)       | 11.0.0+         | Enforced by `devEngines` in `package.json` — install it yourself, it is not auto-downloaded; use `pnpm install`, never `npm install` or `yarn install`     |

`pnpm-workspace.yaml` sets `minimumReleaseAge` to two days, so `pnpm add` and `pnpm update-packages` resolve to the newest release that is at least that old; a version published more recently will not install until it ages past that window.

## Getting Started

1. [Fork](https://github.com/Castlenine/vite-plugin-remove-attribute/fork) the repository.
2. Clone your fork locally:

   ```shell
   git clone https://github.com/<your-username>/vite-plugin-remove-attribute.git
   cd vite-plugin-remove-attribute
   ```

3. Install dependencies:

   ```shell
   pnpm install
   ```

   `pnpm install` runs Lefthook's own `postinstall` script (allowed through `allowBuilds` in `pnpm-workspace.yaml`), which installs the git hooks — no extra step required. If the hooks are missing, run `pnpm exec lefthook install`.

4. Run the tests and build to verify your setup:

   ```shell
   pnpm test
   pnpm build
   ```

   Optionally, run the slower integration suite, which performs a real `vite build` per framework; every framework it needs is already a devDependency in `package.json`, so there is nothing extra to install:

   ```shell
   pnpm test:integration
   ```

## How the Plugin Works

Read [documentation/how-it-works.md](documentation/how-it-works.md) before changing the transform. It covers file kinds, how a match is verified and bounded, the scan budget, compiled Astro modules, ignore matching, warnings, sourcemaps and concurrent builds.

If your change alters behavior, update that page and the [README](README.md) in the same pull request.

## Development Workflow

1. Create a branch from `development`.
2. Make your changes, adding or updating tests in the matching layer (see [Test layout](#test-layout)).
3. Push your branch and open a pull request against `development`.

### Test layout

- `src/*.test.ts` — unit tests colocated with the source; `src/*.test-d.ts` — type tests.
- `tests/fixtures/<framework>/` — real component sources fed to the plugin; they are excluded from ESLint, Prettier and the root `tsconfig.json` on purpose, so do not format them.
- `tests/frameworks/` — runs `transform` on each fixture and checks the output and the sourcemap positions.
- `tests/integration/` — a real `vite.build()` (and Astro `build()`) per framework, run with `pnpm test:integration`.
- `tests/packaging/` — checks the shape of `dist/`; `tests/property/` — fast-check property tests (removal, ranges, sourcemaps); `tests/performance/` — linear-time property checks, run with `pnpm test:performance`.

As a rule of thumb, a parser change gets a unit case in `src/utilities.test.ts`, a fixture case in every framework it affects, and a property or performance case when it touches scanning.

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by [Commitlint](https://commitlint.js.org/).

Optionally, you can use `pnpm commit` to launch the interactive Commitizen prompt, which guides you through the format.

**Format:** `type(scope): subject`

### Allowed Commit Types

| Type              | Description                                        |
| ----------------- | -------------------------------------------------- |
| `BREAKING-CHANGE` | A change that breaks backward compatibility        |
| `build`           | Modifications to build systems or processes        |
| `cherry-pick`     | Cherry-picks a specific commit                     |
| `chore`           | Routine maintenance tasks                          |
| `ci`              | Updates to CI/CD configuration                     |
| `comment`         | Modifications or additions to code comments        |
| `config`          | Modifications to configuration files               |
| `deps`            | Dependency additions, removals, or updates         |
| `docs`            | Changes to documentation                           |
| `feat`            | A new feature or improvement                       |
| `fix`             | A bug fix or issue resolution                      |
| `hotfix`          | An urgent fix for a critical production issue      |
| `merge`           | Merges changes from one branch into another        |
| `perf`            | Performance optimization                           |
| `prune`           | Removal of unnecessary files or cleanup            |
| `refactor`        | Code restructuring without behavior changes        |
| `revert`          | Rolls back a previous commit                       |
| `security`        | Security vulnerability fixes or enhancements       |
| `style`           | Code formatting changes (no logic changes)         |
| `temp`            | Provisional commit marked for cleanup before merge |
| `test`            | Adding or improving tests                          |
| `version`         | Updates project version metadata                   |
| `wip`             | Work in progress                                   |

## Code Quality

[Lefthook](https://github.com/evilmartians/lefthook) git hooks run automatically on each commit, but you can also run these tools manually:

| Tool | Command | Purpose |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| ESLint               | `pnpm lint:fix`                      | Lint and auto-fix TypeScript and JavaScript                               |
| Prettier             | `pnpm format`                        | Format all files                                                          |
| markdownlint         | `pnpm markdownlint:fix`              | Lint and auto-fix Markdown                                                |
| TypeScript           | `pnpm type-check`                    | Type-check the codebase                                                   |
| Vitest               | `pnpm test` (also `pnpm test:watch`) | Run the `unit` and `performance` projects                                 |
| Vitest (performance) | `pnpm test:performance`              | Run the `performance` project: linear-time property checks                |
| Vitest (coverage)    | `pnpm test:coverage`                 | Run the `unit` project with coverage; enforces the 100 % threshold        |
| Vitest (integration) | `pnpm test:integration`              | Run the `integration` project: a real `vite build` per framework (slower) |
| Package check        | `pnpm package`                       | Build, then validate `dist/` with `publint` and `arethetypeswrong`        |
| **All of the above** | `pnpm clean-code`                    | Run Prettier, ESLint, then markdownlint                                   |

### Secret Scanning (optional)

The pre-commit hook also runs [ggshield](https://github.com/GitGuardian/ggshield), GitGuardian's CLI, to scan staged files for secrets (API keys, tokens, credentials) before they reach the repository.

- **Optional:** when `ggshield` is not installed, the hook prints a warning and the commit proceeds.
- **Setup:** [install it](https://docs.gitguardian.com/ggshield-docs/getting-started), then authenticate once with `ggshield auth login` (requires a free GitGuardian account). An installed but unauthenticated `ggshield` fails the scan and blocks the commit.
- **When a secret is found:** the commit is blocked. Remove the secret and rotate it if it was real. For a false positive, run `ggshield secret ignore --last-found` and commit the resulting `.gitguardian.yaml`.

Before opening a pull request, you can also run `pnpm package` — it builds the package and validates the output with `publint` and `arethetypeswrong`. These are the same checks that run before publishing.

## Pull Requests

- Target the `development` branch.
- Use a descriptive title following the commit convention format (e.g., `feat: support attribute values with template literals`).
- Include a clear description of what changed and why.
- Ensure lint, type-check, tests, and build all pass before requesting a review.

## Reporting Issues

- [Report a bug](https://github.com/Castlenine/vite-plugin-remove-attribute/issues/new?template=bug-report.yml)
- [Request a feature](https://github.com/Castlenine/vite-plugin-remove-attribute/issues/new?template=feature-request.yml)

## AI Disclosure

Using LLMs, AI agents, or similar tools during development is perfectly fine. What matters is transparency.

As the maintainer, I use AI agents to challenge my own biases, review technical approaches, and for grammar correction.

Being open about this helps everyone understand how the code was written and why we made specific decisions.

If you used AI tools while working on your contribution, please mention it in your pull request. A brief note is enough: for example, which tools and models you used and how they helped (code generation, refactoring suggestions, documentation drafting, etc.).

**This is not about gatekeeping; it is about maintaining a clear and honest record of how the project evolves.**

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
