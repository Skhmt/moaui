<script lang="ts">
	import MoaToMil from "./lib/MoaToMil.svelte";
	import MilToMoa from "./lib/MilToMoa.svelte";
	import FindDistance from "./lib/FindDistance.svelte";
	import FindSize from "./lib/FindSize.svelte";
	import Measurements from "./lib/Measurements.svelte";
	import GetCoords from "./lib/GetCoords.svelte";
	import Group from "./lib/Group.svelte";
</script>

<div>
	<div role="tablist" class="tabs tabs-border prose pl-4">
		<input
			type="radio"
			name="tabs"
			class="tab"
			aria-label="Convert"
			checked
		/>
		<div class="tab-content" role="tab">
			<h3>MOA to Mils <code>(arcmin to mrad)</code></h3>
			<MoaToMil />

			<h3>Mils to MOA <code>(mrad to arcmin)</code></h3>
			<MilToMoa />

			<h3>Measurements</h3>
			<Measurements />
		</div>

		<input type="radio" name="tabs" class="tab" aria-label="Calculate" />
		<div class="tab-content" role="tab">
			<h3>Find distance</h3>
			<FindDistance />

			<h3>Find coordinates</h3>
			<GetCoords />

			<h3>Find size</h3>
			<FindSize />
		</div>

		<input type="radio" name="tabs" class="tab" aria-label="Group" />
		<div class="tab-content" role="tab">
			<Group />
		</div>
	</div>
</div>
