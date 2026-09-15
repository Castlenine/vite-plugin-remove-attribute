import type { Range } from './utilities';

/**
 * Source map v3 object, as accepted by Vite's `transform` hook (`map`)
 */
interface SourceMap {
	version: 3;
	sources: string[];
	sourcesContent: string[];
	names: string[];
	mappings: string;
}

const BASE64_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const WORD_CHARACTER_REGEX = /\w/;

/**
 * Encodes a single integer value as a base64 VLQ (Variable Length Quantity) string.
 *
 * @remarks
 * Base64 VLQ is the encoding format used for numbers in source map `mappings` fields.
 * This function encodes both positive and negative integers using bitwise operations,
 * setting the least significant bit for sign and using continuation bits for multi-digit numbers.
 *
 * @param value - The integer to encode. Can be positive, negative, or zero.
 *
 * @returns The VLQ Base64-encoded string representation.
 *
 * @see [Source Map V3 Spec](https://sourcemaps.info/spec.html)
 */
function encodeVlq(value: number): string {
	let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
	let output = '';

	do {
		let digit = vlq & 31;

		vlq >>>= 5;

		if (vlq > 0) {
			digit |= 32;
		}

		output += BASE64_CHARACTERS.charAt(digit);
	} while (vlq > 0);

	return output;
}

/**
 * Builds the `mappings` string one generated line at a time, encoding every segment as deltas from the previous one
 */
class MappingsWriter {
	private readonly lines: string[] = [];
	private segments: string[] = [];
	private lastGeneratedColumn = 0;
	private lastOriginalLine = 0;
	private lastOriginalColumn = 0;
	private lastMappedColumn = -1;

	addSegment(generatedColumn: number, originalLine: number, originalColumn: number): void {
		// Two candidates for the same generated column always describe the same original position
		if (generatedColumn === this.lastMappedColumn) {
			return;
		}

		this.segments.push(
			encodeVlq(generatedColumn - this.lastGeneratedColumn) +
				encodeVlq(0) +
				encodeVlq(originalLine - this.lastOriginalLine) +
				encodeVlq(originalColumn - this.lastOriginalColumn),
		);
		this.lastGeneratedColumn = generatedColumn;
		this.lastOriginalLine = originalLine;
		this.lastOriginalColumn = originalColumn;
		this.lastMappedColumn = generatedColumn;
	}

	endLine(): void {
		this.lines.push(this.segments.join(','));
		this.segments = [];
		this.lastGeneratedColumn = 0;
		this.lastMappedColumn = -1;
	}

	toString(): string {
		this.endLine();

		return this.lines.join(';');
	}
}

/**
 * Generates a source map for a given `source` string with the specified ranges removed.
 *
 * Emits a segment at the start of each generated line, at each position where the original text was cut, and at
 * every word boundary in between, allowing consumers to resolve any token to its original line and column.
 *
 * @param source - The original source code string.
 * @param ranges - Sorted, non-overlapping `[start, end)` character ranges to be removed.
 * @param file - The original file name or path. Used as the single source entry in the resulting source map.
 *
 * @returns The generated SourceMap object with correct mappings after range removal.
 */
function generateRemovalSourceMap(source: string, ranges: Range[], file: string): SourceMap {
	const WRITER = new MappingsWriter();

	let generatedColumn = 0;
	let originalLine = 0;
	let originalColumn = 0;
	let previousCharacter = '';
	let cursor = 0;

	/**
	 * Advances the original position from `from` to `to`, updating `originalLine` and `originalColumn`
	 * to correctly reflect skipping a removed range.
	 *
	 * @param from - Start index in the original source.
	 * @param to - End index in the original source.
	 */
	const ADVANCE_ORIGINAL = (from: number, to: number): void => {
		for (let index = from; index < to; index++) {
			if (source.charAt(index) === '\n') {
				originalLine++;
				originalColumn = 0;
			} else {
				originalColumn++;
			}
		}
	};

	/**
	 * Emits source map segments for the kept region from `from` to `to`.
	 *
	 * @remarks
	 * A segment is written at every new line and at every word boundary change (as determined by
	 * `WORD_CHARACTER_REGEX`), so tools consuming the source map can resolve the original location of any token in
	 * the generated content. The `generatedColumn`, `originalLine` and `originalColumn` counters are advanced as the
	 * region is traversed, and `needsSegment` forces a segment right after a cut.
	 *
	 * @param from - Start index of the kept region.
	 * @param to - End index of the kept region.
	 */
	const WRITE_KEPT = (from: number, to: number): void => {
		let needsSegment = from < to;

		for (let index = from; index < to; index++) {
			const CHARACTER = source.charAt(index);

			if (CHARACTER === '\n') {
				WRITER.endLine();
				generatedColumn = 0;
				originalLine++;
				originalColumn = 0;
				needsSegment = true;
			} else {
				if (needsSegment || WORD_CHARACTER_REGEX.test(CHARACTER) !== WORD_CHARACTER_REGEX.test(previousCharacter)) {
					WRITER.addSegment(generatedColumn, originalLine, originalColumn);
					needsSegment = false;
				}

				generatedColumn++;
				originalColumn++;
			}

			previousCharacter = CHARACTER;
		}
	};

	// Emit the kept text before each removed range, then advance the original position through the removed
	// content; whatever follows the last range is emitted afterwards
	for (const [START, END] of ranges) {
		WRITE_KEPT(cursor, START);
		ADVANCE_ORIGINAL(START, END);
		cursor = END;
	}

	WRITE_KEPT(cursor, source.length);

	return {
		version: 3,
		sources: [file],
		sourcesContent: [source],
		names: [],
		mappings: WRITER.toString(),
	};
}

export type { SourceMap };
export { encodeVlq, generateRemovalSourceMap };
