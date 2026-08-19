import type { AppearanceSettings } from './types';

export const NUDGE_AMOUNT_DISPLAY_PIXELS = 2;
export const ZOOM_FACTOR = 1.2;
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 20.0;
export const MIN_SCALE_LINE_PIXELS = 5;
export const MAX_BUFFER_DIM = 4096;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
	legendFontSize: 12,
	legendTextColor: '#e0e0e0',
	legendBgColor: '#000000',
	legendBorderColor: '#555555',
	lineWidthBase: 2,
	bulletHoleColor: '#FF4136',
	inactiveBulletHoleColor: 'rgba(255,65,54,0.7)',
	selectedHoleColor: '#FFDC00',
	selectedHoleLineWidthMultiplier: 2,
	centroidColor: '#0074D9',
	aimPointColor: '#FF851B',
	offsetLineColor: '#00BFFF',
	offsetLineWidthMultiplier: 0.8,
	scaleLineColor: '#00FF00',
	scaleLineWidth: 2,
	scaleMarkerSize: 6,
	showGroupNameInLegend: true,
	showReferenceLine: true,
};
