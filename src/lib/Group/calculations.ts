import * as moa from '@moa/moa';
import type { Point, Rect, ShotGroup, DistanceUnit, LinearUnit } from './types';
import { convertUnits } from './units';

export function isPointInRect(p: Point, r: Rect): boolean {
	return (
		p.x >= r.x &&
		p.x <= r.x + r.width &&
		p.y >= r.y &&
		p.y <= r.y + r.height
	);
}

export function calculateGroupResults(
	g: ShotGroup,
	scale: number | null,
	targetDistance: number,
	targetDistanceUnit: DistanceUnit,
	referenceUnit: LinearUnit,
): void {
	if (!scale) return;
	// Reset results
	g.centroidReal = null;
	g.meanRadius = null;
	g.maxSpread = null;
	g.meanRadiusMOA = null;
	g.meanRadiusMRAD = null;
	g.maxSpreadMOA = null;
	g.maxSpreadMRAD = null;
	g.offsetFromAim = null;
	g.resultsValid = false;
	if (g.bulletHolesReal.length === 0) {
		return;
	}
	// --- Calculate Centroid (in referenceUnit) ---
	let sumX = 0,
		sumY = 0;
	g.bulletHolesReal.forEach((h) => {
		sumX += h.x;
		sumY += h.y;
	});
	const n = g.bulletHolesReal.length;
	const centroidX = sumX / n;
	const centroidY = sumY / n;
	g.centroidReal = { x: centroidX, y: centroidY }; // Store in referenceUnit
	// --- Calculate Mean Radius (in referenceUnit) ---
	let sumDistFromCentroid = 0;
	g.bulletHolesReal.forEach((h) => {
		const dx = h.x - centroidX;
		const dy = h.y - centroidY;
		sumDistFromCentroid += Math.sqrt(dx * dx + dy * dy);
	});
	g.meanRadius = sumDistFromCentroid / n; // Store in referenceUnit
	// --- Calculate Max Spread (in referenceUnit) ---
	if (n >= 2) {
		let maxDistSq = 0;
		for (let i = 0; i < n; i++)
			for (let j = i + 1; j < n; j++) {
				const dx = g.bulletHolesReal[i].x - g.bulletHolesReal[j].x;
				const dy = g.bulletHolesReal[i].y - g.bulletHolesReal[j].y;
				maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy);
			}
		g.maxSpread = Math.sqrt(maxDistSq); // Store in referenceUnit
	} else g.maxSpread = null;
	// --- Calculate Angular Measurements ---
	if (targetDistance > 0) {
		const distMeters = convertUnits(
			targetDistance,
			targetDistanceUnit,
			'meters',
		);
		if (distMeters > 0) {
			if (g.meanRadius !== null) {
				// Mean Radius Angular
				const radiusMeters = convertUnits(
					g.meanRadius,
					referenceUnit,
					'meters',
				);
				const angleRad = radiusMeters / distMeters; // Small angle approx
				g.meanRadiusMRAD = angleRad * 1000;
				g.meanRadiusMOA = moa.mrad2moa(g.meanRadiusMRAD);
			}
			if (g.maxSpread !== null) {
				// Max Spread Angular
				const spreadMeters = convertUnits(
					g.maxSpread,
					referenceUnit,
					'meters',
				);
				const angleRad = spreadMeters / distMeters;
				g.maxSpreadMRAD = angleRad * 1000;
				g.maxSpreadMOA = moa.mrad2moa(g.maxSpreadMRAD);
			}
		}
	} // Else MOA/MRAD remain null
	// --- Calculate Offset from Aim Point (in referenceUnit) ---
	if (g.aimingPointReal && g.centroidReal) {
		// Both in referenceUnit
		const dx = g.centroidReal.x - g.aimingPointReal.x;
		const dy = g.centroidReal.y - g.aimingPointReal.y;
		const dist = Math.sqrt(dx * dx + dy * dy); // Distance in referenceUnit
		let angleRad = Math.atan2(dy, dx);
		if (angleRad < 0) angleRad += 2 * Math.PI;
		g.offsetFromAim = {
			distance: dist,
			angleDegrees:
				(((angleRad * (180 / Math.PI) - 90) % 360) + 360) % 360,
		};
	} else g.offsetFromAim = null;
	g.resultsValid = true;
}

export function invalidateResults(g: ShotGroup): void {
	if (g && g.resultsValid) {
		g.resultsValid = false;
	}
}
