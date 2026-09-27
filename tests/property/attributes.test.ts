import type { AttributeMatchResult, FileKind, Range } from '../../src/utilities';

import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { parseSync } from 'vite';

import { createAttributeMatcher, removeAttributes, removeRanges } from '../../src/utilities';

// ─── Markup model ─────────────────────────────────────────────────────────────

/**
 * Attribute names both the generated documents and the removal sets are drawn from
 */
const ATTRIBUTE_NAME_POOL = ['data-testid', 'data-cy', 'class', 'id', 'aria-label'] as const;

/**
 * Words every generated value, comment and text run is built from.
 *
 * @remarks
 * None of them holds a name of {@link ATTRIBUTE_NAME_POOL} or the `data-` prefix a generated name carries, so
 * no value and no text ever reads as one of the attributes the matcher was asked to remove. The documented
 * contract covers attributes, not names written as content.
 */
const CONTENT_WORDS = ['alpha', 'beta', 'gamma', 'theta', 'omega', 'sigma', 'kappa', 'lorem'] as const;

/**
 * Element names the generated documents use, none of which holds an attribute name
 */
const ELEMENT_NAMES = ['A', 'Box', 'span', 'p', 'Row'] as const;

/**
 * Vue modifiers a bound name may carry
 */
const BINDING_MODIFIER_NAMES = ['attr', 'prop', 'camel', 'sync'] as const;

/**
 * How deep a generated `={…}` expression nests
 */
const MAXIMUM_EXPRESSION_DEPTH = 3;

type BindingPrefix = '' | ':' | 'v-bind:';

type ValueModel =
	| { kind: 'bare' }
	| { kind: 'quoted'; quote: string; content: string }
	| { kind: 'expression'; content: string }
	| { kind: 'unquoted'; content: string };

interface AttributeModel {
	/**
	 * The name in lower case, which is how the removal sets carry it as well
	 */
	name: string;
	/**
	 * Whether the name is serialized upper-cased, so that the case-insensitive matching is exercised
	 */
	isUpperCase: boolean;
	prefix: BindingPrefix;
	/**
	 * The Vue modifier tail (`.attr.prop`), empty unless the name carries a binding prefix
	 */
	modifiers: string;
	value: ValueModel;
	/**
	 * The whitespace run separating the attribute from what precedes it, never empty
	 */
	whitespaceBefore: string;
}

interface ElementModel {
	tag: string;
	attributes: AttributeModel[];
	/**
	 * The whitespace run in front of the `>` or `/>` closing the tag, never empty
	 */
	whitespaceBeforeClose: string;
	isSelfClosing: boolean;
	/**
	 * The text between the opening and the closing tag, read only when the element is not self-closing
	 */
	childText: string;
	/**
	 * The text following the element
	 */
	followingText: string;
}

interface DocumentModel {
	leadingText: string;
	elements: ElementModel[];
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const WHITESPACE_ARBITRARY = fc
	.array(fc.constantFrom(' ', '\t', '\n', '\r\n'), { minLength: 1, maxLength: 3 })
	.map((parts) => parts.join(''));

const WORD_ARBITRARY = fc.constantFrom(...CONTENT_WORDS);

const IDENTIFIER_ARBITRARY = fc
	.tuple(WORD_ARBITRARY, fc.integer({ min: 0, max: 9 }))
	.map(([word, suffix]) => `${word}${suffix}`);

const NUMBER_ARBITRARY = fc.integer({ min: 0, max: 999 }).map((value) => String(value));

const QUOTE_ARBITRARY = fc.constantFrom('"', "'");

/**
 * A single-line JavaScript string literal, escaped quotes included and never closed by accident
 */
const STRING_LITERAL_ARBITRARY = QUOTE_ARBITRARY.chain((quote) =>
	fc
		.array(fc.constantFrom(...CONTENT_WORDS, ' ', '-', '.', `\\${quote}`), { maxLength: 4 })
		.map((parts) => `${quote}${parts.join('')}${quote}`),
);

const TEMPLATE_TEXT_ARBITRARY = fc
	.array(fc.constantFrom(...CONTENT_WORDS, ' ', '-'), { maxLength: 3 })
	.map((parts) => parts.join(''));

const TEXT_ARBITRARY = fc
	.array(fc.constantFrom(...CONTENT_WORDS, ' ', '\n', '.', ',', '!', '?'), { maxLength: 6 })
	.map((parts) => parts.join(''));

/**
 * Builds the arbitrary of an `={…}` expression body.
 *
 * @remarks
 * The grammar stays inside what the scanner promises to follow: identifiers, numbers, string literals,
 * template literals with their `${…}` placeholders, nested objects and both comment forms. It holds no
 * regular expression literal and no nested element, which the scanner reads but which are covered by the unit
 * tests rather than by a generated oracle. Every form is balanced by construction, so the matcher always
 * measures the value and never reports it as skipped.
 *
 * @param depth - How many further levels the body may nest.
 *
 * @returns An arbitrary of expression bodies.
 */
function buildExpressionArbitrary(depth: number): fc.Arbitrary<string> {
	const LEAF = fc.oneof(IDENTIFIER_ARBITRARY, NUMBER_ARBITRARY, STRING_LITERAL_ARBITRARY);

	if (depth <= 0) {
		return LEAF;
	}

	const INNER = buildExpressionArbitrary(depth - 1);

	return fc.oneof(
		{ arbitrary: LEAF, weight: 5 },
		{ arbitrary: fc.tuple(INNER, INNER).map(([left, right]) => `${left} + ${right}`), weight: 1 },
		{ arbitrary: fc.tuple(IDENTIFIER_ARBITRARY, INNER).map(([key, value]) => `{ ${key}: ${value} }`), weight: 1 },
		{
			arbitrary: fc
				.tuple(TEMPLATE_TEXT_ARBITRARY, INNER, TEMPLATE_TEXT_ARBITRARY)
				.map(([before, expression, after]) => `\`${before}\${${expression}}${after}\``),
			weight: 1,
		},
		{ arbitrary: fc.tuple(INNER, WORD_ARBITRARY).map(([body, note]) => `${body} /* ${note} */`), weight: 1 },
		{ arbitrary: fc.tuple(INNER, WORD_ARBITRARY).map(([body, note]) => `${body} // ${note}\n`), weight: 1 },
	);
}

const EXPRESSION_ARBITRARY = buildExpressionArbitrary(MAXIMUM_EXPRESSION_DEPTH);

const QUOTED_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = QUOTE_ARBITRARY.chain((quote) =>
	fc
		.array(fc.constantFrom(...CONTENT_WORDS, ' ', '-', '_', '.', ':', ',', '#', '\n', quote === '"' ? "'" : '"'), {
			maxLength: 5,
		})

		.map((parts) => ({ kind: 'quoted', quote, content: parts.join('') })),
);

const UNQUOTED_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = fc
	.array(fc.constantFrom(...CONTENT_WORDS, '0', '7', '_', '-'), { minLength: 1, maxLength: 3 })
	.map((parts) => ({ kind: 'unquoted', content: parts.join('') }));

const EXPRESSION_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = EXPRESSION_ARBITRARY.map((content) => ({
	kind: 'expression',
	content,
}));

/**
 * An unquoted value interpolating one or two `{…}` or `${…}` expressions after a leading run of text.
 *
 * @remarks
 * The leading run is what keeps the value from reading as the `={…}` form, which ends at its own brace. The
 * expressions come from the same grammar as `={…}` values, spaces, quotes and nested braces included, which
 * only the expression scan steps over — a plain run would end the value at the first of them.
 */
const INTERPOLATED_UNQUOTED_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = fc
	.tuple(
		WORD_ARBITRARY,
		fc.array(fc.tuple(fc.constantFrom('{', '${'), EXPRESSION_ARBITRARY, fc.constantFrom('', '-', ...CONTENT_WORDS)), {
			minLength: 1,
			maxLength: 2,
		}),
	)
	.map(([head, parts]) => ({
		kind: 'unquoted',
		content: `${head}${parts.map(([opener, expression, text]) => `${opener}${expression}}${text}`).join('')}`,
	}));

const VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = fc.oneof(
	fc.constant<ValueModel>({ kind: 'bare' }),
	QUOTED_VALUE_ARBITRARY,
	EXPRESSION_VALUE_ARBITRARY,
	UNQUOTED_VALUE_ARBITRARY,
	INTERPOLATED_UNQUOTED_VALUE_ARBITRARY,
);

/**
 * A quoted value interpolating one or two tagged-template placeholders between runs of text.
 *
 * @remarks
 * The expressions come from the same grammar as `={…}` values, so a placeholder may hold a string literal in
 * the very quote delimiting the value — which only the placeholder read steps over, and which the plain read
 * cuts. Documents drawing from it are therefore only matched with the placeholder flag on.
 */
const PLACEHOLDER_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = fc
	.tuple(
		QUOTE_ARBITRARY,
		fc.array(fc.tuple(TEMPLATE_TEXT_ARBITRARY, EXPRESSION_ARBITRARY), { minLength: 1, maxLength: 2 }),
		TEMPLATE_TEXT_ARBITRARY,
	)
	.map(([quote, parts, tail]) => ({
		kind: 'quoted',
		quote,
		content: `${parts.map(([text, expression]) => `${text}\${${expression}}`).join('')}${tail}`,
	}));

const SCRIPT_VALUE_ARBITRARY: fc.Arbitrary<ValueModel> = fc.oneof(VALUE_ARBITRARY, PLACEHOLDER_VALUE_ARBITRARY);

/**
 * A `data-` name of one to six letters, alongside the fixed pool every document draws from
 */
const GENERATED_NAME_ARBITRARY = fc
	.array(fc.constantFrom(...'abcdefgh'), { minLength: 1, maxLength: 6 })
	.map((letters) => `data-${letters.join('')}`);

const ATTRIBUTE_NAME_ARBITRARY = fc.oneof(
	{ arbitrary: fc.constantFrom(...ATTRIBUTE_NAME_POOL), weight: 4 },
	{ arbitrary: GENERATED_NAME_ARBITRARY, weight: 1 },
);

const REMOVAL_NAMES_ARBITRARY = fc.uniqueArray(ATTRIBUTE_NAME_ARBITRARY, { minLength: 1, maxLength: 3 });

/**
 * Builds the arbitrary of one element whose attribute values and binding prefixes are drawn from the given
 * arbitraries.
 *
 * @param options.valueArbitrary - The arbitrary every attribute value is drawn from.
 * @param options.prefixArbitrary - The arbitrary every binding prefix is drawn from.
 *
 * @returns An arbitrary of element models.
 */
function buildElementArbitrary(options: {
	valueArbitrary: fc.Arbitrary<ValueModel>;
	prefixArbitrary: fc.Arbitrary<BindingPrefix>;
}): fc.Arbitrary<ElementModel> {
	const ATTRIBUTE_ARBITRARY: fc.Arbitrary<AttributeModel> = fc
		.record({
			name: ATTRIBUTE_NAME_ARBITRARY,
			isUpperCase: fc.boolean(),
			prefix: options.prefixArbitrary,
			modifiers: fc
				.array(fc.constantFrom(...BINDING_MODIFIER_NAMES), { maxLength: 2 })
				.map((names) => names.map((name) => `.${name}`).join('')),
			value: options.valueArbitrary,
			whitespaceBefore: WHITESPACE_ARBITRARY,
		})

		// Without a binding prefix a `.tail` is no modifier at all, so the name would simply be a longer one
		.map((attribute) => ({ ...attribute, modifiers: attribute.prefix === '' ? '' : attribute.modifiers }));

	return fc.record({
		tag: fc.constantFrom(...ELEMENT_NAMES),
		attributes: fc.array(ATTRIBUTE_ARBITRARY, { maxLength: 4 }),
		whitespaceBeforeClose: WHITESPACE_ARBITRARY,
		isSelfClosing: fc.boolean(),
		childText: TEXT_ARBITRARY,
		followingText: TEXT_ARBITRARY,
	});
}

