import type { Options } from './index';
import type { Plugin } from 'vite';

import { describe, expectTypeOf, it } from 'vitest';

import removeAttributesPlugin, { DEFAULT_EXTENSIONS, JSX_EXTENSIONS } from './index';

describe('Options.extensions', () => {
	it('accepts the readonly DEFAULT_EXTENSIONS preset directly, without spreading it', () => {
		expectTypeOf(DEFAULT_EXTENSIONS).toExtend<Options['extensions']>();
	});

	it('accepts an ordinary mutable string[] just as well', () => {
		const CUSTOM_EXTENSIONS: string[] = ['svelte', 'vue'];

		expectTypeOf(CUSTOM_EXTENSIONS).toExtend<Options['extensions']>();
	});
});

describe('Options.attributes', () => {
	it('is required', () => {
		// @ts-expect-error -- `attributes` is required
		removeAttributesPlugin({});

		removeAttributesPlugin({ attributes: ['data-testid'] });
	});
});

describe('Options readonly lists', () => {
	it('accepts `as const` arrays for attributes, ignoreFolders and ignoreFiles', () => {
		const ATTRIBUTES = ['data-testid', 'data-cy'] as const;
		const IGNORE_FOLDERS = ['src/tests', 'fixtures'] as const;
		const IGNORE_FILES = ['Header.svelte'] as const;

		expectTypeOf(ATTRIBUTES).toExtend<Options['attributes']>();
		expectTypeOf(IGNORE_FOLDERS).toExtend<NonNullable<Options['ignoreFolders']>>();
		expectTypeOf(IGNORE_FILES).toExtend<NonNullable<Options['ignoreFiles']>>();

		removeAttributesPlugin({ attributes: ATTRIBUTES, ignoreFolders: IGNORE_FOLDERS, ignoreFiles: IGNORE_FILES });
	});

	it('still accepts ordinary mutable string[] lists', () => {
		const ATTRIBUTES: string[] = ['data-testid'];

		expectTypeOf(ATTRIBUTES).toExtend<Options['attributes']>();
	});

	it('still rejects a list holding something other than strings', () => {
		// @ts-expect-error -- `attributes` holds attribute names only
		removeAttributesPlugin({ attributes: [42] });
	});
});

describe('Options.removeInStrings', () => {
	it('is an optional boolean', () => {
		expectTypeOf<Options['removeInStrings']>().toEqualTypeOf<boolean | undefined>();

		removeAttributesPlugin({ attributes: ['data-testid'], removeInStrings: true });
		removeAttributesPlugin({ attributes: ['data-testid'], removeInStrings: false });
	});

	it('rejects a value of any other type', () => {
		// @ts-expect-error -- `removeInStrings` is a boolean, not a truthy string
		removeAttributesPlugin({ attributes: ['data-testid'], removeInStrings: 'yes' });
		// @ts-expect-error -- `removeInStrings` is a boolean, not a number
		removeAttributesPlugin({ attributes: ['data-testid'], removeInStrings: 1 });
	});
});

describe('extension presets', () => {
	it('are readonly, so mutating one is a type error', () => {
		// @ts-expect-error -- `JSX_EXTENSIONS` is a readonly array
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- the call is a deliberate type error, so its type is unresolved
		JSX_EXTENSIONS.push('foo');
	});
});

describe('removeAttributesPlugin', () => {
	it('returns a Vite Plugin', () => {
		expectTypeOf(removeAttributesPlugin({ attributes: ['data-testid'] })).toEqualTypeOf<Plugin>();
	});
});

describe('Options', () => {
	it('is importable from the package root', () => {
		expectTypeOf<Options>().toExtend<{ attributes: readonly string[] }>();
	});
});
