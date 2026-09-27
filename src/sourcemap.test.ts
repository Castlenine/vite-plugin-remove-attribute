import type { Range } from './utilities';
import type { SourceMap } from './sourcemap';

import { decodedMappings, TraceMap, originalPositionFor as traceOriginalPositionFor } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';

import { createAttributeMatcher, removeRanges } from './utilities';
import { encodeVlq, generateRemovalSourceMap } from './sourcemap';

const matchTestIds = createAttributeMatcher(['data-testid']);

/**
 * Finds the ranges of `data-testid` the way a non-Svelte file is scanned.
 *
 * @param input - The markup to scan.
 *
 * @returns The ranges to remove.
 */
function findTestIdRanges(input: string): Range[] {
	return matchTestIds(input, { hasQuotedMustache: false }).ranges;
}

/**
 * Resolves the original position (1-based line, 0-based column) for a position in the generated code, through
 * `@jridgewell/trace-mapping` — the same library a real sourcemap consumer uses.
 *
 * @param map - The source map to resolve through.
 * @param line - The 1-based generated line number.
 * @param column - The 0-based generated column number.
 *
 * @returns The original `{ line, column }` (1-based line, 0-based column), or `null` when unresolved.
 */
function resolveOriginalPosition(
	map: SourceMap,
	line: number,
	column: number,
): { line: number; column: number } | null {
	const RESULT = traceOriginalPositionFor(new TraceMap(map), { line, column });

	return RESULT.line == null ? null : { line: RESULT.line, column: RESULT.column };
}

/**
 * Decodes every mapping segment of a source map into `[generatedColumn, originalLine, originalColumn]` tuples per
 * generated line, through `@jridgewell/trace-mapping`'s decoder — both zero-based, matching the raw VLQ deltas.
 *
 * @param map - The source map to decode.
 *
 * @returns One array of segment tuples per generated line.
 */
function decodeSegments(map: SourceMap): Array<Array<[number, number, number]>> {
	return decodedMappings(new TraceMap(map)).map((line) =>
		line.map(([generatedColumn, , originalLine = 0, originalColumn = 0]) => [
			generatedColumn,
			originalLine,
			originalColumn,
		]),
	);
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

	it('round-trips a value through the library decoder', () => {
		// A single segment on generated line 1: zero deltas for the generated column, the source index and the
		// original line, then the value under test as the original column delta
		const VALUES = [0, 1, -1, 31, 32, 1023, -1024, 123456];

		for (const VALUE of VALUES) {
			const MAP: SourceMap = {
				version: 3,
				sources: ['a.js'],
				sourcesContent: ['x'],
				names: [],
				mappings: `${encodeVlq(0)}${encodeVlq(0)}${encodeVlq(0)}${encodeVlq(VALUE)}`,
			};

			expect(resolveOriginalPosition(MAP, 1, 0)).toEqual({ line: 1, column: VALUE });
		}
	});
});

