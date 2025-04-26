<script lang="ts">
	import {
		m2yd,
		yd2m,
		m2ft,
		ft2m,
		m2in,
		in2m,
		m2cm,
		cm2m,
		m2mi,
		mi2m,
		m2km,
		km2m,
	} from '@moa/moa';

	let leftValue = $state(0);
	let leftUnit = $state('Meters');

	let rightUnit = $state('Meters');
	let rightValue = $derived.by(() => {
		let inMeters = leftValue;

		if (leftUnit === 'Yards') inMeters = yd2m(leftValue);
		else if (leftUnit === 'Feet') inMeters = ft2m(leftValue);
		else if (leftUnit === 'Inches') inMeters = in2m(leftValue);
		else if (leftUnit === 'Centimeters') inMeters = cm2m(leftValue);
		else if (leftUnit === 'Miles') inMeters = mi2m(leftValue);
		else if (leftUnit === 'Kilometers') inMeters = km2m(leftValue);

		let output = inMeters;

		if (rightUnit === 'Yards') output = m2yd(inMeters);
		else if (rightUnit === 'Feet') output = m2ft(inMeters);
		else if (rightUnit === 'Inches') output = m2in(inMeters);
		else if (rightUnit === 'Centimeters') output = m2cm(inMeters);
		else if (rightUnit === 'Miles') output = m2mi(inMeters);
		else if (rightUnit === 'Kilometers') output = m2km(inMeters);

		return Number(output.toFixed(5));
	});
</script>

<section>
	<label class="input">
		<input type="number" bind:value={leftValue} min="0" />
		<select bind:value={leftUnit}>
			<option>Centimeters</option>
			<option>Feet</option>
			<option>Inches</option>
			<option>Kilometers</option>
			<option>Meters</option>
			<option>Miles</option>
			<option>Yards</option>
		</select>
	</label>
	<br />
	<label class="input">
		<input type="number" bind:value={rightValue} disabled />
		<select bind:value={rightUnit}>
			<option>Centimeters</option>
			<option>Feet</option>
			<option>Inches</option>
			<option>Kilometers</option>
			<option>Meters</option>
			<option>Miles</option>
			<option>Yards</option>
		</select>
	</label>
</section>

<style>
	option {
		text-align-last: right;
	}
</style>
