import type { FileKind } from '../../src/utilities';

import { beforeAll, describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';

import { createAttributeMatcher } from '../../src/utilities';

/**
 * One pathological shape, repeated as many times as a run asks for
 */
interface PathologicalShape {
	/**
	 * Written once in front of every copy: the `<p` opening the tag whose attribute list the copies make up, for the
	 * shapes whose copies open no tag of their own. Default: none
	 */
	prefix?: string;
	/**
	 * The fragment repeated to build the input, each copy opening a value that is never closed
	 */
	opener: string;
	/**
	 * The fragment repeated as many times after every opener, closing what the openers nest
	 */
	closer: string;
	/**
	 * Written once after every closer. Default: none
	 */
	suffix?: string;
	hasQuotedMustache: boolean;
	/**
	 * The kind of source the input is read as. Default: `'markup'`
	 */
	fileKind?: FileKind;
	/**
	 * Whether the matcher reads the markup of `'` and `"` strings. Default: `false`
	 */
	removeInStrings?: boolean;
}

/**
 * The tag every attribute of the shapes whose copies open no tag of their own belongs to: an attribute counts only
 * inside the attribute list of an opening tag
 */
const TAG_PREFIX = '<p';

/**
 * An `={…}` that never closes, so every hit scans to the end of the input until the budget is spent
 */
const UNTERMINATED_EXPRESSION: PathologicalShape = { opener: '<A data-testid={', closer: '', hasQuotedMustache: false };

/**
 * A quoted value whose closing quote is the opening quote of the next copy
 */
const UNTERMINATED_QUOTE: PathologicalShape = { opener: '<A data-testid="', closer: '', hasQuotedMustache: false };

/**
 * A Svelte quoted value opening a mustache that never closes
 */
const UNTERMINATED_QUOTED_MUSTACHE: PathologicalShape = {
	opener: '<A data-testid="{',
	closer: '',
	hasQuotedMustache: true,
};

/**
 * Unquoted placeholders nesting every later copy, each balancing over the rest of the input and then running
 * into an `=` that rejects the value
 */
const NESTED_REJECTED_UNQUOTED_PLACEHOLDER: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid=${',
	closer: '}=',
	hasQuotedMustache: false,
};

/**
 * Quoted placeholders nesting every later copy inside a template literal, each balancing over the rest of the
 * input and then finding no closing quote
 */
const UNTERMINATED_QUOTED_PLACEHOLDER: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid="${`',
	closer: '`}',
	hasQuotedMustache: false,
};

/**
 * Unquoted values interpolating a `{…}` that nests every later copy, each balancing over the rest of the input
 * and then running into an `=` that rejects the value
 */
const NESTED_REJECTED_UNQUOTED_BRACE: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid=a{',
	closer: '}=',
	hasQuotedMustache: false,
};

/**
 * Unquoted values mixing a placeholder, a `{…}` nesting every later copy and a brace inside a string, rejected
 * at the `<` that follows them
 */
const NESTED_REJECTED_UNQUOTED_MIXED: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid=${a}-{"}"+',
	closer: '}<',
	hasQuotedMustache: false,
};

/**
 * Unquoted values interpolating a `{…}` that never closes, so every copy scans to the end of the input until the
 * budget is spent
 */
const UNTERMINATED_UNQUOTED_BRACE: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid=a{',
	closer: '',
	hasQuotedMustache: false,
};

/**
 * Unquoted values whose first `{…}` balances over every later copy and whose second never closes
 */
const NESTED_UNQUOTED_BRACE_BEFORE_UNBALANCED: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid=a{',
	closer: '}{/*',
	hasQuotedMustache: false,
};

/**
 * An expression that never closes followed by a quoted value nesting its own quote in a placeholder: the first
 * few copies spend the budget, which leaves every later nested-quote value unmeasured
 */
const BUDGET_EXHAUSTION_BEFORE_NESTED_QUOTES: PathologicalShape = {
	prefix: TAG_PREFIX,
	opener: ' data-testid={ data-testid="${a?"b":"c"}"',
	closer: '',
	hasQuotedMustache: true,
};

/**
 * Components ending on an element whose quoted value holds a literal `${`, each nesting every later copy, so a
 * scan reading the markup after the value as JavaScript would run on to the brace of an enclosing component
 */
