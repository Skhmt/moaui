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
</script>

<div class="container">
	<div>
		<strong>Size:</strong>
	</div>
	<div>
		<input type="number" bind:value={sizeValue} />
		<select bind:value={sizeUnit}>
			<option>Meters</option>
			<option>Centimeters</option>
			<option>Yards</option>
			<option>Feet</option>
			<option>Inches</option>
		</select>
	</div>

	<div>
		<strong>Angle:</strong>
	</div>
	<div>
		<input type="number" bind:value={angleValue} />
		<select bind:value={angleUnit}>
			<option>Mils (mrad)</option>
			<option>MOA (arcmin)</option>
		</select>
	</div>

	<div>
		<strong>Distance:</strong>
	</div>
	<div>
		<input type="number" bind:value={distanceValue} disabled />
		<select bind:value={distanceUnit}>
			<option>Meters</option>
			<option>Yards</option>
			<option>Feet</option>
		</select>
	</div>
</div>

<style>
	.container {
		display: grid;
		grid-template-columns: 5em 1fr;
	}

	input {
		width: 12em;
		height: 1.1em;
	}
</style>
