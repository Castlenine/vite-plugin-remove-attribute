import { createSignal, For, Show } from 'solid-js';

interface Props {
	id: string;
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

function Price(props: { price: number }) {
	return <span data-testid="${" class="price">{props.price}</span>;
}

function App(props: Props) {
	const [count, setCount] = createSignal(0);
	const items = ['a', 'b'];

	return (
		<div data-testid="wrapper" data-cy="wrapper-cy" class="container" id="app">
			<Show when={count() > 0} fallback={<p data-testid="empty" class="empty">empty</p>}>
				<p data-testid="count-positive" class="count">
					{count()}
				</p>
			</Show>
			<For each={items}>
				{(item) => (
					<span data-testid={props.id} class="item">
						{item}
					</span>
				)}
			</For>
			<div classList={{ active: count() > 0, box: true }} data-testid="active-box" class="box">
				box
			</div>
			<button on:click={() => setCount(count() + 1)} data-testid="increment" class="btn">
				+
			</button>
			<i data-testid="${props.id}" class="literal-placeholder" />
			<i data-testid="${" class="unbalanced" />
			<div
				innerHTML={html`<b data-testid="${count() > 0 ? "tagged-on" : `tagged-${props.id}`}" class="tagged">tagged</b>`}
				data-testid="inner-html"
				class="inner-html"
			/>
			<i data-testid="${" class="}" />
		</div>
	);
}

export default App;
