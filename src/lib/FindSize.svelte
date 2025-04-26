<script lang="ts">
	// size(distance: number, mrad: number): number
	import {
		moa2mrad,
		size,
		m2yd,
		yd2m,
		m2ft,
		ft2m,
		m2in,
		m2cm,
	} from '@moa/moa';

	let distanceValue = $state(0);
	let distanceUnit = $state('Meters');

	let angleValue = $state(0);
	let angleUnit = $state('Mils (mrad)');

	let sizeUnit = $state('Meters');
	let sizeValue = $derived.by(() => {
		let distInMeters = distanceValue;
		let angleInMrad = angleValue;

		// convert distance to meters
		if (distanceUnit === 'Yards') distInMeters = yd2m(distanceValue);
		else if (distanceUnit === 'Feet') distInMeters = ft2m(distanceValue);

		// convert angle to mrad
		if (angleUnit === 'MOA (arcmin)') angleInMrad = moa2mrad(angleValue);

		// get size
		let sizeInMeters = size(distInMeters, angleInMrad);
		if (sizeUnit === 'Centimeters') sizeInMeters = m2cm(sizeInMeters);
		else if (sizeUnit === 'Yards') sizeInMeters = m2yd(sizeInMeters);
		else if (sizeUnit === 'Feet') sizeInMeters = m2ft(sizeInMeters);
		else if (sizeUnit === 'Inches') sizeInMeters = m2in(sizeInMeters);

		return Number(sizeInMeters.toFixed(3));
	});
</script>

<section class="grid grid-cols-[5em_1fr]">
	<strong>Distance:</strong>
	<label class="input">
		<input type="number" bind:value={distanceValue} />
		<select bind:value={distanceUnit}>
			<option>Meters</option>
			<option>Yards</option>
			<option>Feet</option>
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

	<strong>Size:</strong>
	<label class="input">
		<input type="number" bind:value={sizeValue} disabled />
		<select bind:value={sizeUnit}>
			<option>Meters</option>
			<option>Centimeters</option>
			<option>Yards</option>
			<option>Feet</option>
			<option>Inches</option>
		</select>
	</label>
</section>

<style>
	option {
		text-align-last: right;
	}
</style>
