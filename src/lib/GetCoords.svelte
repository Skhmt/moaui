<script lang="ts">
	import LatLon from 'geodesy/latlon-ellipsoidal-vincenty.js';
	import Mgrs, { LatLon as MgrsLatLon } from 'geodesy/mgrs.js';
	import { yd2m, ft2m, mi2m, km2m } from '@moa/moa';

	/* Examples:
		const mgrs = Mgrs.parse('31U DQ 48251 11932');
		const latlon = mgrs.toUtm().toLatLon();
		console.assert(latlon.toString('dms', 2) == '48° 51′ 29.50″ N, 002° 17′ 40.16″ E');

		// *might* need to import latlon-ellipsoidal.js
		LatLon.parse('58°38′38″N, 003°04′12″W');
	*/

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

		/*
			const greenwich = new LatLon(51.47788, -0.00147, 46);
			const d = greenwich.toString();                        // 51.4779°N, 000.0015°W
			const dms = greenwich.toString('dms', 2);              // 51°28′40″N, 000°00′05″W
			const [lat, lon] = greenwich.toString('n').split(','); // 51.4779, -0.0015
			const dmsh = greenwich.toString('dms', 0, 0);          // 51°28′40″N, 000°00′06″W +46m
		*/

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
				// else if (ev.hasOwnProperty('alpha')) bearingValue = Math.abs(ev.alpha - 360);
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

<div class="container">
	<div>
		<strong>Coords:</strong>
	</div>
	<div>
		<input
			type="text"
			style="width: 16em; height: 1.1em"
			bind:value={coordsValue}
		/>
		<button onclick={() => getDeviceCoords()}>📍</button>
	</div>

	<div>
		<strong>Distance:</strong>
	</div>
	<div>
		<input
			type="number"
			style="width: 12em; height: 1.1em"
			bind:value={distanceValue}
		/>
		<select bind:value={distanceUnit}>
			<option>Meters</option>
			<option>Yards</option>
			<option>Feet</option>
			<option>Miles</option>
			<option>Kilometers</option>
		</select>
	</div>

	<div>
		<strong>Bearing:</strong>
	</div>
	<div>
		<input
			type="number"
			style="width: 12em; height: 1.1em"
			bind:value={bearingValue}
		/>
		<strong>°</strong>
		<button onclick={() => getDeviceBearing()}>🧭</button>
	</div>

	<div>
		<strong>Target:</strong>
	</div>
	<div>
		<input
			type="text"
			style="width: 16em; height: 1.1em"
			disabled
			bind:value={targetValue}
		/>
		<select bind:value={targetType}>
			<option value="mgrs">MGRS</option>
			<option value="d">D</option>
			<option value="dm">DM</option>
			<option value="dms">DMS</option>
		</select>
	</div>
</div>

<style>
	.container {
		display: grid;
		grid-template-columns: 5em 1fr;
	}
</style>
