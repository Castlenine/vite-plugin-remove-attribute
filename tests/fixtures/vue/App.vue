<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
const items = ref(['a', 'b']);
const config = ref({ 'data-testid': 1, title: 'r' });
const isHighlighted = ref(true);
const badgeId = 'x';

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
	return strings.reduce((accumulator, part, index) => `${accumulator}${part}${String(values[index] ?? '')}`, '');
}

const badge = html`<b data-testid="${isHighlighted.value ? `badge-${badgeId}` : "badge-off"}" class="badge">badge</b>`;

function increment() {
	count.value++;
}
</script>

<template>
	<div :data-testid="'wrapper'" data-cy="wrapper-cy" class="container" id="app">
		<p v-bind:data-testid.camel="'count-label'" class="count">{{ count }}</p>
		<ul>
			<li v-for="item in items" :key="item" :data-testid="`${item}-item`" class="item">{{ item }}</li>
		</ul>
		<button @click="increment" data-testid="increment" class="btn">+</button>
		<p data-testid="${count}" class="dollar">dollar</p>
		<p data-testid="${" title="}" class="spanned-title">spanned title</p>
		<span v-html="badge" class="badge-host"></span>
		<Child>
			<template #footer>
				<span v-bind="config" class="footer">footer</span>
				<span v-bind="{ 'data-testid': 1 }" class="footer-literal">footer-literal</span>
			</template>
		</Child>
	</div>
</template>

<style scoped>
.container {
	color: red;
}
</style>