const LITERAL_PLACEHOLDER_BEFORE_ENCLOSING_BRACE: PathologicalShape = {
	opener: 'function F() {\n\treturn <b data-testid="${" class="p">{price}</b>;\n',
	closer: '}\n',
	hasQuotedMustache: false,
};

/**
 * The same components written on one line, whose literal `{` a Svelte quoted value reads as a mustache
 */
const LITERAL_MUSTACHE_BEFORE_ENCLOSING_BRACE: PathologicalShape = {
	opener: 'function F(){return <b data-testid="{" class="p">{price}</b>;',
	closer: '}',
	hasQuotedMustache: true,
};

/**
 * Shapes aimed at the reading of a file's regions rather than at the measurement of one value, named after what
 * each repeats
 */
const REGION_SHAPES: Readonly<Record<string, PathologicalShape>> = {
	// Type parameter lists no closing tag follows, each asking the closing-tag index whether one does
	'type parameter lists': {
		opener: 'type F = <T>(x: T) => T; const s = " data-testid";\n',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'script',
	},
	// Elements closed by a tag of the same name, each asking the index for a later closer
	'paired elements': {
		opener: 'const a = <T><b data-testid="x" /></T>;\n',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'script',
	},
	// Elements nesting every later copy, which the scan holds one frame each for
	'nested elements': { opener: '<b data-testid="x">{a}', closer: '</b>', hasQuotedMustache: false, fileKind: 'script' },
	// Template literals nesting every later copy inside a placeholder
	'nested template literals': {
		opener: 'html`<b data-testid=${',
		closer: '}>`',
		hasQuotedMustache: false,
		fileKind: 'ts',
	},
	// Slots that never close, of which only the first is read to the end
	'unclosed slots': { opener: '{ <b data-testid="x"> ', closer: '', hasQuotedMustache: true },
	// Interpolations that never close
	'unclosed interpolations': {
		opener: '{{ <b data-testid="x"> ',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'vue',
	},
	// Style blocks that never close, of which only the first searches for its closer
	'unclosed style blocks': { opener: '<style><b data-testid="x">', closer: '', hasQuotedMustache: false },
	// Comments that never close
	'unclosed comments': { opener: '<!-- <b data-testid="x">', closer: '', hasQuotedMustache: false, fileKind: 'html' },
	// Script blocks, each read as a region of its own
	'script blocks': {
		opener: '<script>const s = "<b data-testid=\'x\'>";</script><i data-testid="y">',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'html',
	},
	// Quoted values that cannot be measured, each read the plain way to the quote the next copy opens with
	'unmeasurable quoted values': {
		prefix: TAG_PREFIX,
		opener: ' data-testid="{a',
		closer: '',
		hasQuotedMustache: true,
	},
	// Fenced code blocks, each searching the lines after it for its closing fence
	'fenced code blocks': {
		opener: '```\n<b data-testid="x">\n',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'markdown',
	},
};

/**
 * Shapes aimed at the reading of `'` and `"` strings as markup, named after what each repeats
 */
const STRING_SHAPES: Readonly<Record<string, PathologicalShape>> = {
	// Strings holding closed markup, each read twice: once to check that its markup closes, once as markup
	'strings holding closed markup': {
		opener: 'const s = \'<b data-testid="x">\' + "<i data-testid=\'y\'></i>";\n',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'ts',
		removeInStrings: true,
	},
	// Strings whose tag never closes, each rejected after its markup was read to the closing quote
	'strings holding unclosed markup': {
		opener: "const s = '<b data-testid=\"x\"' + '<!-- <i data-testid>';\n",
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'ts',
		removeInStrings: true,
	},
	// Strings holding no `<` in a module holding none either, each of which the search for a `<` stops at its quote
	'strings holding no tag opener': {
		opener: 'const s = \'data-testid\' + "data-testid";\n',
		closer: '',
		hasQuotedMustache: false,
		fileKind: 'ts',
		removeInStrings: true,
	},
	// One string holding a single tag whose attribute list never closes
	'one long string of unclosed markup': {
		prefix: "const s = '<b",
		opener: ' data-testid="x"',
		closer: '',
		suffix: "';\n",
		hasQuotedMustache: false,
		fileKind: 'ts',
		removeInStrings: true,
	},
	// Svelte `{@html}` tags whose string values open a mustache the next tag's string closes
	'Svelte {@html} strings opening a mustache': {
		opener: '{@html \'<b data-testid="{">\'}{@html "}"}\n',
		closer: '',
		hasQuotedMustache: true,
		removeInStrings: true,
	},
};

