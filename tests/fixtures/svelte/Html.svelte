<script lang="ts">
	let label = $state('Save');

	const BADGE = '<span data-testid="badge" class="badge">new</span>';
	const PARTIAL = '<em data-testid="' + label + '">';
</script>

<div data-testid="wrapper" class="container">
	{@html '<strong data-testid="title" class="title">Title</strong>'}
	{@html BADGE}
	{@html PARTIAL}
	<button data-testid="save" class="btn">{label}</button>
</div>
