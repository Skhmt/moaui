<script lang="ts">
	import { mrad2moa } from '@moa/moa';

	let userMrad = $state(0);
	let userMradToMoa = $derived(mrad2moa(userMrad).toFixed(4));

	function modMrad(mod: number) {
		let temp = userMrad + mod;
		userMrad = temp < 0 ? 0 : Number(temp.toFixed(2));
	}
</script>

<section class="grid grid-cols-[4em_1fr]">
	<strong>Mil:</strong>
	<label class="input">
		<input
			type="number"
			bind:value={userMrad}
			min="0"
		/>
		<button onclick={() => modMrad(1)}>+1</button>
		<button onclick={() => modMrad(0.2)}>+0.2</button>
		<button onclick={() => modMrad(-0.2)}>-0.2</button>
		<button onclick={() => modMrad(-1)}>-1</button>
	</label>
	
	<strong>MOA:</strong>
	<label class="input">
		
		<input
			type="text"
			bind:value={userMradToMoa}
			disabled
		/>
	</label>
</section>

<style>
	button {
		height: 100%;
		padding: 2px;
		margin: 0;
	}
</style>