const EVERY_PREFIX_ARBITRARY = fc.constantFrom<BindingPrefix>('', ':', 'v-bind:');

/**
 * Builds the arbitrary of a whole document whose attribute values are drawn from the given arbitrary.
 *
 * @param valueArbitrary - The arbitrary every attribute value is drawn from.
 *
 * @returns An arbitrary of document models.
 */
function buildDocumentArbitrary(valueArbitrary: fc.Arbitrary<ValueModel>): fc.Arbitrary<DocumentModel> {
	return fc.record({
		leadingText: TEXT_ARBITRARY,
		elements: fc.array(buildElementArbitrary({ valueArbitrary, prefixArbitrary: EVERY_PREFIX_ARBITRARY }), {
			minLength: 1,
			maxLength: 4,
		}),
	});
}

const DOCUMENT_ARBITRARY = buildDocumentArbitrary(VALUE_ARBITRARY);

/**
 * Documents a script file may hold, whose quoted values also interpolate tagged-template placeholders
 */
const SCRIPT_DOCUMENT_ARBITRARY = buildDocumentArbitrary(SCRIPT_VALUE_ARBITRARY);

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes one attribute, binding prefix, Vue modifiers and value form included.
 *
 * @param attribute - The attribute to serialize.
 *
 * @returns The attribute as it appears in the markup, without the whitespace in front of it.
 */
function serializeAttribute(attribute: AttributeModel): string {
	const NAME = attribute.isUpperCase ? attribute.name.toUpperCase() : attribute.name;
	const HEAD = `${attribute.prefix}${NAME}${attribute.modifiers}`;
	const VALUE = attribute.value;

	if (VALUE.kind === 'bare') {
		return HEAD;
	}

	if (VALUE.kind === 'quoted') {
		return `${HEAD}=${VALUE.quote}${VALUE.content}${VALUE.quote}`;
	}

	if (VALUE.kind === 'expression') {
		return `${HEAD}={${VALUE.content}}`;
	}

	return `${HEAD}=${VALUE.content}`;
}

/**
 * Serializes one element, dropping the attributes whose name is in the removal set.
 *
 * @remarks
 * A dropped attribute takes the whitespace run in front of it along, which is the rule the plugin follows
 * whenever something still separates the attribute from what follows it. Every generated element keeps at
 * least one whitespace character between two attributes and in front of its `>` or `/>`, so that rule alone
 * describes the expected output.
 *
 * @param element - The element to serialize.
 * @param removedNames - The lower-cased names to leave out.
 *
 * @returns The element as it appears in the markup, the text following it included.
 */
function serializeElement(element: ElementModel, removedNames: ReadonlySet<string>): string {
	const ATTRIBUTES = element.attributes
		.filter((attribute) => !removedNames.has(attribute.name))
		.map((attribute) => `${attribute.whitespaceBefore}${serializeAttribute(attribute)}`)
		.join('');
	const TAIL = element.isSelfClosing
		? `${element.whitespaceBeforeClose}/>`
		: `${element.whitespaceBeforeClose}>${element.childText}</${element.tag}>`;

	return `<${element.tag}${ATTRIBUTES}${TAIL}${element.followingText}`;
}

/**
 * Serializes a whole document, dropping the attributes whose name is in the removal set.
 *
 * @param document - The document model to serialize.
 * @param removedNames - The lower-cased names to leave out.
 *
 * @returns The markup of the document.
 */
function serializeDocument(document: DocumentModel, removedNames: ReadonlySet<string>): string {
	return document.leadingText + document.elements.map((element) => serializeElement(element, removedNames)).join('');
}

const NOTHING_REMOVED: ReadonlySet<string> = new Set<string>();

// ─── Region model ─────────────────────────────────────────────────────────────

/**
 * One piece of a generated source: an element, whose configured attributes are removed, or noise — an attribute
 * name written where no attribute sits, which stays byte-identical
 */
type SegmentModel = { kind: 'element'; element: ElementModel } | { kind: 'noise'; text: string };

/**
 * Writes an attribute name where no attribute sits
 */
type NoiseTemplate = (name: string) => string;

/**
 * Noise every document kind leaves alone: text, an escaped tag, a comment, a style block and a script block
 */
const DOCUMENT_NOISE_TEMPLATES: readonly NoiseTemplate[] = [
	(name) => `\nAdd ${name} to every button, ${name}="x" included.\n`,
	(name) => `&lt;b ${name}="e"&gt;`,
	(name) => `<pre>&lt;i ${name}&gt;</pre>`,
	(name) => `<!-- <b ${name}="c"> ${name} -->`,
	(name) => `<style>[${name}="s"] { content: "<b ${name}='s'>"; }</style>`,
	(name) => `<script>const s = "<b ${name}='x'> ${name}"; // <i ${name}="y">\n</script>`,
];

/**
 * Noise particular to one document kind: a string in an expression, and a Markdown fenced code block
 */
const KIND_NOISE_TEMPLATES: Readonly<Partial<Record<FileKind, readonly NoiseTemplate[]>>> = {
	markup: [(name) => `{'<b ${name}="s">'}`],
	astro: [(name) => `{'<b ${name}="s">'}`],
	vue: [(name) => `{{ '<b ${name}="s">' }}`],
	markdown: [(name) => `\n\`\`\`html\n<b ${name}="f">\n\`\`\`\n`, (name) => `{'<b ${name}="s">'}`],
};

/**
 * Noise a script leaves alone: strings, comments, a regular expression and the text of template-literal markup
 */
const SCRIPT_NOISE_TEMPLATES: readonly NoiseTemplate[] = [
	(name) => `const note = "<b ${name}='x'> ${name}";\n`,
	(name) => `// <i ${name}="y">\n`,
	(name) => `/* <i ${name}="z"> */\n`,
	(name) => `const text = \`${name}="t" text\`;\n`,
	(name) => `const comment = \`<!-- <b ${name}="c"> -->\`;\n`,
	(name) => `const regex = /<b ${name}="r">/;\n`,
];

