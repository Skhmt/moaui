import type {
	Point,
	Rect,
	ShotGroup,
	ViewportState,
	LetterboxParams,
	Mode,
} from './types';
import { isPointInRect } from './calculations';
import { imageToCanvasCoords } from './canvasRenderer';
import { NUDGE_AMOUNT_DISPLAY_PIXELS } from './constants';

export interface InteractionState {
	isPanning: boolean;
	panStartPointerCoords: Point | null;
	panStartViewCenter: Point | null;
	isDraggingInfoBox: boolean;
	draggingGroupIndex: number | null;
	dragStartPointerCoords: Point | null;
	dragStartInfoBoxAnchorImage: Point | null;
	isDraggingHole: boolean;
	isDrawingRefLine: boolean;
	isDraggingRefLineHandle: boolean;
	draggingRefLineHandle: 'start' | 'end' | null;
	ignoreNextClick: boolean;
}

export function createInitialInteractionState(): InteractionState {
	return {
		isPanning: false,
		panStartPointerCoords: null,
		panStartViewCenter: null,
		isDraggingInfoBox: false,
		draggingGroupIndex: null,
		dragStartPointerCoords: null,
		dragStartInfoBoxAnchorImage: null,
		isDraggingHole: false,
		isDrawingRefLine: false,
		isDraggingRefLineHandle: false,
		draggingRefLineHandle: null,
		ignoreNextClick: false,
	};
}

/**
 * Computes appropriate canvas cursor given interaction state and active mode.
 */
export function computeCanvasCursor(
	interaction: InteractionState,
	mode: Mode,
): string {
	if (
		interaction.isPanning ||
		interaction.isDraggingHole ||
		interaction.isDraggingRefLineHandle
	) {
		return 'grabbing';
	}
	if (interaction.isDraggingInfoBox) return 'move';
	if (mode === 'panning') return 'grab';
	if (mode === 'scaling' || mode === 'placingAim') return 'crosshair';
	if (mode === 'placingHoles') return 'copy';
	if (mode === 'selectingHole') return 'pointer';
	return 'default';
}

/**
 * Converts mouse/pointer event coordinates relative to the canvas bounding rect.
 */