describe('generateRemovalSourceMap', () => {
	const SOURCE = '<div\n\tdata-testid="a"\n\tclass="x" />\n<span data-testid="b">y</span>\n';
	const RANGES = findTestIdRanges(SOURCE);
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

	it('carries the input verbatim as sourcesContent and an empty names list', () => {
		expect(MAP.sourcesContent).toEqual([SOURCE]);
		expect(MAP.sourcesContent[0]).toBe(SOURCE);
		expect(MAP.names).toEqual([]);
	});

	it('has one mappings line per generated line', () => {
		expect(MAP.mappings.split(';')).toHaveLength(4);
	});

	it('writes a segment per non-word character and per word start, like magic-string `hires: boundary`', () => {
		const INPUT = '<div data-testid="x" class="a b">';
		const INPUT_RANGES = findTestIdRanges(INPUT);

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<div class="a b">');
		expect(decodeSegments(generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte'))).toEqual([
			[
				[0, 0, 0],
				[1, 0, 1],
				[4, 0, 20],
				[5, 0, 21],
				[10, 0, 26],
				[11, 0, 27],
				[12, 0, 28],
				[13, 0, 29],
				[14, 0, 30],
				[15, 0, 31],
				[16, 0, 32],
			],
		]);
	});

	it('gives every character outside ASCII a segment of its own, as a non-word character', () => {
		expect(decodeSegments(generateRemovalSourceMap('aé b', [], 'a.svelte'))).toEqual([
			[
				[0, 0, 0],
				[1, 0, 1],
				[2, 0, 2],
				[3, 0, 3],
			],
		]);
	});

	it('maps untouched positions to themselves', () => {
		expect(resolveOriginalPosition(MAP, 1, 0)).toEqual({ line: 1, column: 0 });
		expect(resolveOriginalPosition(MAP, 1, 1)).toEqual({ line: 1, column: 1 });
	});

	it('maps a line that moved up after an attribute on its own line was removed', () => {
		// `class` is on generated line 2 but original line 3
		expect(resolveOriginalPosition(MAP, 2, 1)).toEqual({ line: 3, column: 1 });
		expect(resolveOriginalPosition(MAP, 2, 8)).toEqual({ line: 3, column: 8 });
	});

	it('maps text after an inline removal to its original column', () => {
		// `<span data-testid="b">y</span>` became `<span>y</span>`
		expect(resolveOriginalPosition(MAP, 3, 0)).toEqual({ line: 4, column: 0 });
		expect(resolveOriginalPosition(MAP, 3, 5)).toEqual({ line: 4, column: 21 });
		expect(resolveOriginalPosition(MAP, 3, 6)).toEqual({ line: 4, column: 22 });
		expect(resolveOriginalPosition(MAP, 3, 7)).toEqual({ line: 4, column: 23 });
	});

	it('handles a removal spanning several lines', () => {
		const INPUT = '<a\n\tdata-testid={`x-${\n\t\tid\n\t}`}\n\thref="/">go</a>';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<a\n\thref="/">go</a>');
		expect(resolveOriginalPosition(INPUT_MAP, 2, 1)).toEqual({ line: 5, column: 1 });
		expect(resolveOriginalPosition(INPUT_MAP, 2, 10)).toEqual({ line: 5, column: 10 });
	});

	it('handles the removal of an unquoted value', () => {
		const INPUT = '<div data-testid=alpha class="x">go</div>';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<div class="x">go</div>');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 0)).toEqual({ line: 1, column: 0 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 5)).toEqual({ line: 1, column: 23 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 15)).toEqual({ line: 1, column: 33 });
	});

	it('handles a removal that keeps the whitespace in front of it', () => {
		// Nothing separates the value from `class`, so only `data-testid="a"` is cut and the space before it stays
		const INPUT = '<div data-testid="a"class="x">go</div>';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(INPUT_RANGES).toEqual([[5, 20]]);
		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<div class="x">go</div>');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 4)).toEqual({ line: 1, column: 4 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 5)).toEqual({ line: 1, column: 20 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 15)).toEqual({ line: 1, column: 30 });
	});

	it('handles two adjacent removals', () => {
		const INPUT = '<div data-testid="a" data-testid="b" class="x">go</div>';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(INPUT_RANGES).toHaveLength(2);
		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<div class="x">go</div>');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 5)).toEqual({ line: 1, column: 37 });
	});

	it('produces an identity map without ranges', () => {
		const IDENTITY = generateRemovalSourceMap('ab\ncd', [] as Range[], 'x');

		expect(decodeSegments(IDENTITY)).toEqual([[[0, 0, 0]], [[0, 1, 0]]]);
	});

	it('produces an empty mappings string for an empty source', () => {
		const EMPTY = generateRemovalSourceMap('', [] as Range[], 'x');

		expect(EMPTY.mappings).toBe('');
		expect(EMPTY.sources).toEqual(['x']);
		expect(EMPTY.sourcesContent).toEqual(['']);
	});

	it('handles a removal starting at index 0', () => {
		// generateRemovalSourceMap takes any sorted, non-overlapping ranges — the matcher itself never produces one
		// starting at 0 (an attribute there has nothing in front of it to separate it from), so the range is built
		// by hand
		const INPUT = 'abcdef';
		const INPUT_MAP = generateRemovalSourceMap(INPUT, [[0, 3]], 'a.svelte');

		expect(removeRanges(INPUT, [[0, 3]])).toBe('def');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 0)).toEqual({ line: 1, column: 3 });
	});

	it('handles a removal ending at the end of the input', () => {
		const INPUT = 'abcdef';
		const INPUT_MAP = generateRemovalSourceMap(INPUT, [[3, 6]], 'a.svelte');

		expect(removeRanges(INPUT, [[3, 6]])).toBe('abc');
		// Nothing follows the cut, so the map holds only the segment written before it
		expect(resolveOriginalPosition(INPUT_MAP, 1, 0)).toEqual({ line: 1, column: 0 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 2)).toEqual({ line: 1, column: 0 });
	});

	it('treats a removal spanning a CRLF as a column, not a line break', () => {
		// `\r` never opens a new generated line — only `\n` does. The line count therefore comes from `\n` alone
		const INPUT = '<div\r\n  data-testid="x"\r\n  class="a">';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');
		const OUTPUT = removeRanges(INPUT, INPUT_RANGES);

		expect(OUTPUT).toBe('<div\r\n  class="a">');
		expect(INPUT_MAP.mappings.split(';')).toHaveLength(2);
		expect(resolveOriginalPosition(INPUT_MAP, 2, 2)).toEqual({ line: 3, column: 2 });
	});

	it('handles consecutive blank lines in the kept text', () => {
		// The whitespace run in front of the attribute (including the blank lines before it) joins the removal,
		// which is what keeps a removed attribute from leaving a blank line behind — here it also absorbs the
		// blank lines that preceded it
		const INPUT = '<div\n\n\n  data-testid="x"\n\n\n  class="a">';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');
		const OUTPUT = removeRanges(INPUT, INPUT_RANGES);

		expect(OUTPUT).toBe('<div\n\n\n  class="a">');
		expect(INPUT_MAP.mappings.split(';')).toHaveLength(4);
		expect(resolveOriginalPosition(INPUT_MAP, 4, 2)).toEqual({ line: 7, column: 2 });
	});

	it('handles a removal whose kept text is pure punctuation', () => {
		// Each `}` is a non-word character carrying a segment of its own. No tag holds the text, so the matcher would
		// find nothing to remove: the range is given directly
		const INPUT = '}data-testid="x"}';
		const INPUT_RANGES: Range[] = [[1, 16]];
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('}}');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 0)).toEqual({ line: 1, column: 0 });
		expect(resolveOriginalPosition(INPUT_MAP, 1, 1)).toEqual({ line: 1, column: 16 });
	});

	it('encodes a negative original-column delta across a generated line break', () => {
		// Line 1 keeps a long run of original text before the newline; line 2 starts back at original column 0,
		// which is smaller than the last mapped column of line 1 and forces a negative VLQ delta
		const INPUT = '<div style="width: 100px" data-testid="x">\na</div>';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(resolveOriginalPosition(INPUT_MAP, 2, 0)).toEqual({ line: 2, column: 0 });
	});

	it('maps a word starting right where the removed range ends to its original column', () => {
		const INPUT = '<div data-testid="x"class="a">';
		const INPUT_RANGES = findTestIdRanges(INPUT);
		const INPUT_MAP = generateRemovalSourceMap(INPUT, INPUT_RANGES, 'a.svelte');

		expect(removeRanges(INPUT, INPUT_RANGES)).toBe('<div class="a">');
		expect(resolveOriginalPosition(INPUT_MAP, 1, 5)).toEqual({ line: 1, column: 20 });
	});
});