/**
 * Builds the arbitrary of the noise written from the given templates.
 *
 * @param templates - The templates the noise is written from.
 *
 * @returns An arbitrary of noise segments.
 */
function buildNoiseArbitrary(templates: readonly NoiseTemplate[]): fc.Arbitrary<SegmentModel> {
	return fc
		.tuple(fc.constantFrom(...ATTRIBUTE_NAME_POOL), fc.constantFrom(...templates))
		.map(([name, template]) => ({ kind: 'noise', text: template(name) }));
}

/**
 * Builds the arbitrary of a source interleaving elements and noise.
 *
 * @param options.elementArbitrary - The arbitrary every element is drawn from.
 * @param options.noiseTemplates - The templates every noise segment is written from.
 *
 * @returns An arbitrary of segment lists.
 */
function buildSegmentsArbitrary(options: {
	elementArbitrary: fc.Arbitrary<ElementModel>;
	noiseTemplates: readonly NoiseTemplate[];
}): fc.Arbitrary<SegmentModel[]> {
	const SEGMENT_ARBITRARY = fc.oneof(
		options.elementArbitrary.map((element): SegmentModel => ({ kind: 'element', element })),
		buildNoiseArbitrary(options.noiseTemplates),
	);

	return fc.array(SEGMENT_ARBITRARY, { minLength: 1, maxLength: 6 });
}

/**
 * The document kinds, each with the noise it leaves alone
 */
const DOCUMENT_SOURCE_ARBITRARY = fc
	.constantFrom<FileKind>('html', 'markup', 'vue', 'markdown', 'astro')
	.chain((fileKind) =>
		buildSegmentsArbitrary({
			elementArbitrary: buildElementArbitrary({
				valueArbitrary: VALUE_ARBITRARY,
				prefixArbitrary: EVERY_PREFIX_ARBITRARY,
			}),
			noiseTemplates: [...DOCUMENT_NOISE_TEMPLATES, ...(KIND_NOISE_TEMPLATES[fileKind] ?? [])],
		}).map((segments) => ({ fileKind, segments })),
	);

/**
 * JSX elements that parse as written: no binding prefix, and no unquoted value
 */
const JSX_ELEMENT_ARBITRARY = buildElementArbitrary({
	valueArbitrary: fc.oneof(
		fc.constant<ValueModel>({ kind: 'bare' }),
		QUOTED_VALUE_ARBITRARY,
		EXPRESSION_VALUE_ARBITRARY,
	),
	prefixArbitrary: fc.constant<BindingPrefix>(''),
}).map((element) => ({ ...element, followingText: '' }));

/**
 * Elements a template literal holds, whose expressions are placeholders: an `={…}` value is written `=${…}`
 */
const TEMPLATE_ELEMENT_ARBITRARY = buildElementArbitrary({
	valueArbitrary: fc.oneof(
		fc.constant<ValueModel>({ kind: 'bare' }),
		QUOTED_VALUE_ARBITRARY,
		UNQUOTED_VALUE_ARBITRARY,
		PLACEHOLDER_VALUE_ARBITRARY,
		EXPRESSION_ARBITRARY.map((content): ValueModel => ({ kind: 'unquoted', content: `\${${content}}` })),
	),
	prefixArbitrary: EVERY_PREFIX_ARBITRARY,
});

/**
 * Serializes a source of segments, dropping the configured attributes of its elements.
 *
 * @param options.segments - The segments of the source.
 * @param options.removedNames - The lower-cased names to leave out.
 * @param options.wrapElement - Writes the serialized element into the source, as markup, a JSX expression or a
 *   template literal.
 *
 * @returns The source.
 */
function serializeSegments(options: {
	segments: readonly SegmentModel[];
	removedNames: ReadonlySet<string>;
	wrapElement: (element: string) => string;
}): string {
	const { segments, removedNames, wrapElement } = options;

	return segments
		.map((segment) =>
			segment.kind === 'noise' ? segment.text : wrapElement(serializeElement(segment.element, removedNames)),
		)
		.join('');
}

/**
 * Writes an element as the value of a JSX constant, the text following it left out
 */
function wrapJsxElement(element: string): string {
	return `const value = (${element});\n`;
}

/**
 * Writes an element as the markup of a tagged template literal
 */
function wrapTemplateElement(element: string): string {
	return `const view = html\`${element}\`;\n`;
}

/**
 * Removes the given names from a source of the given kind, reading quoted `${…}` placeholders the way every
 * non-Svelte file is read.
 *
 * @param options.input - The source.
 * @param options.removalNames - The attribute names to remove.
 * @param options.fileKind - The kind of source.
 *
 * @returns The source without the attributes.
 */
function removeFromKind(options: { input: string; removalNames: readonly string[]; fileKind: FileKind }): string {
	const { input, removalNames, fileKind } = options;
	const { ranges } = createAttributeMatcher(removalNames)(input, {
		hasQuotedMustache: false,
		hasQuotedPlaceholder: true,
		fileKind,
	});

	return removeRanges(input, ranges);
}

// ─── Literal placeholder model ────────────────────────────────────────────────

/**
 * One component of a generated module, rendering a single element whose `data-testid` holds a literal `${` or
 * `{` that never closes
 */
interface LiteralComponentModel {
	tag: string;
	attributesBefore: string[];
	/**
	 * The `data-testid` attribute, whose quoted value holds the literal opener
	 */
	literalAttribute: string;
	attributesAfter: string[];
	children: string;
	/**
	 * A statement in front of the `return`, which puts braces of the module between two elements
	 */
	statement: string;
}

/**
 * Content of a quoted value starting with a word, the way a class name, an id or a title does
 */
const WORD_LED_CONTENT_ARBITRARY = fc
	.tuple(WORD_ARBITRARY, fc.array(fc.constantFrom(...CONTENT_WORDS, ' ', '-'), { maxLength: 3 }))
	.map(([head, rest]) => `${head}${rest.join('')}`);

