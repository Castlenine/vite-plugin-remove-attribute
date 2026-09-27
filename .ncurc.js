/**
 * npm-check-updates config: upgrades are offered for all packages, except the versions another devDependency's
 * peer range does not accept yet, which are blocked here at upgrade-suggestion time. Drop a pin once the package
 * that imposes it widens its range.
 */

/**
 * Highest accepted version per package: `major` always, `minor` too when the constraint is narrower than a major
 * (or the package is still on `0.x`, where a minor bump is breaking)
 *
 * @type {Readonly<Record<string, Readonly<{ major: number, minor?: number }>>>}
 */
const VERSION_PINS = {
	// `@analogjs/vite-plugin-angular` 2.x peers on `@angular/build` up to `^22.0.0`
	'@angular/build': { major: 22 },
	// The Angular packages move in lockstep: `@angular/build` peers on `^22` of the others, which peer on exact 22.x versions
	'@angular/common': { major: 22 },
	'@angular/compiler': { major: 22 },
	'@angular/compiler-cli': { major: 22 },
	'@angular/core': { major: 22 },
	'@angular/platform-browser': { major: 22 },
	// `@jridgewell/remapping` depends on `^0.3.24`, and `ast-v8-to-istanbul` (`@vitest/coverage-v8`) on `^0.3.31`
	'@jridgewell/trace-mapping': { major: 0, minor: 3 },
	// `@commitlint/cz-commitlint` peers on `commitizen` `^4.0.3`
	commitizen: { major: 4 },
	// `@eslint/js` 10.x peers on `eslint` `^10.0.0`; `typescript-eslint`, `eslint-plugin-perfectionist` and
	// `eslint-plugin-sonarjs` peer on ranges ending at `^10.0.0`
	eslint: { major: 10 },
	// `@angular/core` and `@angular/common` peer on `rxjs` `^6.5.3 || ^7.4.0`
	rxjs: { major: 7 },
	// `vite-plugin-solid` 2.x peers on `solid-js` `^1.7.2`
	'solid-js': { major: 1 },
	// `@sveltejs/vite-plugin-svelte` 7.x peers on `svelte` `^5.46.4`
	svelte: { major: 5 },
	// `typescript-eslint`, `eslint-plugin-sonarjs`, `@angular/build` and `@angular/compiler-cli` accept `typescript` `<6.1.0`
	typescript: { major: 6, minor: 0 },
	// `@sveltejs/vite-plugin-svelte` peers on `vite` `^8.0.0`, `astro` depends on `^8.0.13`, and `vitest`,
	// `@analogjs/vite-plugin-angular`, `@vitejs/plugin-vue` and `@preact/preset-vite` peer on ranges ending at 8
	vite: { major: 8 },
	// `@fast-check/vitest` peers on `vitest` `^4.1.0 || ^5.0.0` (`@vitest/coverage-v8` moves in lockstep with `vitest`)
	vitest: { major: 5 },
	'@vitest/coverage-v8': { major: 5 },
	// `@vitejs/plugin-vue` 6.x peers on `vue` `^3.2.25`
	vue: { major: 3 },
};

/** @type {import('npm-check-updates').RunOptions} */
const NCU_CONFIG = {
	// Wait at least 2 days after new versions are published before suggesting them (mirrors `minimumReleaseAge` in
	// pnpm-workspace.yaml)
	cooldown: '2d',
	filterResults(packageName, { upgradedVersionSemver }) {
		const PIN = VERSION_PINS[packageName];

		if (PIN == null) return true;

		// Despite ncu's type declaration, `upgradedVersionSemver` is undefined at runtime for complex/non-semver
		// ranges, so the optional chain is required; an unparsable version is let through for manual review
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const MAJOR_VERSION = Number.parseInt(upgradedVersionSemver?.major ?? '', 10);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		const MINOR_VERSION = Number.parseInt(upgradedVersionSemver?.minor ?? '', 10);

		if (!Number.isFinite(MAJOR_VERSION)) return true;
		if (MAJOR_VERSION !== PIN.major) return MAJOR_VERSION < PIN.major;
		if (PIN.minor == null || !Number.isFinite(MINOR_VERSION)) return true;

		return MINOR_VERSION <= PIN.minor;
	},
};

export default NCU_CONFIG;
