import type { Range } from './utilities';

import { describe, expect, it } from 'vitest';

import { encodeVlq, generateRemovalSourceMap } from './sourcemap';
import { findAttributeRanges, removeRanges } from './utilities';

const BASE64_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type Segment = [generatedColumn: number, originalLine: number, originalColumn: number];

/**
 * Decodes a string of Base64 VLQ-encoded values into an array of numbers.
 *
 * VLQ (Variable Length Quantity) is used in source maps to efficiently encode numbers.
 * Each value in the input string is decoded by interpreting Base64-encoded segments,
 * handling sign and multi-byte sequences according to the VLQ specification.
 *
 * @param input - The Base64 VLQ-encoded string to decode.
 *
 * @returns An array of decoded numbers.
 */
function decodeVlqs(input: string): number[] {
	const VALUES: number[] = [];

	let value = 0;
	let shift = 0;

	for (const CHARACTER of input) {
		const DIGIT = BASE64_CHARACTERS.indexOf(CHARACTER);

		value += (DIGIT & 31) << shift;
		shift += 5;

		if ((DIGIT & 32) === 0) {
			VALUES.push(value & 1 ? -(value >>> 1) : value >>> 1);
			value = 0;
			shift = 0;
		}
	}

	return VALUES;
}

/**
 * Decodes a VLQ-encoded source map `mappings` string into absolute segments per generated line.
 *
 * This function parses the `mappings` string from a source map, accumulating segment deltas into absolute positions.
 * Each decoded segment is a tuple representing the column in the generated file, the corresponding original line,
 * and the original column (all zero-based). It assumes only one source file (source index is dropped).
 *
 * @param mappings - The VLQ-encoded mappings string from a source map.
 *
 * @returns An array of segments for each generated line. Each segment is a tuple of `[generatedColumn, originalLine, originalColumn]`.
 */
function decodeMappings(mappings: string): Segment[][] {
	let originalLine = 0;
	let originalColumn = 0;

	return mappings.split(';').map((line) => {
		let generatedColumn = 0;

		return line
			.split(',')
			.filter((segment) => segment !== '')
			.map((segment) => {
				const [generatedDelta = 0, , lineDelta = 0, columnDelta = 0] = decodeVlqs(segment);

				generatedColumn += generatedDelta;
				originalLine += lineDelta;
				originalColumn += columnDelta;

				return [generatedColumn, originalLine, originalColumn];
			});
	});
}

/**
 * Resolves the original position (`line` and `column`, both 1-based) for a given position in the generated code,
 * as interpreted from a VLQ source map mappings string.
 *
 * The lookup mimics the behavior of a source map consumer: it finds the closest mapping segment whose generated
 * column is less than or equal to the provided column, and returns the corresponding original line and column. If
 * there is no such mapping segment, returns `null`.
 *
 * @param mappings - The VLQ-encoded source map `mappings` string.
 * @param line - The 1-based generated line number for which to resolve the original position.
 * @param column - The 1-based generated column number for which to resolve the original position.
 *
 * @returns An object with the original `line` (1-based) and `column` (0-based), or `null` if not found.
 */
function originalPositionFor(mappings: string, line: number, column: number): { line: number; column: number } | null {
	const SEGMENTS = decodeMappings(mappings)[line - 1] ?? [];
	const MATCH = SEGMENTS.filter(([generatedColumn]) => generatedColumn <= column).at(-1);

	return MATCH ? { line: MATCH[1] + 1, column: MATCH[2] } : null;
}

describe('encodeVlq', () => {
	it('encodes small, negative and multi-digit values', () => {
		expect(encodeVlq(0)).toBe('A');
		expect(encodeVlq(1)).toBe('C');
		expect(encodeVlq(-1)).toBe('D');
		expect(encodeVlq(15)).toBe('e');
		expect(encodeVlq(16)).toBe('gB');
		expect(encodeVlq(32)).toBe('gC');
		expect(encodeVlq(-1000)).toBe('x+B');
	});

	it('round-trips through the test decoder', () => {
		const VALUES = [0, 1, -1, 31, 32, 1023, -1024, 123456];

		expect(decodeVlqs(VALUES.map(encodeVlq).join(''))).toEqual(VALUES);
	});
});

describe('generateRemovalSourceMap', () => {
	const SOURCE = '<div\n\tdata-testid="a"\n\tclass="x" />\n<span data-testid="b">y</span>\n';
	const RANGES = findAttributeRanges(SOURCE, ['data-testid']);
	const MAP = generateRemovalSourceMap(SOURCE, RANGES, '/repo/src/App.svelte');

	it('describes the single original source', () => {
		expect(removeRanges(SOURCE, RANGES)).toBe('<div\n\tclass="x" />\n<span>y</span>\n');
		expect(MAP).toMatchObject({
			version: 3,
			sources: ['/repo/src/App.svelte'],
			sourcesContent: [SOURCE],
			names: [],
		});
	});

	it('has one mappings line per generated line', () => {
		expect(MAP.mappings.split(';')).toHaveLength(4);
	});

	it('maps untouched positions to themselves', () => {
		expect(originalPositionFor(MAP.mappings, 1, 0)).toEqual({ line: 1, column: 0 });
		expect(originalPositionFor(MAP.mappings, 1, 1)).toEqual({ line: 1, column: 1 });
	});

	it('maps a line that moved up after an attribute on its own line was removed', () => {
		// `class` is on generated line 2 but original line 3
		expect(originalPositionFor(MAP.mappings, 2, 1)).toEqual({ line: 3, column: 1 });
		expect(originalPositionFor(MAP.mappings, 2, 8)).toEqual({ line: 3, column: 8 });
	});

	it('maps text after an inline removal to its original column', () => {
		// `<span data-testid="b">y</span>` became `<span>y</span>`
		expect(originalPositionFor(MAP.mappings, 3, 0)).toEqual({ line: 4, column: 0 });
		expect(originalPositionFor(MAP.mappings, 3, 5)).toEqual({ line: 4, column: 21 });
		expect(originalPositionFor(MAP.mappings, 3, 6)).toEqual({ line: 4, column: 22 });
		expect(originalPositionFor(MAP.mappings, 3, 7)).toEqual({ line: 4, column: 23 });
	});

	it('handles a removal spanning several lines', () => {
		const INPUT = '<a\n\tdata-testid={`x-${\n\t\tid\n\t}`}\n\thref="/">go</a>';
		const INPUT_RANGES = findAttributeRanges(INPUT, ['data-testid']);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<a\n\thref="/">go</a>');
		expect(originalPositionFor(INPUT_MAP.mappings, 2, 1)).toEqual({ line: 5, column: 1 });
		expect(originalPositionFor(INPUT_MAP.mappings, 2, 10)).toEqual({ line: 5, column: 10 });
	});

	it('produces an identity map without ranges', () => {
		const IDENTITY = generateRemovalSourceMap('ab\ncd', [] as Range[], 'x');

		expect(decodeMappings(IDENTITY.mappings)).toEqual([[[0, 0, 0]], [[0, 1, 0]]]);
	});
});