/**
 * Every multi-line shape a removed attribute takes, mirroring the table `utilities.test.ts` pins the output of
 */
const MULTI_LINE_INPUTS: readonly string[] = [
	'<div\n  class="a"\n  data-testid="x"\n  id="b"\n>',
	'<div\n  class="a"\n  data-testid="x"\n>',
	'<div\n  class="a"\n  data-testid="x">',
	'<div\n  data-testid="x"\n>',
	'<Foo\n  data-testid="x"\n/>',
	'<div data-testid="x"\n  class="a"\n>',
	'<Foo\n  data-testid={[\n    a,\n    b,\n  ].join("-")}\n  class="a"\n/>',
	'<div\n  data-testid="a\n    b"\n  class="a">',
	'<div\n  class="a"\n\n  data-testid="x"\n  id="b">',
	'<div\n  data-testid="x"\n  data-cy="y"\n  class="a">',
	'<div\n  data-testid="x"   \n  class="a">',
	'<div\r\n  class="a"\r\n  data-testid="x"\r\n  id="b"\r\n>',
	'<div\n\t\tdata-testid="x"\n\t\tclass="a"\n\t>',
	'<Foo\n  data-testid="x" // note\n  class="a"\n/>',
	'<div\n  data-testid\n    ="x"\n  class="a">',
];

