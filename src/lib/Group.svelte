<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import type {
		Point,
		ViewportState,
		LetterboxParams,
		ShotGroup,
		Mode,
		LinearUnit,
		DistanceUnit,
		DiameterUnit,
		AngularUnitDisplay,
		AppearanceSettings as AppearanceSettingsType,
	} from './Group/types';
	import {
		ZOOM_FACTOR,
		MIN_SCALE_LINE_PIXELS,
		MAX_BUFFER_DIM,
		DEFAULT_APPEARANCE,
	} from './Group/constants';
	import {
		calculateGroupResults as calcGroupResults,
		invalidateResults as invalResults,
	} from './Group/calculations';
	import {
		imageToCanvasCoords,
		canvasToImageCoords,
		renderMainCanvas,
		exportCanvasAsJpeg as exportJpeg,
	} from './Group/canvasRenderer';
	import {
		computeTargetBufferSize,
		calculateFitView,
		clampViewCenter as clampCenter,
		calculateZoom,
	} from './Group/viewport';
	import {
		createNewGroup,
		deleteGroupFromList,
		addHoleToGroup,
		setAimPointForGroup,
		deleteHoleFromGroup,
		nudgeHoleInGroup,
		updateHolePosition,
		calculateAndApplyScale,
	} from './Group/groupOperations';
	import {
		type InteractionState,
		createInitialInteractionState,
		computeCanvasCursor,
		getCanvasDisplayCoords,
		findInfoBoxAtPointer,
		findHoleAtPointer,
		findRefLineHandleAtPointer,
		calculatePanOffset,
		calculateKeyboardNudge,
	} from './Group/interactions';

	import ImageHeader from './Group/ImageHeader.svelte';
	import CanvasToolbar from './Group/CanvasToolbar.svelte';
	import CanvasArea from './Group/CanvasArea.svelte';
	import EmptyState from './Group/EmptyState.svelte';
	import Sidebar from './Group/Sidebar.svelte';

	// --- Core State Variables ---
	let imageFile: File | null = null;
	let imageUrl: string | null = null;
	let canvasElement: HTMLCanvasElement | undefined;
	let canvasAreaElement: HTMLDivElement | undefined;
	let ctx: CanvasRenderingContext2D | null = null;
	let imageBitmap: ImageBitmap | null = null;
	let fileInputEl: HTMLInputElement | undefined;
	let observer: ResizeObserver | null = null;
	let dpr = 1;

	// --- Analysis & Group State ---
	let mode: Mode = 'loading';
	let scale: number | null = null;
	let referenceUnit: LinearUnit = 'inches';
	let referenceLength: number = 1;
	let resultDisplayUnit: LinearUnit = 'inches';
	let bulletDiameterUnit: DiameterUnit = 'inches';
	let targetDistanceUnit: DistanceUnit = 'yards';
	let angularUnitDisplay: AngularUnitDisplay = 'moa';
	let bulletDiameter: number = 0.22;
	let targetDistance: number = 100;
	let refLineStart: Point | null = null;
	let refLineEnd: Point | null = null;
	let groups: ShotGroup[] = [];
	let activeGroupIndex: number = -1;
	let nextGroupId = 0;
	let selectedHoleIndex: number | null = null;

	// --- Viewport State ---
	let viewScale: number = 1.0;
	let viewCenter: Point = { x: 0, y: 0 };
	let fitScaleValue: number = 1.0;
	let lastViewport: ViewportState | null = null;
	let letterboxParams: LetterboxParams = { dx: 0, dy: 0, dWidth: 0, dHeight: 0 };

	// --- Interaction & Style State ---
	let interaction: InteractionState = createInitialInteractionState();
	let appearance: AppearanceSettingsType = { ...DEFAULT_APPEARANCE };

	// --- Two-Finger Pinch Zoom State ---
	const activePointers = new Map<number, Point>();
	let pinchPrevDistance: number | null = null;

	// --- Lifecycle & Observers ---
	onMount(() => {
		dpr = window.devicePixelRatio || 1;
		window.addEventListener('pointermove', handleWindowPointerMove);
		window.addEventListener('pointerup', handleWindowPointerUp);
		window.addEventListener('pointercancel', handleWindowPointerCancel);
		window.addEventListener('keydown', handleKeyDown);
	});

	onDestroy(() => {
		window.removeEventListener('pointermove', handleWindowPointerMove);
		window.removeEventListener('pointerup', handleWindowPointerUp);
		window.removeEventListener('pointercancel', handleWindowPointerCancel);
		window.removeEventListener('keydown', handleKeyDown);
		cleanupResizeObserver();
		if (imageUrl && imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
		if (imageBitmap) imageBitmap.close();
	});

	function cleanupResizeObserver() {
		if (observer && canvasAreaElement) observer.unobserve(canvasAreaElement);
		observer = null;
	}

	function setupResizeObserver() {
		if (!canvasAreaElement) return;
		cleanupResizeObserver();
		observer = new ResizeObserver(handleResize);
		observer.observe(canvasAreaElement);
		handleResize();
	}

	function handleResize() {
		if (!canvasElement || !canvasAreaElement) return;
		const { width, height } = computeTargetBufferSize(
			canvasAreaElement.clientWidth,
			canvasAreaElement.clientHeight,
			dpr,
			MAX_BUFFER_DIM,
		);
		if (width <= 0 || height <= 0) return;
		if (canvasElement.width !== width || canvasElement.height !== height) {
			canvasElement.width = width;
			canvasElement.height = height;
			if (imageBitmap) {
				resetZoomToFit();
				redrawCanvas();
			}
		}
	}

	// --- Canvas Setup & Rendering ---
	function setupCanvas(): void {
		if (!canvasElement || !imageUrl || !imageFile) return;
		const context = canvasElement.getContext('2d', { alpha: false });
		if (!context) {
			alert('Canvas init error.');
			reset();
			return;
		}
		ctx = context;
		self.createImageBitmap(imageFile)
			.then((bitmap) => {
				if (imageBitmap) imageBitmap.close();
				imageBitmap = bitmap;
				if (!canvasElement || !ctx || !imageBitmap || !canvasAreaElement) return;
				const { width, height } = computeTargetBufferSize(
					canvasAreaElement.clientWidth,
					canvasAreaElement.clientHeight,
					dpr,
					MAX_BUFFER_DIM,
				);
				canvasElement.width = width;
				canvasElement.height = height;
				viewCenter = { x: imageBitmap.width / 2, y: imageBitmap.height / 2 };
				viewScale = 1.0;
				lastViewport = null;
				if (groups.length === 0) addNewGroup();
				requestAnimationFrame(() => {
					if (!canvasElement || !imageBitmap || !canvasAreaElement) return;
					resetZoomToFit();
					redrawCanvas();
				});
				mode = 'scaling';
			})
			.catch((err) => {
				console.error('createImageBitmap error:', err);
				alert('Image load error.');
				reset();
			});
	}

	function redrawCanvas(): void {
		const result = renderMainCanvas({
			ctx,
			canvasElement,
			imageBitmap,
			viewScale,
			viewCenter,
			refLineStart,
			refLineEnd,
			scale,
			groups,
			activeGroupIndex,
			bulletDiameter,
			bulletDiameterUnit,
			referenceUnit,
			resultDisplayUnit,
			targetDistance,
			targetDistanceUnit,
			angularUnitDisplay,
			selectedHoleIndex,
			dpr,
			appearance,
			activeRefLineHandle: interaction.draggingRefLineHandle,
		});
		if (result) {
			lastViewport = result.viewport;
			letterboxParams = result.letterbox;
		}
	}

	function imgToCvs(p: Point): Point | null {
		return imageToCanvasCoords(p, lastViewport, canvasElement, letterboxParams);
	}

	function cvsToImg(p: Point): Point | null {
		return canvasToImageCoords(p, lastViewport, canvasElement, letterboxParams, imageBitmap);
	}

	function clampView(): void {
		if (!imageBitmap || !canvasElement) return;
		viewCenter = clampCenter(
			viewCenter,
			viewScale,
			imageBitmap.width,
			imageBitmap.height,
			canvasElement.clientWidth,
			canvasElement.clientHeight,
		);
	}

	// --- Event Handling ---
	function handleFileSelect(e: Event) {
		const t = e.target as HTMLInputElement;
		const f = t.files?.[0];
		if (f && f.type.startsWith('image/')) {
			imageFile = f;
			if (imageUrl && imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
			imageUrl = URL.createObjectURL(f);
			resetStateForNewImage();
			mode = 'loading';
			requestAnimationFrame(setupCanvas);
		} else {
			alert('Select valid image.');
			if (t) t.value = '';
			imageFile = null;
			imageUrl = null;
			reset();
		}
	}

	function handleCanvasPointerDown(e: PointerEvent) {
		if (!canvasElement || !ctx || !lastViewport || !imageBitmap) return;

		// Track active pointers to support two-finger pinch zooming on touch devices
		const trackD = getCanvasDisplayCoords(e, canvasElement);
		if (trackD) {
			activePointers.set(e.pointerId, trackD);
			if (activePointers.size === 2) {
				beginPinchZoom();
				return;
			}
			if (activePointers.size > 2) return;
		}

		// Middle click pans from any mode
		if (e.button === 1) {
			e.preventDefault();
			const dCoords = getCanvasDisplayCoords(e, canvasElement);
			if (!dCoords) return;
			interaction.isPanning = true;
			interaction.panStartPointerCoords = dCoords;
			interaction.panStartViewCenter = { ...viewCenter };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			canvasElement.style.cursor = 'grabbing';
			e.stopPropagation();
			return;
		}

		// Only handle left click for other tools
		if (e.button !== 0) return;

		const dCoords = getCanvasDisplayCoords(e, canvasElement);
		if (!dCoords) return;
		const iCoords = cvsToImg(dCoords);
		if (!iCoords) return;

		interaction.isDraggingInfoBox = false;
		interaction.isPanning = false;
		interaction.isDraggingHole = false;
		interaction.isDraggingRefLineHandle = false;

		// Check ref line handle dragging first
		if (appearance.showReferenceLine && refLineStart && refLineEnd) {
			const hitHandle = findRefLineHandleAtPointer(
				refLineStart,
				refLineEnd,
				iCoords,
				lastViewport,
				canvasElement,
				dpr,
			);
			if (hitHandle) {
				interaction.isDraggingRefLineHandle = true;
				interaction.draggingRefLineHandle = hitHandle;
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
				canvasElement.style.cursor = 'grabbing';
				redrawCanvas();
				e.stopPropagation();
				return;
			}
		}

		const hitInfoBox = findInfoBoxAtPointer(groups, dCoords, canvasElement, lastViewport, letterboxParams, dpr);
		if (hitInfoBox !== null) {
			interaction.isDraggingInfoBox = true;
			interaction.draggingGroupIndex = hitInfoBox;
			interaction.dragStartPointerCoords = dCoords;
			interaction.dragStartInfoBoxAnchorImage = { ...groups[hitInfoBox].infoBoxAnchorImage! };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			e.stopPropagation();
			return;
		}

		if (mode === 'selectingHole' && selectedHoleIndex !== null && scale) {
			const g = groups[activeGroupIndex];
			const hitHole = findHoleAtPointer(g, iCoords, lastViewport, canvasElement, dpr);
			if (hitHole === selectedHoleIndex) {
				interaction.isDraggingHole = true;
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
				canvasElement.style.cursor = 'grabbing';
				e.stopPropagation();
				return;
			}
		}

		if (mode === 'panning') {
			interaction.isPanning = true;
			interaction.panStartPointerCoords = dCoords;
			interaction.panStartViewCenter = { ...viewCenter };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			canvasElement.style.cursor = 'grabbing';
			e.stopPropagation();
			return;
		}

		if (mode === 'scaling') {
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			interaction.isDrawingRefLine = true;
			refLineStart = iCoords;
			refLineEnd = iCoords;
			redrawCanvas();
			e.stopPropagation();
		}
	}

	function beginPinchZoom() {
		const pts = [...activePointers.values()];
		pinchPrevDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);

		// Abort any single-pointer operation started by the first finger
		if (canvasElement) {
			for (const id of activePointers.keys()) {
				try {
					canvasElement.releasePointerCapture(id);
				} catch {
					// Pointer capture may not be held for this id
				}
			}
			canvasElement.style.cursor = canvasCursor;
		}
		interaction.isPanning = false;
		interaction.panStartPointerCoords = null;
		interaction.panStartViewCenter = null;
		interaction.isDraggingInfoBox = false;
		interaction.draggingGroupIndex = null;
		interaction.dragStartPointerCoords = null;
		interaction.dragStartInfoBoxAnchorImage = null;
		interaction.isDraggingHole = false;
		if (interaction.isDrawingRefLine) {
			// Abort an in-progress reference line draw; keep any existing line intact
			refLineStart = null;
			refLineEnd = null;
		}
		interaction.isDrawingRefLine = false;
		interaction.isDraggingRefLineHandle = false;
		interaction.draggingRefLineHandle = null;

		// Prevent the tap that ends a pinch from triggering a canvas click action
		interaction.ignoreNextClick = true;
		setTimeout(() => { interaction.ignoreNextClick = false; }, 250);
	}

	function handleWindowPointerMove(e: PointerEvent) {
		if (!canvasElement || !lastViewport || !canvasElement.clientWidth || !canvasElement.clientHeight) return;
		const curPtrD = getCanvasDisplayCoords(e, canvasElement);
		if (!curPtrD) return;

		if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, curPtrD);

		if (pinchPrevDistance !== null && activePointers.size >= 2) {
			const pts = [...activePointers.values()];
			const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
			if (dist > 0 && pinchPrevDistance > 0) {
				const midD: Point = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
				const result = calculateZoom(dist / pinchPrevDistance, viewScale, fitScaleValue, viewCenter, cvsToImg(midD));
				viewScale = result.newScale;
				viewCenter = result.newCenter;
				clampView();
				requestAnimationFrame(redrawCanvas);
			}
			if (dist > 0) pinchPrevDistance = dist;
			return;
		}

		if (interaction.isPanning && interaction.panStartPointerCoords && interaction.panStartViewCenter && canvasElement.hasPointerCapture(e.pointerId)) {
			viewCenter = calculatePanOffset(curPtrD, interaction.panStartPointerCoords, interaction.panStartViewCenter, canvasElement, lastViewport);
			clampView();
			requestAnimationFrame(redrawCanvas);
		} else if (interaction.isDraggingInfoBox && interaction.draggingGroupIndex !== null && interaction.dragStartPointerCoords && interaction.dragStartInfoBoxAnchorImage && canvasElement.hasPointerCapture(e.pointerId)) {
			const startPtrI = cvsToImg(interaction.dragStartPointerCoords);
			const curPtrI = cvsToImg(curPtrD);
			if (startPtrI && curPtrI) {
				const g = groups[interaction.draggingGroupIndex];
				if (g) {
					g.infoBoxAnchorImage = {
						x: interaction.dragStartInfoBoxAnchorImage.x + (curPtrI.x - startPtrI.x),
						y: interaction.dragStartInfoBoxAnchorImage.y + (curPtrI.y - startPtrI.y),
					};
					groups = groups;
					requestAnimationFrame(redrawCanvas);
				}
			}
		} else if (interaction.isDraggingHole && selectedHoleIndex !== null && scale && activeGroupIndex !== -1) {
			const curPtrI = cvsToImg(curPtrD);
			if (curPtrI) {
				const g = groups[activeGroupIndex];
				if (g) {
					updateHolePosition(g, selectedHoleIndex, curPtrI, scale, imageBitmap ?? undefined);
					groups = groups;
					requestAnimationFrame(redrawCanvas);
				}
			}
		} else if (interaction.isDraggingRefLineHandle && interaction.draggingRefLineHandle) {
			const curPtrI = cvsToImg(curPtrD);
			if (curPtrI) {
				const clampedCoords = {
					x: imageBitmap ? Math.max(0, Math.min(curPtrI.x, imageBitmap.width)) : curPtrI.x,
					y: imageBitmap ? Math.max(0, Math.min(curPtrI.y, imageBitmap.height)) : curPtrI.y,
				};
				if (interaction.draggingRefLineHandle === 'start') {
					refLineStart = clampedCoords;
				} else {
					refLineEnd = clampedCoords;
				}
				requestAnimationFrame(redrawCanvas);
			}
		} else if (mode === 'scaling' && interaction.isDrawingRefLine && refLineStart && canvasElement.hasPointerCapture(e.pointerId)) {
			const curPtrI = cvsToImg(curPtrD);
			if (curPtrI) {
				refLineEnd = curPtrI;
				requestAnimationFrame(redrawCanvas);
			}
		}
	}

	function handleWindowPointerRelease(e: PointerEvent) {
		activePointers.delete(e.pointerId);
		if (activePointers.size < 2) pinchPrevDistance = null;

		const wasDragging =
			interaction.isPanning ||
			interaction.isDraggingInfoBox ||
			interaction.isDraggingHole ||
			interaction.isDraggingRefLineHandle ||
			interaction.isDrawingRefLine;

		if (interaction.isPanning && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			interaction.isPanning = false;
			interaction.panStartPointerCoords = null;
			interaction.panStartViewCenter = null;
			if (canvasElement) canvasElement.style.cursor = canvasCursor;
		} else if (interaction.isDraggingInfoBox && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			interaction.isDraggingInfoBox = false;
			interaction.draggingGroupIndex = null;
			interaction.dragStartPointerCoords = null;
			interaction.dragStartInfoBoxAnchorImage = null;
			redrawCanvas();
		} else if (interaction.isDraggingHole && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			interaction.isDraggingHole = false;
			if (canvasElement) canvasElement.style.cursor = canvasCursor;
			if (activeGroupIndex !== -1) calculateGroupResults(activeGroupIndex);
			redrawCanvas();
		} else if (interaction.isDraggingRefLineHandle && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			interaction.isDraggingRefLineHandle = false;
			interaction.draggingRefLineHandle = null;
			if (canvasElement) canvasElement.style.cursor = canvasCursor;
			if (refLineStart && refLineEnd) {
				applyScale();
			}
			redrawCanvas();
		} else if (mode === 'scaling' && interaction.isDrawingRefLine && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			interaction.isDrawingRefLine = false;
			const finalPtrD = getCanvasDisplayCoords(e, canvasElement);
			if (finalPtrD) {
				const finalI = cvsToImg(finalPtrD);
				if (finalI) refLineEnd = finalI;
			}
			if (refLineStart && refLineEnd && applyScale()) {
				mode = 'placingHoles';
			} else {
				refLineStart = null;
				refLineEnd = null;
			}
			redrawCanvas();
		}

		if (wasDragging) {
			interaction.ignoreNextClick = true;
			setTimeout(() => { interaction.ignoreNextClick = false; }, 250);
		}

		interaction.isPanning = false;
		interaction.isDraggingInfoBox = false;
		interaction.isDraggingHole = false;
		interaction.isDraggingRefLineHandle = false;
		interaction.draggingRefLineHandle = null;
		interaction.isDrawingRefLine = false;
		interaction.panStartPointerCoords = null;
		interaction.panStartViewCenter = null;
		interaction.dragStartPointerCoords = null;
		interaction.dragStartInfoBoxAnchorImage = null;
		if (canvasElement) canvasElement.style.cursor = canvasCursor;
	}

	function handleWindowPointerUp(e: PointerEvent) {
		handleWindowPointerRelease(e);
	}

	function handleWindowPointerCancel(e: PointerEvent) {
		handleWindowPointerRelease(e);
	}

	async function handleCanvasClick(e: MouseEvent) {
		if (e.button !== 0) return;
		if (interaction.ignoreNextClick) {
			interaction.ignoreNextClick = false;
			return;
		}
		if (interaction.isPanning || interaction.isDrawingRefLine || !canvasElement || activeGroupIndex === -1) return;
		const dCoords = getCanvasDisplayCoords(e, canvasElement);
		if (!dCoords) return;
		const iCoords = cvsToImg(dCoords);
		if (!iCoords) return;
		const g = groups[activeGroupIndex];

		if (mode === 'placingHoles' && scale) {
			selectedHoleIndex = addHoleToGroup(g, iCoords, scale);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			redrawCanvas();
		} else if (mode === 'placingAim' && scale) {
			setAimPointForGroup(g, iCoords, scale);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			mode = 'placingHoles';
			redrawCanvas();
		} else if (mode === 'selectingHole') {
			selectedHoleIndex = findHoleAtPointer(g, iCoords, lastViewport!, canvasElement, dpr);
			redrawCanvas();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (activeGroupIndex === -1 || selectedHoleIndex === null || !scale || !lastViewport || !canvasElement) return;
		const nudgeAction = calculateKeyboardNudge(e.key, canvasElement, lastViewport);
		if (!nudgeAction) return;

		e.preventDefault();
		if (nudgeAction.isDelete) {
			deleteSelectedHole();
		} else {
			nudgeSelectedHolePx(nudgeAction.dx, nudgeAction.dy);
		}
	}

	function handleNudgeKey(key: string) {
		handleKeyDown({ key, preventDefault: () => {} } as KeyboardEvent);
	}

	// --- Group & Scale Actions ---
	function applyScale(): boolean {
		const res = calculateAndApplyScale(
			groups,
			refLineStart,
			refLineEnd,
			referenceLength,
			targetDistance,
			targetDistanceUnit,
			referenceUnit,
			MIN_SCALE_LINE_PIXELS,
		);
		if (res.error) {
			alert(res.error);
			scale = null;
			refLineStart = null;
			refLineEnd = null;
			return false;
		}
		scale = res.scale;
		groups = groups;
		redrawCanvas();
		return scale !== null;
	}

	function calculateGroupResults(idx: number) {
		if (idx < 0 || idx >= groups.length || !scale) return;
		calcGroupResults(groups[idx], scale, targetDistance, targetDistanceUnit, referenceUnit);
		groups = groups;
		redrawCanvas();
	}

	function addNewGroup() {
		const nG = createNewGroup(nextGroupId++);
		groups = [...groups, nG];
		activeGroupIndex = groups.length - 1;
		selectedHoleIndex = null;
		mode = !imageBitmap ? 'loading' : !scale ? 'scaling' : 'placingHoles';
		redrawCanvas();
	}

	function switchToGroup(idx: number) {
		if (idx >= 0 && idx < groups.length && idx !== activeGroupIndex) {
			activeGroupIndex = idx;
			selectedHoleIndex = null;
			mode = !imageBitmap ? 'loading' : !scale ? 'scaling' : 'placingHoles';
			redrawCanvas();
		}
	}

	async function deleteGroup(idx: number) {
		if (idx < 0 || idx >= groups.length) return;
		const gName = groups[idx]?.name ?? `Group ${idx + 1}`;
		if (!confirm(`Are you sure you want to delete ${gName}? This cannot be undone.`)) return;

		const result = deleteGroupFromList(groups, idx, activeGroupIndex);
		groups = result.groups;
		activeGroupIndex = result.nextActiveIndex;

		if (groups.length === 0) {
			addNewGroup();
		} else {
			await tick();
			redrawCanvas();
		}
	}

	async function deleteSelectedHole() {
		if (activeGroupIndex === -1 || selectedHoleIndex === null) return;
		const g = groups[activeGroupIndex];
		deleteHoleFromGroup(g, selectedHoleIndex);
		selectedHoleIndex = null;
		groups = groups;
		await tick();
		calculateGroupResults(activeGroupIndex);
		redrawCanvas();
	}

	async function nudgeSelectedHolePx(dxI: number, dyI: number) {
		if (!scale || activeGroupIndex === -1 || selectedHoleIndex === null) return;
		const g = groups[activeGroupIndex];
		nudgeHoleInGroup(g, selectedHoleIndex, dxI, dyI, scale, imageBitmap ?? undefined);
		groups = groups;
		await tick();
		calculateGroupResults(activeGroupIndex);
		redrawCanvas();
	}

	// --- Zoom Controls ---
	function zoom(factor: number, cX?: number, cY?: number) {
		if (!imageBitmap || !canvasElement || !lastViewport) return;
		let zoomTargetImg: Point | null = null;
		if (cX !== undefined && cY !== undefined) {
			const dispCoords = getCanvasDisplayCoords({ clientX: cX, clientY: cY } as PointerEvent, canvasElement);
			if (dispCoords) zoomTargetImg = cvsToImg(dispCoords);
		}
		const result = calculateZoom(factor, viewScale, fitScaleValue, viewCenter, zoomTargetImg);
		viewScale = result.newScale;
		viewCenter = result.newCenter;
		clampView();
		redrawCanvas();
	}

	function resetZoomToFit() {
		const fit = calculateFitView(
			imageBitmap,
			canvasElement,
			canvasAreaElement?.clientHeight || canvasElement?.clientHeight || 0,
		);
		if (fit) {
			fitScaleValue = fit.fitScaleValue;
			viewScale = fit.viewScale;
			viewCenter = fit.viewCenter;
		}
	}

	function resetZoom() {
		if (!imageBitmap) return;
		resetZoomToFit();
		redrawCanvas();
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = -Math.sign(e.deltaY);
		zoom(delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR, e.clientX, e.clientY);
	}

	function enterScaleMode() {
		mode = 'scaling';
		refLineStart = null;
		refLineEnd = null;
		interaction.isDrawingRefLine = false;
		selectedHoleIndex = null;
		redrawCanvas();
	}

	function resetStateForNewImage() {
		scale = null;
		refLineStart = null;
		refLineEnd = null;
		if (imageBitmap) {
			imageBitmap.close();
			imageBitmap = null;
		}
		groups = [];
		activeGroupIndex = -1;
		nextGroupId = 0;
		selectedHoleIndex = null;
		interaction = createInitialInteractionState();
		viewScale = 1.0;
		viewCenter = { x: 0, y: 0 };
		lastViewport = null;
		mode = 'loading';
		fitScaleValue = 1.0;
	}

	function reset() {
		if (!confirm('Are you sure you want to start over? All current data will be lost.')) return;
		resetStateForNewImage();
		if (ctx && canvasElement) ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		if (imageUrl && imageUrl.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
		imageFile = null;
		imageUrl = null;
		ctx = null;
		if (fileInputEl) fileInputEl.value = '';
	}

	function handleDiameterChange() { if (scale) redrawCanvas(); }
	function handleResultUnitChange() { if (groups.some((g) => g.resultsValid)) redrawCanvas(); }
	function handleAngularUnitChange() { if (groups.some((g) => g.resultsValid)) redrawCanvas(); }
	function handleTargetDistanceChange() { groups.forEach((_, i) => calculateGroupResults(i)); }

	function handleReferenceInputChange() {
		if (refLineStart && refLineEnd) {
			applyScale();
		} else {
			scale = null;
			mode = 'scaling';
			groups.forEach((g) => {
				invalResults(g);
				g.infoBoxAnchorImage = null;
			});
			groups = groups;
			redrawCanvas();
		}
	}

	function handleExportJpeg() {
		exportJpeg({
			imageFile,
			imageBitmap,
			scale,
			refLineStart,
			refLineEnd,
			groups,
			activeGroupIndex,
			bulletDiameter,
			bulletDiameterUnit,
			referenceUnit,
			resultDisplayUnit,
			targetDistance,
			targetDistanceUnit,
			angularUnitDisplay,
			viewScale,
			appearance,
		});
	}

	function togglePanMode() {
		mode = mode === 'panning' ? (scale ? 'placingHoles' : 'scaling') : 'panning';
		selectedHoleIndex = null;
		redrawCanvas();
	}

	function setMode(newMode: Mode) {
		mode = newMode;
		if (newMode !== 'selectingHole') selectedHoleIndex = null;
		redrawCanvas();
	}

	$: if (imageUrl) {
		tick().then(() => setupResizeObserver());
	} else {
		cleanupResizeObserver();
	}

	$: activeGroup = activeGroupIndex !== -1 && activeGroupIndex < groups.length ? groups[activeGroupIndex] : null;
	$: canvasCursor = computeCanvasCursor(interaction, mode);
</script>

<div
	class="flex flex-col items-center font-sans p-0 text-base-content w-[calc(100vw-17px)] h-[calc(100vh-4em)] overflow-x-hidden"
>
	<div class="flex flex-col lg:flex-row w-full p-2 lg:p-4 gap-3 lg:gap-4 flex-grow min-h-0">
		<div class="flex flex-col gap-2 lg:gap-3 lg:flex-[3] lg:order-1 lg:h-full min-h-[80vh] w-full">
			<ImageHeader
				bind:fileInputEl
				hasImage={!!imageBitmap}
				onFileSelect={handleFileSelect}
				onExportJpeg={handleExportJpeg}
			/>

			{#if imageUrl}
				<CanvasToolbar
					hasImage={!!imageBitmap}
					{viewScale}
					{fitScaleValue}
					{mode}
					{scale}
					onZoomIn={(e) => zoom(ZOOM_FACTOR, e?.clientX, e?.clientY)}
					onZoomOut={(e) => zoom(1 / ZOOM_FACTOR, e?.clientX, e?.clientY)}
					onResetZoom={resetZoom}
					onTogglePan={togglePanMode}
					onSelectMode={setMode}
				/>

				<CanvasArea
					bind:canvasElement
					bind:canvasAreaElement
					{mode}
					{selectedHoleIndex}
					{canvasCursor}
					onPointerDown={handleCanvasPointerDown}
					onClick={handleCanvasClick}
					onWheel={handleWheel}
					onNudgeKey={handleNudgeKey}
					onDeleteHole={deleteSelectedHole}
				/>
			{:else if mode !== 'loading'}
				<EmptyState />
			{/if}
		</div>

		{#if imageUrl}
			<Sidebar
				hasImage={!!imageBitmap}
				{mode}
				bind:referenceLength
				bind:referenceUnit
				bind:targetDistance
				bind:targetDistanceUnit
				bind:bulletDiameter
				bind:bulletDiameterUnit
				bind:resultDisplayUnit
				bind:angularUnitDisplay
				{groups}
				{activeGroupIndex}
				{activeGroup}
				bind:appearance
				onReferenceInputChange={handleReferenceInputChange}
				onEnterScaleMode={enterScaleMode}
				onTargetDistanceChange={handleTargetDistanceChange}
				onDiameterChange={handleDiameterChange}
				onResultUnitChange={handleResultUnitChange}
				onAngularUnitChange={handleAngularUnitChange}
				onSwitchGroup={switchToGroup}
				onDeleteGroup={deleteGroup}
				onAddNewGroup={addNewGroup}
				onGroupNameInput={redrawCanvas}
				onRedraw={redrawCanvas}
			/>
		{/if}
	</div>
</div>
