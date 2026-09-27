import type { Range } from '../../src/utilities';

import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

import { createAttributeMatcher, removeRanges } from '../../src/utilities';
import { generateRemovalSourceMap } from '../../src/sourcemap';

/**
 * The file name the generated maps carry, which every resolved position has to name back
 */
const SOURCE_FILE = 'x.svelte';

const WORD_CHARACTER_REGEX = /\w/;

/**
 * A zero-based position in a text
 */
interface Position {
	line: number;
	column: number;
}

/**
 * A position of the generated text the map is expected to resolve, and the original position it maps to
 */
interface ExpectedSegment {
	generated: Position;
	original: Position;
}

const SOURCE_ARBITRARY = fc
	.array(fc.oneof(fc.string({ unit: 'grapheme-ascii', minLength: 2, maxLength: 10 }), fc.constant('\n')), {
		minLength: 5,
		maxLength: 30,
	})

	.map((parts) => parts.join(''));

/**
 * Turns `[gap, size]` pairs into sorted, non-overlapping, non-empty ranges inside a text of the given length.
 *
 * @param length - The length of the text the ranges cut into.
 * @param specifications - The `[gap, size]` pairs, read in order.
 *
 * @returns The ranges, with every pair that would reach past the end of the text left out.
 */
function toRanges(length: number, specifications: readonly (readonly [number, number])[]): Range[] {
	return specifications.reduce<{ ranges: Range[]; cursor: number }>(
		(accumulated, [gap, size]) => {
			const START = accumulated.cursor + gap;
			const END = START + size;

			return END > length ? accumulated : { ranges: [...accumulated.ranges, [START, END] as Range], cursor: END };
		},
		{ ranges: [], cursor: 0 },
	).ranges;
}

const SOURCE_AND_RANGES_ARBITRARY = SOURCE_ARBITRARY.chain((source) =>
	fc.tuple(
		fc.constant(source),
		fc
			.array(fc.tuple(fc.nat({ max: 6 }), fc.integer({ min: 1, max: 6 })), { maxLength: 8 })
			.map((specifications) => toRanges(source.length, specifications)),
	),
);

/**
 * Quoted `data-testid` values interpolating tagged-template placeholders, some spread over several lines and
 * some nesting the quote delimiting their value, and unquoted ones interpolating `{…}` expressions
 */
const PLACEHOLDER_ATTRIBUTES = [
	' data-testid="${ok ? "a" : "b"}"',
	'\n\tdata-testid="${ok\n\t\t? "a"\n\t\t: "b"}"',
	" data-testid='${`x-${id}`}'",
	' data-testid="${a}\n-${b}"',
	'data-testid="${c}"',
	' data-testid=a{ok\n\t? "}"\n\t: b}c',
	' data-testid=${d}{e}-{f}',
] as const;

/**
 * A source whose removal ranges come from the matcher itself, reading placeholders the way a script file does
 */
const PLACEHOLDER_SOURCE_ARBITRARY = fc
	.array(
		fc.oneof(
			{ arbitrary: fc.constantFrom(...PLACEHOLDER_ATTRIBUTES), weight: 2 },
			{ arbitrary: fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 8 }), weight: 2 },
			{ arbitrary: fc.constantFrom('<div', '>', '\n', ' class="k"'), weight: 1 },
		),
		{ minLength: 3, maxLength: 20 },
	)
	.map((parts) => parts.join(''));

const PLACEHOLDER_MATCHER = createAttributeMatcher(['data-testid']);

/**
 * Resolves the zero-based line and column of an index by counting the newlines in front of it.
 *
 * @param text - The text the index points into.
 * @param index - The index to resolve.
 *
 * @returns The zero-based position of the index.
 */
function toPosition(text: string, index: number): Position {
	const BEFORE = text.slice(0, index);

	return { line: BEFORE.split('\n').length - 1, column: index - BEFORE.lastIndexOf('\n') - 1 };
}

/**
 * Lists the `[start, end)` regions of the source that survive the removal, empty ones left out.
 *
 * @param sourceLength - The length of the original source.
 * @param ranges - The sorted, non-overlapping ranges being removed.
 *
 * @returns The kept regions, in source order.
 */