const matchMultiLineAttributes = createAttributeMatcher(['data-testid', 'data-cy']);

describe('generateRemovalSourceMap across lines', () => {
	it.each(MULTI_LINE_INPUTS)('points every segment of %j at the character it came from', (input) => {
		const { ranges } = matchMultiLineAttributes(input, { hasQuotedMustache: false });
		const OUTPUT = removeRanges(input, ranges);
		const OUTPUT_LINES = OUTPUT.split('\n');
		const SOURCE_LINES = input.split('\n');
		const LINES = decodeSegments(generateRemovalSourceMap(input, ranges, 'a.svelte'));

		// A consumer resolving a position past the last generated line would fall off the map
		expect(LINES).toHaveLength(OUTPUT_LINES.length);

		for (const [LINE_INDEX, SEGMENTS] of LINES.entries()) {
			for (const [GENERATED_COLUMN, ORIGINAL_LINE, ORIGINAL_COLUMN] of SEGMENTS) {
				expect({
					line: LINE_INDEX,
					column: GENERATED_COLUMN,
					character: OUTPUT_LINES[LINE_INDEX]?.charAt(GENERATED_COLUMN),
				}).toEqual({
					line: LINE_INDEX,
					column: GENERATED_COLUMN,
					character: SOURCE_LINES[ORIGINAL_LINE]?.charAt(ORIGINAL_COLUMN),
				});
			}
		}
	});
});

