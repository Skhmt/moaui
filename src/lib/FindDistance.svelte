<script lang="ts">
	// distance(size: number, mrad: number): number
	import {
		moa2mrad,
		distance,
		m2yd,
		yd2m,
		m2ft,
		ft2m,
		in2m,
		cm2m,
	} from '@moa/moa';

	let sizeValue = $state(0);
	let sizeUnit = $state('Meters');

	let angleValue = $state(0);
	let angleUnit = $state('Mils (mrad)');

	let distanceUnit = $state('Meters');
	let distanceValue = $derived.by(() => {
		let sizeInMeters = sizeValue;
		let angleInMrad = angleValue;

		// convert size to meters
		if (sizeUnit === 'Centimeters') sizeInMeters = cm2m(sizeValue);
		else if (sizeUnit === 'Yards') sizeInMeters = yd2m(sizeValue);
		else if (sizeUnit === 'Feet') sizeInMeters = ft2m(sizeValue);
		else if (sizeUnit === 'Inches') sizeInMeters = in2m(sizeValue);

		// convert angle to mrad
		if (angleUnit === 'MOA (arcmin)') angleInMrad = moa2mrad(angleValue);

		// get distance
		let distInMeters = distance(sizeInMeters, angleInMrad);
		if (distanceUnit === 'Yards') distInMeters = m2yd(distInMeters);
		else if (distanceUnit === 'Feet') distInMeters = m2ft(distInMeters);

		return Number(distInMeters.toFixed(3));
	});

	function setSize(size: number, unit: string) {
		sizeValue = size;
		sizeUnit = unit;
	}
</script>

<section class="grid grid-cols-[5em_1fr]">
	<div class="col-span-2">
		<button class="btn" onclick={() => setSize(3.25, 'Feet')}>
			🦌 white-tail deer to shoulder (3.25 ft)
		</button>

		<button class="btn" onclick={() => setSize(2.75, 'Feet')}>
			🐖 hog to shoulder (2.75 ft)
		</button>

		<button class="btn" onclick={() => setSize(75, 'Centimeters')}>
			🧟‍♂️ IPSC "metric" torso silhouette target (75 cm)
		</button>

		<button class="btn" onclick={() => setSize(57, 'Centimeters')}>
			🛑 IPSC "classic" modern octagon target (57cm)
		</button>
	</div>

	<strong>Size:</strong>
	<label class="input">
		<input type="number" bind:value={sizeValue} />
		<select bind:value={sizeUnit}>
			<option>Meters</option>
			<option>Centimeters</option>
			<option>Yards</option>
			<option>Feet</option>
			<option>Inches</option>
		</select>
	</label>

	<strong>Angle:</strong>
	<label class="input">
		<input type="number" bind:value={angleValue} />
		<select bind:value={angleUnit}>
			<option>Mils (mrad)</option>
			<option>MOA (arcmin)</option>
		</select>
	</label>

	<strong>Distance:</strong>
	<label class="input">
		<input type="number" bind:value={distanceValue} disabled />
		<select bind:value={distanceUnit}>
			<option>Meters</option>
			<option>Yards</option>
			<option>Feet</option>
		</select>
	</label>
</section>

<style>
	option {
		text-align-last: right;
	}
</style>
