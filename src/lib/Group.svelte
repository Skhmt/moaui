<script lang="ts">
	import { onMount, onDestroy, tick } from "svelte";
	import * as moa from "@moa/moa"; // Assuming moa.txt is renamed/served as moa.mjs

	// --- Kept Constants ---
	const NUDGE_AMOUNT_DISPLAY_PIXELS = 2;
	const ZOOM_FACTOR = 1.2;
	const MIN_ZOOM = 0.01;
	const MAX_ZOOM = 20.0;
	const MIN_SCALE_LINE_PIXELS = 5;
	const MAX_BUFFER_DIM = 4096;

	// --- Type Definitions  ---
	interface Point {
		x: number;
		y: number;
	}
	interface RealPoint {
		x: number;
		y: number;
	} // Stores values in referenceUnit
	interface Rect {
		x: number;
		y: number;
		width: number;
		height: number;
	}
	interface ViewportState {
		sx: number;
		sy: number;
		sWidth: number;
		sHeight: number;
	}
	interface ShotGroup {
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
	type Mode =
		| "loading"
		| "scaling"
		| "placingHoles"
		| "placingAim"
		| "selectingHole"
		| "panning";
	type LinearUnit = "inches" | "cm" | "mm" | "meters" | "yards"; // Keep broader type for flexibility
	type DistanceUnit = "yards" | "meters";
	type DiameterUnit = "inches" | "mm";
	type AngularUnitDisplay = "moa" | "mrad" | "none";

	// --- State Variables  ---
	let imageFile: File | null = null;
	let imageUrl: string | null = null;
	let canvasElement: HTMLCanvasElement | undefined;
	let canvasAreaElement: HTMLDivElement | undefined;
	let ctx: CanvasRenderingContext2D | null = null;
	let imageBitmap: ImageBitmap | null = null;
	let mode: Mode = "loading";
	let scale: number | null = null; // pixels per referenceUnit
	let referenceUnit: LinearUnit = "inches";
	let referenceLength: number = 1;
	let resultDisplayUnit: LinearUnit = "inches";
	let bulletDiameterUnit: DiameterUnit = "inches";
	let targetDistanceUnit: DistanceUnit = "yards";
	let angularUnitDisplay: AngularUnitDisplay = "moa";
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
	let letterboxParams = { dx: 0, dy: 0, dWidth: 0, dHeight: 0 };
	let showGroupNameInLegend: boolean = true;
	let observer: ResizeObserver | null = null;
	let isDraggingHole: boolean = false;
	let draggingHoleStartCoords: Point | null = null;

	// --- Style State Variables  ---
	let legendFontSize: number = 12;
	let legendTextColor: string = "#e0e0e0";
	let legendBgColor: string = "#000000";
	let legendBorderColor: string = "#555555";
	let lineWidthBase: number = 2;
	let bulletHoleColor: string = "#FF4136";
	let inactiveBulletHoleColor: string = "rgba(255,65,54,0.7)";
	let selectedHoleColor: string = "#FFDC00";
	let selectedHoleLineWidthMultiplier: number = 2;
	let centroidColor: string = "#0074D9";
	let aimPointColor: string = "#FF851B";
	let offsetLineColor: string = "#00BFFF";
	let offsetLineWidthMultiplier: number = 0.8;
	let scaleLineColor: string = "#00FF00";
	let scaleLineWidth: number = 2;
	let scaleMarkerSize: number = 6;

	// --- Lifecycle & Setup  ---
	onMount(() => {
		dpr = window.devicePixelRatio || 1;

		window.addEventListener("pointermove", handleWindowPointerMove);
		window.addEventListener("pointerup", handleWindowPointerUp);
		window.addEventListener("keydown", handleKeyDown);
	});
	onDestroy(() => {
		// Cleanup global listeners
		window.removeEventListener("pointermove", handleWindowPointerMove);
		window.removeEventListener("pointerup", handleWindowPointerUp);
		window.removeEventListener("keydown", handleKeyDown);

		// --- Cleanup observer on component destroy ---
		cleanupResizeObserver();

		// Cleanup image object URL and bitmap
		if (imageUrl && imageUrl.startsWith("blob:"))
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
		// Ensure element exists before setting up
		if (!canvasAreaElement) return;

		// Cleanup previous observer just in case
		cleanupResizeObserver();

		observer = new ResizeObserver(handleResize);
		observer.observe(canvasAreaElement);
		// Call handleResize initially to set size based on current state
		handleResize();
	}

	// --- handleResize  ---
	function handleResize() {
		if (!canvasElement || !canvasAreaElement) return;
		const displayWidth = canvasAreaElement.clientWidth;
		const displayHeight = canvasAreaElement.clientHeight;

		if (displayWidth <= 0 || displayHeight <= 0) return; // Avoid division by zero

		let targetBufferWidth = displayWidth * dpr;
		let targetBufferHeight = displayHeight * dpr;

		// Check if buffer exceeds max dimensions and calculate scaling ratio if needed
		if (
			targetBufferWidth > MAX_BUFFER_DIM ||
			targetBufferHeight > MAX_BUFFER_DIM
		) {
			const ratioW = MAX_BUFFER_DIM / targetBufferWidth;
			const ratioH = MAX_BUFFER_DIM / targetBufferHeight;
			const ratio = Math.min(ratioW, ratioH); // Determine the limiting ratio

			// --- Correction Start ---
			// Scale BOTH dimensions by the same ratio to maintain aspect ratio
			targetBufferWidth = Math.round(targetBufferWidth * ratio);
			targetBufferHeight = Math.round(targetBufferHeight * ratio);
			// --- Correction End ---
		}

		// Ensure dimensions are at least 1 pixel
		targetBufferWidth = Math.max(1, targetBufferWidth);
		targetBufferHeight = Math.max(1, targetBufferHeight);

		// Only update canvas and redraw if the dimensions have actually changed
		if (
			canvasElement.width !== targetBufferWidth ||
			canvasElement.height !== targetBufferHeight
		) {
			canvasElement.width = targetBufferWidth;
			canvasElement.height = targetBufferHeight;
			if (imageBitmap) {
				// Important: Reset zoom/view after resize to fit the new canvas dimensions
				resetZoomToFit(); // This recalculates fitScaleValue and resets view
				redrawCanvas(); // Redraw everything with new dimensions and view
			}
		}
	}

	// --- setupCanvas  ---
	function setupCanvas(): void {
		if (!canvasElement || !imageUrl || !imageFile) return;
		const context = canvasElement.getContext("2d", { alpha: false });
		if (!context) {
			alert("Canvas init error.");
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
				mode = "scaling";
			})
			.catch((err) => {
				console.error("createImageBitmap error:", err);
				alert("Image load error.");
				reset();
			});
	}

	// --- Unit Conversion Helpers (Using moa library) ---
	// Helper to convert a value *from* meters *to* a target unit
	function metersToUnit(
		value: number,
		targetUnit: LinearUnit | DistanceUnit,
	): number {
		switch (targetUnit) {
			case "inches":
				return moa.m2in(value);
			case "cm":
				return moa.m2cm(value);
			case "mm":
				return moa.m2cm(value) * 10;
			case "meters":
				return value;
			case "yards":
				return moa.m2yd(value);
			default:
				return value; // Should not happen
		}
	}
	// Helper: Convert value from 'from' unit to 'to' unit via meters
	function convertUnits(
		value: number,
		from: LinearUnit | DistanceUnit | DiameterUnit,
		to: LinearUnit | DistanceUnit,
	): number {
		if (from === to) return value;
		let meters: number;
		switch (from) {
			case "inches":
				meters = moa.in2m(value);
				break;
			case "cm":
				meters = moa.cm2m(value);
				break;
			case "mm":
				meters = moa.cm2m(value / 10);
				break;
			case "yards":
				meters = moa.yd2m(value);
				break;
			case "meters":
				meters = value;
				break;
			default:
				meters = value; // Fallback for unknown DiameterUnit not covered above
		}
		return metersToUnit(meters, to);
	}

	// --- Coordinate Transformation  ---
	function imageToCanvasCoords(imgP: Point): Point | null {
		if (
			!lastViewport ||
			!canvasElement ||
			letterboxParams.dWidth <= 0 ||
			letterboxParams.dHeight <= 0
		)
			return null;
		const { sx, sy, sWidth, sHeight } = lastViewport;
		const { dx, dy, dWidth, dHeight } = letterboxParams;

		const relX = sWidth > 0 ? (imgP.x - sx) / sWidth : 0;
		const relY = sHeight > 0 ? (imgP.y - sy) / sHeight : 0;
		return { x: dx + relX * dWidth, y: dy + relY * dHeight };
	}
	function canvasToImageCoords(cvsPtrP: Point): Point | null {
		if (
			!lastViewport ||
			!canvasElement ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight ||
			letterboxParams.dWidth <= 0 ||
			letterboxParams.dHeight <= 0 ||
			!imageBitmap
		)
			return null;
		const { sx, sy, sWidth, sHeight } = lastViewport;
		const {
			dx: dxBuf,
			dy: dyBuf,
			dWidth: dWidthBuf,
			dHeight: dHeightBuf,
		} = letterboxParams;
		const displayW = canvasElement.clientWidth;
		const displayH = canvasElement.clientHeight;
		const bufferW = canvasElement.width;
		const bufferH = canvasElement.height;
		const ptrXBuf = (cvsPtrP.x / displayW) * bufferW;
		const ptrYBuf = (cvsPtrP.y / displayH) * bufferH;
		if (
			ptrXBuf < dxBuf ||
			ptrXBuf > dxBuf + dWidthBuf ||
			ptrYBuf < dyBuf ||
			ptrYBuf > dyBuf + dHeightBuf
		)
			return null;
		const relX = dWidthBuf > 0 ? (ptrXBuf - dxBuf) / dWidthBuf : 0;
		const relY = dHeightBuf > 0 ? (ptrYBuf - dyBuf) / dHeightBuf : 0;
		const imgX = sx + relX * sWidth;
		const imgY = sy + relY * sHeight;
		return {
			x: Math.max(0, Math.min(imgX, imageBitmap.width)),
			y: Math.max(0, Math.min(imgY, imageBitmap.height)),
		};
	}

	// --- Viewport Calculation  ---
	function calculateViewport(): ViewportState | null {
		if (
			!canvasElement ||
			!imageBitmap ||
			!canvasElement.clientWidth ||
			!canvasElement.clientHeight
		)
			return null;
		const imgW = imageBitmap.width;
		const imgH = imageBitmap.height;
		const displayW = canvasElement.clientWidth;
		const displayH = canvasElement.clientHeight;
		let sWidth = displayW / viewScale;
		let sHeight = displayH / viewScale;
		let sx = viewCenter.x - sWidth / 2;
		let sy = viewCenter.y - sHeight / 2;
		if (sx < 0) {
			sWidth += sx;
			sx = 0;
		}
		if (sy < 0) {
			sHeight += sy;
			sy = 0;
		}
		if (sx + sWidth > imgW) sWidth = imgW - sx;
		if (sy + sHeight > imgH) sHeight = imgH - sy;
		sWidth = Math.max(1, sWidth);
		sHeight = Math.max(1, sHeight);
		sx = Math.max(0, Math.min(sx, imgW - sWidth));
		sy = Math.max(0, Math.min(sy, imgH - sHeight));
		return { sx, sy, sWidth, sHeight };
	}

	// --- Drawing Functions ---
	// --- redrawCanvas  ---
	function redrawCanvas(): void {
		if (!ctx || !canvasElement || !imageBitmap) return;
		const vp = calculateViewport();
		if (!vp) return;
		lastViewport = vp;
		const { sx, sy, sWidth, sHeight } = vp;
		const cW = canvasElement.width;
		const cH = canvasElement.height;
		ctx.save();
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, cW, cH);
		ctx.imageSmoothingEnabled = true;
		let dx = 0,
			dy = 0,
			dWidth = cW,
			dHeight = cH;
		if (sWidth > 0 && sHeight > 0) {
			const sourceAspect = sWidth / sHeight;
			const bufferAspect = cW / cH;
			if (
				!isNaN(sourceAspect) &&
				isFinite(sourceAspect) &&
				sourceAspect > 0
			) {
				if (sourceAspect >= bufferAspect) {
					dHeight = cW / sourceAspect;
					dy = (cH - dHeight) / 2;
				} else {
					dWidth = cH * sourceAspect;
					dx = (cW - dWidth) / 2;
				}
			} else {
				dWidth = 0;
				dHeight = 0;
			}
		} else {
			dWidth = 0;
			dHeight = 0;
		}
		dWidth = Math.max(1, Math.min(cW, dWidth || 0));
		dHeight = Math.max(1, Math.min(cH, dHeight || 0));
		dx = Math.max(0, Math.min(cW - dWidth, dx || 0));
		dy = Math.max(0, Math.min(cH - dHeight, dy || 0));
		letterboxParams = { dx, dy, dWidth, dHeight };
		if (dWidth > 0 && dHeight > 0 && sWidth > 0 && sHeight > 0)
			ctx.drawImage(
				imageBitmap,
				sx,
				sy,
				sWidth,
				sHeight,
				dx,
				dy,
				dWidth,
				dHeight,
			);
		ctx.save(); // Save before overlays
		if (refLineStart && refLineEnd) {
			const sC = imageToCanvasCoords(refLineStart);
			const eC = imageToCanvasCoords(refLineEnd);
			if (
				sC &&
				eC &&
				Number.isFinite(sC.x) &&
				Number.isFinite(sC.y) &&
				Number.isFinite(eC.x) &&
				Number.isFinite(eC.y)
			) {
				drawScalingLine(ctx, sC, eC);
			}
		}
		if (scale)
			groups.forEach((g, i) => drawGroupElements(ctx!, g, i, scale!));
		ctx.restore(); // Restore after overlays
	}
	// --- drawScalingLine  ---
	function drawScalingLine(
		ctx: CanvasRenderingContext2D,
		startC: Point,
		endC: Point,
	) {
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(startC.x, startC.y);
		ctx.lineTo(endC.x, endC.y);
		ctx.strokeStyle = scaleLineColor;
		ctx.lineWidth = Math.max(dpr, lineWidthBase * dpr);
		ctx.setLineDash([]);
		ctx.stroke();
		ctx.fillStyle = scaleLineColor;
		const mS = Math.max(2 * dpr, lineWidthBase * dpr);
		ctx.fillRect(startC.x - mS / 2, startC.y - mS / 2, mS, mS);
		ctx.fillRect(endC.x - mS / 2, endC.y - mS / 2, mS, mS);
		ctx.restore();
	}
	// --- drawGroupElements (Using 'convertUnits') ---
	function drawGroupElements(
		ctx: CanvasRenderingContext2D,
		g: ShotGroup,
		i: number,
		sc: number,
	) {
		const act = i === activeGroupIndex;
		// Calculate bullet radius in IMAGE pixels
		const bulletDiameterInRefUnit = convertUnits(
			bulletDiameter,
			bulletDiameterUnit,
			referenceUnit,
		);
		const bRImg = (bulletDiameterInRefUnit / 2) * sc; // Bullet radius in image pixels

		// Need viewScale and dpr for the calculation
		if (!lastViewport || viewScale <= 0 || dpr <= 0) return;

		// --- Colors and Line Width (Unchanged) ---
		const hC = act ? bulletHoleColor : inactiveBulletHoleColor;
		const hSC = selectedHoleColor;
		const ceC = act ? centroidColor : "rgba(0,116,217,0.7)";
		const aiC = act ? aimPointColor : "rgba(255,133,27,0.7)";
		const ofC = offsetLineColor;
		const lW = Math.max(0.5 * dpr, lineWidthBase * dpr); // Base line width in buffer pixels

		ctx.save();

		// --- Draw Bullet Holes ---
		g.bulletHolesPixels.forEach((hImg: Point, hIdx) => {
			const hCvs = imageToCanvasCoords(hImg); // Center point in canvas coords
			if (!hCvs) return; // Hole center is not visible

			// --- New Radius Calculation (Directly using viewScale and dpr) ---
			// Radius in Buffer Pixels = (Radius in Image Pixels) * viewScale * dpr
			const bRCvs = bRImg * viewScale * dpr;
			// --- End New Radius Calculation ---

			const isSelected = act && hIdx === selectedHoleIndex;
			ctx.strokeStyle = isSelected ? hSC : hC;
			ctx.lineWidth = isSelected
				? Math.max(dpr, lW * selectedHoleLineWidthMultiplier)
				: lW;
			ctx.beginPath();
			// Draw arc with the calculated canvas buffer pixel radius (ensure minimum size)
			ctx.arc(hCvs.x, hCvs.y, Math.max(dpr * 0.5, bRCvs), 0, Math.PI * 2); // Minimum radius 0.5 display pixels
			ctx.stroke();
		});

		// --- Draw Centroid, Aim Point, Offset Line, Info Box (Unchanged from previous version) ---
		let ceCvs: Point | null = null;
		let aiCvs: Point | null = null;
		if (g.aimingPointPixels)
			aiCvs = imageToCanvasCoords(g.aimingPointPixels);
		if (g.resultsValid && g.centroidReal)
			ceCvs = imageToCanvasCoords({
				x: g.centroidReal.x * sc,
				y: g.centroidReal.y * sc,
			});
		if (ceCvs) {
			// Draw Centroid
			ctx.strokeStyle = ceC;
			ctx.lineWidth = lW;
			const cs = Math.max(3 * dpr, 6 * dpr);
			ctx.beginPath();
			ctx.moveTo(ceCvs.x - cs, ceCvs.y);
			ctx.lineTo(ceCvs.x + cs, ceCvs.y);
			ctx.moveTo(ceCvs.x, ceCvs.y - cs);
			ctx.lineTo(ceCvs.x, ceCvs.y + cs);
			ctx.stroke();
		}
		if (aiCvs) {
			// Draw Aim Point
			ctx.strokeStyle = aiC;
			ctx.lineWidth = lW;
			const dS = Math.max(dpr, 3 * dpr);
			ctx.setLineDash([dS, dS]);
			const cs = Math.max(4 * dpr, lineWidthBase * 4 * dpr);
			ctx.beginPath();
			ctx.moveTo(aiCvs.x - cs, aiCvs.y);
			ctx.lineTo(aiCvs.x + cs, aiCvs.y);
			ctx.moveTo(aiCvs.x, aiCvs.y - cs);
			ctx.lineTo(aiCvs.x, aiCvs.y + cs);
			ctx.stroke();
			ctx.setLineDash([]);
			if (ceCvs) {
				// Draw Offset Line
				ctx.strokeStyle = ofC;
				ctx.lineWidth = Math.max(
					0.5 * dpr,
					lW * offsetLineWidthMultiplier,
				);
				const oD = Math.max(1.5 * dpr, 4 * dpr);
				ctx.setLineDash([oD, oD]);
				ctx.beginPath();
				ctx.moveTo(aiCvs.x, aiCvs.y);
				ctx.lineTo(ceCvs.x, ceCvs.y);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
		if (g.resultsValid && (ceCvs || g.infoBoxAnchorImage)) {
			// Draw Info Box
			drawInfoBox(ctx, g, {
				fontSize: legendFontSize,
				textColor: legendTextColor,
				bgColor: legendBgColor,
				borderColor: legendBorderColor,
			});
		}
		ctx.restore();
	}
	// --- drawInfoBox (Using 'convertUnits') ---
	interface InfoBoxStyleOptions {
		fontSize: number;
		textColor: string;
		bgColor: string;
		borderColor: string;
	}
	function drawInfoBox(
		ctx: CanvasRenderingContext2D,
		group: ShotGroup,
		styles: InfoBoxStyleOptions,
	) {
		const lines: string[] = [];

		if (showGroupNameInLegend) lines.push(group.name);

		lines.push(
			`(${group.bulletHolesReal.length} shots @ ${targetDistance} ${targetDistanceUnit})`,
		);
		if (group.maxSpread !== null) {
			// Display Max Spread
			const d = convertUnits(
				group.maxSpread,
				referenceUnit,
				resultDisplayUnit,
			);
			let l = `Spread: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit}`;
			if (angularUnitDisplay === "moa" && group.maxSpreadMOA !== null)
				l += ` (${group.maxSpreadMOA.toFixed(2)} MOA)`;
			else if (
				angularUnitDisplay === "mrad" &&
				group.maxSpreadMRAD !== null
			)
				l += ` (${group.maxSpreadMRAD.toFixed(2)} MRAD)`;
			lines.push(l);
		} else if (group.bulletHolesReal.length < 2)
			lines.push(`Spread: N/A (<2 shots)`);
		if (group.meanRadius !== null) {
			// Display Mean Radius
			const d = convertUnits(
				group.meanRadius,
				referenceUnit,
				resultDisplayUnit,
			);
			let l = `Mean Radius: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit}`;
			if (angularUnitDisplay === "moa" && group.meanRadiusMOA !== null)
				l += ` (${group.meanRadiusMOA.toFixed(2)} MOA)`;
			else if (
				angularUnitDisplay === "mrad" &&
				group.meanRadiusMRAD !== null
			)
				l += ` (${group.meanRadiusMRAD.toFixed(2)} MRAD)`;
			lines.push(l);
		}
		if (group.offsetFromAim !== null) {
			// Display Offset
			const d = convertUnits(
				group.offsetFromAim.distance,
				referenceUnit,
				resultDisplayUnit,
			);
			lines.push(
				`Offset: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
			);
		}
		// Box drawing logic (mostly unchanged)
		ctx.save();
		const fS = styles.fontSize;
		const pad = 4;
		const lH = fS * 1.2;
		ctx.font = `${fS}px sans-serif`;
		let maxW = 0;
		lines.forEach(
			(ln) => (maxW = Math.max(maxW, ctx.measureText(ln).width)),
		);
		const boxW = maxW + pad * 2;
		const boxH = lines.length * lH + pad * 2;
		if (
			!group.infoBoxSize ||
			group.infoBoxSize.width !== boxW ||
			group.infoBoxSize.height !== boxH
		)
			group.infoBoxSize = { width: boxW, height: boxH };
		ctx.restore();
		ctx.save(); // Re-save for drawing
		if (
			!group.infoBoxAnchorImage &&
			group.centroidReal &&
			scale &&
			lastViewport &&
			ctx.canvas.clientHeight > 0 &&
			lastViewport.sHeight > 0
		) {
			// Calculate anchor if needed
			const cenImg = {
				x: group.centroidReal.x * scale,
				y: group.centroidReal.y * scale,
			};
			const offXImage = 15;
			const yOffsetPixels = boxH / 2;
			const yOffsetImage =
				(yOffsetPixels / ctx.canvas.clientHeight) *
				lastViewport.sHeight;
			group.infoBoxAnchorImage = {
				x: cenImg.x + offXImage,
				y: cenImg.y - yOffsetImage,
			};
			groups = groups;
		}
		let pos: Point | null = null;
		if (group.infoBoxAnchorImage)
			pos = imageToCanvasCoords(group.infoBoxAnchorImage);
		if (!pos || !group.infoBoxSize) {
			ctx.restore();
			return;
		}
		if (ctx.canvas.width <= 0 || ctx.canvas.height <= 0) {
			ctx.restore();
			return;
		} // Avoid NaN/Infinity
		pos.x = Math.max(
			0,
			Math.min(pos.x, ctx.canvas.width - group.infoBoxSize.width * dpr),
		); // Clamp X
		pos.y = Math.max(
			0,
			Math.min(pos.y, ctx.canvas.height - group.infoBoxSize.height * dpr),
		); // Clamp Y
		const bgColorWithAlpha = styles.bgColor.startsWith("#")
			? styles.bgColor + "E6"
			: styles.bgColor;
		ctx.fillStyle = bgColorWithAlpha;
		ctx.strokeStyle = styles.borderColor;
		ctx.lineWidth = 1 * dpr;
		ctx.fillRect(
			pos.x,
			pos.y,
			group.infoBoxSize.width * dpr,
			group.infoBoxSize.height * dpr,
		); // Draw box background
		ctx.strokeRect(
			pos.x,
			pos.y,
			group.infoBoxSize.width * dpr,
			group.infoBoxSize.height * dpr,
		); // Draw box border
		ctx.fillStyle = styles.textColor;
		ctx.font = `${fS * dpr}px sans-serif`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		lines.forEach((line, i) =>
			ctx.fillText(
				line,
				pos!.x + pad * dpr,
				pos!.y + pad * dpr + i * lH * dpr,
			),
		); // Draw text
		ctx.restore();
	}

	// --- Event Handlers (Unchanged logic) ---
	function getCanvasDisplayCoords(
		e: MouseEvent | PointerEvent,
	): Point | null {
		if (!canvasElement) return null;
		const r = canvasElement.getBoundingClientRect();
		if (!r.width || !r.height) return null;
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function handleFileSelect(e: Event) {
		const t = e.target as HTMLInputElement;
		const f = t.files?.[0];
		if (f && f.type.startsWith("image/")) {
			imageFile = f;
			if (imageUrl && imageUrl.startsWith("blob:"))
				URL.revokeObjectURL(imageUrl);
			imageUrl = URL.createObjectURL(f);
			resetStateForNewImage();
			mode = "loading";
			requestAnimationFrame(setupCanvas);
		} else {
			alert("Select valid image.");
			if (t) t.value = "";
			imageFile = null;
			imageUrl = null;
			reset();
		}
	}

	function handleCanvasPointerDown(e: PointerEvent) {
		if (!canvasElement || !ctx || !lastViewport || !imageBitmap) return;

		const dCoords = getCanvasDisplayCoords(e);
		if (!dCoords) return;

		const iCoords = canvasToImageCoords(dCoords);
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
				const aCvsRender = imageToCanvasCoords(aImg);
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
		if (mode === "selectingHole" && selectedHoleIndex !== null && scale) {
			const g = groups[activeGroupIndex];
			if (g && selectedHoleIndex < g.bulletHolesPixels.length) {
				const selectedHolePx = g.bulletHolesPixels[selectedHoleIndex];

				// Calculate tolerance in image pixels (similar to selection click)
				const clickToleranceRenderPixels = 15 * dpr; // Or use a dedicated drag tolerance
				const clickToleranceImagePixels =
					lastViewport.sWidth > 0 && canvasElement.width > 0
						? (clickToleranceRenderPixels / canvasElement.width) *
							lastViewport.sWidth
						: 5; // Fallback tolerance
				const clickToleranceImagePixelsSq =
					clickToleranceImagePixels * clickToleranceImagePixels;

				// Check distance from pointer (image coords) to selected hole center (image coords)
				const dx = iCoords.x - selectedHolePx.x;
				const dy = iCoords.y - selectedHolePx.y;
				const distSq = dx * dx + dy * dy;

				if (distSq <= clickToleranceImagePixelsSq) {
					// Start dragging the selected hole!
					isDraggingHole = true;
					draggingHoleStartCoords = { ...iCoords }; // Store starting image coords of pointer

					(e.target as HTMLElement).setPointerCapture(e.pointerId);
					canvasElement.style.cursor = "grabbing"; // Update cursor
					e.stopPropagation();
					return; // Prevent other modes
				}
			}
		}

		// Check panning or drawing ref line
		if (mode === "panning") {
			isPanning = true;
			panStartPointerCoords = dCoords;
			panStartViewCenter = { ...viewCenter };
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			canvasElement.style.cursor = "grabbing";
			e.stopPropagation();
			return;
		}

		if (mode === "scaling" && iCoords) {
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
			dragStartPointerCoords && // [cite: 146] Start pointer display coords
			dragStartInfoBoxAnchorImage && // [cite: 146] Start anchor image coords
			canvasElement?.hasPointerCapture(e.pointerId) // Check pointer capture
		) {
			const curPtrD = getCanvasDisplayCoords(e); // [cite: 142] Current pointer display coords
			if (!curPtrD) return; // Exit if current pointer coords are invalid

			// Convert start and current display coordinates to image coordinates
			const startPtrI = canvasToImageCoords(dragStartPointerCoords); //
			const curPtrI = canvasToImageCoords(curPtrD); //

			// Only update if both conversions are successful
			if (startPtrI && curPtrI) {
				// Calculate the delta movement in image coordinates
				const dxI = curPtrI.x - startPtrI.x;
				const dyI = curPtrI.y - startPtrI.y;

				const g = groups[draggingGroupIndex];
				// Ensure group exists before accessing
				if (g) {
					// Calculate the new anchor position in image coordinates
					g.infoBoxAnchorImage = {
						x: dragStartInfoBoxAnchorImage.x + dxI,
						y: dragStartInfoBoxAnchorImage.y + dyI,
					};
					groups = groups; // Trigger Svelte reactivity
					requestAnimationFrame(redrawCanvas); // Redraw the canvas [cite: 149]
				}
			}
		}
		// Hole dragging
		else if (isDraggingHole && selectedHoleIndex !== null && scale) {
			const curPtrI = canvasToImageCoords(curPtrD); // Current pointer in Image Coords
			if (curPtrI && activeGroupIndex !== -1) {
				const g = groups[activeGroupIndex];
				if (g && selectedHoleIndex < g.bulletHolesPixels.length) {
					const holePx = g.bulletHolesPixels[selectedHoleIndex];
					const holeRl = g.bulletHolesReal[selectedHoleIndex];

					// Update pixel coordinates directly to pointer's image coordinates
					holePx.x = curPtrI.x;
					holePx.y = curPtrI.y;

					// Clamp to image bounds
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

					// Update real coordinates based on new pixel coordinates and scale
					holeRl.x = holePx.x / scale;
					holeRl.y = holePx.y / scale;

					// Invalidate results and trigger redraw
					invalidateResults(activeGroupIndex);
					groups = groups; // Trigger reactivity
					requestAnimationFrame(redrawCanvas); // Redraw needed to show movement
				}
			}
		}
		// Scaling Line Drawing
		else if (
			mode === "scaling" &&
			isDrawingRefLine &&
			refLineStart &&
			canvasElement.hasPointerCapture(e.pointerId)
		) {
			const curPtrI = canvasToImageCoords(curPtrD);
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
			isDraggingHole = false; // Reset flag
			draggingHoleStartCoords = null;
			if (canvasElement) canvasElement.style.cursor = canvasCursor; // Reset cursor via reactive variable

			// Final calculation and redraw after drag finishes
			if (activeGroupIndex !== -1) {
				calculateGroupResults(activeGroupIndex); // Recalculate stats
			}
			redrawCanvas(); // Ensure final position is drawn
		}
		// Scaling Line Draw End
		else if (
			mode === "scaling" &&
			isDrawingRefLine &&
			canvasElement?.hasPointerCapture(e.pointerId)
		) {
			canvasElement.releasePointerCapture(e.pointerId);
			isDrawingRefLine = false;
			const finalPtrD = getCanvasDisplayCoords(e);
			if (finalPtrD) {
				const finalI = canvasToImageCoords(finalPtrD);
				if (finalI) refLineEnd = finalI;
			}
			if (refLineStart && refLineEnd) {
				if (calculateScale()) mode = "placingHoles";
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

		// Reset flags just in case pointer capture was lost somehow
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
			canvasElement.style.cursor = canvasCursor; // Ensure cursor resets if capture lost
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
		const iCoords = canvasToImageCoords(dCoords);
		if (!iCoords) return;
		const g = groups[activeGroupIndex];
		// Placing Holes
		if (mode === "placingHoles" && scale) {
			const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale }; // Real coords in referenceUnit
			g.bulletHolesPixels.push(iCoords);
			g.bulletHolesReal.push(rCoords);
			selectedHoleIndex = g.bulletHolesPixels.length - 1;
			invalidateResults(activeGroupIndex);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			redrawCanvas();
		}
		// Placing Aim Point
		else if (mode === "placingAim" && scale) {
			const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale }; // Real coords in referenceUnit
			g.aimingPointPixels = iCoords;
			g.aimingPointReal = rCoords;
			invalidateResults(activeGroupIndex);
			groups = groups;
			await tick();
			calculateGroupResults(activeGroupIndex);
			mode = "placingHoles";
			redrawCanvas();
		}
		// Selecting Hole
		else if (mode === "selectingHole") {
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
			case "ArrowUp":
				dyI = -nudgeYImage;
				break;
			case "ArrowDown":
				dyI = nudgeYImage;
				break;
			case "ArrowLeft":
				dxI = -nudgeXImage;
				break;
			case "ArrowRight":
				dxI = nudgeXImage;
				break;
			case "Delete":
			case "Backspace":
				e.preventDefault();
				deleteSelectedHole();
				return;
			default:
				return;
		}
		e.preventDefault();
		nudgeSelectedHolePx(dxI, dyI);
	}

	// --- Logic ---
	// --- calculateScale  ---
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
		groups.forEach((g, i) => {
			// Recalculate real coords and invalidate results
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
			invalidateResults(i);
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

	// --- calculateGroupResults (Using 'convertUnits' and moa.mrad2moa) ---
	function calculateGroupResults(idx: number) {
		if (idx < 0 || idx >= groups.length || !scale) return;
		const g = groups[idx];
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
			groups = groups;
			redrawCanvas();
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
				"meters",
			);
			if (distMeters > 0) {
				if (g.meanRadius !== null) {
					// Mean Radius Angular
					const radiusMeters = convertUnits(
						g.meanRadius,
						referenceUnit,
						"meters",
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
						"meters",
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
			let angleRad = Math.atan2(-dy, dx);
			if (angleRad < 0) angleRad += 2 * Math.PI;
			g.offsetFromAim = {
				distance: dist,
				angleDegrees: angleRad * (180 / Math.PI),
			};
		} else g.offsetFromAim = null;
		g.resultsValid = true;
		groups = groups;
		redrawCanvas();
	}
	// --- invalidateResults  ---
	function invalidateResults(idx: number) {
		if (idx >= 0 && idx < groups.length && groups[idx].resultsValid) {
			groups[idx].resultsValid = false;
			groups = groups;
		}
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
		if (!imageBitmap) mode = "loading";
		else if (!scale) mode = "scaling";
		else mode = "placingHoles";
		redrawCanvas();
	}
	function switchToGroup(idx: number) {
		if (idx >= 0 && idx < groups.length && idx !== activeGroupIndex) {
			activeGroupIndex = idx;
			selectedHoleIndex = null;
			if (!imageBitmap) mode = "loading";
			else if (!scale) mode = "scaling";
			else mode = "placingHoles";
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
		invalidateResults(activeGroupIndex);
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
			invalidateResults(activeGroupIndex);
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
				const imageCoords = canvasToImageCoords(displayCoords);
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
		mode = "scaling";
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
		mode = "loading";
		fitScaleValue = 1.0;
	}
	function reset() {
		if (
			!confirm(
				"Are you sure you want to start over? All current data will be lost.",
			)
		)
			return;
		resetStateForNewImage();
		if (ctx && canvasElement)
			ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		if (imageUrl && imageUrl.startsWith("blob:"))
			URL.revokeObjectURL(imageUrl);
		imageFile = null;
		imageUrl = null;
		ctx = null;
		if (fileInputEl) fileInputEl.value = "";
	}

	// --- Input Handlers (Unchanged logic, rely on redraw/recalculate) ---
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
			calculateScale(); // Tries to recalculate scale, results, redraws
		else {
			// Invalidate scale if no line exists
			scale = null;
			mode = "scaling";
			groups.forEach((g, i) => {
				invalidateResults(i);
				g.infoBoxAnchorImage = null;
			});
			groups = groups;
			redrawCanvas();
		}
	}
	function isPointInRect(p: Point, r: Rect): boolean {
		return (
			p.x >= r.x &&
			p.x <= r.x + r.width &&
			p.y >= r.y &&
			p.y <= r.y + r.height
		);
	}

	// --- exportCanvasAsJpeg (Using 'convertUnits' and moa.mrad2moa) ---
	function exportCanvasAsJpeg(): void {
		if (!canvasElement || !imageBitmap || !ctx || !scale) {
			alert("Canvas/image/scale not ready.");
			return;
		}
		const exportCanvas = document.createElement("canvas");
		exportCanvas.width = imageBitmap.width;
		exportCanvas.height = imageBitmap.height;
		const exportCtx = exportCanvas.getContext("2d");
		if (!exportCtx) {
			alert("Failed context.");
			return;
		}
		exportCtx.imageSmoothingEnabled = true;
		exportCtx.fillStyle = "#FFFFFF";
		exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
		exportCtx.drawImage(imageBitmap, 0, 0);
		exportCtx.save(); // Save before overlays
		// Draw Scaling Line
		if (refLineStart && refLineEnd) {
			exportCtx.beginPath();
			exportCtx.moveTo(refLineStart.x, refLineStart.y);
			exportCtx.lineTo(refLineEnd.x, refLineEnd.y);
			exportCtx.strokeStyle = scaleLineColor;
			exportCtx.lineWidth = scaleLineWidth;
			exportCtx.setLineDash([]);
			exportCtx.stroke();
			exportCtx.fillStyle = scaleLineColor;
			const mSize = scaleMarkerSize;
			exportCtx.fillRect(
				refLineStart.x - mSize / 2,
				refLineStart.y - mSize / 2,
				mSize,
				mSize,
			);
			exportCtx.fillRect(
				refLineEnd.x - mSize / 2,
				refLineEnd.y - mSize / 2,
				mSize,
				mSize,
			);
		}
		// Draw Group Elements
		if (scale)
			groups.forEach((group, index) => {
				const isActive = index === activeGroupIndex;
				const bulletDiameterInRefUnit = convertUnits(
					bulletDiameter,
					bulletDiameterUnit,
					referenceUnit,
				);
				const bRadiusImg = (bulletDiameterInRefUnit / 2) * scale!;
				const hColor = isActive
					? bulletHoleColor
					: inactiveBulletHoleColor;
				const cenColor = isActive
					? centroidColor
					: "rgba(0,116,217,0.7)";
				const aimColor = isActive
					? aimPointColor
					: "rgba(255,133,27,0.7)";
				const offColor = offsetLineColor;
				const lWidth = lineWidthBase;
				// Draw Holes
				exportCtx.strokeStyle = hColor;
				exportCtx.lineWidth = lWidth;
				group.bulletHolesPixels.forEach((holeImg: Point) => {
					exportCtx.beginPath();
					exportCtx.arc(
						holeImg.x,
						holeImg.y,
						Math.max(1, bRadiusImg),
						0,
						Math.PI * 2,
					);
					exportCtx.stroke();
				});
				// Get Centroid/Aim in Image Pixels
				let cenImgPx: Point | null = null;
				let aimImgPx: Point | null = group.aimingPointPixels;
				if (group.resultsValid && group.centroidReal)
					cenImgPx = {
						x: group.centroidReal.x * scale!,
						y: group.centroidReal.y * scale!,
					};
				// Draw Centroid
				if (cenImgPx) {
					exportCtx.strokeStyle = cenColor;
					exportCtx.lineWidth = lWidth;
					const cs = 6;
					exportCtx.beginPath();
					exportCtx.moveTo(cenImgPx.x - cs, cenImgPx.y);
					exportCtx.lineTo(cenImgPx.x + cs, cenImgPx.y);
					exportCtx.moveTo(cenImgPx.x, cenImgPx.y - cs);
					exportCtx.lineTo(cenImgPx.x, cenImgPx.y + cs);
					exportCtx.stroke();
				}
				// Draw Aim Point & Offset Line
				if (aimImgPx) {
					exportCtx.strokeStyle = aimColor;
					exportCtx.lineWidth = lWidth;
					exportCtx.setLineDash([3, 3]);
					const cs = 8;
					exportCtx.beginPath();
					exportCtx.moveTo(aimImgPx.x - cs, aimImgPx.y);
					exportCtx.lineTo(aimImgPx.x + cs, aimImgPx.y);
					exportCtx.moveTo(aimImgPx.x, aimImgPx.y - cs);
					exportCtx.lineTo(aimImgPx.x, aimImgPx.y + cs);
					exportCtx.stroke();
					exportCtx.setLineDash([]);
					if (cenImgPx) {
						exportCtx.strokeStyle = offColor;
						exportCtx.lineWidth =
							lWidth * offsetLineWidthMultiplier;
						exportCtx.setLineDash([4, 4]);
						exportCtx.beginPath();
						exportCtx.moveTo(aimImgPx.x, aimImgPx.y);
						exportCtx.lineTo(cenImgPx.x, cenImgPx.y);
						exportCtx.stroke();
						exportCtx.setLineDash([]);
					}
				}
				// Draw Info Box
				if (
					group.resultsValid &&
					group.infoBoxAnchorImage &&
					group.infoBoxSize
				) {
					const lines: string[] = [];
					if (showGroupNameInLegend) lines.push(group.name);

					lines.push(
						`(${group.bulletHolesReal.length} shots @ ${targetDistance} ${targetDistanceUnit})`,
					);
					if (group.maxSpread !== null) {
						// Spread
						const d = convertUnits(
							group.maxSpread,
							referenceUnit,
							resultDisplayUnit,
						);
						let l = `Spread: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit}`;
						if (
							angularUnitDisplay === "moa" &&
							group.maxSpreadMOA !== null
						)
							l += ` (${group.maxSpreadMOA.toFixed(2)} MOA)`;
						else if (
							angularUnitDisplay === "mrad" &&
							group.maxSpreadMRAD !== null
						)
							l += ` (${group.maxSpreadMRAD.toFixed(2)} MRAD)`;
						lines.push(l);
					} else if (group.bulletHolesReal.length < 2)
						lines.push(`Spread: N/A (<2 shots)`);
					if (group.meanRadius !== null) {
						// Mean Radius
						const d = convertUnits(
							group.meanRadius,
							referenceUnit,
							resultDisplayUnit,
						);
						let l = `Mean Radius: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit}`;
						if (
							angularUnitDisplay === "moa" &&
							group.meanRadiusMOA !== null
						)
							l += ` (${group.meanRadiusMOA.toFixed(2)} MOA)`;
						else if (
							angularUnitDisplay === "mrad" &&
							group.meanRadiusMRAD !== null
						)
							l += ` (${group.meanRadiusMRAD.toFixed(2)} MRAD)`;
						lines.push(l);
					}
					if (group.offsetFromAim !== null) {
						// Offset
						const d = convertUnits(
							group.offsetFromAim.distance,
							referenceUnit,
							resultDisplayUnit,
						);
						lines.push(
							`Offset: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
						);
					}
					const { width: boxW, height: boxH } = group.infoBoxSize;
					let infoX = group.infoBoxAnchorImage.x;
					let infoY = group.infoBoxAnchorImage.y;
					infoX = Math.max(
						0,
						Math.min(infoX, exportCanvas.width - boxW),
					);
					infoY = Math.max(
						0,
						Math.min(infoY, exportCanvas.height - boxH),
					);
					const fSize = legendFontSize;
					const pad = 4;
					const lH = fSize * 1.2;
					const bgColorWithAlpha = legendBgColor.startsWith("#")
						? legendBgColor + "E6"
						: legendBgColor;
					const LborderColor = legendBorderColor;
					const LtextColor = legendTextColor;
					exportCtx.fillStyle = bgColorWithAlpha;
					exportCtx.strokeStyle = LborderColor;
					exportCtx.lineWidth = 1;
					exportCtx.fillRect(infoX, infoY, boxW, boxH);
					exportCtx.strokeRect(infoX, infoY, boxW, boxH);
					exportCtx.fillStyle = LtextColor;
					exportCtx.font = `${fSize}px sans-serif`;
					exportCtx.textAlign = "left";
					exportCtx.textBaseline = "top";
					lines.forEach((line, i) =>
						exportCtx.fillText(
							line,
							infoX + pad,
							infoY + pad + i * lH,
						),
					);
				}
			});
		exportCtx.restore(); // Restore after overlays
		// Generate Data URL and Download
		try {
			const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
			const link = document.createElement("a");
			const baseName =
				imageFile?.name.replace(/\.[^/.]+$/, "") ?? "target-analysis";
			link.download = `${baseName}.jpg`;
			link.href = dataUrl;
			link.click();
			link.remove();
		} catch (error) {
			console.error("Error exporting canvas:", error);
			alert("Failed to export image as JPEG.");
		}
	}

	// --- Reactive statement for Observer based on imageUrl ---
	$: if (imageUrl) {
		// When imageUrl becomes truthy (image loaded)
		// Use tick() to wait for the #if block to render the element
		tick().then(() => {
			setupResizeObserver();
		});
	} else {
		// When imageUrl becomes falsy (image removed or initially null)
		cleanupResizeObserver();
	}

	// Reactive derivations
	$: activeGroup =
		activeGroupIndex !== -1 && activeGroupIndex < groups.length
			? groups[activeGroupIndex]
			: null;
	$: canvasCursor = isPanning
		? "grabbing"
		: isDraggingInfoBox
			? "move"
			: isDraggingHole
				? "grabbing"
				: mode === "panning"
					? "grab"
					: mode === "scaling"
						? "crosshair"
						: mode === "placingHoles"
							? "copy"
							: mode === "placingAim"
								? "crosshair"
								: mode === "selectingHole"
									? "pointer"
									: "default";
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
			<div class="card bg-base-100 shadow-md p-3">
				<div
					class="flex flex-wrap gap-2 items-center justify-center sm:justify-start"
				>
					<label
						for="fileInput"
						class="label text-sm font-medium mr-1">🖼️ Image:</label
					>
					<input
						bind:this={fileInputEl}
						type="file"
						id="fileInput"
						accept="image/*"
						on:change={handleFileSelect}
						class="file-input file-input-bordered file-input-sm max-w-[20em] flex-grow"
					/>
					<button
						class="btn btn-primary btn-sm lg:order-last"
						on:click={exportCanvasAsJpeg}
						title="Save full image + overlays as JPG"
						disabled={!imageBitmap}
					>
						💾 Save JPG
					</button>
				</div>
			</div>

			{#if imageUrl}
				<div
					class="card bg-base-100 shadow-md p-2 lg:p-3 flex flex-col sm:flex-row sm:flex-wrap gap-2 xs:items-center"
				>
					<div
						class="flex gap-1 items-center flex-wrap justify-center lg:justify-start"
					>
						<button
							class="btn btn-secondary btn-sm btn-square"
							on:click={zoomIn}
							disabled={!imageBitmap || viewScale >= MAX_ZOOM}
							title="Zoom In (+Wheel Up)">➕</button
						>
						<span
							class="text-xs text-base-content/70 mx-1 whitespace-nowrap w-8"
							title="Current Zoom Level"
							>{Math.round(viewScale * 100)}%</span
						>
						<button
							class="btn btn-secondary btn-sm btn-square"
							on:click={zoomOut}
							disabled={!imageBitmap ||
								viewScale <= fitScaleValue}
							title="Zoom Out (+Wheel Down)">➖</button
						>
						<button
							class="btn btn-secondary btn-sm"
							on:click={resetZoom}
							disabled={!imageBitmap}
							title="Fit Zoom & Reset Pan">🔍 Fit</button
						>
					</div>

					<div
						class="flex flex-wrap gap-x-3 gap-y-2 items-center justify-center sm:ml-auto"
					>
						<div class="btn-group">
							<button
								class="btn btn-sm"
								class:btn-outline={mode === "panning"}
								on:click={() => {
									mode =
										mode === "panning"
											? scale
												? "placingHoles"
												: "scaling"
											: "panning";
									selectedHoleIndex = null;
									redrawCanvas();
								}}
								title="Toggle Pan Mode (Click-drag canvas to move view)"
								disabled={!scale}
							>
								🤚 Pan
							</button>
							<button
								class="btn btn-sm"
								class:btn-outline={mode === "placingHoles"}
								on:click={() => {
									mode = "placingHoles";
									selectedHoleIndex = null;
									redrawCanvas();
								}}
								title="Place bullet holes (Click on image)"
								disabled={!scale}
							>
								⭕ Holes
							</button>
							<button
								class="btn btn-sm"
								class:btn-outline={mode === "placingAim"}
								on:click={() => {
									mode = "placingAim";
									selectedHoleIndex = null;
									redrawCanvas();
								}}
								title="Set aiming point (Click on image)"
								disabled={!scale}
							>
								🎯 Aim Pt
							</button>
							<button
								class="btn btn-sm"
								class:btn-outline={mode === "selectingHole"}
								on:click={() => {
									mode = "selectingHole";
									redrawCanvas();
								}}
								title="Select/Move hole (Click near a hole, use arrows/buttons to nudge/delete)"
								disabled={!scale}
							>
								👆 Select
							</button>
						</div>
					</div>
				</div>

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

					{#if mode === "selectingHole" && selectedHoleIndex !== null}
						<div
							class="absolute top-2 left-2 z-10 card bg-base-100/80 backdrop-blur-sm shadow-lg p-2 border border-base-300"
						>
							<span
								class="text-xs text-center mb-1 text-base-content/80"
								>Nudge (Arrows):</span
							>
							<div
								class="grid grid-cols-3 gap-1 justify-center mb-1"
							>
								<button
									class="btn btn-info btn-xs btn-square col-start-2 row-start-1"
									on:click={() =>
										handleKeyDown({
											key: "ArrowUp",
											preventDefault: () => {},
										} as KeyboardEvent)}
									title="Nudge Up">↑</button
								>
								<button
									class="btn btn-info btn-xs btn-square col-start-1 row-start-2"
									on:click={() =>
										handleKeyDown({
											key: "ArrowLeft",
											preventDefault: () => {},
										} as KeyboardEvent)}
									title="Nudge Left">←</button
								>
								<button
									class="btn btn-info btn-xs btn-square col-start-3 row-start-2"
									on:click={() =>
										handleKeyDown({
											key: "ArrowRight",
											preventDefault: () => {},
										} as KeyboardEvent)}
									title="Nudge Right">→</button
								>
								<button
									class="btn btn-info btn-xs btn-square col-start-2 row-start-3"
									on:click={() =>
										handleKeyDown({
											key: "ArrowDown",
											preventDefault: () => {},
										} as KeyboardEvent)}
									title="Nudge Down">↓</button
								>
							</div>
							<div class="flex justify-center gap-2 w-full mt-2">
								<!-- <button
									class="btn btn-soft btn-warning btn-xs"
									on:click={() => {
										selectedHoleIndex = null;
										redrawCanvas();
									}}
									title="Deselect hole">Clear Sel.</button
								> -->
								<button
									class="btn btn-soft btn-error btn-xs"
									on:click={deleteSelectedHole}
									title="Delete selected hole (Del/Bksp)"
									>Delete</button
								>
							</div>
						</div>
					{/if}
				</div>
			{:else if mode !== "loading"}
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
				<div class="card bg-base-100 shadow-md p-3">
					<h2
						class="text-lg font-semibold mb-2 pb-1 border-b border-base-300 text-center mt-1"
					>
						Settings & Groups
					</h2>
					<div
						class="flex flex-wrap items-center gap-2 justify-center lg:justify-start mb-3 pb-3 border-b border-dashed border-base-300"
					>
						<div class="flex items-center gap-1">
							<label
								for="refLength"
								class="label text-xs font-medium whitespace-nowrap"
								>Ref Len:</label
							>
							<input
								type="number"
								id="refLength"
								bind:value={referenceLength}
								min="1"
								step="1"
								on:input={handleReferenceInputChange}
								disabled={!imageBitmap}
								class="input input-bordered input-xs w-16 text-center"
							/>
							<select
								bind:value={referenceUnit}
								on:change={handleReferenceInputChange}
								disabled={!imageBitmap}
								class="select select-bordered select-xs"
							>
								<option value="inches">in</option>
								<option value="cm">cm</option>
								<option value="mm">mm</option>
							</select>
						</div>
						<button
							class="btn btn-secondary btn-sm"
							class:btn-active={mode === "scaling"}
							on:click={enterScaleMode}
							title={mode === "scaling"
								? "Click-drag on image to draw reference line"
								: "Draw reference line based on known length"}
							disabled={!imageBitmap}
						>
							📏 {#if mode === "scaling"}Drawing Ref...{:else}Draw
								Ref Line{/if}
						</button>
					</div>
					<div
						class="flex flex-row lg:flex-col flex-wrap gap-x-4 gap-y-3 mb-3 pb-3 border-b border-dashed border-base-300"
					>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="targetDist"
								class="label text-xs font-medium whitespace-nowrap shrink-0 xs:w-16 sm:text-right"
								>Tgt Dist:</label
							>
							<div
								class="flex items-center gap-1 w-full sm:w-auto"
							>
								<input
									type="number"
									id="targetDist"
									bind:value={targetDistance}
									min="1"
									step="any"
									on:input={handleTargetDistanceChange}
									title="Distance to target (set > 0 for MOA/MIL)"
									class="input input-bordered input-xs w-20 text-center grow sm:grow-0"
								/>
								<select
									bind:value={targetDistanceUnit}
									on:change={handleTargetDistanceChange}
									class="select select-bordered select-xs grow sm:grow-0"
								>
									<option value="yards">yd</option>
									<option value="meters">m</option>
								</select>
							</div>
						</div>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="bulletDiam"
								class="label text-xs font-medium whitespace-nowrap shrink-0 xs:w-16 sm:text-right"
								>Bullet Dia:</label
							>
							<div
								class="flex items-center gap-1 w-full sm:w-auto"
							>
								<input
									type="number"
									id="bulletDiam"
									bind:value={bulletDiameter}
									min="0.01"
									step="0.001"
									on:input={handleDiameterChange}
									title="Bullet diameter (for hole visualization)"
									class="input input-bordered input-xs w-20 text-center grow sm:grow-0"
								/>
								<select
									bind:value={bulletDiameterUnit}
									on:change={handleDiameterChange}
									class="select select-bordered select-xs grow sm:grow-0"
								>
									<option value="inches">in</option>
									<option value="mm">mm</option>
								</select>
							</div>
						</div>
					</div>
					<div
						class="flex flex-row lg:flex-col flex-wrap gap-x-4 gap-y-3 mb-3 pb-3 border-b border-dashed border-base-300"
					>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="resultUnit"
								class="label text-xs font-medium whitespace-nowrap shrink-0 w-16 sm:text-right"
								>Units:</label
							>
							<select
								id="resultUnit"
								bind:value={resultDisplayUnit}
								on:change={handleResultUnitChange}
								title="Units for displaying results"
								class="select select-bordered select-xs w-full sm:w-auto"
							>
								<option value="inches">in</option>
								<option value="cm">cm</option>
								<option value="mm">mm</option>
							</select>
						</div>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="angularUnit"
								class="label text-xs font-medium whitespace-nowrap shrink-0 w-16 sm:text-right"
								>Angular:</label
							>
							<select
								id="angularUnit"
								bind:value={angularUnitDisplay}
								on:change={handleAngularUnitChange}
								disabled={targetDistance <= 0}
								title={targetDistance <= 0
									? "Set Target Distance > 0 to enable MOA/MIL"
									: "Angular units for results"}
								class="select select-bordered select-xs w-full sm:w-auto"
							>
								<option value="moa">MOA</option>
								<option value="mrad">MIL</option>
								<option value="none">None</option>
							</select>
						</div>
					</div>
					<div
						class="flex flex-wrap items-center gap-2 justify-center lg:justify-start mb-3 pb-3 border-b border-dashed border-base-300"
					>
						<span class="text-sm font-medium mr-1 shrink-0"
							>Groups:</span
						>
						<div
							class="btn-group flex-wrap justify-center lg:justify-start"
						>
							{#each groups as group, index (group.id)}
								<button
									class="btn btn-xs mb-1"
									class:btn-active={index ===
										activeGroupIndex}
									on:click={() => switchToGroup(index)}
									title="Switch to {group.name}"
									>{group.name}</button
								>
								{#if groups.length > 1}
									<button
										class="btn btn-error btn-xs btn-square -ml-px z-10"
										on:click|stopPropagation={() =>
											deleteGroup(index)}
										title="Delete {group.name}">X</button
									>
								{/if}
							{/each}
						</div>
						<button
							class="btn btn-secondary btn-xs btn-square"
							on:click={addNewGroup}
							title="Add new group">+</button
						>
					</div>
					{#if activeGroup}
						<div class="flex items-center gap-2">
							<label
								for="groupName"
								class="label text-xs font-medium whitespace-nowrap"
								>Active Name:</label
							>
							<input
								type="text"
								id="groupName"
								bind:value={activeGroup.name}
								on:input={redrawCanvas}
								title="Rename active group"
								class="input input-bordered input-sm flex-grow"
							/>
						</div>
					{/if}
				</div>

				<div class="card bg-base-100 shadow-md p-3">
					<h2
						class="text-lg font-semibold mb-2 pb-1 border-b border-base-300 text-center mt-1"
					>
						Appearance
					</h2>
					<div
						class="flex flex-col flex-row flex-wrap gap-x-4 gap-y-3 mb-3 pb-3 border-b border-dashed border-base-300"
					>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="lineWidthBase"
								class="label text-xs font-medium whitespace-nowrap shrink-0 sm:w-20 sm:text-right"
								>Line Width:</label
							>
							<input
								type="number"
								id="lineWidthBase"
								bind:value={lineWidthBase}
								min="1"
								step="1"
								max="20"
								title="Base line width (px)"
								on:input={redrawCanvas}
								class="input input-bordered input-xs w-16 text-center"
							/>
						</div>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="legendFontSize"
								class="label text-xs font-medium whitespace-nowrap shrink-0 sm:w-20 sm:text-right"
								>Legend Font:</label
							>
							<input
								type="number"
								id="legendFontSize"
								bind:value={legendFontSize}
								min="12"
								step="2"
								max="100"
								title="Legend font size (px)"
								on:input={redrawCanvas}
								class="input input-bordered input-xs w-16 text-center"
							/>
						</div>
						<div
							class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
						>
							<label
								for="showGroupNameInLegend"
								class="label text-xs font-medium whitespace-nowrap shrink-0 sm:w-20 sm:text-right"
								title="Show group name in legend box?"
								>Show Name:</label
							>
							<input
								type="checkbox"
								id="showGroupNameInLegend"
								bind:checked={showGroupNameInLegend}
								on:change={redrawCanvas}
								class="toggle toggle-xs toggle-primary"
							/>
						</div>
					</div>
					<div
						class="flex flex-wrap gap-x-4 gap-y-3 mb-3 pb-3 border-b border-dashed border-base-300 justify-around lg:justify-start"
					>
						<div class="flex items-center gap-1">
							<label
								for="bulletHoleColor"
								title="Bullet holes"
								class="label text-xs font-medium">Hole:</label
							>
							<input
								type="color"
								id="bulletHoleColor"
								bind:value={bulletHoleColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="selectedHoleColor"
								title="Selected hole highlight"
								class="label text-xs font-medium"
								>Sel Hole:</label
							>
							<input
								type="color"
								id="selectedHoleColor"
								bind:value={selectedHoleColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="centroidColor"
								title="Group center marker"
								class="label text-xs font-medium">Center:</label
							>
							<input
								type="color"
								id="centroidColor"
								bind:value={centroidColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="aimPointColor"
								title="Aiming point marker"
								class="label text-xs font-medium">Aim Pt:</label
							>
							<input
								type="color"
								id="aimPointColor"
								bind:value={aimPointColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
					</div>
					<div
						class="flex flex-wrap gap-x-4 gap-y-3 justify-around lg:justify-start"
					>
						<div class="flex items-center gap-1">
							<label
								for="offsetLineColor"
								title="Offset line (aim to center)"
								class="label text-xs font-medium">Offset:</label
							>
							<input
								type="color"
								id="offsetLineColor"
								bind:value={offsetLineColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="scaleLineColor"
								title="Scale reference line"
								class="label text-xs font-medium"
								>Scale Ln:</label
							>
							<input
								type="color"
								id="scaleLineColor"
								bind:value={scaleLineColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="legendTextColor"
								title="Legend text color"
								class="label text-xs font-medium"
								>Lgd Text:</label
							>
							<input
								type="color"
								id="legendTextColor"
								bind:value={legendTextColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
						<div class="flex items-center gap-1">
							<label
								for="legendBgColor"
								title="Legend background color"
								class="label text-xs font-medium">Lgd BG:</label
							>
							<input
								type="color"
								id="legendBgColor"
								bind:value={legendBgColor}
								on:input={redrawCanvas}
								class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
							/>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
