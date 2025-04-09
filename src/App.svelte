<script lang="ts">
	import MoaToMil from './lib/MoaToMil.svelte';
	import MilToMoa from './lib/MilToMoa.svelte';
	import FindDistance from './lib/FindDistance.svelte';
	import FindSize from './lib/FindSize.svelte';
	import Measurements from './lib/Measurements.svelte';
</script>

<main>
	<h1>Conversions</h1>

	<h2>MOA to Mils (arcmin to mrad)</h2>
	<MoaToMil />

	<h2>Mils to MOA (mrad to arcmin)</h2>
	<MilToMoa />

	<h2>Find distance</h2>
	<FindDistance />

	<h2>Find size</h2>
	<FindSize />

	<h2>Measurements</h2>
	<Measurements />
</main>

<style>
</style>
