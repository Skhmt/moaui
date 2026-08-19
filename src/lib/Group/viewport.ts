import type { Point } from './types';
import { MIN_ZOOM, MAX_ZOOM, MAX_BUFFER_DIM, ZOOM_FACTOR } from './constants';

/**
 * Calculates canvas buffer dimensions constrained by device pixel ratio and MAX_BUFFER_DIM.
 */
export function computeTargetBufferSize(
	containerW: number,
	containerH: number,
	dpr: number,
	maxDim: number = MAX_BUFFER_DIM,
): { width: number; height: number } {
	if (containerW <= 0 || containerH <= 0) {
		return { width: 0, height: 0 };
	}

	let targetW = containerW * dpr;
	let targetH = containerH * dpr;

	if (targetW > maxDim || targetH > maxDim) {
		const ratioW = maxDim / targetW;
		const ratioH = maxDim / targetH;
		const ratio = Math.min(ratioW, ratioH);

		targetW = Math.round(targetW * ratio);
		targetH = Math.round(targetH * ratio);
	}

	targetW = Math.max(1, targetW);
	targetH = Math.max(1, targetH);

	return { width: targetW, height: targetH };
}

/**
 * Computes scale to fit an image within container dimensions.
 */
export function computeFitScale(
	imgW: number,
	imgH: number,
	displayW: number,
	displayH: number,
	minZoom: number = MIN_ZOOM,
	maxZoom: number = MAX_ZOOM,
): number {
	let fitScale = 1.0;
	if (imgW > 0 && imgH > 0 && displayW > 0 && displayH > 0) {
		fitScale = Math.min(displayW / imgW, displayH / imgH);
	} else {
		fitScale = minZoom;
	}
	return Math.max(minZoom, Math.min(maxZoom, fitScale));
}

/**
 * Computes initial fit view center and fit scale for a loaded image.
 */
export function calculateFitView(
	imageBitmap: ImageBitmap | null,
	canvasElement: HTMLCanvasElement | undefined,
	containerHeight: number,
	minZoom: number = MIN_ZOOM,
	maxZoom: number = MAX_ZOOM,
): { fitScaleValue: number; viewScale: number; viewCenter: Point } | null {
	if (!imageBitmap || !canvasElement || !canvasElement.clientWidth || !canvasElement.clientHeight) {
		return null;
	}

	const fitScaleValue = computeFitScale(
		imageBitmap.width,
		imageBitmap.height,
		canvasElement.clientWidth,
		containerHeight || canvasElement.clientHeight,
		minZoom,
		maxZoom,
	);

	const viewCenter = {
		x: imageBitmap.width / 2,
		y: imageBitmap.height / 2,
	};

	const clampedCenter = clampViewCenter(
		viewCenter,
		fitScaleValue,
		imageBitmap.width,
		imageBitmap.height,
		canvasElement.clientWidth,
		canvasElement.clientHeight,
	);

	return {
		fitScaleValue,
		viewScale: fitScaleValue,
		viewCenter: clampedCenter,
	};
}

/**
 * Clamps view center so the image does not pan outside visible bounds.
 */
export function clampViewCenter(
	viewCenter: Point,
	viewScale: number,
	imgW: number,
	imgH: number,
	canvasW: number,
	canvasH: number,
): Point {
	if (imgW <= 0 || imgH <= 0 || canvasW <= 0 || canvasH <= 0 || viewScale <= 0) {
		return { ...viewCenter };
	}

	const viewportWidthImg = canvasW / viewScale;
	const viewportHeightImg = canvasH / viewScale;
	const minX = viewportWidthImg / 2;
	const maxX = imgW - viewportWidthImg / 2;
	const minY = viewportHeightImg / 2;
	const maxY = imgH - viewportHeightImg / 2;

	const clampedX =
		maxX >= minX ? Math.max(minX, Math.min(viewCenter.x, maxX)) : imgW / 2;
	const clampedY =
		maxY >= minY ? Math.max(minY, Math.min(viewCenter.y, maxY)) : imgH / 2;

	return { x: clampedX, y: clampedY };
}

/**
 * Calculates new zoom scale and adjusted center position.
 */
export function calculateZoom(
	factor: number,
	currentScale: number,
	fitScaleValue: number,
	viewCenter: Point,
	zoomTargetImageCoords?: Point | null,
	minZoom: number = MIN_ZOOM,
	maxZoom: number = MAX_ZOOM,
): { newScale: number; newCenter: Point } {
	let newScale = Math.max(minZoom, Math.min(maxZoom, currentScale * factor));
	if (newScale < fitScaleValue) {
		newScale = fitScaleValue;
	}

	if (newScale === currentScale) {
		return { newScale: currentScale, newCenter: { ...viewCenter } };
	}

	const zoomCenterX = zoomTargetImageCoords ? zoomTargetImageCoords.x : viewCenter.x;
	const zoomCenterY = zoomTargetImageCoords ? zoomTargetImageCoords.y : viewCenter.y;

	const newCenterX =
		zoomCenterX - (zoomCenterX - viewCenter.x) * (currentScale / newScale);
	const newCenterY =
		zoomCenterY - (zoomCenterY - viewCenter.y) * (currentScale / newScale);

	return {
		newScale,
		newCenter: { x: newCenterX, y: newCenterY },
	};
}