/**
 * An attribute written next to the literal one and never removed: a word-led quoted value, an expression value
 * or a bare name
 */
const NEIGHBOR_ATTRIBUTE_ARBITRARY = fc.oneof(
	fc
		.tuple(fc.constantFrom('class', 'id', 'title'), QUOTE_ARBITRARY, WORD_LED_CONTENT_ARBITRARY)
		.map(([name, quote, content]) => `${name}=${quote}${content}${quote}`),
	fc.tuple(fc.constantFrom('id', 'title'), IDENTIFIER_ARBITRARY).map(([name, identifier]) => `${name}={${identifier}}`),
	fc.constant('hidden'),
);

const LITERAL_ATTRIBUTE_ARBITRARY = fc
	.tuple(QUOTE_ARBITRARY, TEMPLATE_TEXT_ARBITRARY, fc.constantFrom('${', '{'), TEMPLATE_TEXT_ARBITRARY)
	.map(([quote, before, opener, after]) => `data-testid=${quote}${before}${opener}${after}${quote}`);

const LITERAL_COMPONENT_ARBITRARY: fc.Arbitrary<LiteralComponentModel> = fc.record({
	tag: fc.constantFrom(...ELEMENT_NAMES),
	attributesBefore: fc.array(NEIGHBOR_ATTRIBUTE_ARBITRARY, { maxLength: 2 }),
	literalAttribute: LITERAL_ATTRIBUTE_ARBITRARY,
	attributesAfter: fc.array(NEIGHBOR_ATTRIBUTE_ARBITRARY, { maxLength: 2 }),
	children: fc
		.array(
			fc.oneof(
				WORD_ARBITRARY,
				IDENTIFIER_ARBITRARY.map((identifier) => `{${identifier}}`),
			),
			{ maxLength: 3 },
		)
		.map((parts) => parts.join(' ')),
	statement: fc.oneof(
		fc.constant(''),
		IDENTIFIER_ARBITRARY.map((identifier) => `const value = { key: ${identifier} };`),
	),
});

/**
 * Serializes a module of components, each a function returning its element, the literal attribute kept or
 * dropped along with the space in front of it.
 *
 * @param options.components - The components of the module.
 * @param options.isLiteralKept - Whether the `data-testid` attributes are written.
 * @param options.isSingleLine - Whether the module is written on one line, the way a minifier would.
 *
 * @returns The TSX source of the module.
 */
function serializeLiteralModule(options: {
	components: readonly LiteralComponentModel[];
	isLiteralKept: boolean;
	isSingleLine: boolean;
}): string {
	const { components, isLiteralKept, isSingleLine } = options;

	return components
		.map((component, index) => {
			const ATTRIBUTES = [
				...component.attributesBefore,
				...(isLiteralKept ? [component.literalAttribute] : []),
				...component.attributesAfter,
			]
				.map((attribute) => ` ${attribute}`)
				.join('');
			const ELEMENT = `<${component.tag}${ATTRIBUTES}>${component.children}</${component.tag}>`;

			if (isSingleLine) {
				return `function Component${index}(){${component.statement}return ${ELEMENT};}`;
			}

			const STATEMENT_LINE = component.statement === '' ? '' : `\t${component.statement}\n`;

			return `function Component${index}() {\n${STATEMENT_LINE}\treturn ${ELEMENT};\n}\n`;
		})

		.join(isSingleLine ? '' : '\n');
}

// ─── String markup model ──────────────────────────────────────────────────────

/**
 * One statement of a generated module: a JSX element, an element written in a `'` or `"` string — read as markup
 * only with `removeInStrings` on — or noise that stays byte-identical either way
 */
type StringSegmentModel =
	| { kind: 'element'; element: ElementModel }
	| { kind: 'noise'; text: string }
	| { kind: 'string'; quote: string; element: ElementModel };

/**
 * Noise a module leaves alone even with `removeInStrings` on: strings whose markup the option never reads, and the
 * comments, regular expression and template-literal text a script always leaves alone
 */
const STRING_NOISE_TEMPLATES: readonly NoiseTemplate[] = [
	(name) => `const note = "${name} text";\n`,
	(name) => `const escaped = "<b ${name}=\\"x\\">";\n`,
	(name) => `const split = '<b ${name}="' + id + '">';\n`,
	(name) => `const open = '<b ${name}';\n`,
	(name) => `const selector = '[${name}="x"]';\n`,
	(name) => `const comment = '<!-- <b ${name}="c">';\n`,
	...SCRIPT_NOISE_TEMPLATES.slice(1),
];

/**
 * Replaces every line break of a generated run by a space, which a `'` or `"` string cannot hold.
 *
 * @param text - The run.
 *
 * @returns The run on one line.
 */
function toSingleLine(text: string): string {
	return text.replaceAll(/\r?\n/g, ' ');
}

/**
 * Builds the arbitrary of an element a string delimited by the given quote holds: on one line, and quoting its
 * values with the other quote.
 *
 * @param quote - The quote delimiting the string.
 *
 * @returns An arbitrary of element models.
 */
function buildStringElementArbitrary(quote: string): fc.Arbitrary<ElementModel> {
	const VALUE_QUOTE = quote === '"' ? "'" : '"';
	const QUOTED_VALUE: fc.Arbitrary<ValueModel> = fc
		.array(fc.constantFrom(...CONTENT_WORDS, ' ', '-', '_', '.', ':', ','), { maxLength: 5 })
		.map((parts) => ({ kind: 'quoted', quote: VALUE_QUOTE, content: parts.join('') }));

	return buildElementArbitrary({
		valueArbitrary: fc.oneof(fc.constant<ValueModel>({ kind: 'bare' }), QUOTED_VALUE, UNQUOTED_VALUE_ARBITRARY),
		prefixArbitrary: EVERY_PREFIX_ARBITRARY,
	}).map((element) => ({
		...element,
		attributes: element.attributes.map((attribute) => ({
			...attribute,
			whitespaceBefore: toSingleLine(attribute.whitespaceBefore),
		})),
		whitespaceBeforeClose: toSingleLine(element.whitespaceBeforeClose),
		childText: toSingleLine(element.childText),
		followingText: '',
	}));
}

