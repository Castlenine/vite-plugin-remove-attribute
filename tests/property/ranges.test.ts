import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';

import { createAttributeMatcher, removeRanges } from '../../src/utilities';

/**
 * Attribute names the matchers under test are built from
 */
const ATTRIBUTE_NAME_POOL = ['data-testid', 'data-cy', 'class', 'id', 'aria-label'] as const;

/**
 * Markup fragments a generated input is assembled from.
 *
 * @remarks
 * Whole attributes sit next to the punctuation they are built from, so that a run reaches the value readers
 * and the ranges they produce instead of only exercising the name pattern. Several of them are deliberately
 * left open, which is what makes the matcher report an attribute as skipped. The quoted placeholders nest the
 * quote delimiting their value, which only the placeholder read steps over, and the unquoted values interpolate
 * `{…}` expressions, some nesting braces and quotes and some never closing.
 */
const MARKUP_FRAGMENTS = [
	'<A',
	'</A>',
	'>',
	'/>',
	' ',
	'\t',
	'\n',
	'"',
	"'",
	'={',
	'}',
	'=',
	':',
	'v-bind:',
	'.attr',
	'`',
	'${',
	'//',
	'/*',
	'*/',
	' data-testid="alpha"',
	" data-cy='beta'",
	' class={ gamma }',
	' id=theta',
	' aria-label',
	' :data-testid.attr={ omega }',
	' v-bind:class="sigma',
	' data-cy={ kappa',
	'$',
	'\\',
	'"${',
	' data-testid="${ ok ? "a" : "b" }"',
	" data-cy='${`x-${ lambda }`}'",
	' :data-testid.attr="${ mu }-${ nu }"',
	' id="\\${ xi }"',
	' class="${ pi',
	'{',
	' data-testid=rho{ tau }',
	' data-cy=${ phi }{ "}" }-{ chi }',
	' id=psi{ { a: "{" } }{',
	' class=upsilon{ zeta',
	' data-testid=eta{',
	...ATTRIBUTE_NAME_POOL,
] as const;

const NAMES_ARBITRARY = fc.uniqueArray(fc.constantFrom(...ATTRIBUTE_NAME_POOL), { minLength: 1, maxLength: 3 });

const MARKUP_FRAGMENT_ARBITRARY = fc
	.array(
		fc.oneof(
			{ arbitrary: fc.constantFrom(...MARKUP_FRAGMENTS), weight: 6 },
			{ arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 6 }), weight: 1 },
		),
		{ minLength: 8, maxLength: 40 },
	)
	.map((parts) => parts.join(''));

const INPUT_ARBITRARY = fc.oneof(fc.string({ unit: 'binary' }), MARKUP_FRAGMENT_ARBITRARY);

describe('createAttributeMatcher', () => {
	test.prop([INPUT_ARBITRARY, NAMES_ARBITRARY, fc.boolean(), fc.boolean()])(
		'never throws, so no input reaches the invariants it fails fast on',
		(input, names, hasQuotedMustache, hasQuotedPlaceholder) => {
			const MATCH_ATTRIBUTES = createAttributeMatcher(names);

			expect(() => MATCH_ATTRIBUTES(input, { hasQuotedMustache, hasQuotedPlaceholder })).not.toThrow();
		},
	);

	test.prop([INPUT_ARBITRARY, NAMES_ARBITRARY, fc.boolean(), fc.boolean()])(
		'returns sorted, non-overlapping, non-empty ranges inside the input',
		(input, names, hasQuotedMustache, hasQuotedPlaceholder) => {
			const RANGES = createAttributeMatcher(names)(input, { hasQuotedMustache, hasQuotedPlaceholder }).ranges;

			const IS_WELL_FORMED = RANGES.every(([start, end], index) => {
				const PREVIOUS_END = index === 0 ? 0 : (RANGES[index - 1]?.[1] ?? 0);

				return start >= PREVIOUS_END && start < end && end <= input.length;
			});

			expect(IS_WELL_FORMED).toBe(true);
		},
	);

	test.prop([INPUT_ARBITRARY, NAMES_ARBITRARY, fc.boolean(), fc.boolean()])(
		'cuts exactly the length of its ranges out of the input',
		(input, names, hasQuotedMustache, hasQuotedPlaceholder) => {
			const RANGES = createAttributeMatcher(names)(input, { hasQuotedMustache, hasQuotedPlaceholder }).ranges;
			const REMOVED_LENGTH = RANGES.reduce((total, [start, end]) => total + (end - start), 0);

			expect(removeRanges(input, RANGES)).toHaveLength(input.length - REMOVED_LENGTH);
		},
	);

	test.prop([INPUT_ARBITRARY, NAMES_ARBITRARY, fc.boolean(), fc.boolean()])(
		'reports a skipped attribute at the index of one of the configured names',
		(input, names, hasQuotedMustache, hasQuotedPlaceholder) => {
			const SKIPPED = createAttributeMatcher(names)(input, { hasQuotedMustache, hasQuotedPlaceholder }).skipped;

			const IS_AT_A_NAME = SKIPPED.every(
				(index) =>
					index >= 0 &&
					index < input.length &&
					names.some((name) => input.slice(index, index + name.length).toLowerCase() === name.toLowerCase()),
			);

			expect(IS_AT_A_NAME).toBe(true);
		},
	);
});