/**
 * The shapes the baseline cost per character is calibrated on, all of them read linearly since the budget was
 * introduced
 */
const CALIBRATION_SHAPES = [UNTERMINATED_EXPRESSION, UNTERMINATED_QUOTE, UNTERMINATED_QUOTED_MUSTACHE] as const;

/**
 * Repeat counts the baseline cost per character is measured over, spanning the range the properties draw from
 */
const CALIBRATION_OPENER_COUNTS = [1_000, 2_500, 5_000] as const;

/**
 * How far above the calibrated cost per character a run may land before it is read as super-linear
 */
const ALLOWED_FACTOR = 10;

/**
 * The duration below which no run ever fails, so that a short input cannot flake on timer noise
 */
const ABSOLUTE_FLOOR_MS = 50;

/**
 * How long one property may run over all its inputs, well above the fraction of a second three of the largest
 * inputs take.
 *
 * @remarks
 * Linearity is asserted per run against the calibrated budget; this only keeps the default timeout of a single
 * test from failing a slow machine on the total.
 */
const PROPERTY_TIMEOUT_IN_MS = 30_000;

const MAXIMUM_OPENER_COUNT = 5_000;

const OPENER_COUNT_ARBITRARY = fc.integer({ min: 1_000, max: MAXIMUM_OPENER_COUNT });

/**
 * The inputs every property is checked on: the largest repeat count first, where a super-linear cost lands furthest
 * above the linear budget, then two drawn at random.
 */
const PROPERTY_PARAMETERS: fc.Parameters<[number]> = { numRuns: 3, examples: [[MAXIMUM_OPENER_COUNT]] };

const MATCHER = createAttributeMatcher(['data-testid']);

const STRING_MATCHER = createAttributeMatcher(['data-testid'], { removeInStrings: true });

/**
 * Highest cost per character measured over the calibration inputs, filled in before the properties run
 */
let baselineMsPerCharacter = 0;

/**
 * Builds the input of one repeat count of a pathological shape.
 *
 * @param shape - The pathological shape to repeat.
 * @param openerCount - How many copies of its opener, and of its closer, the input holds.
 *
 * @returns The prefix, then every opener followed by every closer, then the suffix.
 */
function buildInput(shape: PathologicalShape, openerCount: number): string {
	return (
		(shape.prefix ?? '') + shape.opener.repeat(openerCount) + shape.closer.repeat(openerCount) + (shape.suffix ?? '')
	);
}

/**
 * Times one matcher call over the given input.
 *
 * @param input - The markup to match.
 * @param options.hasQuotedMustache - Whether a `{…}` inside a quoted value opens a JavaScript expression.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside a quoted value opens a JavaScript expression.
 * @param options.fileKind - The kind of source the input is read as.
 * @param options.removeInStrings - Whether the markup of `'` and `"` strings is read. Default: `false`
 *
 * @returns How long the call took, in milliseconds.
 */
function measureMatch(
	input: string,
	options: {
		hasQuotedMustache: boolean;
		hasQuotedPlaceholder: boolean;
		fileKind?: FileKind;
		removeInStrings?: boolean;
	},
): number {
	const MATCH = options.removeInStrings === true ? STRING_MATCHER : MATCHER;
	const STARTED_AT = performance.now();
	const RESULT = MATCH(input, options);
	const DURATION_IN_MS = performance.now() - STARTED_AT;

	// The result is read so that the call cannot be optimized away as dead code
	if (RESULT.ranges.length < 0) {
		throw new Error('the matcher returned a negative number of ranges');
	}

	return DURATION_IN_MS;
}

/**
 * Asserts that one repeat count of a pathological shape stays within the calibrated linear budget.
 *
 * @param options.shape - The pathological shape to repeat.
 * @param options.openerCount - How many copies of it the input holds.
 * @param options.hasQuotedPlaceholder - Whether a `${…}` inside a quoted value opens a JavaScript expression.
 */
