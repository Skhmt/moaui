export interface Point {
	x: number;
	y: number;
}

export interface RealPoint {
	x: number;
	y: number;
} // Stores values in referenceUnit

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ViewportState {
	sx: number;
	sy: number;
	sWidth: number;
	sHeight: number;
}

export interface LetterboxParams {
	dx: number;
	dy: number;
	dWidth: number;
	dHeight: number;
}

export interface ShotGroup {
	id: number;
	name: string;
	bulletHolesPixels: Point[];
	bulletHolesReal: RealPoint[]; // Stores values in referenceUnit
	centroidReal: RealPoint | null; // Stores value in referenceUnit
	meanRadius: number | null; // Stores value in referenceUnit
	meanRadiusMOA: number | null;
	meanRadiusMRAD: number | null;
	maxSpread: number | null; // Stores value in referenceUnit
	maxSpreadMOA: number | null;
	maxSpreadMRAD: number | null;
	aimingPointPixels: Point | null;
	aimingPointReal: RealPoint | null; // Stores value in referenceUnit
	offsetFromAim: { distance: number; angleDegrees: number } | null; // distance is in referenceUnit
	resultsValid: boolean;
	infoBoxAnchorImage: Point | null;
	infoBoxSize: { width: number; height: number } | null;
}

export type Mode =
	| 'loading'
	| 'scaling'
	| 'placingHoles'
	| 'placingAim'
	| 'selectingHole'
	| 'panning';

export type LinearUnit = 'inches' | 'cm' | 'mm' | 'meters' | 'yards'; // Keep broader type for flexibility
export type DistanceUnit = 'yards' | 'meters';
export type DiameterUnit = 'inches' | 'mm';
export type AngularUnitDisplay = 'moa' | 'mrad' | 'none';

export interface InfoBoxStyleOptions {
	fontSize: number;
	textColor: string;
	bgColor: string;
	borderColor: string;
}

export interface AppearanceSettings {
	legendFontSize: number;
	legendTextColor: string;
	legendBgColor: string;
	legendBorderColor: string;
	lineWidthBase: number;
	bulletHoleColor: string;
	inactiveBulletHoleColor: string;
	selectedHoleColor: string;
	selectedHoleLineWidthMultiplier: number;
	centroidColor: string;
	aimPointColor: string;
	offsetLineColor: string;
	offsetLineWidthMultiplier: number;
	scaleLineColor: string;
	scaleLineWidth: number;
	scaleMarkerSize: number;
	showGroupNameInLegend: boolean;
}
