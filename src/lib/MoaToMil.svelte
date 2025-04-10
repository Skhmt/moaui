<script lang="ts">
	import { moa2mrad } from '@moa/moa';

	let userMoa = $state(0);
	let userMoaToMrad = $derived(moa2mrad(userMoa).toFixed(4));

	function modMoa(mod: number) {
		let temp = userMoa + mod;
		userMoa = temp < 0 ? 0 : Number(temp.toFixed(2));
	}
</script>

<div class="container">
	<div>
		<strong>MOA:</strong>
	</div>
	<div>
		<input
			type="number"
			bind:value={userMoa}
			style="width: 6em; height: 1.1em"
		/>
		<button onclick={() => modMoa(1)}>+1</button>
		<button onclick={() => modMoa(0.5)}>+0.5</button>
		<button onclick={() => modMoa(-0.5)}>-0.5</button>
		<button onclick={() => modMoa(-1)}>-1</button>
	</div>

	<div>
		<strong>Mils:</strong>
	</div>
	<div>
		<input
			type="text"
			bind:value={userMoaToMrad}
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