const STRING_SEGMENTS_ARBITRARY: fc.Arbitrary<StringSegmentModel[]> = fc.array(
	fc.oneof(
		JSX_ELEMENT_ARBITRARY.map((element): StringSegmentModel => ({ kind: 'element', element })),
		QUOTE_ARBITRARY.chain((quote) =>
			buildStringElementArbitrary(quote).map((element): StringSegmentModel => ({ kind: 'string', quote, element })),
		),
		buildNoiseArbitrary(STRING_NOISE_TEMPLATES),
	),
	{ minLength: 1, maxLength: 6 },
);

/**
 * A generated module, with the content range of every string holding an element
 */
interface StringModule {
	code: string;
	/**
	 * The `[start, end)` range between the quotes of every string segment
	 */
	stringRanges: Range[];
}

/**
 * Serializes a module of string segments.
 *
 * @param options.segments - The segments of the module.
 * @param options.removedNames - The lower-cased names to leave out of JSX elements.
 * @param options.removedStringNames - The lower-cased names to leave out of the elements strings hold.
 *
 * @returns The TSX source of the module, and where its string segments sit.
 */
function serializeStringModule(options: {
	segments: readonly StringSegmentModel[];
	removedNames: ReadonlySet<string>;
	removedStringNames: ReadonlySet<string>;
}): StringModule {
	const { segments, removedNames, removedStringNames } = options;

	return segments.reduce<StringModule>(
		(module, segment) => {
			if (segment.kind === 'noise') {
				return { ...module, code: module.code + segment.text };
			}

			if (segment.kind === 'element') {
				return { ...module, code: module.code + wrapJsxElement(serializeElement(segment.element, removedNames)) };
			}

			const HEAD = `const markup = ${segment.quote}`;
			const CONTENT = serializeElement(segment.element, removedStringNames);
			const CONTENT_START = module.code.length + HEAD.length;

			return {
				code: `${module.code}${HEAD}${CONTENT}${segment.quote};\n`,
				stringRanges: [...module.stringRanges, [CONTENT_START, CONTENT_START + CONTENT.length]],
			};
		},
		{ code: '', stringRanges: [] },
	);
}

/**
 * Builds the words and markup the content of a generated `'` or `"` string is drawn from: whole tags, including the
 * values a matcher may measure past the string — a `${` placeholder, and a `{` a Svelte quoted value reads as a
 * mustache — and the loose fragments of tags a string leaves open.
 *
 * @param valueQuote - The quote the string does not use, which its markup quotes values with.
 *
 * @returns The fragments.
 */
function buildStringFragments(valueQuote: string): string[] {
	function quoteValue(text: string): string {
		return `${valueQuote}${text}${valueQuote}`;
	}

	return [
		`<b data-testid=${quoteValue('x')} class=${quoteValue('k')}>`,
		'<i data-testid>',
		`<b data-testid=${quoteValue('{')}>`,
		`<b data-testid=${quoteValue('${')}>`,
		`<b data-testid=${quoteValue('}')}>`,
		'</b>',
		'<!-- ',
		' -->',
		'<b',
		' data-testid',
		'=',
		valueQuote,
		'>',
		' ',
		'x',
		'{',
		'}',
		'${',
	];
}

/**
 * A module of `'` and `"` strings — alone, or concatenated with an identifier or with a string closing a brace a value
 * opened — whose content mixes markup fragments, on one line and free of backslashes, so that every string is valid
 * whatever it holds
 */
const STRING_SOUP_ARBITRARY = fc
	.array(
		fc.tuple(
			QUOTE_ARBITRARY.chain((quote) =>
				fc
					.array(fc.constantFrom(...buildStringFragments(quote === '"' ? "'" : '"')), { maxLength: 6 })
					.map((parts) => `${quote}${parts.join('')}${quote}`),
			),
			fc.constantFrom('', ' + id', ' + id + "</b>"', ' + "}"'),
		),
		{ minLength: 1, maxLength: 5 },
	)
	.map((statements) =>
		statements.map(([literal, tail], index) => `const value${index} = ${literal}${tail};\n`).join(''),
	);

/**
 * Reports whether a range lies inside another.
 *
 * @param range - The range.
 * @param container - The range it may lie in.
 *
 * @returns `true` when every index of `range` belongs to `container`.
 */
function isWithin(range: Range, container: Range): boolean {
	return range[0] >= container[0] && range[1] <= container[1];
}

/**
 * Reports whether two ranges share an index.
 *
 * @param range - One range.
 * @param other - The other.
 *
 * @returns `true` when the ranges overlap.
 */
function isOverlapping(range: Range, other: Range): boolean {
	return range[0] < other[1] && range[1] > other[0];
}

/**
 * Collects the type of every node of a syntax tree, in depth-first order.
 *
 * @param node - The node, or any value one holds.
 *
 * @returns The node types, which two trees share exactly when only the text of their literals differs.
 */
function collectNodeTypes(node: unknown): string[] {
	if (Array.isArray(node)) {
		return node.flatMap(collectNodeTypes);
	}

	if (typeof node !== 'object' || node == null) {
		return [];
	}

	const TYPE = (node as { type?: unknown }).type;

	return [...(typeof TYPE === 'string' ? [TYPE] : []), ...Object.values(node).flatMap(collectNodeTypes)];
}

// ─── Properties ───────────────────────────────────────────────────────────────

