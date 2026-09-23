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
const ASCII_LIMIT = 128;
const NEWLINE_CODE = 10;

/**
 * `1` for each ASCII character code `WORD_CHARACTER_REGEX` matches, which is the definition of a word character
 * magic-string's `hires: 'boundary'` mode uses; every code outside ASCII is a non-word character
 */
const WORD_CHARACTER_TABLE = Uint8Array.from({ length: ASCII_LIMIT }, (_, code) =>
	WORD_CHARACTER_REGEX.test(String.fromCharCode(code)) ? 1 : 0,
);

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

function isWordCharacter(code: number): boolean {
	return code < ASCII_LIMIT && WORD_CHARACTER_TABLE[code] === 1;
}

/**
 * Builds the `mappings` string one generated line at a time, encoding every segment as deltas from the previous one
 */
class MappingsWriter {
	readonly #lines: string[] = [];
	#segments: string[] = [];
	#lastGeneratedColumn = 0;
	#lastOriginalLine = 0;
	#lastOriginalColumn = 0;

	addSegment(generatedColumn: number, originalLine: number, originalColumn: number): void {
		// The source index delta is always `A` (zero): the map names a single source
		this.#segments.push(
			`${encodeVlq(generatedColumn - this.#lastGeneratedColumn)}A${encodeVlq(originalLine - this.#lastOriginalLine)}${encodeVlq(originalColumn - this.#lastOriginalColumn)}`,
		);
		this.#lastGeneratedColumn = generatedColumn;
		this.#lastOriginalLine = originalLine;
		this.#lastOriginalColumn = originalColumn;
	}

	endLine(): void {
		this.#lines.push(this.#segments.join(','));
		this.#segments = [];
		this.#lastGeneratedColumn = 0;
	}

	toString(): string {
		this.endLine();

		return this.#lines.join(';');
	}
}

/**
 * Generates a source map for a given `source` string with the specified ranges removed.
 *
 * The kept text is described the way magic-string's `hires: 'boundary'` mode describes it: every non-word character
 * carries a segment of its own, and a run of word characters (`\w`) carries one segment at its first character. A run
 * is cut at each line start and at each removed range, so that the first character following a removal always
 * resolves to its true original position.
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
	let cursor = 0;

	/**
	 * Advances the original position from `from` to `to`, updating `originalLine` and `originalColumn`
	 * to correctly reflect skipping a removed range.
	 *
	 * @param from - Start index in the original source.
	 * @param to - End index in the original source.
	 */
	function advanceOriginal(from: number, to: number): void {
		for (let index = from; index < to; index++) {
			if (source.charCodeAt(index) === NEWLINE_CODE) {
				originalLine++;
				originalColumn = 0;
			} else {
				originalColumn++;
			}
		}
	}

	/**
	 * Emits source map segments for the kept region from `from` to `to`.
	 *
	 * @remarks
	 * A segment is written at every non-word character and at the first character of every word, so tools consuming
	 * the source map can resolve the original location of any token in the generated content. The `generatedColumn`,
	 * `originalLine` and `originalColumn` counters are advanced as the region is traversed.
	 *
	 * @param from - Start index of the kept region.
	 * @param to - End index of the kept region.
	 */
	function writeKept(from: number, to: number): void {
		// Starts `false` so that the first character of the region, which follows a cut, always opens a segment
		let isInWord = false;

		for (let index = from; index < to; index++) {
			const CODE = source.charCodeAt(index);

			if (CODE === NEWLINE_CODE) {
				WRITER.endLine();
				generatedColumn = 0;
				originalLine++;
				originalColumn = 0;
				isInWord = false;
				continue;
			}

			const IS_WORD_CHARACTER = isWordCharacter(CODE);

			if (!IS_WORD_CHARACTER || !isInWord) {
				WRITER.addSegment(generatedColumn, originalLine, originalColumn);
			}

			isInWord = IS_WORD_CHARACTER;
			generatedColumn++;
			originalColumn++;
		}
	}

	// Emit the kept text before each removed range, then advance the original position through the removed
	// content; whatever follows the last range is emitted afterward
	for (const [start, end] of ranges) {
		writeKept(cursor, start);
		advanceOriginal(start, end);
		cursor = end;
	}

	writeKept(cursor, source.length);

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