function toKeptRegions(sourceLength: number, ranges: readonly Range[]): Range[] {
	const CUTS = ranges.reduce<{ regions: Range[]; cursor: number }>(
		(accumulated, [start, end]) => ({
			regions: [...accumulated.regions, [accumulated.cursor, start] as Range],
			cursor: end,
		}),
		{ regions: [], cursor: 0 },
	);

	return [...CUTS.regions, [CUTS.cursor, sourceLength] as Range].filter(([start, end]) => start < end);
}

/**
 * Lists the positions the generated map has to resolve, and the original positions they belong to.
 *
 * @remarks
 * The generator emits a segment at the first kept character of every region, at the first character of every
 * generated line, at every non-word character and at the first character of every word — a newline itself
 * occupies no generated column and carries no segment. Every other character resolves through the segment
 * before it, so asserting on those would only re-state the interpolation rule rather than the mapping.
 *
 * @param source - The original source.
 * @param generated - The source with the ranges cut out.
 * @param ranges - The sorted, non-overlapping ranges being removed.
 *
 * @returns Every expected segment, in generated order.
 */
function toExpectedSegments(source: string, generated: string, ranges: readonly Range[]): ExpectedSegment[] {
	const SEGMENTS: ExpectedSegment[] = [];

	let generatedIndex = 0;
	let previousCharacter = '';

	for (const [start, end] of toKeptRegions(source.length, ranges)) {
		let isRegionStart = true;

		for (let index = start; index < end; index++) {
			const CHARACTER = source.charAt(index);
			const HAS_SEGMENT =
				isRegionStart ||
				previousCharacter === '\n' ||
				!WORD_CHARACTER_REGEX.test(CHARACTER) ||
				!WORD_CHARACTER_REGEX.test(previousCharacter);

			if (CHARACTER !== '\n' && HAS_SEGMENT) {
				SEGMENTS.push({ generated: toPosition(generated, generatedIndex), original: toPosition(source, index) });
			}

			previousCharacter = CHARACTER;
			isRegionStart = false;
			generatedIndex++;
		}
	}

	return SEGMENTS;
}

/**
 * Asserts that the map generated for a removal resolves every emitted segment to its original position.
 *
 * @param source - The original source.
 * @param ranges - The sorted, non-overlapping ranges being removed.
 */
function expectSegmentsResolve(source: string, ranges: Range[]): void {
	const GENERATED = removeRanges(source, ranges);
	const TRACE = new TraceMap(generateRemovalSourceMap(source, ranges, SOURCE_FILE));
	const SEGMENTS = toExpectedSegments(source, GENERATED, ranges);

	const RESOLVED = SEGMENTS.map((segment) =>
		originalPositionFor(TRACE, { line: segment.generated.line + 1, column: segment.generated.column }),
	);
	const EXPECTED = SEGMENTS.map((segment) => ({
		source: SOURCE_FILE,
		line: segment.original.line + 1,
		column: segment.original.column,
		name: null,
	}));

	expect(RESOLVED).toEqual(EXPECTED);
}

describe('generateRemovalSourceMap', () => {
	test.prop([SOURCE_AND_RANGES_ARBITRARY])(
		'resolves every emitted segment to its original position',
		([source, ranges]) => {
			expectSegmentsResolve(source, ranges);
		},
	);

	test.prop([PLACEHOLDER_SOURCE_ARBITRARY])(
		'resolves every emitted segment after quoted placeholder removals, multi-line ones included',
		(source) => {
			const MATCHED = PLACEHOLDER_MATCHER(source, { hasQuotedMustache: false, hasQuotedPlaceholder: true });

			expectSegmentsResolve(source, MATCHED.ranges);
		},
	);

	test.prop([SOURCE_AND_RANGES_ARBITRARY])('writes one mapping line per generated line', ([source, ranges]) => {
		const GENERATED = removeRanges(source, ranges);
		const MAP = generateRemovalSourceMap(source, ranges, SOURCE_FILE);

		expect(MAP.mappings.split(';')).toHaveLength(GENERATED.split('\n').length);
	});
});
