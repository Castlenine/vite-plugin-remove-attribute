import { component$, useSignal } from '@builder.io/qwik';

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

const Price = component$((props: { price: number }) => {
	return <span data-testid="${" class="price">{props.price}</span>;
});

export default component$(() => {
	const sig = useSignal(0);

	return (
		<div data-testid="wrapper" data-cy="wrapper-cy" class="container" id="app">
			<p data-testid={sig.value} class="count">
				{sig.value}
			</p>
			<button onClick$={() => sig.value++} data-testid="increment" class="btn">
				+
			</button>
			<i data-testid="${sig.value}" class="literal-placeholder" />
			<i data-testid="${" class="unbalanced" />
			<div
				dangerouslySetInnerHTML={html`<b data-testid="${sig.value > 0 ? "tagged-on" : `tagged-${sig.value}`}" class="tagged">tagged</b>`}
				data-testid="inner-html"
				class="inner-html"
			/>
			<i data-testid="${" class="}" />
		</div>
	);
});
