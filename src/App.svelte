<script lang="ts">
	import MoaToMil from "./lib/MoaToMil.svelte";
	import MilToMoa from "./lib/MilToMoa.svelte";
	import FindDistance from "./lib/FindDistance.svelte";
	import FindSize from "./lib/FindSize.svelte";
	import Measurements from "./lib/Measurements.svelte";
	import GetCoords from "./lib/GetCoords.svelte";
	import Group from "./lib/Group.svelte";

	let tab = $state(0);
</script>

<main>
	<!-- <Group /> -->

	<div>
		<button onclick={() => (tab = 0)} disabled={tab == 0}> Convert </button>
		<button onclick={() => (tab = 1)} disabled={tab == 1}>
			Calculate
		</button>
	</div>

	<!-- Convert tab -->
	<div style={tab == 0 ? "display: block" : "display: none"}>
		<h2>MOA to Mils <code>(arcmin to mrad)</code></h2>
		<MoaToMil />

		<h2>Mils to MOA <code>(mrad to arcmin)</code></h2>
		<MilToMoa />

		<h2>Measurements</h2>
		<Measurements />
	</div>

	<!-- Calculate tab -->
	<div style={tab == 1 ? "display: block" : "display: none"}>
		<h2>Find distance</h2>
		<FindDistance />

		<h2>Find coordinates</h2>
		<GetCoords />

		<h2>Find size</h2>
		<FindSize />
	</div>
</main>

<style>
	button {
		width: 8em;
		height: 1.5em;
		font-size: 1.5em;
	}
	button:disabled {
		font-weight: bold;
		color: white;
		background-color: rgba(0, 0, 0, 0);
		border: none;
	}
</style>
