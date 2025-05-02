<script lang="ts">
	import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
	import Mgrs, { LatLon as MgrsLatLon } from 'geodesy/mgrs.js';
	import { yd2m, ft2m, mi2m, km2m } from '@moa/moa';

	let coordsValue = $state(`0`);
	let distanceValue = $state(0);
	let distanceUnit = $state('Meters');
	let bearingValue = $state(0);
	let targetType = $state('mgrs');

	let targetValue = $derived.by(() => {
		let latlon;
		try {
			latlon = LatLon.parse(coordsValue);
		} catch (err1) {
			try {
				latlon = Mgrs.parse(coordsValue).toUtm().toLatLon();
			} catch (err2) {
				return '';
			}
		}

		let distInMeters = distanceValue;

		if (distanceUnit === 'Yards') distInMeters = yd2m(distanceValue);
		else if (distanceUnit === 'Feet') distInMeters = ft2m(distanceValue);
		else if (distanceUnit === 'Miles') distInMeters = mi2m(distanceValue);
		else if (distanceUnit === 'Kilometers')
			distInMeters = km2m(distanceValue);

		let vLL = new LatLon(latlon.lat, latlon.lon);
		let destination = vLL.destinationPoint(distInMeters, bearingValue);

		if (targetType === 'mgrs') {
			let mgrs = new MgrsLatLon(destination.lat, destination.lon);
			return mgrs.toUtm().toMgrs();
		} else if (targetType === 'd') return destination.toString('d', 2);
		else if (targetType === 'dm') return destination.toString('dm', 2);
		else return destination.toString('dms', 2);
	});

	function getDeviceCoords() {
		if (navigator.geolocation) {
			coordsValue = 'Trying to get your location...';
			navigator.geolocation.getCurrentPosition(
				(position) => {
					coordsValue = `${position.coords.latitude}, ${position.coords.longitude}`;
				},
				(err) => {
					coordsValue = 'Permission needed.';
				},
			);
		} else {
			coordsValue = 'Not supported.';
		}
	}

	function getDeviceBearing() {
		window.addEventListener(
			'deviceorientationabsolute',
			(ev) => {
				if (ev.hasOwnProperty('webkitCompassHeading'))
					//@ts-ignore
					bearingValue = ev.webkitCompassHeading;
				else if (ev.alpha !== null)
					bearingValue = Math.abs(ev.alpha - 360);
				else alert('No compass found.');
			},
			{
				once: true,
			},
		);
	}
</script>

<section class="grid grid-cols-[5em_1fr]">
	<strong>Coords:</strong>
	<div>
		<label class="input">
			<input type="text" bind:value={coordsValue} />
		</label>
		<button onclick={() => getDeviceCoords()}>📍</button>
	</div>

	<strong>Distance:</strong>
	<label class="input">
		<input type="number" bind:value={distanceValue} />
		<select bind:value={distanceUnit}>
			<option>Meters</option>
			<option>Yards</option>
			<option>Feet</option>
			<option>Miles</option>
			<option>Kilometers</option>
		</select>
	</label>

	<strong>Bearing:</strong>
	<div>
		<label class="input">
			<input type="number" bind:value={bearingValue} />
			<strong>°</strong>
		</label>
		<button onclick={() => getDeviceBearing()}>🧭</button>
	</div>

	<strong>Target:</strong>
	<label class="input">
		<input type="text" disabled bind:value={targetValue} />
		<select bind:value={targetType}>
			<option value="mgrs">MGRS</option>
			<option value="d">D</option>
			<option value="dm">DM</option>
			<option value="dms">DMS</option>
		</select>
	</label>
</section>

<style>
	option {
		text-align-last: right;
	}
</style>
