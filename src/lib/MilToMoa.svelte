<script lang="ts">
	import { mrad2moa } from '@moa/moa';

	let userMrad = $state(0);
	let userMradToMoa = $derived(mrad2moa(userMrad).toFixed(4));

	function modMrad(mod: number) {
		let temp = userMrad + mod;
		userMrad = temp < 0 ? 0 : Number(temp.toFixed(2));
	}
</script>

<div class="container">
	<div>
		<strong>Mils:</strong>
	</div>
	<div>
		<input
			type="number"
			bind:value={userMrad}
			style="width: 6em; height: 1.1em"
		/>
		<button onclick={() => modMrad(1)}>+1</button>
		<button onclick={() => modMrad(0.2)}>+0.2</button>
		<button onclick={() => modMrad(-0.2)}>-0.2</button>
		<button onclick={() => modMrad(-1)}>-1</button>
	</div>

	<div>
		<strong>MOA:</strong>
	</div>
	<div>
		<input
			type="text"
			bind:value={userMradToMoa}
			style="width: 18em; height: 1.1em"
			disabled
		/>
	</div>
</div>

<style>
	.container {
		display: grid;
		grid-template-columns: 4em 1fr;
	}
</style>
