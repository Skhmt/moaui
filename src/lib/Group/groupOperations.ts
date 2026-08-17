import type {
	Point,
	ShotGroup,
	LinearUnit,
	DistanceUnit,
} from './types';
import {
	calculateGroupResults,
	invalidateResults,
} from './calculations';
import { MIN_SCALE_LINE_PIXELS } from './constants';

/**
 * Creates a new ShotGroup object initialized with default values.
 */
export function createNewGroup(id: number): ShotGroup {
	return {
		id,
		name: `Group ${id + 1}`,
		bulletHolesPixels: [],
		bulletHolesReal: [],
		centroidReal: null,
		meanRadius: null,
		maxSpread: null,
		meanRadiusMOA: null,
		meanRadiusMRAD: null,
		maxSpreadMOA: null,
		maxSpreadMRAD: null,
		aimingPointPixels: null,
		aimingPointReal: null,
		offsetFromAim: null,
		resultsValid: false,
		infoBoxAnchorImage: null,
		infoBoxSize: null,
	};
}

/**
 * Deletes a group at the given index and computes the next active group index.
 */
export function deleteGroupFromList(
	groups: ShotGroup[],
	index: number,
	activeIndex: number,
): { groups: ShotGroup[]; nextActiveIndex: number } {
	if (index < 0 || index >= groups.length) {
		return { groups, nextActiveIndex: activeIndex };
	}

	const updatedGroups = [...groups];
	updatedGroups.splice(index, 1);

	let nextActiveIndex = activeIndex;
	if (updatedGroups.length === 0) {
		nextActiveIndex = -1;
	} else if (activeIndex === index) {
		nextActiveIndex = Math.max(0, index - 1);
	} else if (activeIndex > index) {
		nextActiveIndex = activeIndex - 1;
	}

	if (nextActiveIndex >= updatedGroups.length) {
		nextActiveIndex = updatedGroups.length - 1;
	}

	return { groups: updatedGroups, nextActiveIndex };
}

/**
 * Adds a bullet hole to the group in pixel and real coordinates.
 */
export function addHoleToGroup(
	group: ShotGroup,
	coords: Point,
	scale: number,
): number {
	const realCoords = { x: coords.x / scale, y: coords.y / scale };
	group.bulletHolesPixels.push({ ...coords });
	group.bulletHolesReal.push(realCoords);
	invalidateResults(group);
	return group.bulletHolesPixels.length - 1;
}

/**
 * Sets the aiming point for a group.
 */
export function setAimPointForGroup(
	group: ShotGroup,
	coords: Point,
	scale: number,
): void {
	const realCoords = { x: coords.x / scale, y: coords.y / scale };
	group.aimingPointPixels = { ...coords };
	group.aimingPointReal = realCoords;
	invalidateResults(group);
}

/**
 * Removes a hole at the given index from the group.
 */
export function deleteHoleFromGroup(
	group: ShotGroup,
	holeIndex: number,
): void {
	if (holeIndex < 0 || holeIndex >= group.bulletHolesPixels.length) {
		return;
	}
	group.bulletHolesPixels.splice(holeIndex, 1);
	group.bulletHolesReal.splice(holeIndex, 1);
	invalidateResults(group);
}

/**
 * Moves/nudges a specific hole by (dx, dy) in image pixel space.
 */
export function nudgeHoleInGroup(
	group: ShotGroup,
	holeIndex: number,
	dx: number,
	dy: number,
	scale: number,
	imageBounds?: { width: number; height: number },
): void {
	if (
		holeIndex < 0 ||
		holeIndex >= group.bulletHolesPixels.length ||
		scale <= 0
	) {
		return;
	}

	const holePx = group.bulletHolesPixels[holeIndex];
	holePx.x += dx;
	holePx.y += dy;

	if (imageBounds) {
		holePx.x = Math.max(0, Math.min(holePx.x, imageBounds.width));
		holePx.y = Math.max(0, Math.min(holePx.y, imageBounds.height));
	}

	if (holeIndex < group.bulletHolesReal.length) {
		const holeRl = group.bulletHolesReal[holeIndex];
		holeRl.x = holePx.x / scale;
		holeRl.y = holePx.y / scale;
	}

	invalidateResults(group);
}

/**
 * Updates a hole position directly to a target coordinate.
 */
export function updateHolePosition(
	group: ShotGroup,
	holeIndex: number,
	coords: Point,
	scale: number,
	imageBounds?: { width: number; height: number },
): void {
	if (
		holeIndex < 0 ||
		holeIndex >= group.bulletHolesPixels.length ||
		scale <= 0
	) {
		return;
	}

	let targetX = coords.x;
	let targetY = coords.y;

	if (imageBounds) {
		targetX = Math.max(0, Math.min(targetX, imageBounds.width));
		targetY = Math.max(0, Math.min(targetY, imageBounds.height));
	}

	const holePx = group.bulletHolesPixels[holeIndex];
	holePx.x = targetX;
	holePx.y = targetY;

	if (holeIndex < group.bulletHolesReal.length) {
		const holeRl = group.bulletHolesReal[holeIndex];
		holeRl.x = holePx.x / scale;
		holeRl.y = holePx.y / scale;
	}

	invalidateResults(group);
}

/**
 * Calculates new pixel-to-unit scale from a reference line and updates all groups.
 */
export function calculateAndApplyScale(
	groups: ShotGroup[],
	refLineStart: Point | null,
	refLineEnd: Point | null,
	referenceLength: number,
	targetDistance: number,
	targetDistanceUnit: DistanceUnit,
	referenceUnit: LinearUnit,
	minScalePixels: number = MIN_SCALE_LINE_PIXELS,
): { scale: number | null; error?: string } {
	if (
		!refLineStart ||
		!refLineEnd ||
		!referenceLength ||
		referenceLength <= 0
	) {
		return { scale: null };
	}

	const dx = refLineEnd.x - refLineStart.x;
	const dy = refLineEnd.y - refLineStart.y;
	const lenPx = Math.sqrt(dx * dx + dy * dy);

	if (lenPx < minScalePixels) {
		return {
			scale: null,
			error: `Ref line too short (>= ${minScalePixels}px)`,
		};
	}

	const scale = lenPx / referenceLength; // pixels per referenceUnit

	groups.forEach((g) => {
		g.bulletHolesReal = g.bulletHolesPixels.map((p) => ({
			x: p.x / scale,
			y: p.y / scale,
		}));
		g.aimingPointReal = g.aimingPointPixels
			? {
					x: g.aimingPointPixels.x / scale,
					y: g.aimingPointPixels.y / scale,
				}
			: null;
		invalidateResults(g);
		g.infoBoxAnchorImage = null; // Reset info box anchor
		calculateGroupResults(
			g,
			scale,
			targetDistance,
			targetDistanceUnit,
			referenceUnit,
		);
	});

	return { scale };
}
