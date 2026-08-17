<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import type {
		Point,
		Rect,
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
		NUDGE_AMOUNT_DISPLAY_PIXELS,
		ZOOM_FACTOR,
		MIN_ZOOM,
		MAX_ZOOM,
		MIN_SCALE_LINE_PIXELS,
		MAX_BUFFER_DIM,
	} from './Group/constants';
	import {
		isPointInRect,
		calculateGroupResults as calcGroupResults,
		invalidateResults as invalResults,
	} from './Group/calculations';
	import {
		calculateViewport,
		imageToCanvasCoords,
		canvasToImageCoords,
		renderMainCanvas,
		exportCanvasAsJpeg as exportJpeg,
	} from './Group/canvasRenderer';

	import ImageHeader from './Group/ImageHeader.svelte';
	import CanvasToolbar from './Group/CanvasToolbar.svelte';
	import NudgeControls from './Group/NudgeControls.svelte';
	import GroupSettings from './Group/GroupSettings.svelte';
	import AppearanceSettings from './Group/AppearanceSettings.svelte';

	// --- State Variables  ---
	let imageFile: File | null = null;
	let imageUrl: string | null = null;
	let canvasElement: HTMLCanvasElement | undefined;
	let canvasAreaElement: HTMLDivElement | undefined;
	let ctx: CanvasRenderingContext2D | null = null;
	let imageBitmap: ImageBitmap | null = null;
	let mode: Mode = 'loading';
	let scale: number | null = null; // pixels per referenceUnit
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
	let isDrawingRefLine: boolean = false;
	let viewScale: number = 1.0;
	let viewCenter: Point = { x: 0, y: 0 };
	let lastViewport: ViewportState | null = null;
	let isPanning: boolean = false;
	let panStartPointerCoords: Point | null = null;
	let panStartViewCenter: Point | null = null;
	let groups: ShotGroup[] = [];
	let activeGroupIndex: number = -1;
	let nextGroupId = 0;
	let selectedHoleIndex: number | null = null;
	let isDraggingInfoBox: boolean = false;
	let draggingGroupIndex: number | null = null;
	let dragStartPointerCoords: Point | null = null;
	let dragStartInfoBoxAnchorImage: Point | null = null;
	let ignoreNextClick: boolean = false;
	let fileInputEl: HTMLInputElement | undefined;
	let controlsColumnEl: HTMLDivElement | undefined;
	let dpr = 1;
	let fitScaleValue: number = 1.0;
	let letterboxParams: LetterboxParams = { dx: 0, dy: 0, dWidth: 0, dHeight: 0 };
	let observer: ResizeObserver | null = null;
	let isDraggingHole: boolean = false;
	let draggingHoleStartCoords: Point | null = null;

	// --- Style State Variables  ---
	let appearance: AppearanceSettingsType = {
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
	};

	// --- Lifecycle & Setup  ---
	onMount(() => {
		dpr = window.devicePixelRatio || 1;

		window.addEventListener('pointermove', handleWindowPointerMove);
		window.addEventListener('pointerup', handleWindowPointerUp);
		window.addEventListener('keydown', handleKeyDown);
	});
	onDestroy(() => {
		// Cleanup global listeners
		window.removeEventListener('pointermove', handleWindowPointerMove);
		window.removeEventListener('pointerup', handleWindowPointerUp);
		window.removeEventListener('keydown', handleKeyDown);

		// Cleanup observer on component destroy
		cleanupResizeObserver();

		// Cleanup image object URL and bitmap
		if (imageUrl && imageUrl.startsWith('blob:'))
			URL.revokeObjectURL(imageUrl);
		if (imageBitmap) imageBitmap.close();
		imageBitmap = null;
	});
	function cleanupResizeObserver() {
		if (observer && canvasAreaElement) {
			observer.unobserve(canvasAreaElement);
		}
		observer = null;
	}
	function setupResizeObserver() {
		if (!canvasAreaElement) return;
		cleanupResizeObserver();
		observer = new ResizeObserver(handleResize);
		observer.observe(canvasAreaElement);
		handleResize();
	}

	// --- handleResize  ---
	function handleResize() {
		if (!canvasElement || !canvasAreaElement) return;
		const displayWidth = canvasAreaElement.clientWidth;
		const displayHeight = canvasAreaElement.clientHeight;

		if (displayWidth <= 0 || displayHeight <= 0) return;

		let targetBufferWidth = displayWidth * dpr;
		let targetBufferHeight = displayHeight * dpr;

		if (
			targetBufferWidth > MAX_BUFFER_DIM ||
			targetBufferHeight > MAX_BUFFER_DIM
		) {
			const ratioW = MAX_BUFFER_DIM / targetBufferWidth;
			const ratioH = MAX_BUFFER_DIM / targetBufferHeight;
			const ratio = Math.min(ratioW, ratioH);

			targetBufferWidth = Math.round(targetBufferWidth * ratio);
			targetBufferHeight = Math.round(targetBufferHeight * ratio);
		}

		targetBufferWidth = Math.max(1, targetBufferWidth);
		targetBufferHeight = Math.max(1, targetBufferHeight);

		if (
			canvasElement.width !== targetBufferWidth ||
			canvasElement.height !== targetBufferHeight
		) {
			canvasElement.width = targetBufferWidth;
			canvasElement.height = targetBufferHeight;
			if (imageBitmap) {
				resetZoomToFit();
				redrawCanvas();
			}
		}
	}

	// --- setupCanvas  ---
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
				if (
					!canvasElement ||
					!ctx ||
					!imageBitmap ||
					!canvasAreaElement
				)
					return;
				const logicalWidth = imageBitmap.width;
				const logicalHeight = imageBitmap.height;
				const displayWidth = canvasAreaElement.clientWidth;
				const displayHeight = canvasAreaElement.clientHeight;
				if (displayWidth <= 0 || displayHeight <= 0) return;
				let bufferWidth = displayWidth * dpr;
				let bufferHeight = displayHeight * dpr;
				if (
					bufferWidth > MAX_BUFFER_DIM ||
					bufferHeight > MAX_BUFFER_DIM
				) {
					const ratioW = MAX_BUFFER_DIM / bufferWidth;
					const ratioH = MAX_BUFFER_DIM / bufferHeight;
					const ratio = Math.min(ratioW, ratioH);
					bufferWidth = Math.round(bufferWidth * ratio);
					if (ratioW < ratioH)
						bufferHeight = Math.round(
							bufferWidth / (displayWidth / displayHeight),
						);
					else
						bufferWidth = Math.round(
							bufferHeight * (displayWidth / displayHeight),
						);
				}
				bufferWidth = Math.max(1, bufferWidth);
				bufferHeight = Math.max(1, bufferHeight);
				canvasElement.width = bufferWidth;
				canvasElement.height = bufferHeight;
				viewCenter = { x: logicalWidth / 2, y: logicalHeight / 2 };
				viewScale = 1.0;
				lastViewport = null;
				if (groups.length === 0) addNewGroup();
				requestAnimationFrame(() => {
					if (!canvasElement || !imageBitmap || !canvasAreaElement)
						return;
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

	// --- redrawCanvas ---
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
		});
		if (result) {
			lastViewport = result.viewport;
			letterboxParams = result.letterbox;
		}
	}

	// --- Event Handlers ---
	function getCanvasDisplayCoords(
		e: MouseEvent | PointerEvent,
	): Point | null {
		if (!canvasElement) return null;
		const r = canvasElement.getBoundingClientRect();
		if (!r.width || !r.height) return null;
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function imgToCvs(p: Point): Point | null {
		return imageToCanvasCoords(p, lastViewport, canvasElement, letterboxParams);
	}

	function cvsToImg(p: Point): Point | null {
		return canvasToImageCoords(p, lastViewport, canvasElement, letterboxParams, imageBitmap);
	}

	function handleFileSelect(e: Event) {
		const t = e.target as HTMLInputElement;
		const f = t.files?.[0];
		if (f && f.type.startsWith('image/')) {
			imageFile = f;
			if (imageUrl && imageUrl.startsWith('blob:'))
				URL.revokeObjectURL(imageUrl);
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

		const dCoords = getCanvasDisplayCoords(e);
		if (!dCoords) return;

		const iCoords = cvsToImg(dCoords);
		if (!iCoords) return;

		isDraggingInfoBox = false;
		isPanning = false;
		isDraggingHole = false;

		// Check info box drag first
		for (let i = groups.length - 1; i >= 0; i--) {
			const g = groups[i];
			if (
				g.resultsValid &&
				g.infoBoxAnchorImage &&
				g.infoBoxSize &&
				canvasElement.width > 0 &&
				canvasElement.height > 0 &&
				canvasElement.clientWidth > 0 &&
				canvasElement.clientHeight > 0
			) {
				const aImg = g.infoBoxAnchorImage;
				const sLog = g.infoBoxSize;
				const aCvsRender = imgToCvs(aImg);
				if (aCvsRender) {
					const boxRenderWidth = sLog.width * dpr;
					const boxRenderHeight = sLog.height * dpr;
					const displayX =
						(aCvsRender.x / canvasElement.width) *
						canvasElement.clientWidth;
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
					if (isPointInRect(dCoords, displayRect)) {
						isDraggingInfoBox = true;
						draggingGroupIndex = i;
						dragStartPointerCoords = dCoords;
						dragStartInfoBoxAnchorImage = { ...aImg };
						(e.target as HTMLElement).setPointerCapture(
							e.pointerId,
						);
						e.stopPropagation();
						return;
					}
				}
			}
		}

		// Hole dragging
		if (mode === 'selectingHole' && selectedHoleIndex !== null && scale) {
			const g = groups[activeGroupIndex];
			if (g && selectedHoleIndex < g.bulletHolesPixels.length) {
				const selectedHolePx = g.bulletHolesPixels[selectedHoleIndex];

				const clickToleranceRenderPixels = 15 * dpr;
				const clickToleranceImagePixels =
					lastViewport.sWidth > 0 && canvasElement.width > 0
						? (clickToleranceRenderPixels / canvasElement.width) *
							lastViewport.sWidth
						: 5;
				const clickToleranceImagePixelsSq =
					clickToleranceImagePixels * clickToleranceImagePixels;

				const dx = iCoords.x - selectedHolePx.x;
				const dy = iCoords.y - selectedHolePx.y;
				const distSq = dx * dx + dy * dy;

				if (distSq <= clickToleranceImagePixelsSq) {
					isDraggingHole = true;
					draggingHoleStartCoords = { ...iCoords };

					(e.target as HTMLElement).setPointerCapture(e.pointerId);
					canvasElement.style.cursor = 'grabbing';
					e.stopPropagation();
					return;
				}
			}
		}

		// Check panning or drawing ref line
		if (mode === 'panning') {
			isPanning = true;
			panStartPointerCoords = dCoords;
			panStartViewCenter = { ...viewCenter };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			canvasElement.style.cursor = 'grabbing';
			e.stopPropagation();
			return;
		}

		if (mode === 'scaling' && iCoords) {
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			isDrawingRefLine = true;
			refLineStart = iCoords;
			refLineEnd = iCoords;
			redrawCanvas();
			e.stopPropagation();
			return;
		}
	}

	function handleWindowPointerMove(e: PointerEvent) {
		if (
			!canvasElement ||
			!lastViewport ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight ||
			canvasElement.clientWidth <= 0 ||
			canvasElement.clientHeight <= 0
		)
			return;
		const curPtrD = getCanvasDisplayCoords(e);
		if (!curPtrD) return;
		// Panning
		if (
			isPanning &&
			panStartPointerCoords &&
			panStartViewCenter &&
			canvasElement.hasPointerCapture(e.pointerId)
		) {
			const dxD = curPtrD.x - panStartPointerCoords.x;
			const dyD = curPtrD.y - panStartPointerCoords.y;
			const dxI = (dxD / canvasElement.clientWidth) * lastViewport.sWidth;
			const dyI =
				(dyD / canvasElement.clientHeight) * lastViewport.sHeight;
			viewCenter.x = panStartViewCenter.x - dxI;
			viewCenter.y = panStartViewCenter.y - dyI;
			clampViewCenter();
			requestAnimationFrame(redrawCanvas);
		} else if (
			isDraggingInfoBox &&
			draggingGroupIndex !== null &&
			dragStartPointerCoords &&
			dragStartInfoBoxAnchorImage &&
			canvasElement?.hasPointerCapture(e.pointerId)
		) {
			const curPtrD = getCanvasDisplayCoords(e);
			if (!curPtrD) return;

			const startPtrI = cvsToImg(dragStartPointerCoords);
			const curPtrI = cvsToImg(curPtrD);

			if (startPtrI && curPtrI) {
				const dxI = curPtrI.x - startPtrI.x;
				const dyI = curPtrI.y - startPtrI.y;

				const g = groups[draggingGroupIndex];
				if (g) {
					g.infoBoxAnchorImage = {
						x: dragStartInfoBoxAnchorImage.x + dxI,
						y: dragStartInfoBoxAnchorImage.y + dyI,
					};
					groups = groups;
					requestAnimationFrame(redrawCanvas);
				}
			}
		}
		// Hole dragging
		else if (isDraggingHole && selectedHoleIndex !== null && scale) {
			const curPtrI = cvsToImg(curPtrD);
			if (curPtrI && activeGroupIndex !== -1) {
				const g = groups[activeGroupIndex];
				if (g && selectedHoleIndex < g.bulletHolesPixels.length) {
					const holePx = g.bulletHolesPixels[selectedHoleIndex];
					const holeRl = g.bulletHolesReal[selectedHoleIndex];

					holePx.x = curPtrI.x;
					holePx.y = curPtrI.y;

					if (imageBitmap) {
						holePx.x = Math.max(
							0,
							Math.min(holePx.x, imageBitmap.width),
						);
						holePx.y = Math.max(
							0,
							Math.min(holePx.y, imageBitmap.height),
						);
					}

					holeRl.x = holePx.x / scale;
					holeRl.y = holePx.y / scale;

					invalResults(g);
					groups = groups;
					requestAnimationFrame(redrawCanvas);
				}
			}
		}
		// Scaling Line Drawing
		else if (
			mode === 'scaling' &&
			isDrawingRefLine &&
			refLineStart &&
			canvasElement.hasPointerCapture(e.pointerId)
		) {
			const curPtrI = cvsToImg(curPtrD);
			if (curPtrI) {
				refLineEnd = curPtrI;
				requestAnimationFrame(redrawCanvas);
			}
		}
	}

	function handleWindowPointerUp(e: PointerEvent) {
		let wasDragging = isPanning || isDraggingInfoBox || isDraggingHole;
		// Panning End
		if (isPanning && canvasElement?.hasPointerCapture(e.pointerId)) {
			canvasElement.releasePointerCapture(e.pointerId);
			isPanning = false;
			panStartPointerCoords = null;
			panStartViewCenter = null;
			if (canvasElement) canvasElement.style.cursor = canvasCursor;
			wasDragging = true;
		}
		// Info Box Drag End
		else if (
			isDraggingInfoBox &&
			canvasElement?.hasPointerCapture(e.pointerId)
		) {
			canvasElement.releasePointerCapture(e.pointerId);
			isDraggingInfoBox = false;
			draggingGroupIndex = null;
			dragStartPointerCoords = null;
			dragStartInfoBoxAnchorImage = null;
			wasDragging = true;
			redrawCanvas();
		}
		// Hole Drag End
		else if (
			isDraggingHole &&
			canvasElement?.hasPointerCapture(e.pointerId)
		) {
			canvasElement.releasePointerCapture(e.pointerId);
			isDraggingHole = false;
			draggingHoleStartCoords = null;
			if (canvasElement) canvasElement.style.cursor = canvasCursor;

			if (activeGroupIndex !== -1) {
				calculateGroupResults(activeGroupIndex);
			}
			redrawCanvas();
		}
		// Scaling Line Draw End
		else if (
			mode === 'scaling' &&
			isDrawingRefLine &&
			canvasElement?.hasPointerCapture(e.pointerId)
		) {
			canvasElement.releasePointerCapture(e.pointerId);
			isDrawingRefLine = false;
			const finalPtrD = getCanvasDisplayCoords(e);
			if (finalPtrD) {
				const finalI = cvsToImg(finalPtrD);
				if (finalI) refLineEnd = finalI;
			}
			if (refLineStart && refLineEnd) {
				if (calculateScale()) mode = 'placingHoles';
				else {
					refLineStart = null;
					refLineEnd = null;
				}
			} else {
				refLineStart = null;
				refLineEnd = null;
			}
			wasDragging = true;
			redrawCanvas();
		}
		// Prevent click after drag/draw
		if (wasDragging) {
			ignoreNextClick = true;
			setTimeout(() => {
				ignoreNextClick = false;
			}, 50);
		}

		// Reset flags just in case pointer capture was lost
		isPanning = false;
		isDraggingInfoBox = false;
		isDraggingHole = false;
		isDrawingRefLine = false;
		panStartPointerCoords = null;
		panStartViewCenter = null;
		dragStartPointerCoords = null;
		dragStartInfoBoxAnchorImage = null;
		draggingHoleStartCoords = null;
		if (
			canvasElement &&
			!isPanning &&
			!isDraggingInfoBox &&
			!isDraggingHole
		) {
			canvasElement.style.cursor = canvasCursor;
		}
	}

	async function handleCanvasClick(e: MouseEvent) {
		if (ignoreNextClick) {
			ignoreNextClick = false;
			return;
		}
		if (
			isPanning ||
			isDrawingRefLine ||
			!canvasElement ||
			activeGroupIndex === -1
		)
			return;
		const dCoords = getCanvasDisplayCoords(e);
		if (!dCoords) return;
		const iCoords = cvsToImg(dCoords);
		if (!iCoords) return;
		const g = groups[activeGroupIndex];
		// Placing Holes
		if (mode === 'placingHoles' && scale) {
			const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale };
			g.bulletHolesPixels.push(iCoords);
			g.bulletHolesReal.push(rCoords);
			selectedHoleIndex = g.bulletHolesPixels.length - 1;
			invalResults(g);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			redrawCanvas();
		}
		// Placing Aim Point
		else if (mode === 'placingAim' && scale) {
			const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale };
			g.aimingPointPixels = iCoords;
			g.aimingPointReal = rCoords;
			invalResults(g);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			mode = 'placingHoles';
			redrawCanvas();
		}
		// Selecting Hole
		else if (mode === 'selectingHole') {
			if (
				!scale ||
				!lastViewport ||
				!canvasElement.width ||
				canvasElement.width <= 0
			)
				return;
			const clickToleranceRenderPixels = 15 * dpr;
			const clickToleranceImagePixels =
				(clickToleranceRenderPixels / canvasElement.width) *
				lastViewport.sWidth;
			const clickToleranceImagePixelsSq =
				clickToleranceImagePixels * clickToleranceImagePixels;
			let found = false;
			let closestIndex = -1;
			let minDistanceSq = Infinity;
			for (let i = g.bulletHolesPixels.length - 1; i >= 0; i--) {
				const h = g.bulletHolesPixels[i];
				const dx = iCoords.x - h.x;
				const dy = iCoords.y - h.y;
				const dSq = dx * dx + dy * dy;
				if (dSq < clickToleranceImagePixelsSq && dSq < minDistanceSq) {
					minDistanceSq = dSq;
					closestIndex = i;
					found = true;
				}
			}
			selectedHoleIndex = found ? closestIndex : null;
			redrawCanvas();
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (
			activeGroupIndex === -1 ||
			selectedHoleIndex === null ||
			!scale ||
			!lastViewport ||
			!canvasElement ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight ||
			canvasElement.clientWidth <= 0 ||
			canvasElement.clientHeight <= 0
		)
			return;
		let dxI = 0;
		let dyI = 0;
		const nudgeXImage =
			(NUDGE_AMOUNT_DISPLAY_PIXELS / canvasElement.clientWidth) *
			lastViewport.sWidth;
		const nudgeYImage =
			(NUDGE_AMOUNT_DISPLAY_PIXELS / canvasElement.clientHeight) *
			lastViewport.sHeight;
		switch (e.key) {
			case 'ArrowUp':
				dyI = -nudgeYImage;
				break;
			case 'ArrowDown':
				dyI = nudgeYImage;
				break;
			case 'ArrowLeft':
				dxI = -nudgeXImage;
				break;
			case 'ArrowRight':
				dxI = nudgeXImage;
				break;
			case 'Delete':
			case 'Backspace':
				e.preventDefault();
				deleteSelectedHole();
				return;
			default:
				return;
		}
		e.preventDefault();
		nudgeSelectedHolePx(dxI, dyI);
	}

	function handleNudgeKey(key: string) {
		handleKeyDown({
			key,
			preventDefault: () => {},
		} as KeyboardEvent);
	}

	// --- Logic ---
	function calculateScale(): boolean {
		if (
			!refLineStart ||
			!refLineEnd ||
			!referenceLength ||
			referenceLength <= 0
		) {
			scale = null;
			return false;
		}
		const dx = refLineEnd.x - refLineStart.x;
		const dy = refLineEnd.y - refLineStart.y;
		const lenPx = Math.sqrt(dx * dx + dy * dy);
		if (lenPx < MIN_SCALE_LINE_PIXELS) {
			alert(`Ref line too short (>= ${MIN_SCALE_LINE_PIXELS}px)`);
			scale = null;
			refLineStart = null;
			refLineEnd = null;
			return false;
		}
		scale = lenPx / referenceLength; // pixels per referenceUnit
		groups.forEach((g) => {
			g.bulletHolesReal = g.bulletHolesPixels.map((p) => ({
				x: p.x / scale!,
				y: p.y / scale!,
			}));
			g.aimingPointReal = g.aimingPointPixels
				? {
						x: g.aimingPointPixels.x / scale!,
						y: g.aimingPointPixels.y / scale!,
					}
				: null;
			invalResults(g);
			g.infoBoxAnchorImage = null; // Reset info box anchor
		});
		groups = groups;
		tick().then(() => {
			groups.forEach((_, i) => calculateGroupResults(i));
			redrawCanvas();
		});
		console.log(`Scale set: ${scale.toFixed(3)} pixels/${referenceUnit}`);
		return true;
	}

	function calculateGroupResults(idx: number) {
		if (idx < 0 || idx >= groups.length || !scale) return;
		calcGroupResults(
			groups[idx],
			scale,
			targetDistance,
			targetDistanceUnit,
			referenceUnit,
		);
		groups = groups;
		redrawCanvas();
	}

	// --- Group Management  ---
	function addNewGroup() {
		const nG: ShotGroup = {
			id: nextGroupId++,
			name: `Group ${nextGroupId}`,
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
		groups = [...groups, nG];
		activeGroupIndex = groups.length - 1;
		selectedHoleIndex = null;
		if (!imageBitmap) mode = 'loading';
		else if (!scale) mode = 'scaling';
		else mode = 'placingHoles';
		redrawCanvas();
	}

	function switchToGroup(idx: number) {
		if (idx >= 0 && idx < groups.length && idx !== activeGroupIndex) {
			activeGroupIndex = idx;
			selectedHoleIndex = null;
			if (!imageBitmap) mode = 'loading';
			else if (!scale) mode = 'scaling';
			else mode = 'placingHoles';
			redrawCanvas();
		}
	}

	async function deleteGroup(idx: number) {
		if (idx < 0 || idx >= groups.length) return;
		const gName = groups[idx]?.name ?? `Group ${idx + 1}`;
		if (
			!confirm(
				`Are you sure you want to delete ${gName}? This cannot be undone.`,
			)
		)
			return;
		groups.splice(idx, 1);
		if (groups.length === 0) {
			activeGroupIndex = -1;
			addNewGroup();
		} else {
			if (activeGroupIndex === idx)
				activeGroupIndex = Math.max(0, idx - 1);
			else if (activeGroupIndex > idx) activeGroupIndex--;
			if (activeGroupIndex >= groups.length)
				activeGroupIndex = groups.length - 1;
			groups = groups;
			await tick();
			redrawCanvas();
		}
	}

	// --- Point Deletion  ---
	async function deleteSelectedHole() {
		if (activeGroupIndex === -1 || selectedHoleIndex === null) return;
		const g = groups[activeGroupIndex];
		if (
			selectedHoleIndex < 0 ||
			selectedHoleIndex >= g.bulletHolesPixels.length
		) {
			selectedHoleIndex = null;
			return;
		}
		g.bulletHolesPixels.splice(selectedHoleIndex, 1);
		g.bulletHolesReal.splice(selectedHoleIndex, 1);
		selectedHoleIndex = null;
		invalResults(g);
		groups = groups;
		await tick();
		calculateGroupResults(activeGroupIndex);
		redrawCanvas();
	}

	// --- Nudging  ---
	async function nudgeSelectedHolePx(dxI: number, dyI: number) {
		if (
			scale &&
			activeGroupIndex !== -1 &&
			selectedHoleIndex !== null &&
			selectedHoleIndex >= 0 &&
			selectedHoleIndex <
				groups[activeGroupIndex].bulletHolesPixels.length
		) {
			const g = groups[activeGroupIndex];
			const hPx = g.bulletHolesPixels[selectedHoleIndex];
			hPx.x += dxI;
			hPx.y += dyI;
			if (imageBitmap) {
				hPx.x = Math.max(0, Math.min(hPx.x, imageBitmap.width));
				hPx.y = Math.max(0, Math.min(hPx.y, imageBitmap.height));
			}
			if (selectedHoleIndex < g.bulletHolesReal.length) {
				const hRl = g.bulletHolesReal[selectedHoleIndex];
				hRl.x = hPx.x / scale;
				hRl.y = hPx.y / scale;
			}
			invalResults(g);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			redrawCanvas();
		}
	}

	// --- Zoom Controls  ---
	function zoom(factor: number, cX?: number, cY?: number) {
		if (
			!imageBitmap ||
			!canvasElement ||
			!lastViewport ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight ||
			canvasElement.clientWidth <= 0 ||
			canvasElement.clientHeight <= 0
		)
			return;
		const currentScale = viewScale;
		let newScale = Math.max(
			MIN_ZOOM,
			Math.min(MAX_ZOOM, currentScale * factor),
		);
		if (newScale < fitScaleValue) newScale = fitScaleValue;
		if (newScale === currentScale) return;
		let zoomCenterX = viewCenter.x;
		let zoomCenterY = viewCenter.y;
		if (cX !== undefined && cY !== undefined) {
			const displayCoords = getCanvasDisplayCoords({
				clientX: cX,
				clientY: cY,
			} as PointerEvent);
			if (displayCoords) {
				const imageCoords = cvsToImg(displayCoords);
				if (imageCoords) {
					zoomCenterX = imageCoords.x;
					zoomCenterY = imageCoords.y;
				}
			}
		}
		viewCenter.x =
			zoomCenterX -
			(zoomCenterX - viewCenter.x) * (currentScale / newScale);
		viewCenter.y =
			zoomCenterY -
			(zoomCenterY - viewCenter.y) * (currentScale / newScale);
		viewScale = newScale;
		clampViewCenter();
		redrawCanvas();
	}
	function zoomIn(e?: MouseEvent) {
		zoom(ZOOM_FACTOR, e?.clientX, e?.clientY);
	}
	function zoomOut(e?: MouseEvent) {
		zoom(1 / ZOOM_FACTOR, e?.clientX, e?.clientY);
	}
	function resetZoomToFit() {
		if (
			!imageBitmap ||
			!canvasElement ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight
		)
			return;
		const imgW = imageBitmap.width;
		const imgH = imageBitmap.height;
		const displayW = canvasElement.clientWidth;
		const displayHeight = canvasAreaElement?.clientHeight || canvasElement.clientHeight;
		const displayH = canvasElement.clientHeight;
		fitScaleValue = 1.0;
		if (imgW > 0 && imgH > 0 && displayW > 0 && displayH > 0)
			fitScaleValue = Math.min(displayW / imgW, displayH / imgH);
		else fitScaleValue = MIN_ZOOM;
		fitScaleValue = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScaleValue));
		viewScale = fitScaleValue;
		viewCenter = { x: imgW / 2, y: imgH / 2 };
		clampViewCenter();
	}
	function resetZoom() {
		if (!imageBitmap) return;
		resetZoomToFit();
		redrawCanvas();
	}
	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = -Math.sign(e.deltaY);
		const factor = delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
		zoom(factor, e.clientX, e.clientY);
	}

	// --- Scale Controls  ---
	function enterScaleMode() {
		mode = 'scaling';
		refLineStart = null;
		refLineEnd = null;
		isDrawingRefLine = false;
		selectedHoleIndex = null;
		redrawCanvas();
	}

	// --- View Clamping  ---
	function clampViewCenter() {
		if (
			!imageBitmap ||
			!canvasElement ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight ||
			viewScale <= 0
		)
			return;
		const imgW = imageBitmap.width;
		const imgH = imageBitmap.height;
		const viewportWidthImg = canvasElement.clientWidth / viewScale;
		const viewportHeightImg = canvasElement.clientHeight / viewScale;
		const minX = viewportWidthImg / 2;
		const maxX = imgW - viewportWidthImg / 2;
		const minY = viewportHeightImg / 2;
		const maxY = imgH - viewportHeightImg / 2;
		if (maxX >= minX)
			viewCenter.x = Math.max(minX, Math.min(viewCenter.x, maxX));
		else viewCenter.x = imgW / 2;
		if (maxY >= minY)
			viewCenter.y = Math.max(minY, Math.min(viewCenter.y, maxY));
		else viewCenter.y = imgH / 2;
	}

	// --- Utility  ---
	function resetStateForNewImage() {
		scale = null;
		refLineStart = null;
		refLineEnd = null;
		isDrawingRefLine = false;
		if (imageBitmap) {
			imageBitmap.close();
			imageBitmap = null;
		}
		groups = [];
		activeGroupIndex = -1;
		nextGroupId = 0;
		selectedHoleIndex = null;
		isDraggingInfoBox = false;
		draggingGroupIndex = null;
		dragStartPointerCoords = null;
		dragStartInfoBoxAnchorImage = null;
		ignoreNextClick = false;
		isPanning = false;
		panStartPointerCoords = null;
		panStartViewCenter = null;
		viewScale = 1.0;
		viewCenter = { x: 0, y: 0 };
		lastViewport = null;
		mode = 'loading';
		fitScaleValue = 1.0;
	}
	function reset() {
		if (
			!confirm(
				'Are you sure you want to start over? All current data will be lost.',
			)
		)
			return;
		resetStateForNewImage();
		if (ctx && canvasElement)
			ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		if (imageUrl && imageUrl.startsWith('blob:'))
			URL.revokeObjectURL(imageUrl);
		imageFile = null;
		imageUrl = null;
		ctx = null;
		if (fileInputEl) fileInputEl.value = '';
	}

	// --- Input Handlers ---
	function handleDiameterChange() {
		if (scale) redrawCanvas();
	}
	function handleResultUnitChange() {
		if (groups.some((g) => g.resultsValid)) redrawCanvas();
	}
	function handleAngularUnitChange() {
		if (groups.some((g) => g.resultsValid)) redrawCanvas();
	}
	function handleTargetDistanceChange() {
		groups.forEach((_, i) => calculateGroupResults(i));
	}
	function handleReferenceInputChange() {
		if (refLineStart && refLineEnd)
			calculateScale();
		else {
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
		mode =
			mode === 'panning'
				? scale
					? 'placingHoles'
					: 'scaling'
				: 'panning';
		selectedHoleIndex = null;
		redrawCanvas();
	}

	function setMode(newMode: Mode) {
		mode = newMode;
		if (newMode !== 'selectingHole') {
			selectedHoleIndex = null;
		}
		redrawCanvas();
	}

	// --- Reactive statement for Observer based on imageUrl ---
	$: if (imageUrl) {
		tick().then(() => {
			setupResizeObserver();
		});
	} else {
		cleanupResizeObserver();
	}

	// Reactive derivations
	$: activeGroup =
		activeGroupIndex !== -1 && activeGroupIndex < groups.length
			? groups[activeGroupIndex]
			: null;
	$: canvasCursor = isPanning
		? 'grabbing'
		: isDraggingInfoBox
			? 'move'
			: isDraggingHole
				? 'grabbing'
				: mode === 'panning'
					? 'grab'
					: mode === 'scaling'
						? 'crosshair'
						: mode === 'placingHoles'
							? 'copy'
							: mode === 'placingAim'
								? 'crosshair'
								: mode === 'selectingHole'
									? 'pointer'
									: 'default';
</script>

<div
	class="flex flex-col items-center font-sans p-0 text-base-content w-[calc(100vw-17px)] h-[calc(100vh-4em)] overflow-x-hidden"
>
	<div
		class="flex flex-col lg:flex-row w-full p-2 lg:p-4 gap-3 lg:gap-4 flex-grow min-h-0"
	>
		<div
			class="flex flex-col gap-2 lg:gap-3 lg:flex-[3] lg:order-1 lg:h-full min-h-[80vh] w-full"
		>
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
					onZoomIn={zoomIn}
					onZoomOut={zoomOut}
					onResetZoom={resetZoom}
					onTogglePan={togglePanMode}
					onSelectMode={setMode}
				/>

				<div
					class="relative w-full flex-grow flex justify-center items-center lg:min-h-0 max-h-[70vh] lg:max-h-full"
				>
					<div
						class="w-full h-full overflow-hidden border border-base-300 bg-base-200 flex justify-center items-center"
						on:wheel={handleWheel}
						bind:this={canvasAreaElement}
					>
						<canvas
							bind:this={canvasElement}
							on:pointerdown={handleCanvasPointerDown}
							on:click={handleCanvasClick}
							class="block touch-none w-full h-full"
							style:cursor={canvasCursor}
							style:image-rendering="smooth"
						>
						</canvas>
					</div>

					{#if mode === 'selectingHole' && selectedHoleIndex !== null}
						<NudgeControls
							onNudgeKey={handleNudgeKey}
							onDeleteHole={deleteSelectedHole}
						/>
					{/if}
				</div>
			{:else if mode !== 'loading'}
				<div
					class="flex justify-center items-center flex-grow min-h-[200px] w-full bg-base-100 border border-dashed border-base-300 rounded-lg p-5"
				>
					<div
						class="alert alert-info shadow-lg max-w-md text-center"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							class="stroke-current shrink-0 w-6 h-6"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							></path></svg
						>
						<span>Load an image to start analysis.</span>
					</div>
				</div>
			{/if}
		</div>

		<div
			class="flex flex-col gap-3 lg:flex-1 lg:max-w-sm lg:order-2 lg:h-full lg:overflow-y-auto lg:pr-1 min-h-0 w-full"
			bind:this={controlsColumnEl}
		>
			{#if imageUrl}
				<GroupSettings
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
				/>

				<AppearanceSettings
					bind:appearance
					onRedraw={redrawCanvas}
				/>
			{/if}
		</div>
	</div>
</div>