describe('removeAttributes', () => {
	test.prop([DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY])(
		'removes every configured attribute, its whitespace run, and nothing else',
		(document, removalNames) => {
			const INPUT = serializeDocument(document, NOTHING_REMOVED);
			const EXPECTED = serializeDocument(document, new Set(removalNames));

			expect(removeAttributes(INPUT, removalNames)).toBe(EXPECTED);
		},
	);

	test.prop([DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY, fc.boolean(), fc.boolean()])(
		'measures every generated attribute, so none is left in place',
		(document, removalNames, hasQuotedMustache, hasQuotedPlaceholder) => {
			const INPUT = serializeDocument(document, NOTHING_REMOVED);

			expect(createAttributeMatcher(removalNames)(INPUT, { hasQuotedMustache, hasQuotedPlaceholder }).skipped).toEqual(
				[],
			);
		},
	);

	test.prop([DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY])(
		'is idempotent on generated markup',
		(document, removalNames) => {
			const INPUT = serializeDocument(document, NOTHING_REMOVED);
			const ONCE = removeAttributes(INPUT, removalNames);

			expect(removeAttributes(ONCE, removalNames)).toBe(ONCE);
		},
	);

	test.prop([fc.string({ unit: 'binary' }), REMOVAL_NAMES_ARBITRARY])(
		'is idempotent on arbitrary unicode input',
		(input, removalNames) => {
			const ONCE = removeAttributes(input, removalNames);

			expect(removeAttributes(ONCE, removalNames)).toBe(ONCE);
		},
	);

	test.prop([fc.string({ unit: 'binary' }), REMOVAL_NAMES_ARBITRARY])(
		'leaves an input holding none of the names untouched',
		(input, removalNames) => {
			const LOWER_CASED_INPUT = input.toLowerCase();

			fc.pre(removalNames.every((name) => !LOWER_CASED_INPUT.includes(name)));

			expect(removeAttributes(input, removalNames)).toBe(input);
		},
	);
});

describe('createAttributeMatcher on quoted placeholders', () => {
	/**
	 * Removes the given names the way a script file is transformed, a Svelte mustache read or not.
	 *
	 * @param options.input - The markup to transform.
	 * @param options.removalNames - The attribute names to remove.
	 * @param options.hasQuotedMustache - Whether a `{…}` inside a quoted value opens a JavaScript expression.
	 *
	 * @returns The markup without the attributes.
	 */
	function removeScriptAttributes(options: {
		input: string;
		removalNames: readonly string[];
		hasQuotedMustache: boolean;
	}): string {
		const { input, removalNames, hasQuotedMustache } = options;
		const { ranges } = createAttributeMatcher(removalNames)(input, { hasQuotedMustache, hasQuotedPlaceholder: true });

		return removeRanges(input, ranges);
	}

	test.prop([SCRIPT_DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY, fc.boolean()])(
		'removes every configured attribute, placeholders included, and nothing else',
		(document, removalNames, hasQuotedMustache) => {
			const INPUT = serializeDocument(document, NOTHING_REMOVED);
			const EXPECTED = serializeDocument(document, new Set(removalNames));

			expect(removeScriptAttributes({ input: INPUT, removalNames, hasQuotedMustache })).toBe(EXPECTED);
		},
	);

	test.prop([SCRIPT_DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY, fc.boolean()])(
		'measures every generated attribute, so none is left in place',
		(document, removalNames, hasQuotedMustache) => {
			const INPUT = serializeDocument(document, NOTHING_REMOVED);
			const { skipped } = createAttributeMatcher(removalNames)(INPUT, {
				hasQuotedMustache,
				hasQuotedPlaceholder: true,
			});

			expect(skipped).toEqual([]);
		},
	);

	test.prop([SCRIPT_DOCUMENT_ARBITRARY, REMOVAL_NAMES_ARBITRARY, fc.boolean()])(
		'is idempotent on generated markup',
		(document, removalNames, hasQuotedMustache) => {
			const ONCE = removeScriptAttributes({
				input: serializeDocument(document, NOTHING_REMOVED),
				removalNames,
				hasQuotedMustache,
			});

			expect(removeScriptAttributes({ input: ONCE, removalNames, hasQuotedMustache })).toBe(ONCE);
		},
	);
});

describe('createAttributeMatcher on a literal `${` or `{` in a quoted value', () => {
	test.prop([fc.array(LITERAL_COMPONENT_ARBITRARY, { minLength: 1, maxLength: 3 }), fc.boolean(), fc.boolean()])(
		'reads the value as plain text whatever brace of the module follows it, and emits a module that parses',
		(components, isSingleLine, hasQuotedMustache) => {
			const INPUT = serializeLiteralModule({ components, isLiteralKept: true, isSingleLine });
			const { ranges, skipped } = createAttributeMatcher(['data-testid'])(INPUT, {
				hasQuotedMustache,
				hasQuotedPlaceholder: true,
			});

			const OUTPUT = removeRanges(INPUT, ranges);

			expect(OUTPUT).toBe(serializeLiteralModule({ components, isLiteralKept: false, isSingleLine }));
			expect(skipped).toEqual([]);
			expect(parseSync('module.tsx', OUTPUT).errors).toEqual([]);
		},
	);
});