describe('generateRemovalSourceMap fuzzing', () => {
	const CASE_COUNT = 500;
	const MAX_PIECE_COUNT = 60;
	const MAX_REMOVED_LENGTH = 6;
	const REMOVAL_PROBABILITY = 0.12;
	const PIECES = ['ab', 'x', '_', '9', '$', ' ', '\t', '<', '>', '=', '"', '\n', '\r\n', 'é', '😀'] as const;
	const WORD_CHARACTER_REGEX = /\w/;

	/**
	 * One randomly generated source together with sorted, non-overlapping, non-empty ranges removed from it
	 */
	interface FuzzCase {
		source: string;
		ranges: Range[];
	}

	/**
	 * A 1-based line and a 0-based column, as trace-mapping reads and returns them
	 */
	interface Position {
		line: number;
		column: number;
	}

	/**
	 * Builds the seeded mulberry32 generator, so that a failing case reproduces on every run.
	 *
	 * @param seed - The initial state.
	 *
	 * @returns A function returning the next pseudo-random number of `[0, 1)`.
	 */
	function createRandom(seed: number): () => number {
		let state = seed;

		return () => {
			state = (state + 0x6d2b79f5) | 0;

			let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

			mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);

			return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
		};
	}

	/**
	 * Reads one entry of a list, failing the test instead of yielding `undefined` for an index out of range.
	 *
	 * @param entries - The list to read.
	 * @param index - The index of the entry.
	 *
	 * @returns The entry.
	 */
	function getAt<Entry>(entries: readonly Entry[], index: number): Entry {
		const ENTRY = entries[index];

		if (ENTRY == null) {
			throw new Error(`no entry at index ${index}`);
		}

		return ENTRY;
	}

	/**
	 * Generates one random source and random removals over it.
	 *
	 * @param random - The generator to draw from.
	 *
	 * @returns The generated case.
	 */
	function createFuzzCase(random: () => number): FuzzCase {
		const PIECE_COUNT = 1 + Math.floor(random() * MAX_PIECE_COUNT);
		const SOURCE = Array.from({ length: PIECE_COUNT }, () => getAt(PIECES, Math.floor(random() * PIECES.length))).join(
			'',
		);
		const RANGES: Range[] = [];

		let index = 0;

		while (index < SOURCE.length) {
			if (random() < REMOVAL_PROBABILITY) {
				const END = Math.min(SOURCE.length, index + 1 + Math.floor(random() * MAX_REMOVED_LENGTH));

				RANGES.push([index, END]);
				index = END + 1;
			} else {
				index++;
			}
		}

		return { source: SOURCE, ranges: RANGES };
	}

	/**
	 * Resolves the 1-based line and 0-based column of every index of a text.
	 *
	 * @param text - The text to locate the indexes of.
	 *
	 * @returns One position per index, plus the position just past the end.
	 */
	function listPositions(text: string): Position[] {
		let line = 1;
		let column = 0;

		return Array.from({ length: text.length + 1 }, (_, index) => {
			const POSITION = { line, column };

			if (text.charAt(index) === '\n') {
				line++;
				column = 0;
			} else {
				column++;
			}

			return POSITION;
		});
	}

	/**
	 * Resolves, for each character of the output, the index of the original character it was kept from.
	 *
	 * @param source - The original source.
	 * @param ranges - The ranges removed from it, in source order.
	 *
	 * @returns One original index per character of the output.
	 */
	function listOrigins(source: string, ranges: readonly Range[]): number[] {
		const IS_REMOVED = Array.from({ length: source.length }, (_, index) =>
			ranges.some(([start, end]) => index >= start && index < end),
		);

		return IS_REMOVED.flatMap((isRemoved, index) => (isRemoved ? [] : [index]));
	}

	/**
	 * Resolves the original index a generated character must map to under the boundary semantics: a non-word
	 * character maps to itself, and a word character to the first character of its word, as long as the word is
	 * contiguous in the original source.
	 *
	 * @param output - The output left once the ranges are removed.
	 * @param origins - The original index of each character of the output.
	 * @param generatedIndex - The index of the character in the output.
	 *
	 * @returns The expected original index.
	 */
	function getExpectedOriginalIndex(output: string, origins: readonly number[], generatedIndex: number): number {
		if (!WORD_CHARACTER_REGEX.test(output.charAt(generatedIndex))) {
			return getAt(origins, generatedIndex);
		}

		let tokenStart = generatedIndex;

		while (
			tokenStart > 0 &&
			WORD_CHARACTER_REGEX.test(output.charAt(tokenStart - 1)) &&
			getAt(origins, tokenStart - 1) === getAt(origins, tokenStart) - 1
		) {
			tokenStart--;
		}

		return getAt(origins, tokenStart);
	}

	it('resolves every generated character to its exact token start in the original source', () => {
		const RANDOM = createRandom(0x5eed);

		Array.from({ length: CASE_COUNT }, () => createFuzzCase(RANDOM)).forEach(({ source, ranges }) => {
			const OUTPUT = removeRanges(source, ranges);
			const ORIGINS = listOrigins(source, ranges);
			const ORIGINAL_POSITIONS = listPositions(source);
			const GENERATED_POSITIONS = listPositions(OUTPUT);
			const TRACER = new TraceMap(generateRemovalSourceMap(source, ranges, 'fuzz.svelte'));

			expect(ORIGINS).toHaveLength(OUTPUT.length);

			Array.from({ length: OUTPUT.length }, (_, generatedIndex) => generatedIndex)
				.filter((generatedIndex) => OUTPUT.charAt(generatedIndex) !== '\n')
				.forEach((generatedIndex) => {
					const EXPECTED = getAt(ORIGINAL_POSITIONS, getExpectedOriginalIndex(OUTPUT, ORIGINS, generatedIndex));

					expect(traceOriginalPositionFor(TRACER, getAt(GENERATED_POSITIONS, generatedIndex))).toMatchObject(EXPECTED);
				});
		});
	});
});
