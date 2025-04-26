<script lang="ts">
	import { moa2mrad } from '@moa/moa';

	let userMoa = $state(0);
	let userMoaToMrad = $derived(moa2mrad(userMoa).toFixed(4));

	function modMoa(mod: number) {
		let temp = userMoa + mod;
		userMoa = temp < 0 ? 0 : Number(temp.toFixed(2));
	}
</script>

<section class="grid grid-cols-[4em_1fr]">
	<strong>MOA:</strong>
	<label class="input">
		<input
			type="number"
			bind:value={userMoa}
			min="0"
		/>
		<button onclick={() => modMoa(1)}>+1</button>
		<button onclick={() => modMoa(0.5)}>+0.5</button>
		<button onclick={() => modMoa(-0.5)}>-0.5</button>
		<button onclick={() => modMoa(-1)}>-1</button>
	</label>

	<strong>Mil:</strong>
	<label class="input">
		
		<input
			type="text"
			bind:value={userMoaToMrad}
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

