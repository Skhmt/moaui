import type {
	Point,
	Rect,
	ViewportState,
	LetterboxParams,
	ShotGroup,
	LinearUnit,
	DistanceUnit,
	DiameterUnit,
	AngularUnitDisplay,
	InfoBoxStyleOptions,
	AppearanceSettings,
} from './types';
import { convertUnits } from './units';

export function calculateViewport(
	canvasElement: HTMLCanvasElement | undefined,
	imageBitmap: ImageBitmap | null,
	viewScale: number,
	viewCenter: Point,
): ViewportState | null {
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

export function imageToCanvasCoords(
	imgP: Point,
	lastViewport: ViewportState | null,
	canvasElement: HTMLCanvasElement | undefined,
	letterboxParams: LetterboxParams,
): Point | null {
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

export function canvasToImageCoords(
	cvsPtrP: Point,
	lastViewport: ViewportState | null,
	canvasElement: HTMLCanvasElement | undefined,
	letterboxParams: LetterboxParams,
	imageBitmap: ImageBitmap | null,
): Point | null {
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

export function drawScalingLine(
	ctx: CanvasRenderingContext2D,
	startC: Point,
	endC: Point,
	scaleLineColor: string,
	lineWidthBase: number,
	dpr: number,
): void {
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

export function drawInfoBox(
	ctx: CanvasRenderingContext2D,
	group: ShotGroup,
	styles: InfoBoxStyleOptions,
	showGroupNameInLegend: boolean,
	targetDistance: number,
	targetDistanceUnit: DistanceUnit,
	referenceUnit: LinearUnit,
	resultDisplayUnit: LinearUnit,
	angularUnitDisplay: AngularUnitDisplay,
	scale: number | null,
	lastViewport: ViewportState | null,
	canvasElement: HTMLCanvasElement,
	letterboxParams: LetterboxParams,
	dpr: number,
): void {
	const lines: string[] = [];

	if (showGroupNameInLegend) lines.push(group.name);

	lines.push(
		`${group.bulletHolesReal.length} shots @ ${targetDistance} ${targetDistanceUnit}`,
	);
	if (group.maxSpread !== null) {
		// Display Max Spread
		const d = convertUnits(
			group.maxSpread,
			referenceUnit,
			resultDisplayUnit,
		);
		let l = `Spread: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit}`;
		if (angularUnitDisplay === 'moa' && group.maxSpreadMOA !== null)
			l += ` (${group.maxSpreadMOA.toFixed(2)} MOA)`;
		else if (
			angularUnitDisplay === 'mrad' &&
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
		let l = `Mean Radius: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit}`;
		if (angularUnitDisplay === 'moa' && group.meanRadiusMOA !== null)
			l += ` (${group.meanRadiusMOA.toFixed(2)} MOA)`;
		else if (
			angularUnitDisplay === 'mrad' &&
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
			`Offset: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
		);
	}
	// Box drawing logic
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
	}
	let pos: Point | null = null;
	if (group.infoBoxAnchorImage)
		pos = imageToCanvasCoords(group.infoBoxAnchorImage, lastViewport, canvasElement, letterboxParams);
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
	const bgColorWithAlpha = styles.bgColor.startsWith('#')
		? styles.bgColor + 'E6'
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
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	lines.forEach((line, i) =>
		ctx.fillText(
			line,
			pos!.x + pad * dpr,
			pos!.y + pad * dpr + i * lH * dpr,
		),
	); // Draw text
	ctx.restore();
}

export function drawGroupElements(
	ctx: CanvasRenderingContext2D,
	g: ShotGroup,
	i: number,
	activeGroupIndex: number,
	sc: number,
	bulletDiameter: number,
	bulletDiameterUnit: DiameterUnit,
	referenceUnit: LinearUnit,
	resultDisplayUnit: LinearUnit,
	targetDistance: number,
	targetDistanceUnit: DistanceUnit,
	angularUnitDisplay: AngularUnitDisplay,
	selectedHoleIndex: number | null,
	viewScale: number,
	dpr: number,
	lastViewport: ViewportState | null,
	canvasElement: HTMLCanvasElement,
	letterboxParams: LetterboxParams,
	appearance: AppearanceSettings,
): void {
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

	const hC = act ? appearance.bulletHoleColor : appearance.inactiveBulletHoleColor;
	const hSC = appearance.selectedHoleColor;
	const ceC = act ? appearance.centroidColor : 'rgba(0,116,217,0.7)';
	const aiC = act ? appearance.aimPointColor : 'rgba(255,133,27,0.7)';
	const ofC = appearance.offsetLineColor;
	const lW = Math.max(0.5 * dpr, appearance.lineWidthBase * dpr); // Base line width in buffer pixels

	ctx.save();

	// --- Draw Bullet Holes ---
	g.bulletHolesPixels.forEach((hImg: Point, hIdx) => {
		const hCvs = imageToCanvasCoords(hImg, lastViewport, canvasElement, letterboxParams); // Center point in canvas coords
		if (!hCvs) return; // Hole center is not visible

		const bRCvs = bRImg * viewScale * dpr;

		const isSelected = act && hIdx === selectedHoleIndex;
		ctx.strokeStyle = isSelected ? hSC : hC;
		ctx.lineWidth = isSelected
			? Math.max(dpr, lW * appearance.selectedHoleLineWidthMultiplier)
			: lW;
		ctx.beginPath();
		ctx.arc(hCvs.x, hCvs.y, Math.max(dpr * 0.5, bRCvs), 0, Math.PI * 2);
		ctx.stroke();
	});

	// --- Draw Centroid, Aim Point, Offset Line, Info Box ---
	let ceCvs: Point | null = null;
	let aiCvs: Point | null = null;
	if (g.aimingPointPixels)
		aiCvs = imageToCanvasCoords(g.aimingPointPixels, lastViewport, canvasElement, letterboxParams);
	if (g.resultsValid && g.centroidReal)
		ceCvs = imageToCanvasCoords({
			x: g.centroidReal.x * sc,
			y: g.centroidReal.y * sc,
		}, lastViewport, canvasElement, letterboxParams);
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
		const cs = Math.max(4 * dpr, appearance.lineWidthBase * 4 * dpr);
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
				lW * appearance.offsetLineWidthMultiplier,
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
		drawInfoBox(
			ctx,
			g,
			{
				fontSize: appearance.legendFontSize,
				textColor: appearance.legendTextColor,
				bgColor: appearance.legendBgColor,
				borderColor: appearance.legendBorderColor,
			},
			appearance.showGroupNameInLegend,
			targetDistance,
			targetDistanceUnit,
			referenceUnit,
			resultDisplayUnit,
			angularUnitDisplay,
			sc,
			lastViewport,
			canvasElement,
			letterboxParams,
			dpr,
		);
	}
	ctx.restore();
}

export interface RenderCanvasParams {
	ctx: CanvasRenderingContext2D | null;
	canvasElement: HTMLCanvasElement | undefined;
	imageBitmap: ImageBitmap | null;
	viewScale: number;
	viewCenter: Point;
	refLineStart: Point | null;
	refLineEnd: Point | null;
	scale: number | null;
	groups: ShotGroup[];
	activeGroupIndex: number;
	bulletDiameter: number;
	bulletDiameterUnit: DiameterUnit;
	referenceUnit: LinearUnit;
	resultDisplayUnit: LinearUnit;
	targetDistance: number;
	targetDistanceUnit: DistanceUnit;
	angularUnitDisplay: AngularUnitDisplay;
	selectedHoleIndex: number | null;
	dpr: number;
	appearance: AppearanceSettings;
}

export function renderMainCanvas(params: RenderCanvasParams): {
	viewport: ViewportState | null;
	letterbox: LetterboxParams;
} | null {
	const {
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
	} = params;

	if (!ctx || !canvasElement || !imageBitmap) return null;
	const vp = calculateViewport(canvasElement, imageBitmap, viewScale, viewCenter);
	if (!vp) return null;

	const { sx, sy, sWidth, sHeight } = vp;
	const cW = canvasElement.width;
	const cH = canvasElement.height;
	ctx.save();
	ctx.fillStyle = '#000';
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
	const letterbox: LetterboxParams = { dx, dy, dWidth, dHeight };
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
		const sC = imageToCanvasCoords(refLineStart, vp, canvasElement, letterbox);
		const eC = imageToCanvasCoords(refLineEnd, vp, canvasElement, letterbox);
		if (
			sC &&
			eC &&
			Number.isFinite(sC.x) &&
			Number.isFinite(sC.y) &&
			Number.isFinite(eC.x) &&
			Number.isFinite(eC.y)
		) {
			drawScalingLine(
				ctx,
				sC,
				eC,
				appearance.scaleLineColor,
				appearance.lineWidthBase,
				dpr,
			);
		}
	}
	if (scale)
		groups.forEach((g, i) =>
			drawGroupElements(
				ctx,
				g,
				i,
				activeGroupIndex,
				scale,
				bulletDiameter,
				bulletDiameterUnit,
				referenceUnit,
				resultDisplayUnit,
				targetDistance,
				targetDistanceUnit,
				angularUnitDisplay,
				selectedHoleIndex,
				viewScale,
				dpr,
				vp,
				canvasElement,
				letterbox,
				appearance,
			),
		);
	ctx.restore(); // Restore after overlays
	ctx.restore(); // Restore context

	return { viewport: vp, letterbox };
}

export interface ExportCanvasParams {
	imageFile: File | null;
	imageBitmap: ImageBitmap | null;
	scale: number | null;
	refLineStart: Point | null;
	refLineEnd: Point | null;
	groups: ShotGroup[];
	activeGroupIndex: number;
	bulletDiameter: number;
	bulletDiameterUnit: DiameterUnit;
	referenceUnit: LinearUnit;
	resultDisplayUnit: LinearUnit;
	targetDistance: number;
	targetDistanceUnit: DistanceUnit;
	angularUnitDisplay: AngularUnitDisplay;
	viewScale: number;
	appearance: AppearanceSettings;
}

export function exportCanvasAsJpeg(params: ExportCanvasParams): void {
	const {
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
	} = params;

	if (!imageBitmap || !scale) {
		alert('Canvas/image/scale not ready.');
		return;
	}
	const exportCanvas = document.createElement('canvas');
	exportCanvas.width = imageBitmap.width;
	exportCanvas.height = imageBitmap.height;
	const exportCtx = exportCanvas.getContext('2d');
	if (!exportCtx) {
		alert('Failed context.');
		return;
	}
	exportCtx.imageSmoothingEnabled = true;
	exportCtx.fillStyle = '#FFFFFF';
	exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
	exportCtx.drawImage(imageBitmap, 0, 0);
	exportCtx.save(); // Save before overlays
	// Draw Scaling Line
	if (refLineStart && refLineEnd) {
		exportCtx.beginPath();
		exportCtx.moveTo(refLineStart.x, refLineStart.y);
		exportCtx.lineTo(refLineEnd.x, refLineEnd.y);
		exportCtx.strokeStyle = appearance.scaleLineColor;
		exportCtx.lineWidth = appearance.scaleLineWidth;
		exportCtx.setLineDash([]);
		exportCtx.stroke();
		exportCtx.fillStyle = appearance.scaleLineColor;
		const mSize = appearance.scaleMarkerSize;
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
			const bRadiusImg = (bulletDiameterInRefUnit / 2) * scale;
			const hColor = isActive
				? appearance.bulletHoleColor
				: appearance.inactiveBulletHoleColor;
			const cenColor = isActive
				? appearance.centroidColor
				: 'rgba(0,116,217,0.7)';
			const aimColor = isActive
				? appearance.aimPointColor
				: 'rgba(255,133,27,0.7)';
			const offColor = appearance.offsetLineColor;
			const lWidth = appearance.lineWidthBase;
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
					x: group.centroidReal.x * scale,
					y: group.centroidReal.y * scale,
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
						lWidth * appearance.offsetLineWidthMultiplier;
					exportCtx.setLineDash([4, 4]);
					exportCtx.beginPath();
					exportCtx.moveTo(aimImgPx.x, aimImgPx.y);
					exportCtx.lineTo(cenImgPx.x, cenImgPx.y);
					exportCtx.stroke();
					exportCtx.setLineDash([]);
				}
			}
			// --- Draw Info Box (Modified for Scaling) ---
			if (
				group.resultsValid &&
				group.infoBoxAnchorImage // Position still comes from the group
			) {
				const lines: string[] = [];
				if (appearance.showGroupNameInLegend) lines.push(group.name);
				lines.push(
					`(${group.bulletHolesReal.length} shots @ ${targetDistance} ${targetDistanceUnit})`,
				);
				if (group.maxSpread !== null) {
					const d = convertUnits(
						group.maxSpread,
						referenceUnit,
						resultDisplayUnit,
					);
					let l = `Spread: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit}`;
					if (
						angularUnitDisplay === 'moa' &&
						group.maxSpreadMOA !== null
					) {
						l += ` (${group.maxSpreadMOA.toFixed(2)} MOA)`;
					} else if (
						angularUnitDisplay === 'mrad' &&
						group.maxSpreadMRAD !== null
					) {
						l += ` (${group.maxSpreadMRAD.toFixed(2)} MRAD)`;
					}
					lines.push(l);
				} else if (group.bulletHolesReal.length < 2) {
					lines.push(`Spread: N/A (<2 shots)`);
				}

				if (group.meanRadius !== null) {
					const d = convertUnits(
						group.meanRadius,
						referenceUnit,
						resultDisplayUnit,
					);
					let l = `Mean Radius: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit}`;
					if (
						angularUnitDisplay === 'moa' &&
						group.meanRadiusMOA !== null
					) {
						l += ` (${group.meanRadiusMOA.toFixed(2)} MOA)`;
					} else if (
						angularUnitDisplay === 'mrad' &&
						group.meanRadiusMRAD !== null
					) {
						l += ` (${group.meanRadiusMRAD.toFixed(2)} MRAD)`;
					}
					lines.push(l);
				}

				if (group.offsetFromAim !== null) {
					const d = convertUnits(
						group.offsetFromAim.distance,
						referenceUnit,
						resultDisplayUnit,
					);
					lines.push(
						`Offset: ${d.toFixed(3)}${resultDisplayUnit === 'inches' ? '"' : ' ' + resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
					);
				}

				// --- Start Scaling Calculation ---
				const currentViewScale = viewScale || 1.0;
				let scaledFontSize = appearance.legendFontSize / currentViewScale;
				const minExportFontSize = 8;
				const maxExportFontSize = Math.min(appearance.legendFontSize * 5, 72);

				const adjustedFontSize = Math.max(
					minExportFontSize,
					Math.min(maxExportFontSize, scaledFontSize),
				);

				const pad = 4;
				const adjustedLineHeight = adjustedFontSize * 1.2;

				exportCtx.save();
				exportCtx.font = `${adjustedFontSize}px sans-serif`;
				let maxW = 0;
				lines.forEach(
					(ln) =>
						(maxW = Math.max(
							maxW,
							exportCtx.measureText(ln).width,
						)),
				);
				exportCtx.restore();

				const exportBoxW = maxW + pad * 2;
				const exportBoxH =
					lines.length * adjustedLineHeight + pad * 2;

				let infoX = group.infoBoxAnchorImage.x;
				let infoY = group.infoBoxAnchorImage.y;

				infoX = Math.max(
					0,
					Math.min(infoX, exportCanvas.width - exportBoxW),
				);
				infoY = Math.max(
					0,
					Math.min(infoY, exportCanvas.height - exportBoxH),
				);

				const bgColorWithAlpha = appearance.legendBgColor.startsWith('#')
					? appearance.legendBgColor + 'E6'
					: appearance.legendBgColor;
				const LborderColor = appearance.legendBorderColor;
				const LtextColor = appearance.legendTextColor;

				// Draw Box Background & Border
				exportCtx.fillStyle = bgColorWithAlpha;
				exportCtx.strokeStyle = LborderColor;
				exportCtx.lineWidth = 1;
				exportCtx.fillRect(infoX, infoY, exportBoxW, exportBoxH);
				exportCtx.strokeRect(infoX, infoY, exportBoxW, exportBoxH);

				// Draw Text
				exportCtx.fillStyle = LtextColor;
				exportCtx.font = `${adjustedFontSize}px sans-serif`;
				exportCtx.textAlign = 'left';
				exportCtx.textBaseline = 'top';
				lines.forEach((line, i) =>
					exportCtx.fillText(
						line,
						infoX + pad,
						infoY + pad + i * adjustedLineHeight,
					),
				);
			}
		});

	exportCtx.restore(); // Restore after overlays
	try {
		const dataUrl = exportCanvas.toDataURL('image/jpeg', 0.9);
		const link = document.createElement('a');
		const baseName =
			imageFile?.name.replace(/\.[^/.]+$/, '') ?? 'target-analysis';
		link.download = `${baseName}.jpg`;
		link.href = dataUrl;
		link.click();
		link.remove();
	} catch (error) {
		console.error('Error exporting canvas:', error);
		alert('Failed to export image as JPEG.');
	}
}
