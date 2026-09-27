import { Fragment, h } from 'preact';

interface Props {
	id: string;
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

function identity<T,>(value: T): T {
	return value;
}

function Child(props: { id: string }) {
	return <span class="child-inner">{props.id}</span>;
}

function Price(props: { price: number }) {
	return <span data-testid="${" class="price">{props.price}</span>;
}

function App(props: Props) {
	const label = identity(props.id);
	const items = ['a', 'b'];

	return (
		<div data-testid="wrapper" data-cy="wrapper-cy" class="container" id="app">
			<p data-testid={label ? `active-${label}` : 'inactive'} class="status">
				{label}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item} data-testid={`item-${item}`} class="item">
						{item}
					</li>
				))}
			</ul>
			<Child {...{ id: label }} data-testid="child" class="child" />
			<Fragment>
				<span data-testid="fragment-child" class="frag">
					frag
				</span>
			</Fragment>
			<i data-testid="${label}" class="literal-placeholder" />
			<i data-testid="${" class="unbalanced" />
			<div
				dangerouslySetInnerHTML={{
					__html: html`<b data-testid="${label ? "tagged-on" : `tagged-${label}`}" class="tagged">tagged</b>`,
				}}
				data-testid="inner-html"
				class="inner-html"
			/>
			<i data-testid="${" class="}" />
		</div>
	);
}

export default App;