export function getCanvasDisplayCoords(
	e: MouseEvent | PointerEvent,
	canvasElement: HTMLCanvasElement | undefined,
): Point | null {
	if (!canvasElement) return null;
	const r = canvasElement.getBoundingClientRect();
	if (!r.width || !r.height) return null;
	return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * Hit-tests reference measurement line handles ('start' and 'end').
 */
export function findRefLineHandleAtPointer(
	refLineStart: Point | null,
	refLineEnd: Point | null,
	imageCoords: Point,
	lastViewport: ViewportState | null,
	canvasElement: HTMLCanvasElement | undefined,
	dpr: number,
	toleranceDisplayPixels: number = 18,
): 'start' | 'end' | null {
	if (
		!refLineStart ||
		!refLineEnd ||
		!lastViewport ||
		!canvasElement ||
		!canvasElement.width ||
		canvasElement.width <= 0 ||
		!lastViewport.sWidth
	) {
		return null;
	}

	const tolRenderPixels = toleranceDisplayPixels * dpr;
	const tolImagePixels =
		(tolRenderPixels / canvasElement.width) * lastViewport.sWidth;
	const tolImagePixelsSq = tolImagePixels * tolImagePixels;

	const dxStart = imageCoords.x - refLineStart.x;
	const dyStart = imageCoords.y - refLineStart.y;
	const distStartSq = dxStart * dxStart + dyStart * dyStart;

	const dxEnd = imageCoords.x - refLineEnd.x;
	const dyEnd = imageCoords.y - refLineEnd.y;
	const distEndSq = dxEnd * dxEnd + dyEnd * dyEnd;

	if (distStartSq <= tolImagePixelsSq && distStartSq <= distEndSq) {
		return 'start';
	}
	if (distEndSq <= tolImagePixelsSq) {
		return 'end';
	}
	return null;
}

/**
 * Hit-tests shot group info boxes from top to bottom (reverse order).
 * Returns the index of the hit group, or null if none was clicked.
 */
export function findInfoBoxAtPointer(
	groups: ShotGroup[],
	displayCoords: Point,
	canvasElement: HTMLCanvasElement,
	lastViewport: ViewportState,
	letterboxParams: LetterboxParams,
	dpr: number,
): number | null {
	if (
		canvasElement.width <= 0 ||
		canvasElement.height <= 0 ||
		canvasElement.clientWidth <= 0 ||
		canvasElement.clientHeight <= 0
	) {
		return null;
	}

	for (let i = groups.length - 1; i >= 0; i--) {
		const g = groups[i];
		if (!g.resultsValid || !g.infoBoxAnchorImage || !g.infoBoxSize) {
			continue;
		}

		const aImg = g.infoBoxAnchorImage;
		const sLog = g.infoBoxSize;
		const aCvsRender = imageToCanvasCoords(
			aImg,
			lastViewport,
			canvasElement,
			letterboxParams,
		);

		if (aCvsRender) {
			const boxRenderWidth = sLog.width * dpr;
			const boxRenderHeight = sLog.height * dpr;
			const displayX =
				(aCvsRender.x / canvasElement.width) * canvasElement.clientWidth;
			const displayY =
				(aCvsRender.y / canvasElement.height) *
				canvasElement.clientHeight;
			const displayWidth =
				(boxRenderWidth / canvasElement.width) *
				canvasElement.clientWidth;
			const displayHeight =
				(boxRenderHeight / canvasElement.height) *
				canvasElement.clientHeight;

			const displayRect: Rect = {
				x: displayX,
				y: displayY,
				width: displayWidth,
				height: displayHeight,
			};

			if (isPointInRect(displayCoords, displayRect)) {
				return i;
			}
		}
	}
	return null;
}

/**
 * Hit-tests bullet holes in a group, returning index of the closest hole within tolerance.
 */
export function findHoleAtPointer(
	group: ShotGroup | undefined,
	imageCoords: Point,
	lastViewport: ViewportState,
	canvasElement: HTMLCanvasElement,
	dpr: number,
	toleranceRenderPixels: number = 15,
): number | null {
	if (
		!group ||
		!canvasElement.width ||
		canvasElement.width <= 0 ||
		!lastViewport.sWidth
	) {
		return null;
	}

	const clickToleranceRenderPixels = toleranceRenderPixels * dpr;
	const clickToleranceImagePixels =
		(clickToleranceRenderPixels / canvasElement.width) *
		lastViewport.sWidth;
	const clickToleranceImagePixelsSq =
		clickToleranceImagePixels * clickToleranceImagePixels;

	let foundIndex: number | null = null;
	let minDistanceSq = Infinity;

	for (let i = group.bulletHolesPixels.length - 1; i >= 0; i--) {
		const h = group.bulletHolesPixels[i];
		const dx = imageCoords.x - h.x;
		const dy = imageCoords.y - h.y;
		const dSq = dx * dx + dy * dy;

		if (dSq <= clickToleranceImagePixelsSq && dSq < minDistanceSq) {
			minDistanceSq = dSq;
			foundIndex = i;
		}
	}

	return foundIndex;
}

/**
 * Calculates new viewCenter during panning.
 */
export function calculatePanOffset(
	curPtrD: Point,
	panStartPointer: Point,
	panStartViewCenter: Point,
	canvasElement: HTMLCanvasElement,
	lastViewport: ViewportState,
): Point {
	const dxD = curPtrD.x - panStartPointer.x;
	const dyD = curPtrD.y - panStartPointer.y;
	const dxI = (dxD / canvasElement.clientWidth) * lastViewport.sWidth;
	const dyI = (dyD / canvasElement.clientHeight) * lastViewport.sHeight;

	return {
		x: panStartViewCenter.x - dxI,
		y: panStartViewCenter.y - dyI,
	};
}

/**
 * Calculates keyboard nudge delta or delete command.
 */
export function calculateKeyboardNudge(
	key: string,
	canvasElement: HTMLCanvasElement,
	lastViewport: ViewportState,
	nudgeDisplayPixels: number = NUDGE_AMOUNT_DISPLAY_PIXELS,
): { dx: number; dy: number; isDelete: boolean } | null {
	if (
		!canvasElement.clientWidth ||
		!canvasElement.clientHeight ||
		canvasElement.clientWidth <= 0 ||
		canvasElement.clientHeight <= 0
	) {
		return null;
	}

	const nudgeXImage =
		(nudgeDisplayPixels / canvasElement.clientWidth) *
		lastViewport.sWidth;
	const nudgeYImage =
		(nudgeDisplayPixels / canvasElement.clientHeight) *
		lastViewport.sHeight;

	switch (key) {
		case 'ArrowUp':
			return { dx: 0, dy: -nudgeYImage, isDelete: false };
		case 'ArrowDown':
			return { dx: 0, dy: nudgeYImage, isDelete: false };
		case 'ArrowLeft':
			return { dx: -nudgeXImage, dy: 0, isDelete: false };
		case 'ArrowRight':
			return { dx: nudgeXImage, dy: 0, isDelete: false };
		case 'Delete':
		case 'Backspace':
			return { dx: 0, dy: 0, isDelete: true };
		default:
			return null;
	}
}
