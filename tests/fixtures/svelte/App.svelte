<script lang="ts">
	let count = $state(0);
	let items = $state(['a', 'b']);
	let rest = $state({ title: 'r' });
	let selected = $state(true);
</script>

<div data-testid="wrapper" data-cy="wrapper-cy" class="container" id="app">
	{#if count > 0}
		<p data-testid="count-positive" class="count">{count}</p>
	{/if}
	{#each items as item}
		<span data-testid={`${item}-item`} class="item">{item}</span>
	{/each}
	<span data-testid="{selected ? "yes" : "no"}" class="status">status</span>
	<span data-testid='{selected ? 'single-yes' : 'single-no'}' class="single">single</span>
	<span data-testid="cost ${count}" class="price">price</span>
	<span data-testid="{selected ? `nested-${count}` : "nested-no"}-{count}" class="nested">nested</span>
	<input bind:value={count} data-testid="input" class="field" />
	<button onclick={() => count++} data-testid="increment" class="btn">+</button>
	<button onclick={() => count--} data-testid="decrement" class="btn">-</button>
	<div class:active={count > 0} data-testid="active-box" class="box">box</div>
	<Child {...rest} data-testid="child" class="child" />
	{@render children?.()}
</div>

<style>
	.container {
		color: red;
	}
</style>
