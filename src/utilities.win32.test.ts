import type * as NodePath from 'node:path';
import type { Options } from './types';
import type { ResolvedConfig } from 'vite';

import { describe, expect, it, vi } from 'vitest';

// `utilities.ts` imports `{ relative, sep }` from `node:path`; the mock must expose those two names off the
// `win32` implementation so every path operation in this file behaves as it would on Windows, regardless of the
// platform the test suite actually runs on
vi.mock('node:path', async (importOriginal) => {
	const ACTUAL = await importOriginal<typeof NodePath>();

	return { ...ACTUAL.win32, default: ACTUAL.win32 };
});

const { createIgnoreMatcher, getOptions, toRelativePath } = await import('./utilities');
const { default: removeAttributesPlugin } = await import('./index');

/**
 * Builds an ignore matcher from partial plugin options, defaulting the parts the ignore rules do not read.
 *
 * @param options - The ignore-related plugin options under test.
 *
 * @returns A matcher reporting whether a Windows-style path relative to the Vite root is ignored.
 */
function createIgnoreMatcherFor(options: Partial<Options>) {
	return createIgnoreMatcher(getOptions({ attributes: [], ...options }));
}

describe('toRelativePath on Windows', () => {
	it('converts a module under the root to a POSIX-separated relative path', () => {
		expect(toRelativePath('C:\\r\\src\\a.svelte', 'C:\\r')).toBe('src/a.svelte');
	});

	it('strips the query suffix before computing the relative path', () => {
		expect(toRelativePath('C:\\r\\src\\a.svelte?svelte&type=style', 'C:\\r')).toBe('src/a.svelte');
	});

	it('keeps an absolute, POSIX-separated path when the drive letters differ', () => {
		// `path.win32.relative` cannot express a cross-drive path as a relative one, so it returns the target
		// path unchanged; `toRelativePath` still normalizes its separators to `/`
		expect(toRelativePath('D:\\x\\a.svelte', 'C:\\r')).toBe('D:/x/a.svelte');
	});

	it('resolves a module under a UNC root', () => {
		expect(toRelativePath('\\\\server\\share\\r\\src\\a.svelte', '\\\\server\\share\\r')).toBe('src/a.svelte');
	});
});

describe('createIgnoreMatcher on Windows paths', () => {
	it('does not ignore a cross-drive absolute path, since it names no ignored segment', () => {
		const HAS_IGNORE_PATH = createIgnoreMatcherFor({});

		expect(HAS_IGNORE_PATH(toRelativePath('D:\\x\\a.svelte', 'C:\\r'))).toBe(false);
	});

	it('ignores node_modules nested under a Windows root', () => {
		const HAS_IGNORE_PATH = createIgnoreMatcherFor({});

		expect(HAS_IGNORE_PATH(toRelativePath('C:\\r\\node_modules\\x\\a.svelte', 'C:\\r'))).toBe(true);
	});

	it('matches a configured folder token against a Windows path', () => {
		const HAS_CONFIGURED_PATH = createIgnoreMatcherFor({ ignoreFolders: ['src/tests'] });

		expect(HAS_CONFIGURED_PATH(toRelativePath('C:\\r\\src\\tests\\a.svelte', 'C:\\r'))).toBe(true);
	});
});

describe('removeAttributesPlugin on a Windows root and id', () => {
	function createWindowsHarness(options: Options, root: string) {
		const PLUGIN = removeAttributesPlugin(options);
		const CONFIG_RESOLVED = PLUGIN.configResolved as (config: ResolvedConfig) => void;
		const TRANSFORM = PLUGIN.transform as (
			this: unknown,
			code: string,
			id: string,
		) => null | { code: string; map: unknown };

		CONFIG_RESOLVED({ root } as ResolvedConfig);

		return { plugin: PLUGIN, transform: (code: string, id: string) => TRANSFORM(code, id) };
	}

	it('transforms a module named with Windows-style separators', () => {
		const { transform } = createWindowsHarness({ extensions: ['svelte'], attributes: ['data-testid'] }, 'C:\\r');

		expect(transform('<div data-testid="a" />', 'C:\\r\\src\\App.svelte')).toEqual({
			code: '<div />',
			map: expect.objectContaining({ version: 3 }),
		});
	});

	it('skips a module under an ignored folder named with Windows-style separators', () => {
		const { transform } = createWindowsHarness(
			{ extensions: ['svelte'], attributes: ['data-testid'], ignoreFolders: ['src/tests'] },
			'C:\\r',
		);

		expect(transform('<div data-testid="a" />', 'C:\\r\\src\\tests\\a.svelte')).toBeNull();
	});
});