describe('createAttributeMatcher on the regions of a file', () => {
	test.prop([DOCUMENT_SOURCE_ARBITRARY, REMOVAL_NAMES_ARBITRARY])(
		'removes the attributes of a document and leaves its text, comments, styles and scripts byte-identical',
		({ fileKind, segments }, removalNames) => {
			const INPUT = serializeSegments({ segments, removedNames: NOTHING_REMOVED, wrapElement: String });
			const EXPECTED = serializeSegments({ segments, removedNames: new Set(removalNames), wrapElement: String });
			const ONCE = removeFromKind({ input: INPUT, removalNames, fileKind });

			expect(ONCE).toBe(EXPECTED);
			expect(removeFromKind({ input: ONCE, removalNames, fileKind })).toBe(ONCE);
		},
	);

	test.prop([
		buildSegmentsArbitrary({ elementArbitrary: JSX_ELEMENT_ARBITRARY, noiseTemplates: SCRIPT_NOISE_TEMPLATES }),
		REMOVAL_NAMES_ARBITRARY,
	])(
		'removes the attributes of JSX elements, leaves strings, comments and template text byte-identical, and parses',
		(segments, removalNames) => {
			const INPUT = serializeSegments({ segments, removedNames: NOTHING_REMOVED, wrapElement: wrapJsxElement });
			const EXPECTED = serializeSegments({
				segments,
				removedNames: new Set(removalNames),
				wrapElement: wrapJsxElement,
			});

			const ONCE = removeFromKind({ input: INPUT, removalNames, fileKind: 'script' });

			expect(ONCE).toBe(EXPECTED);
			expect(removeFromKind({ input: ONCE, removalNames, fileKind: 'script' })).toBe(ONCE);
			expect(parseSync('module.tsx', ONCE).errors).toEqual([]);
		},
	);

	test.prop([
		buildSegmentsArbitrary({ elementArbitrary: TEMPLATE_ELEMENT_ARBITRARY, noiseTemplates: SCRIPT_NOISE_TEMPLATES }),
		REMOVAL_NAMES_ARBITRARY,
	])(
		'removes the attributes of template-literal markup in a TypeScript module, leaves the rest byte-identical, and parses',
		(segments, removalNames) => {
			const INPUT = serializeSegments({ segments, removedNames: NOTHING_REMOVED, wrapElement: wrapTemplateElement });
			const EXPECTED = serializeSegments({
				segments,
				removedNames: new Set(removalNames),
				wrapElement: wrapTemplateElement,
			});

			const ONCE = removeFromKind({ input: INPUT, removalNames, fileKind: 'ts' });

			expect(ONCE).toBe(EXPECTED);
			expect(removeFromKind({ input: ONCE, removalNames, fileKind: 'ts' })).toBe(ONCE);
			expect(parseSync('module.ts', ONCE).errors).toEqual([]);
		},
	);

	test.prop([
		fc.string({ unit: 'binary' }),
		REMOVAL_NAMES_ARBITRARY,
		fc.constantFrom<FileKind>('astro', 'html', 'markdown', 'markup', 'script', 'ts', 'vue'),
	])('is idempotent on arbitrary unicode input of every kind', (input, removalNames, fileKind) => {
		const ONCE = removeFromKind({ input, removalNames, fileKind });

		expect(removeFromKind({ input: ONCE, removalNames, fileKind })).toBe(ONCE);
	});
});

describe('createAttributeMatcher on markup strings with removeInStrings', () => {
	/**
	 * Matches the given names in a TSX module.
	 *
	 * @param options.input - The module.
	 * @param options.removalNames - The attribute names to remove.
	 * @param options.removeInStrings - Whether the markup of a string is read.
	 *
	 * @returns The ranges to remove and the attributes left in place.
	 */
	function matchModule(options: {
		input: string;
		removalNames: readonly string[];
		removeInStrings: boolean;
	}): AttributeMatchResult {
		const { input, removalNames, removeInStrings } = options;

		return createAttributeMatcher(removalNames, { removeInStrings })(input, {
			hasQuotedMustache: false,
			hasQuotedPlaceholder: true,
			fileKind: 'script',
		});
	}

	test.prop([STRING_SEGMENTS_ARBITRARY, REMOVAL_NAMES_ARBITRARY])(
		'removes the attributes of closed markup strings on top of what the option off removes, and nothing else',
		(segments, removalNames) => {
			const REMOVED_NAMES = new Set(removalNames);
			const { code: INPUT, stringRanges: STRING_RANGES } = serializeStringModule({
				segments,
				removedNames: NOTHING_REMOVED,
				removedStringNames: NOTHING_REMOVED,
			});

			const ON = matchModule({ input: INPUT, removalNames, removeInStrings: true });
			const OFF = matchModule({ input: INPUT, removalNames, removeInStrings: false });
			const OUTPUT = removeRanges(INPUT, ON.ranges);

			expect(OUTPUT).toBe(
				serializeStringModule({ segments, removedNames: REMOVED_NAMES, removedStringNames: REMOVED_NAMES }).code,
			);
			expect(removeRanges(INPUT, OFF.ranges)).toBe(
				serializeStringModule({ segments, removedNames: REMOVED_NAMES, removedStringNames: NOTHING_REMOVED }).code,
			);
			expect(ON.skipped).toEqual([]);
			expect(parseSync('module.tsx', OUTPUT).errors).toEqual([]);

			// Outside the strings the two agree range for range, and no range reaches across a string's quotes
			const OUTSIDE_RANGES = ON.ranges.filter(
				(range) => !STRING_RANGES.some((stringRange) => isWithin(range, stringRange)),
			);

			expect(OUTSIDE_RANGES).toEqual(OFF.ranges);
			expect(
				OUTSIDE_RANGES.filter((range) => STRING_RANGES.some((stringRange) => isOverlapping(range, stringRange))),
			).toEqual([]);
		},
	);

	test.prop([STRING_SOUP_ARBITRARY, fc.boolean()])(
		'never removes a range reaching past the quotes of a string, whatever the string holds',
		(module, isSvelte) => {
			const PREFIX = isSvelte ? '<script>\n' : '';
			const SUFFIX = isSvelte ? '</script>\n' : '';
			const INPUT = `${PREFIX}${module}${SUFFIX}`;
			const { ranges } = createAttributeMatcher(['data-testid'], { removeInStrings: true })(INPUT, {
				hasQuotedMustache: isSvelte,
				hasQuotedPlaceholder: !isSvelte,
				fileKind: isSvelte ? 'markup' : 'ts',
			});

			const OUTPUT = removeRanges(INPUT, ranges);

			expect(OUTPUT.startsWith(PREFIX) && OUTPUT.endsWith(SUFFIX)).toBe(true);

			const OUTPUT_MODULE = OUTPUT.slice(PREFIX.length, OUTPUT.length - SUFFIX.length);
			const INPUT_TREE = parseSync('module.ts', module);
			const OUTPUT_TREE = parseSync('module.ts', OUTPUT_MODULE);

			expect(OUTPUT_TREE.errors).toEqual([]);
			expect(collectNodeTypes(OUTPUT_TREE.program)).toEqual(collectNodeTypes(INPUT_TREE.program));
		},
	);
});
