import * as moa from '@moa/moa';
import type { LinearUnit, DistanceUnit, DiameterUnit } from './types';

// Helper to convert a value *from* meters *to* a target unit
export function metersToUnit(
	value: number,
	targetUnit: LinearUnit | DistanceUnit,
): number {
	switch (targetUnit) {
		case 'inches':
			return moa.m2in(value);
		case 'cm':
			return moa.m2cm(value);
		case 'mm':
			return moa.m2cm(value) * 10;
		case 'meters':
			return value;
		case 'yards':
			return moa.m2yd(value);
		default:
			return value; // Should not happen
	}
}

// Helper: Convert value from 'from' unit to 'to' unit via meters
export function convertUnits(
	value: number,
	from: LinearUnit | DistanceUnit | DiameterUnit,
	to: LinearUnit | DistanceUnit,
): number {
	if (from === to) return value;
	let meters: number;
	switch (from) {
		case 'inches':
			meters = moa.in2m(value);
			break;
		case 'cm':
			meters = moa.cm2m(value);
			break;
		case 'mm':
			meters = moa.cm2m(value / 10);
			break;
		case 'yards':
			meters = moa.yd2m(value);
			break;
		case 'meters':
			meters = value;
			break;
		default:
			meters = value; // Fallback for unknown DiameterUnit not covered above
	}
	return metersToUnit(meters, to);
}