function expectLinearTime(options: {
	shape: PathologicalShape;
	openerCount: number;
	hasQuotedPlaceholder: boolean;
}): void {
	const { shape, openerCount, hasQuotedPlaceholder } = options;
	const INPUT = buildInput(shape, openerCount);
	const BUDGET_IN_MS = Math.max(ABSOLUTE_FLOOR_MS, baselineMsPerCharacter * ALLOWED_FACTOR * INPUT.length);

	expect(
		measureMatch(INPUT, {
			hasQuotedMustache: shape.hasQuotedMustache,
			hasQuotedPlaceholder,
			fileKind: shape.fileKind,
			removeInStrings: shape.removeInStrings,
		}),
	).toBeLessThan(BUDGET_IN_MS);
}

describe('createAttributeMatcher', () => {
	beforeAll(() => {
		baselineMsPerCharacter = Math.max(
			...CALIBRATION_SHAPES.flatMap((shape) =>
				CALIBRATION_OPENER_COUNTS.map((openerCount) => {
					const INPUT = buildInput(shape, openerCount);
					const OPTIONS = { hasQuotedMustache: shape.hasQuotedMustache, hasQuotedPlaceholder: false };

					// A first call warms the code paths up, so the baseline measures the steady state
					measureMatch(INPUT, OPTIONS);

					return measureMatch(INPUT, OPTIONS) / INPUT.length;
				}),
			),
		);
	});

	describe.each([false, true])('with hasQuotedPlaceholder %s', (hasQuotedPlaceholder) => {
		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on values whose expression never closes',
			(openerCount) => {
				expectLinearTime({ shape: UNTERMINATED_EXPRESSION, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on values whose quote never closes',
			(openerCount) => {
				expectLinearTime({ shape: UNTERMINATED_QUOTE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on Svelte quoted mustaches that never close',
			(openerCount) => {
				expectLinearTime({ shape: UNTERMINATED_QUOTED_MUSTACHE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested unquoted placeholders rejected after they balance',
			(openerCount) => {
				expectLinearTime({ shape: NESTED_REJECTED_UNQUOTED_PLACEHOLDER, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested quoted placeholders whose quote never closes',
			(openerCount) => {
				expectLinearTime({ shape: UNTERMINATED_QUOTED_PLACEHOLDER, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested-quote values following a spent budget',
			(openerCount) => {
				expectLinearTime({ shape: BUDGET_EXHAUSTION_BEFORE_NESTED_QUOTES, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested unquoted braces rejected after they balance',
			(openerCount) => {
				expectLinearTime({ shape: NESTED_REJECTED_UNQUOTED_BRACE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested unquoted placeholders and braces rejected after they balance',
			(openerCount) => {
				expectLinearTime({ shape: NESTED_REJECTED_UNQUOTED_MIXED, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on unquoted braces that never close',
			(openerCount) => {
				expectLinearTime({ shape: UNTERMINATED_UNQUOTED_BRACE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on nested unquoted braces followed by one that never closes',
			(openerCount) => {
				expectLinearTime({ shape: NESTED_UNQUOTED_BRACE_BEFORE_UNBALANCED, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on literal placeholders in quoted values nested in enclosing components',
			(openerCount) => {
				expectLinearTime({ shape: LITERAL_PLACEHOLDER_BEFORE_ENCLOSING_BRACE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);

		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear on literal mustaches in quoted values nested in enclosing components on one line',
			(openerCount) => {
				expectLinearTime({ shape: LITERAL_MUSTACHE_BEFORE_ENCLOSING_BRACE, openerCount, hasQuotedPlaceholder });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);
	});

	describe.each(Object.entries(REGION_SHAPES))('reading the regions of %s', (_name, shape) => {
		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear',
			(openerCount) => {
				expectLinearTime({ shape, openerCount, hasQuotedPlaceholder: !shape.hasQuotedMustache });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);
	});

	describe.each(Object.entries(STRING_SHAPES))('reading the markup of %s with removeInStrings', (_name, shape) => {
		test.prop([OPENER_COUNT_ARBITRARY], PROPERTY_PARAMETERS)(
			'stays linear',
			(openerCount) => {
				expectLinearTime({ shape, openerCount, hasQuotedPlaceholder: !shape.hasQuotedMustache });
			},
			PROPERTY_TIMEOUT_IN_MS,
		);
	});
});
