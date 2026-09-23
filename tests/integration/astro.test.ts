import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'astro';

import removeAttributesPlugin from '../../src/index';

const FIXTURE_ROOT = resolve(import.meta.dirname, '../fixtures/astro');
// Node's module resolution walks up looking for a `node_modules` folder; a copy made under the project's own
// `node_modules` inherits the project's installed `astro` (and its `astro/compiler-runtime` subpath) the same way
// a real dependency of a real project would. A copy under `os.tmpdir()` sits outside that resolution chain, so
// Astro's own Vite plugin fails to resolve its runtime import from the copied `.astro` files.
const TEMPORARY_ROOT_PARENT = resolve(import.meta.dirname, '../../node_modules');
const DATA_TESTID_REGEX = /data-testid\s*=|\sdata-testid[\s/>]/;
// Every `data-testid` the plugin removes from the dynamic page, as the page renders it without the plugin. The values
// starting with `keep-` are rendered from runtime data — a spread object, an HTML string, the body of an inline
// script — which no transform can tell from the rest of the data
const REMOVED_DATA_TESTID_REGEX = / data-testid="(?!keep-)[^"]*"/gi;

let temporaryRoot = '';

/**
 * Builds the fixture project copied under the temporary root.
 *
 * @param options.outDir - The output folder, relative to the temporary root.
 * @param options.hasPlugin - Whether `removeAttributesPlugin` is registered.
 */
async function buildFixture(options: { outDir: string; hasPlugin: boolean }): Promise<void> {
	await build({
		root: temporaryRoot,
		logLevel: 'silent',
		outDir: join(temporaryRoot, options.outDir),
		// Astro writes its prerender cache under `cacheDir`, which otherwise lands in the repo root as `.astro/`
		cacheDir: join(temporaryRoot, `.astro-cache-${options.outDir}`),
		vite: { plugins: options.hasPlugin ? [removeAttributesPlugin({ attributes: ['data-testid'] })] : [] },
	});
}

/**
 * Reads a page the fixture build wrote.
 *
 * @param path - The path of the page, relative to the temporary root.
 *
 * @returns The HTML of the page.
 */
async function readPage(path: string): Promise<string> {
	// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from import.meta.dirname and a mkdtemp directory, not from input
	return readFile(join(temporaryRoot, path), 'utf8');
}

describe('Astro real build', () => {
	beforeAll(async () => {
		// Astro writes a telemetry marker under the user's home directory on every build; that write is outside this
		// package's sandbox and fails there, so telemetry is opted out before the first `build()` call
		process.env.ASTRO_TELEMETRY_DISABLED = '1';

		// A symlinked ancestor (e.g. `/tmp` -> `/private/tmp` on macOS) would desync Astro's Vite plugin from the
		// compile-metadata cache it keys by realpath, so the realpath is resolved explicitly rather than trusting
		// whatever `mkdtemp` handed back
		// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from import.meta.dirname and a mkdtemp directory, not from input
		temporaryRoot = await realpath(await mkdtemp(join(TEMPORARY_ROOT_PARENT, '.remove-attribute-astro-fixture-')));
		await cp(FIXTURE_ROOT, temporaryRoot, { recursive: true });

		// The inline `vite.plugins` merge does apply the plugin — verified against the `astro:config:setup` ->
		// `updateConfig({ vite: { plugins: [...] } })` integration form, which produces byte-identical output — so
		// there is no fallback to report here.
		await buildFixture({ outDir: 'dist-baseline', hasPlugin: false });
		await buildFixture({ outDir: 'dist', hasPlugin: true });
	});

	afterAll(async () => {
		if (temporaryRoot) {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it('removes every static data-testid from the built page and keeps control attributes', async () => {
		const HTML = await readPage('dist/index.html');

		// `body`/`main`'s data-testid is a static quoted attribute in index.astro's own markup — the compiler bakes
		// it into the template literal of its render function, whose markup the plugin reads
		expect(HTML).not.toMatch(/data-testid="(body|main|raw-html|inline-script)"/);
		expect(HTML).toContain('class="page"');
		expect(HTML).toContain('class="main"');
		expect(HTML).toContain('class="card"');
		expect(HTML).toContain('class="raw"');
		expect(HTML).toContain('class="inline"');

		expect(HTML).not.toContain('cost ${price}');
		expect(HTML).toMatch(/<p class="price" data-astro-cid-\w+>cost paid<\/p>/);
		// The plugin reads Astro's compiled module, whose render template escapes the literal `${` of the markup as
		// `\${`: no placeholder opens, so the value ends at its own closing quote and the `title` survives
		expect(HTML).toMatch(/<p title="\}" class="spanned-title" data-astro-cid-\w+>spanned title<\/p>/);
		// The nested-quote placeholders of the frontmatter and of the processed `<script>` are removed whole, and
		// both still build
		expect(HTML).toMatch(/<div class="badge-host" data-astro-cid-\w+><b class="badge">badge<\/b><\/div>/);
		expect(HTML).not.toContain('badge-free');
		expect(HTML).toContain('<b class="script-badge">script</b>');
		expect(HTML).not.toContain('waiting');
	});

	// `data-testid={expression}` is compiled by Astro's compiler into a `${$$addAttribute(value, "data-testid")}`
	// placeholder of the render template before the plugin sees the file; the plugin removes the placeholder whole
	it('removes expression-valued data-testid from the built page', async () => {
		const HTML = await readPage('dist/index.html');

		expect(HTML).not.toMatch(DATA_TESTID_REGEX);
		expect(HTML).toContain('<h2 class="card-title"');
		expect(HTML).toMatch(/<li class="item" data-astro-cid-\w+>a<\/li>/);
	});

	it('removes dynamic attributes and component props, leaving the rest of the page byte-identical', async () => {
		const BASELINE = await readPage('dist-baseline/dynamic/index.html');
		const HTML = await readPage('dist/dynamic/index.html');

		expect(BASELINE).toContain('data-testid="body-dynamic"');
		expect(BASELINE).toContain('data-TestId="on"');
		expect(BASELINE).toContain('data-testid="forward-dynamic"');
		expect(HTML).toBe(BASELINE.replace(REMOVED_DATA_TESTID_REGEX, ''));
		// Runtime data renders its attribute unchanged: an object spread onto an element, an HTML string and the text
		// of an inline script
		expect(HTML).toContain('data-testid="keep-spread"');
		expect(HTML).toContain('<b data-testid="keep-string">string</b>');
		expect(HTML).toContain('\'<i data-testid="keep-inline">\'');
	});
});
