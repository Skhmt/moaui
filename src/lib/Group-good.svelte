<!-- This is known to work but not ideally. No major bugs. -->
<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";

    // --- Constants ---
    const IN_TO_MM = 25.4;
    const YARDS_TO_MM = 914.4;
    const METERS_TO_MM = 1000;
    const RAD_TO_MOA = (180 / Math.PI) * 60;
    const RAD_TO_MRAD = 1000;
    const NUDGE_AMOUNT_DISPLAY_PIXELS = 2;
    const ZOOM_FACTOR = 1.2;
    const MIN_ZOOM = 0.2; // Ensure min zoom is 100%
    const MAX_ZOOM = 20.0;
    const MIN_SCALE_LINE_PIXELS = 5;

    // --- Type Definitions ---
    interface Point {
        x: number;
        y: number;
    }
    interface RealPoint {
        x: number;
        y: number;
    }
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
        bulletHolesReal: RealPoint[];
        centroidReal: RealPoint | null;
        meanRadius: number | null;
        meanRadiusMOA: number | null;
        meanRadiusMRAD: number | null;
        maxSpread: number | null;
        maxSpreadMOA: number | null;
        maxSpreadMRAD: number | null;
        aimingPointPixels: Point | null;
        aimingPointReal: RealPoint | null;
        offsetFromAim: { distance: number; angleDegrees: number } | null;
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
    type LinearUnit = "inches" | "cm" | "mm";
    type DistanceUnit = "yards" | "meters";
    type DiameterUnit = "inches" | "mm";
    type AngularUnitDisplay = "moa" | "mrad" | "none";

    // --- State Variables ---
    let imageFile: File | null = null;
    let imageUrl: string | null = null;
    let canvasElement: HTMLCanvasElement | undefined;
    let canvasAreaElement: HTMLDivElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let imageElement: HTMLImageElement | null = null;
    let mode: Mode = "loading";
    let scale: number | null = null;
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

    // --- Lifecycle & Setup ---
    let observer: ResizeObserver | null = null;
    onMount(() => {
        /* ... dpr, observer, listeners ... */
        dpr = window.devicePixelRatio || 1;
        if (canvasAreaElement) {
            // Check the new element
            observer = new ResizeObserver(handleResize);
            observer.observe(canvasAreaElement); // Observe the container div
        }
        window.addEventListener("pointermove", handleWindowPointerMove);
        window.addEventListener("pointerup", handleWindowPointerUp);
        window.addEventListener("keydown", handleKeyDown);
    });
    onDestroy(() => {
        /* ... cleanup ... */
        if (canvasAreaElement && observer) {
            // Check the new element
            observer.unobserve(canvasAreaElement); // Unobserve the container div
        }
        if (imageUrl && imageUrl.startsWith("blob:"))
            URL.revokeObjectURL(imageUrl);
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("keydown", handleKeyDown);
    });
    function handleResize() {
        // Display size changed
        if (!canvasElement || !ctx) return;

        // Calculate the new drawing buffer size needed based on display size and DPR
        const displayWidth = canvasElement.clientWidth;
        const displayHeight = canvasElement.clientHeight;

        if (displayWidth <= 0 || displayHeight <= 0) {
            // Avoid resizing if the canvas is not visible or has no dimensions yet
            return;
        }

        const newBufferWidth = Math.round(displayWidth * dpr);
        const newBufferHeight = Math.round(displayHeight * dpr);

        // Only resize the drawing buffer if it's different from the current size
        // to avoid unnecessary resizing and clearing
        if (
            canvasElement.width !== newBufferWidth ||
            canvasElement.height !== newBufferHeight
        ) {
            canvasElement.width = newBufferWidth;
            canvasElement.height = newBufferHeight;
            console.log(
                `Resized canvas buffer to <span class="math-inline">\{newBufferWidth\}x</span>{newBufferHeight}`,
            );
            // No need to redraw here, redrawCanvas will be called next
        }
        redrawCanvas();
    } // Display size changed

    function setupCanvas(): void {
        if (!canvasElement || !imageUrl) return;
        const context = canvasElement.getContext("2d", { alpha: false });
        if (!context) {
            console.error("No 2D context");
            alert("Canvas init error.");
            reset();
            return;
        }
        ctx = context;
        imageElement = new Image();
        imageElement.onload = () => {
            if (!imageElement || !canvasElement || !ctx) return;
            const logicalWidth = imageElement.naturalWidth;
            const logicalHeight = imageElement.naturalHeight;

            // Set initial buffer size (Keep this from previous step)
            canvasElement.width = logicalWidth * dpr;
            canvasElement.height = logicalHeight * dpr;

            viewCenter = { x: logicalWidth / 2, y: logicalHeight / 2 };
            viewScale = 1.0;
            lastViewport = null;

            if (groups.length === 0) addNewGroup();

            requestAnimationFrame(() => {
                // --- ADD setTimeout ---
                // Defer calculations slightly to allow browser layout to stabilize
                setTimeout(() => {
                    // Add checks in case component/canvas is destroyed before timeout runs
                    if (!canvasElement || !imageElement) return;
                    resetZoomToFit(); // This reads clientWidth/Height
                    redrawCanvas(); // This calls calculateViewport which reads clientWidth/Height
                }, 10); // Use a small delay (e.g., 10ms, maybe even 0)
                // --- END setTimeout ---
            });
            mode = "scaling";
        };
        imageElement.onerror = () => {
            //
            alert("Image load error.");
            reset();
        };
        imageElement.src = imageUrl;
    }

    // --- Unit Conversion ---
    function convertLinearValue(
        v: number,
        from: LinearUnit | DiameterUnit | DistanceUnit,
        to: LinearUnit | DistanceUnit,
    ): number {
        /*...*/ if (from === to) return v;
        let mm: number;
        switch (from) {
            case "inches":
                mm = v * IN_TO_MM;
                break;
            case "cm":
                mm = v * 10;
                break;
            case "mm":
                mm = v;
                break;
            case "yards":
                mm = v * YARDS_TO_MM;
                break;
            case "meters":
                mm = v * METERS_TO_MM;
                break;
            default:
                return v;
        }
        switch (to) {
            case "inches":
                return mm / IN_TO_MM;
            case "cm":
                return mm / 10;
            case "mm":
                return mm;
            case "yards":
                return mm / YARDS_TO_MM;
            case "meters":
                return mm / METERS_TO_MM;
            default:
                return v;
        }
    }

    // --- Coordinate Transformation ---
    function imageToCanvasCoords(imgP: Point): Point | null {
        if (!lastViewport || !canvasElement) return null;
        const { sx, sy, sWidth, sHeight } = lastViewport;
        const cW = canvasElement.width;
        const cH = canvasElement.height;
        const rX = imgP.x - sx;
        const rY = imgP.y - sy;
        const cX = (rX / sWidth) * cW;
        const cY = (rY / sHeight) * cH;
        return { x: cX, y: cY };
    }
    function canvasToImageCoords(cvsPtrP: Point): Point | null {
        if (
            !lastViewport ||
            !canvasElement ||
            !canvasElement.clientWidth ||
            !canvasElement.clientHeight
        )
            return null;
        const { sx, sy, sWidth, sHeight } = lastViewport;
        const dW = canvasElement.clientWidth;
        const dH = canvasElement.clientHeight;
        const pX = cvsPtrP.x / dW;
        const pY = cvsPtrP.y / dH;
        const imgX = sx + pX * sWidth;
        const imgY = sy + pY * sHeight;
        return { x: imgX, y: imgY };
    }

    // --- Viewport Calculation ---
    function calculateViewport(): ViewportState | null {
        if (
            !canvasElement ||
            !imageElement ||
            !imageElement.complete ||
            !imageElement.naturalWidth
        )
            return null;
        const imgW = imageElement.naturalWidth;
        const imgH = imageElement.naturalHeight;
        let sW = canvasElement.clientWidth / viewScale;
        let sH = canvasElement.clientHeight / viewScale;
        sW = Math.min(sW, imgW);
        sH = Math.min(sH, imgH);
        let sx = viewCenter.x - sW / 2;
        let sy = viewCenter.y - sH / 2;
        sx = Math.max(0, Math.min(sx, imgW - sW));
        sy = Math.max(0, Math.min(sy, imgH - sH));
        sW = Math.min(sW, imgW - sx);
        sH = Math.min(sH, imgH - sy);
        if (sW <= 0) sW = 1;
        if (sH <= 0) sH = 1;
        return { sx, sy, sWidth: sW, sHeight: sH };
    }

    // --- Drawing Functions ---
    function redrawCanvas(): void {
        if (
            !ctx ||
            !canvasElement ||
            !imageElement ||
            !imageElement.complete ||
            !imageElement.naturalWidth
        )
            return;
        const vp = calculateViewport();
        if (!vp) return;
        lastViewport = vp;
        const { sx, sy, sWidth, sHeight } = vp;
        const cW = canvasElement.width;
        const cH = canvasElement.height;
        ctx.save();
        ctx.fillStyle = "#FFF";
        ctx.fillRect(0, 0, cW, cH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imageElement, sx, sy, sWidth, sHeight, 0, 0, cW, cH);
        if (refLineStart && refLineEnd) {
            const sC = imageToCanvasCoords(refLineStart);
            const eC = imageToCanvasCoords(refLineEnd);
            if (sC && eC) drawScalingLine(ctx, sC, eC);
        }
        if (scale) {
            groups.forEach((g, i) => drawGroupElements(ctx!, g, i, scale!));
        }
        ctx.restore();
    }
    function drawScalingLine(
        ctx: CanvasRenderingContext2D,
        startC: Point,
        endC: Point,
    ) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startC.x, startC.y);
        ctx.lineTo(endC.x, endC.y);
        ctx.strokeStyle = "lime";
        ctx.lineWidth = Math.max(dpr, 2 * dpr);
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.fillStyle = "lime";
        const mS = Math.max(2 * dpr, 6 * dpr);
        ctx.fillRect(startC.x - mS / 2, startC.y - mS / 2, mS, mS);
        ctx.fillRect(endC.x - mS / 2, endC.y - mS / 2, mS, mS);
        ctx.restore();
    }
    function drawGroupElements(
        ctx: CanvasRenderingContext2D,
        g: ShotGroup,
        i: number,
        sc: number,
    ) {
        const act = i === activeGroupIndex;
        const dUnit = convertLinearValue(
            bulletDiameter,
            bulletDiameterUnit,
            referenceUnit,
        );
        const bRImg = (dUnit / 2) * sc;
        const lPR = ctx.canvas.width / lastViewport!.sWidth;
        const bRCvs = bRImg * lPR;
        const hC = act ? "#FF4136" : "rgba(255,65,54,0.7)";
        const hSC = "#FFDC00";
        const ceC = act ? "#0074D9" : "rgba(0,116,217,0.7)";
        const aiC = act ? "#FF851B" : "rgba(255,133,27,0.7)";
        const ofC = "#00BFFF";
        const lW = Math.max(0.5 * dpr, 1.5 * dpr);
        ctx.save();
        g.bulletHolesPixels.forEach((hImg: Point, hIdx) => {
            const hCvs = imageToCanvasCoords(hImg);
            if (!hCvs) return;
            ctx.strokeStyle = act && hIdx === selectedHoleIndex ? hSC : hC;
            ctx.lineWidth =
                act && hIdx === selectedHoleIndex ? Math.max(dpr, 3 * dpr) : lW;
            ctx.beginPath();
            ctx.arc(hCvs.x, hCvs.y, Math.max(dpr, bRCvs), 0, Math.PI * 2);
            ctx.stroke();
        });
        let ceCvs: Point | null = null;
        let aiCvs: Point | null = null;
        if (g.aimingPointPixels)
            aiCvs = imageToCanvasCoords(g.aimingPointPixels);
        if (g.resultsValid && g.centroidReal) {
            const ceImg = {
                x: g.centroidReal.x * sc,
                y: g.centroidReal.y * sc,
            };
            ceCvs = imageToCanvasCoords(ceImg);
        }
        if (ceCvs) {
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
            ctx.strokeStyle = aiC;
            ctx.lineWidth = lW;
            const dS = Math.max(dpr, 3 * dpr);
            ctx.setLineDash([dS, dS]);
            const cs = Math.max(4 * dpr, 8 * dpr);
            ctx.beginPath();
            ctx.moveTo(aiCvs.x - cs, aiCvs.y);
            ctx.lineTo(aiCvs.x + cs, aiCvs.y);
            ctx.moveTo(aiCvs.x, aiCvs.y - cs);
            ctx.lineTo(aiCvs.x, aiCvs.y + cs);
            ctx.stroke();
            ctx.setLineDash([]);
            if (ceCvs) {
                ctx.strokeStyle = ofC;
                ctx.lineWidth = Math.max(0.5 * dpr, lW * 0.8);
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
            drawInfoBox(ctx, g);
        }
        ctx.restore();
    }
    function drawInfoBox(context: CanvasRenderingContext2D, group: ShotGroup) {
        const lines: string[] = []; // Generate text lines...
        lines.push(`${group.name} (${group.bulletHolesReal.length} shots)`);
        if (group.maxSpread !== null) {
            const d = convertLinearValue(
                group.maxSpread,
                referenceUnit,
                resultDisplayUnit,
            );
            let l = `Spread: ${d.toFixed(3)} ${resultDisplayUnit}`;
            if (angularUnitDisplay === "moa" && group.maxSpreadMOA !== null)
                l += ` (${group.maxSpreadMOA.toFixed(2)} MOA)`;
            else if (
                angularUnitDisplay === "mrad" &&
                group.maxSpreadMRAD !== null
            )
                l += ` (${group.maxSpreadMRAD.toFixed(2)} MRAD)`;
            lines.push(l);
        } else if (group.bulletHolesReal.length < 2) {
            lines.push(`Spread: N/A (<2 shots)`);
        }
        if (group.meanRadius !== null) {
            const d = convertLinearValue(
                group.meanRadius,
                referenceUnit,
                resultDisplayUnit,
            );
            let l = `Mean Radius: ${d.toFixed(3)} ${resultDisplayUnit}`;
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
            const d = convertLinearValue(
                group.offsetFromAim.distance,
                referenceUnit,
                resultDisplayUnit,
            );
            lines.push(
                `Offset: ${d.toFixed(3)} ${resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
            );
        }

        context.save();
        const fS = 11;
        const pad = 4;
        const lH = fS * 1.2;
        context.font = `${fS}px sans-serif`;
        let maxW = 0;
        lines.forEach((ln) => {
            maxW = Math.max(maxW, context.measureText(ln).width);
        });
        const boxW = maxW + pad * 2;
        const boxH = lines.length * lH + pad * 2;
        if (
            !group.infoBoxSize ||
            group.infoBoxSize.width !== boxW ||
            group.infoBoxSize.height !== boxH
        ) {
            group.infoBoxSize = { width: boxW, height: boxH };
        }
        context.restore();

        if (!group.infoBoxAnchorImage && group.centroidReal && scale) {
            const cenImg = {
                x: group.centroidReal.x * scale,
                y: group.centroidReal.y * scale,
            };
            const offX = 15;
            group.infoBoxAnchorImage = {
                x: cenImg.x + offX,
                y:
                    cenImg.y -
                    boxH /
                        2 /
                        (context.canvas.height / lastViewport!.sHeight / dpr),
            };
            groups = groups;
        }
        let pos: Point | null = null;
        if (group.infoBoxAnchorImage) {
            pos = imageToCanvasCoords(group.infoBoxAnchorImage);
        }
        if (!pos) return;
        pos.x = Math.max(0, Math.min(pos.x, context.canvas.width - boxW * dpr));
        pos.y = Math.max(
            0,
            Math.min(pos.y, context.canvas.height - boxH * dpr),
        );

        context.save();
        // *** CHANGE: Legend background to black ***
        const bgColor = "#000000"; // Black background
        const style = getComputedStyle(document.documentElement);
        const borderColor =
            style.getPropertyValue("--border-color").trim() || "#555";
        const textColor =
            style.getPropertyValue("--text-color").trim() || "#e0e0e0";

        context.fillStyle = `${bgColor}E6`; // Black with some transparency
        context.strokeStyle = borderColor;
        context.lineWidth = 1 * dpr;
        context.fillRect(pos.x, pos.y, boxW * dpr, boxH * dpr);
        context.strokeRect(pos.x, pos.y, boxW * dpr, boxH * dpr);
        context.fillStyle = textColor;
        context.font = `${fS * dpr}px sans-serif`;
        context.textAlign = "left";
        context.textBaseline = "top";
        lines.forEach((line, i) => {
            context.fillText(
                line,
                pos!.x + pad * dpr,
                pos!.y + pad * dpr + i * lH * dpr,
            );
        });
        context.restore();
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
        if (!canvasElement || !ctx || !lastViewport) return;
        const dCoords = getCanvasDisplayCoords(e);
        if (!dCoords) return;
        isDraggingInfoBox = false;
        isPanning = false;
        for (let i = groups.length - 1; i >= 0; i--) {
            const g = groups[i];
            if (g.resultsValid && g.infoBoxAnchorImage && g.infoBoxSize) {
                const aImg = g.infoBoxAnchorImage;
                const sLog = g.infoBoxSize;
                const aCvsLog = imageToCanvasCoords(aImg);
                if (aCvsLog) {
                    const bLogR: Rect = {
                        x: aCvsLog.x,
                        y: aCvsLog.y,
                        width: sLog.width * dpr,
                        height: sLog.height * dpr,
                    };
                    const dRect: Rect = {
                        x:
                            (bLogR.x / canvasElement.width) *
                            canvasElement.clientWidth,
                        y:
                            (bLogR.y / canvasElement.height) *
                            canvasElement.clientHeight,
                        width:
                            (bLogR.width / canvasElement.width) *
                            canvasElement.clientWidth,
                        height:
                            (bLogR.height / canvasElement.height) *
                            canvasElement.clientHeight,
                    };
                    if (isPointInRect(dCoords, dRect)) {
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
        if (mode === "panning") {
            isPanning = true;
            panStartPointerCoords = dCoords;
            panStartViewCenter = { ...viewCenter };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            canvasElement.style.cursor = "grabbing";
            e.stopPropagation();
            return;
        }
        const iCoords = canvasToImageCoords(dCoords);
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
        if (!canvasElement || !lastViewport) return;
        const curPtrD = getCanvasDisplayCoords(e);
        if (!curPtrD) return;
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
            canvasElement.hasPointerCapture(e.pointerId)
        ) {
            const dxD = curPtrD.x - dragStartPointerCoords.x;
            const dyD = curPtrD.y - dragStartPointerCoords.y;
            const g = groups[draggingGroupIndex];
            if (g) {
                const dxI =
                    (dxD / canvasElement.clientWidth) * lastViewport.sWidth;
                const dyI =
                    (dyD / canvasElement.clientHeight) * lastViewport.sHeight;
                const nAX = dragStartInfoBoxAnchorImage.x + dxI;
                const nAY = dragStartInfoBoxAnchorImage.y + dyI;
                g.infoBoxAnchorImage = { x: nAX, y: nAY };
                groups = groups;
                requestAnimationFrame(redrawCanvas);
            }
        } else if (
            mode === "scaling" &&
            isDrawingRefLine &&
            refLineStart &&
            canvasElement.hasPointerCapture(e.pointerId)
        ) {
            const curPtrI = canvasToImageCoords(curPtrD);
            if (curPtrI) {
                refLineEnd = curPtrI;
                redrawCanvas();
            }
        }
    }
    function handleWindowPointerUp(e: PointerEvent) {
        let drag = false;
        let proc = false;
        if (isPanning && canvasElement?.hasPointerCapture(e.pointerId)) {
            drag = true;
            proc = true;
            canvasElement.releasePointerCapture(e.pointerId);
            isPanning = false;
            panStartPointerCoords = null;
            panStartViewCenter = null;
            if (canvasElement)
                canvasElement.style.cursor =
                    mode === "panning" ? "grab" : canvasCursor;
            redrawCanvas();
        } else if (
            isDraggingInfoBox &&
            canvasElement?.hasPointerCapture(e.pointerId)
        ) {
            drag = true;
            proc = true;
            canvasElement.releasePointerCapture(e.pointerId);
            isDraggingInfoBox = false;
            draggingGroupIndex = null;
            dragStartPointerCoords = null;
            dragStartInfoBoxAnchorImage = null;
            redrawCanvas();
        } else if (
            mode === "scaling" &&
            isDrawingRefLine &&
            canvasElement?.hasPointerCapture(e.pointerId)
        ) {
            drag = true;
            proc = true;
            canvasElement.releasePointerCapture(e.pointerId);
            isDrawingRefLine = false;
            const finalPtrD = getCanvasDisplayCoords(e);
            if (finalPtrD) {
                const finalI = canvasToImageCoords(finalPtrD);
                if (finalI) refLineEnd = finalI;
            }
            if (refLineStart && refLineEnd) {
                const ok = calculateScale();
                if (ok) {
                    mode = "placingHoles";
                } else {
                    refLineStart = null;
                    refLineEnd = null;
                }
            } else {
                refLineStart = null;
                refLineEnd = null;
            }
            redrawCanvas();
        }
        if (drag) {
            ignoreNextClick = true;
            setTimeout(() => {
                ignoreNextClick = false;
            }, 50);
        }
    }
    async function handleCanvasClick(e: MouseEvent) {
        if (ignoreNextClick) {
            ignoreNextClick = false;
            return;
        }
        if (isDrawingRefLine || isPanning) return;
        if (!canvasElement || activeGroupIndex === -1) return;
        const dCoords = getCanvasDisplayCoords(e);
        if (!dCoords) return;
        const iCoords = canvasToImageCoords(dCoords);
        if (!iCoords) return;
        const g = groups[activeGroupIndex];
        if (mode === "placingHoles" && scale) {
            const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale };
            g.bulletHolesPixels.push(iCoords);
            g.bulletHolesReal.push(rCoords);
            selectedHoleIndex = g.bulletHolesPixels.length - 1;
            invalidateResults(activeGroupIndex);
            groups = groups;
            await tick();
            calculateGroupResults(activeGroupIndex);
            redrawCanvas();
        } else if (mode === "placingAim" && scale) {
            const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale };
            g.aimingPointPixels = iCoords;
            g.aimingPointReal = rCoords;
            invalidateResults(activeGroupIndex);
            groups = groups;
            await tick();
            calculateGroupResults(activeGroupIndex);
            mode = "placingHoles";
            redrawCanvas();
        } else if (mode === "selectingHole") {
            if (!scale || !lastViewport) return;
            const lPR = canvasElement.width / lastViewport.sWidth;
            const cRL = 15 * dpr;
            const cRI = cRL / lPR;
            const cRISq = cRI * cRI;
            let found = false;
            let cIdx = -1;
            let mDSq = Infinity;
            for (let i = g.bulletHolesPixels.length - 1; i >= 0; i--) {
                const h = g.bulletHolesPixels[i];
                const dx = iCoords.x - h.x;
                const dy = iCoords.y - h.y;
                const dSq = dx * dx + dy * dy;
                if (dSq < cRISq && dSq < mDSq) {
                    mDSq = dSq;
                    cIdx = i;
                    found = true;
                }
            }
            selectedHoleIndex = found ? cIdx : null;
            redrawCanvas();
        }
    }
    function handleKeyDown(e: KeyboardEvent) {
        if (
            activeGroupIndex === -1 ||
            !scale ||
            !lastViewport ||
            !canvasElement
        )
            return;
        if (selectedHoleIndex !== null) {
            let dxI = 0;
            let dyI = 0;
            const nudX =
                (NUDGE_AMOUNT_DISPLAY_PIXELS / canvasElement.clientWidth) *
                lastViewport.sWidth;
            const nudY =
                (NUDGE_AMOUNT_DISPLAY_PIXELS / canvasElement.clientHeight) *
                lastViewport.sHeight;
            switch (e.key) {
                case "ArrowUp":
                    dyI = -nudY;
                    break;
                case "ArrowDown":
                    dyI = nudY;
                    break;
                case "ArrowLeft":
                    dxI = -nudX;
                    break;
                case "ArrowRight":
                    dxI = nudX;
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
            alert(`Ref line < ${MIN_SCALE_LINE_PIXELS} pixels.`);
            scale = null;
            return false;
        }
        const newSc = lenPx / referenceLength;
        if (newSc === scale) return true;
        scale = newSc;
        groups.forEach((g, i) => {
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
            g.infoBoxAnchorImage = null;
        });
        groups = groups;
        tick().then(() => {
            groups.forEach((_, i) => calculateGroupResults(i));
            redrawCanvas();
        });
        console.log(`Scale: ${scale.toFixed(3)} px/${referenceUnit}`);
        return true;
    }
    function calculateGroupResults(idx: number) {
        if (idx < 0 || idx >= groups.length || !scale) return;
        const g = groups[idx];
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
        let sX = 0,
            sY = 0;
        g.bulletHolesReal.forEach((h) => {
            sX += h.x;
            sY += h.y;
        });
        const n = g.bulletHolesReal.length;
        const cX = sX / n;
        const cY = sY / n;
        g.centroidReal = { x: cX, y: cY };
        let sD = 0;
        g.bulletHolesReal.forEach((h) => {
            const dx = h.x - cX,
                dy = h.y - cY;
            sD += Math.sqrt(dx * dx + dy * dy);
        });
        g.meanRadius = sD / n;
        if (n >= 2) {
            let mDSq = 0;
            for (let i = 0; i < n; i++)
                for (let j = i + 1; j < n; j++) {
                    const dx = g.bulletHolesReal[i].x - g.bulletHolesReal[j].x;
                    const dy = g.bulletHolesReal[i].y - g.bulletHolesReal[j].y;
                    mDSq = Math.max(mDSq, dx * dx + dy * dy);
                }
            g.maxSpread = Math.sqrt(mDSq);
        } else {
            g.maxSpread = null;
        }
        if (targetDistance > 0) {
            const dMM = convertLinearValue(
                targetDistance,
                targetDistanceUnit,
                "mm",
            );
            if (dMM > 0) {
                if (g.meanRadius !== null) {
                    const rMM = convertLinearValue(
                        g.meanRadius,
                        referenceUnit,
                        "mm",
                    );
                    const aR = rMM / dMM;
                    g.meanRadiusMOA = aR * RAD_TO_MOA;
                    g.meanRadiusMRAD = aR * RAD_TO_MRAD;
                }
                if (g.maxSpread !== null) {
                    const sMM = convertLinearValue(
                        g.maxSpread,
                        referenceUnit,
                        "mm",
                    );
                    const aR = sMM / dMM;
                    g.maxSpreadMOA = aR * RAD_TO_MOA;
                    g.maxSpreadMRAD = aR * RAD_TO_MRAD;
                }
            }
        } else {
            g.meanRadiusMOA = null;
            g.meanRadiusMRAD = null;
            g.maxSpreadMOA = null;
            g.maxSpreadMRAD = null;
        }
        if (g.aimingPointReal && g.centroidReal) {
            const dx = g.centroidReal.x - g.aimingPointReal.x;
            const dy = g.centroidReal.y - g.aimingPointReal.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let aR = Math.atan2(-dy, dx);
            if (aR < 0) aR += 2 * Math.PI;
            g.offsetFromAim = {
                distance: dist,
                angleDegrees: aR * (180 / Math.PI),
            };
        } else {
            g.offsetFromAim = null;
        }
        g.resultsValid = true;
        groups = groups;
        redrawCanvas();
    }
    function invalidateResults(idx: number) {
        if (idx >= 0 && idx < groups.length && groups[idx].resultsValid) {
            groups[idx].resultsValid = false;
            groups = groups;
        }
    }

    // --- Group Management ---
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
        if (!imageUrl) mode = "loading";
        else if (!scale) mode = "scaling";
        else mode = "placingHoles";
        redrawCanvas();
    }
    function switchToGroup(idx: number) {
        if (idx >= 0 && idx < groups.length && idx !== activeGroupIndex) {
            activeGroupIndex = idx;
            selectedHoleIndex = null;
            if (scale) mode = "placingHoles";
            else if (imageUrl) mode = "scaling";
            redrawCanvas();
        }
    }
    async function deleteGroup(idx: number) {
        if (idx < 0 || idx >= groups.length) return;
        const gName = groups[idx]?.name ?? `Group ${idx + 1}`;
        if (!confirm(`Delete ${gName}?`)) return;
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
            switchToGroup(activeGroupIndex);
            redrawCanvas();
        }
    }

    // --- Point Deletion ---
    async function deleteSelectedHole() {
        if (activeGroupIndex === -1 || selectedHoleIndex === null) return;
        const g = groups[activeGroupIndex];
        if (selectedHoleIndex >= g.bulletHolesPixels.length) {
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

    // --- Nudging ---
    async function nudgeSelectedHolePx(dxI: number, dyI: number) {
        if (
            scale &&
            activeGroupIndex !== -1 &&
            selectedHoleIndex !== null &&
            selectedHoleIndex <
                groups[activeGroupIndex].bulletHolesPixels.length
        ) {
            const g = groups[activeGroupIndex];
            const hPx = g.bulletHolesPixels[selectedHoleIndex];
            hPx.x += dxI;
            hPx.y += dyI;
            if (imageElement) {
                hPx.x = Math.max(0, Math.min(hPx.x, imageElement.naturalWidth));
                hPx.y = Math.max(
                    0,
                    Math.min(hPx.y, imageElement.naturalHeight),
                );
            }
            const hRl = g.bulletHolesReal[selectedHoleIndex];
            hRl.x = hPx.x / scale;
            hRl.y = hPx.y / scale;
            invalidateResults(activeGroupIndex);
            groups = groups;
            await tick();
            calculateGroupResults(activeGroupIndex);
            redrawCanvas();
        }
    }

    // --- Zoom Controls ---
    function zoom(factor: number, cX?: number, cY?: number) {
        if (!imageElement || !canvasElement || !lastViewport) return;
        const curS = viewScale;
        const newS = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, curS * factor));
        if (newS === curS) return;
        let imgX = viewCenter.x;
        let imgY = viewCenter.y;
        if (cX !== undefined && cY !== undefined) {
            const dC = getCanvasDisplayCoords({
                clientX: cX,
                clientY: cY,
            } as PointerEvent);
            if (dC) {
                const iC = canvasToImageCoords(dC);
                if (iC) {
                    imgX = iC.x;
                    imgY = iC.y;
                }
            }
        }
        viewCenter.x = imgX - (imgX - viewCenter.x) * (curS / newS);
        viewCenter.y = imgY - (imgY - viewCenter.y) * (curS / newS);
        viewScale = newS;
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
        if (!imageElement || !canvasElement) return;
        const imgW = imageElement.naturalWidth;
        const imgH = imageElement.naturalHeight;
        const dW = canvasElement.clientWidth;
        const dH = canvasElement.clientHeight;
        let fitScale = 1.0; // Default to 100%
        if (imgW > 0 && imgH > 0 && dW > 0 && dH > 0) {
            fitScale = Math.min(dW / imgW, dH / imgH);
        }
        // *** CHANGE: Ensure zoom is at least 1.0 (or fit scale if image is smaller than display) ***
        viewScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
        viewCenter = { x: imgW / 2, y: imgH / 2 };
        clampViewCenter(); // Clamp needed after scale change
    }
    function resetZoom() {
        if (!imageElement) return;
        resetZoomToFit();
        redrawCanvas();
    }
    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY);
        const factor = delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        zoom(factor, e.clientX, e.clientY);
    }

    // --- Scale Controls ---
    function enterScaleMode() {
        mode = "scaling";
        refLineStart = null;
        refLineEnd = null;
        isDrawingRefLine = false;
        selectedHoleIndex = null;
        redrawCanvas();
    }

    // --- View Clamping ---
    function clampViewCenter() {
        if (!imageElement || !canvasElement || !imageElement.naturalWidth)
            return;
        const imgW = imageElement.naturalWidth;
        const imgH = imageElement.naturalHeight;
        const sW = canvasElement.clientWidth / viewScale;
        const sH = canvasElement.clientHeight / viewScale;
        const minX = sW / 2;
        const maxX = imgW - sW / 2;
        const minY = sH / 2;
        const maxY = imgH - sH / 2;
        if (imgW > sW)
            viewCenter.x = Math.max(minX, Math.min(viewCenter.x, maxX));
        else viewCenter.x = imgW / 2;
        if (imgH > sH)
            viewCenter.y = Math.max(minY, Math.min(viewCenter.y, maxY));
        else viewCenter.y = imgH / 2;
    }

    // --- Utility ---
    function resetStateForNewImage() {
        scale = null;
        refLineStart = null;
        refLineEnd = null;
        isDrawingRefLine = false;
        groups = [];
        activeGroupIndex = -1;
        nextGroupId = 0;
        selectedHoleIndex = null;
        isDraggingInfoBox = false;
        draggingGroupIndex = null;
        dragStartPointerCoords = null;
        dragStartInfoBoxAnchorImage = null;
        ignoreNextClick = false;
        viewScale = 1.0;
        viewCenter = { x: 0, y: 0 };
        lastViewport = null;
        isPanning = false;
        panStartPointerCoords = null;
        panStartViewCenter = null;
        mode = "loading";
    }
    function reset() {
        if (!confirm("Start over? Data lost.")) return;
        resetStateForNewImage();
        if (ctx && canvasElement)
            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        if (imageUrl && imageUrl.startsWith("blob:"))
            URL.revokeObjectURL(imageUrl);
        imageFile = null;
        imageUrl = null;
        imageElement = null;
        ctx = null;
        if (fileInputEl) fileInputEl.value = "";
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
        if (targetDistance >= 0) {
            groups.forEach((_, i) => calculateGroupResults(i));
        } else {
            groups.forEach((g) => {
                g.maxSpreadMOA = null;
                g.maxSpreadMRAD = null;
                g.meanRadiusMOA = null;
                g.meanRadiusMRAD = null;
            });
            groups = groups;
            redrawCanvas();
        }
    }
    function handleReferenceInputChange() {
        if (refLineStart && refLineEnd) {
            calculateScale();
        } else {
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

    // --- Export Canvas Function ---
    function exportCanvasAsJpeg(): void {
        // Renamed
        if (!canvasElement || !imageElement || !ctx) {
            alert("Canvas/image not ready.");
            return;
        }
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = imageElement.naturalWidth;
        exportCanvas.height = imageElement.naturalHeight;
        const exportCtx = exportCanvas.getContext("2d");
        if (!exportCtx) {
            alert("Failed export context.");
            return;
        }
        exportCtx.imageSmoothingEnabled = false;
        exportCtx.fillStyle = "#FFFFFF";
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height); // White BG for JPEG
        exportCtx.drawImage(imageElement, 0, 0);
        exportCtx.save();
        // Draw Overlays (using fixed sizes suitable for full res image)
        if (refLineStart && refLineEnd) {
            exportCtx.beginPath();
            exportCtx.moveTo(refLineStart.x, refLineStart.y);
            exportCtx.lineTo(refLineEnd.x, refLineEnd.y);
            exportCtx.strokeStyle = "lime";
            exportCtx.lineWidth = 2;
            exportCtx.setLineDash([]);
            exportCtx.stroke();
            exportCtx.fillStyle = "lime";
            const mSize = 6;
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
        if (scale) {
            groups.forEach((group, index) => {
                const isActive = index === activeGroupIndex;
                const dUnit = convertLinearValue(
                    bulletDiameter,
                    bulletDiameterUnit,
                    referenceUnit,
                );
                const bRadiusImg = (dUnit / 2) * scale!;
                const hColor = isActive ? "#FF4136" : "rgba(255,65,54,0.7)";
                const cenColor = isActive ? "#0074D9" : "rgba(0,116,217,0.7)";
                const aimColor = isActive ? "#FF851B" : "rgba(255,133,27,0.7)";
                const offColor = "#00BFFF";
                const lWidth = 1.5;
                exportCtx.strokeStyle = hColor;
                exportCtx.lineWidth = lWidth;
                group.bulletHolesPixels.forEach((holeImg: Point) => {
                    exportCtx.beginPath();
                    exportCtx.arc(
                        holeImg.x,
                        holeImg.y,
                        Math.max(1.5, bRadiusImg),
                        0,
                        Math.PI * 2,
                    );
                    exportCtx.stroke();
                });
                let cenImgPx: Point | null = null;
                let aimImgPx: Point | null = group.aimingPointPixels;
                if (group.resultsValid && group.centroidReal)
                    cenImgPx = {
                        x: group.centroidReal.x * scale!,
                        y: group.centroidReal.y * scale!,
                    };
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
                        exportCtx.lineWidth = lWidth * 0.8;
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
                    /* ... Regenerate lines ... */ lines.push(
                        `${group.name} (${group.bulletHolesReal.length} shots)`,
                    );
                    if (group.maxSpread !== null) {
                        const d = convertLinearValue(
                            group.maxSpread,
                            referenceUnit,
                            resultDisplayUnit,
                        );
                        let l = `Spread: ${d.toFixed(3)} ${resultDisplayUnit}`;
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
                    }
                    if (group.meanRadius !== null) {
                        const d = convertLinearValue(
                            group.meanRadius,
                            referenceUnit,
                            resultDisplayUnit,
                        );
                        let l = `Mean Radius: ${d.toFixed(3)} ${resultDisplayUnit}`;
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
                        const d = convertLinearValue(
                            group.offsetFromAim.distance,
                            referenceUnit,
                            resultDisplayUnit,
                        );
                        lines.push(
                            `Offset: ${d.toFixed(3)} ${resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
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
                    const fSize = 11;
                    const pad = 4;
                    const lH = fSize * 1.2;
                    // *** FIX: Use black BG, get other styles at time of export ***
                    const bgColor = "#000000"; // Black background
                    const computedStyle = getComputedStyle(
                        document.documentElement,
                    );
                    const borderColor =
                        computedStyle
                            .getPropertyValue("--border-color")
                            .trim() || "#555";
                    const textColor =
                        computedStyle.getPropertyValue("--text-color").trim() ||
                        "#e0e0e0";

                    exportCtx.fillStyle = `${bgColor}E6`; // Black with some transparency
                    exportCtx.strokeStyle = borderColor;
                    exportCtx.lineWidth = 1;
                    exportCtx.fillRect(infoX, infoY, boxW, boxH);
                    exportCtx.strokeRect(infoX, infoY, boxW, boxH);
                    exportCtx.fillStyle = textColor;
                    exportCtx.font = `${fSize}px sans-serif`;
                    exportCtx.textAlign = "left";
                    exportCtx.textBaseline = "top";
                    lines.forEach((line, i) => {
                        exportCtx.fillText(
                            line,
                            infoX + pad,
                            infoY + pad + i * lH,
                        );
                    });
                }
            });
        }
        exportCtx.restore();
        try {
            const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9); // JPEG format
            const link = document.createElement("a");
            link.download = `${imageFile?.name.replace(/\.[^/.]+$/, "") ?? "target"}-analysis.jpg`; // .jpg extension
            link.href = dataUrl;
            link.click();
            link.remove();
        } catch (error) {
            console.error("Error exporting:", error);
            alert("Failed export.");
        }
    }

    // Reactive derivations
    $: activeGroup =
        activeGroupIndex !== -1 && activeGroupIndex < groups.length
            ? groups[activeGroupIndex]
            : null;
    $: canDeleteHole = activeGroupIndex !== -1 && selectedHoleIndex !== null;
    $: canvasCursor = isPanning
        ? "grabbing"
        : isDraggingInfoBox
          ? "move"
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

<div class="container">
    <div class="main-layout">
        <div class="canvas-column">
            <div class="controls-section">
                <div class="controls">
                    <label for="fileInput">🖼️ Image:</label>
                    <input
                        bind:this={fileInputEl}
                        type="file"
                        id="fileInput"
                        accept="image/*"
                        on:change={handleFileSelect}
                    />
                </div>
            </div>
            {#if imageUrl}
                <div class="interaction-controls">
                    <div class="zoom-pan-save">
                        <button
                            on:click={exportCanvasAsJpeg}
                            title="Save full image + overlays as JPG"
                            class="save-button"
                        >
                            💾 Save
                        </button>
                        <button
                            on:click={zoomIn}
                            disabled={viewScale >= MAX_ZOOM}
                            title="Zoom In (+Wheel Up)">➕</button
                        >
                        <span class="zoom-level"
                            >{Math.round(viewScale * 100)}%</span
                        >
                        <button
                            on:click={zoomOut}
                            disabled={viewScale <= MIN_ZOOM}
                            title="Zoom Out (+Wheel Down)">➖</button
                        >
                        <button
                            on:click={resetZoom}
                            title="Fit Zoom & Reset Pan">🔍 Fit</button
                        >
                    </div>
                    <div class="controls">
                        <label for="refLength">Ref Len:</label>
                        <input
                            type="number"
                            id="refLength"
                            bind:value={referenceLength}
                            min="1"
                            step="1"
                            on:input={handleReferenceInputChange}
                        />
                        <select
                            bind:value={referenceUnit}
                            on:change={handleReferenceInputChange}
                        >
                            <option value="inches">in</option>
                            <option value="cm">cm</option>
                            <option value="mm">mm</option>
                        </select>
                        <button
                            class="secondary"
                            class:active={mode === "scaling"}
                            on:click={enterScaleMode}
                            title="Draw ref line"
                        >
                            📏 {#if mode === "scaling"}Drawing{:else}Draw Ref
                                Line{/if}
                        </button>
                    </div>
                    <div class="mode-buttons">
                        <button
                            class:active={mode === "panning"}
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
                            title="Toggle Pan Mode (Drag canvas)"
                        >
                            🤚 Pan
                        </button>
                        <button
                            class:active={mode === "placingHoles"}
                            on:click={() => {
                                mode = "placingHoles";
                                selectedHoleIndex = null;
                                redrawCanvas();
                            }}
                            title="Place holes"
                            disabled={!scale}
                        >
                            ⭕ Holes
                        </button>
                        <button
                            class:active={mode === "placingAim"}
                            on:click={() => {
                                mode = "placingAim";
                                selectedHoleIndex = null;
                                redrawCanvas();
                            }}
                            title="Set aim point"
                            disabled={!scale}
                        >
                            🎯 Aim Pt
                        </button>
                        <button
                            class:active={mode === "selectingHole"}
                            on:click={() => {
                                mode = "selectingHole";
                                redrawCanvas();
                            }}
                            title="Select/Move hole"
                            disabled={!scale}
                        >
                            👆 Select
                        </button>
                    </div>
                </div>
                <div class="canvas-area-wrapper">
                    <div
                        class="canvas-area"
                        on:wheel={handleWheel}
                        bind:this={canvasAreaElement}
                    >
                        <canvas
                            bind:this={canvasElement}
                            on:pointerdown={handleCanvasPointerDown}
                            on:click={handleCanvasClick}
                            style:cursor={canvasCursor}
                            style:max-width="100%"
                            style:max-height="100%"
                            style:aspect-ratio={imageElement
                                ? imageElement.naturalWidth /
                                  imageElement.naturalHeight
                                : "2/1"}
                        ></canvas>
                    </div>
                    {#if mode === "selectingHole" && selectedHoleIndex !== null}
                        <div class="nudge-overlay">
                            <span>Nudge (Arrows):</span>
                            <div class="nudge-grid">
                                <button
                                    class="nudge"
                                    on:click={() =>
                                        handleKeyDown({
                                            key: "ArrowUp",
                                            preventDefault: () => {},
                                        } as KeyboardEvent)}
                                    title="Nudge Up">↑</button
                                >
                                <button
                                    class="nudge"
                                    on:click={() =>
                                        handleKeyDown({
                                            key: "ArrowLeft",
                                            preventDefault: () => {},
                                        } as KeyboardEvent)}
                                    title="Nudge Left">←</button
                                >
                                <button
                                    class="nudge"
                                    on:click={() =>
                                        handleKeyDown({
                                            key: "ArrowRight",
                                            preventDefault: () => {},
                                        } as KeyboardEvent)}
                                    title="Nudge Right">→</button
                                >
                                <button
                                    class="nudge"
                                    on:click={() =>
                                        handleKeyDown({
                                            key: "ArrowDown",
                                            preventDefault: () => {},
                                        } as KeyboardEvent)}
                                    title="Nudge Down">↓</button
                                >
                            </div>
                            <div class="nudge-actions">
                                <button
                                    class="secondary micro"
                                    on:click={() => {
                                        selectedHoleIndex = null;
                                        redrawCanvas();
                                    }}
                                    title="Deselect">Clear Sel.</button
                                >
                                <button
                                    class="danger micro"
                                    on:click={deleteSelectedHole}
                                    title="Delete (Del/Bksp)"
                                    >Delete Sel.</button
                                >
                            </div>
                        </div>
                    {/if}
                </div>
            {:else if mode !== "loading"}
                <div class="canvas-placeholder">
                    <div class="instructions">Load image to start.</div>
                </div>
            {/if}
        </div>
        <div class="controls-column" bind:this={controlsColumnEl}>
            {#if imageUrl}
                <div class="controls-section">
                    <h2>Settings & Groups</h2>
                    <div class="controls settings-row">
                        <div class="setting-item">
                            <label for="targetDist">Tgt Dist:</label>
                            <input
                                type="number"
                                id="targetDist"
                                bind:value={targetDistance}
                                min="5"
                                step="5"
                                on:input={handleTargetDistanceChange}
                            />
                            <select
                                bind:value={targetDistanceUnit}
                                on:change={handleTargetDistanceChange}
                            >
                                <option value="yards">yd</option>
                                <option value="meters">m</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label for="bulletDiam">Bullet Dia:</label>
                            <input
                                type="number"
                                id="bulletDiam"
                                bind:value={bulletDiameter}
                                min="0.1"
                                step="0.01"
                                on:input={handleDiameterChange}
                            />
                            <select
                                bind:value={bulletDiameterUnit}
                                on:change={handleDiameterChange}
                            >
                                <option value="inches">in</option>
                                <option value="mm">mm</option>
                            </select>
                        </div>
                    </div>
                    <div class="controls settings-row">
                        <div class="setting-item">
                            <label for="resultUnit">Units:</label>
                            <select
                                id="resultUnit"
                                bind:value={resultDisplayUnit}
                                on:change={handleResultUnitChange}
                            >
                                <option value="inches">in</option>
                                <option value="cm">cm</option>
                                <option value="mm">mm</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <label for="angularUnit">Angular:</label>
                            <select
                                id="angularUnit"
                                bind:value={angularUnitDisplay}
                                on:change={handleAngularUnitChange}
                                disabled={targetDistance <= 0}
                                title={targetDistance <= 0
                                    ? "Set Tgt Dist > 0"
                                    : ""}
                            >
                                <option value="moa">MOA</option>
                                <option value="mrad">MIL</option>
                                <option value="none">None</option>
                            </select>
                        </div>
                    </div>
                    <div class="controls group-management">
                        <span>Groups:</span>
                        {#each groups as group, index (group.id)}
                            <button
                                class:active={index === activeGroupIndex}
                                on:click={() => switchToGroup(index)}
                                title="Switch to {group.name}"
                                >{group.name}</button
                            >
                            {#if groups.length > 1}<button
                                    class="danger micro"
                                    on:click|stopPropagation={() =>
                                        deleteGroup(index)}
                                    title="Delete {group.name}">X</button
                                >{/if}
                        {/each}
                        <button
                            class="secondary"
                            on:click={addNewGroup}
                            title="Add new group">+</button
                        >
                    </div>
                    {#if activeGroup}
                        <div class="controls">
                            <label for="groupName">Active Name:</label>
                            <input
                                type="text"
                                id="groupName"
                                bind:value={activeGroup.name}
                                on:input={redrawCanvas}
                            />
                        </div>{/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* :root colors (same as before) */
    :root {
        --bg-color: #242424;
        --bg-secondary-color: #333;
        --text-color: #e0e0e0;
        --text-secondary-color: #b0b0b0;
        --border-color: #555;
        --input-bg-color: #444;
        --input-border-color: #666;
        --primary-color: #007bff;
        --primary-hover-color: #3399ff;
        --secondary-color: #6c757d;
        --secondary-hover-color: #868e96;
        --danger-color: #dc3545;
        --danger-hover-color: #e4606d;
        --warning-color: #ffc107;
        --warning-text-color: #333;
        --warning-hover-color: #ffca2c;
        --info-bg-color: #17a2b8;
        --info-text-color: #e0e0e0;
        --info-border-color: #138496;
        --instruction-bg-color: #3a3f44;
        --instruction-text-color: #d1ecf1;
        --instruction-border-color: #4e555b;
        --instruction-warning-bg-color: #4d3800;
        --instruction-warning-text-color: #ffeeba;
        --instruction-warning-border-color: #664d03;
        --danger-text-color: #f8d7da;
        --danger-bg-color: #58151c;
        --danger-border-color: #842029;
        --highlight-color: #ffdc00;
        --active-border-color: var(--primary-color);
        --active-bg-color: #1a4a7f;
        --active-mode-bg-color: var(--primary-color);
        --active-mode-border-color: var(--primary-hover-color);
        --canvas-border-color: #666;
    }
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        padding: 0;
        width: 100%;
        box-sizing: border-box;
    }
    h1 {
        margin: 0.5em 0 0.3em 0;
        font-size: 1.5em;
        text-align: center;
        width: 100%;
        padding: 0 10px;
        box-sizing: border-box;
    }
    h2 {
        color: var(--text-color);
        font-size: 1.05em;
        margin-bottom: 0.4em;
        margin-top: 0;
        text-align: center;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 5px;
    }
    svg {
        vertical-align: middle;
        margin-right: 3px;
    }

    /* Main Layout */
    .main-layout {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 8px;
        gap: 10px;
        box-sizing: border-box;

        flex-grow: 1;
        min-height: 0; /* Allow main-layout to grow/shrink */
    }
    .canvas-column {
        display: flex;
        flex-direction: column;
        gap: 5px;
        width: 100%;
        box-sizing: border-box;
    }
    .canvas-area-wrapper {
        position: relative;
        width: 100%; /* Needed for absolute positioning of overlay */
    }
    .canvas-area {
        width: 100%;
        margin: 0 auto;
        overflow: hidden; /* Crucial: clips canvas drawing */
        border: 1px solid var(--canvas-border-color);
        position: relative;
        background-color: var(--bg-color); /* Match page bg */
        display: flex; /* Center canvas if smaller */
        justify-content: center;
        align-items: center;
    }
    .canvas-placeholder {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
        width: 100%;
        background-color: var(--bg-secondary-color);
        border: 1px dashed var(--border-color);
        border-radius: 6px;
        padding: 20px;
        box-sizing: border-box;
    }
    canvas {
        display: block;
        touch-action: manipulation; /* Allow pinch zoom maybe? or none? */
        background-color: transparent;
        image-rendering: pixelated; /* width/height/aspect-ratio set via style attribute */
    }

    /* Controls */
    .controls-column {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
    }
    .controls-section {
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 10px;
        background-color: var(--bg-secondary-color);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        align-items: center;
        justify-content: center;
    }
    .controls > span {
        color: var(--text-secondary-color);
        margin-right: 4px;
        font-weight: 500;
        font-size: 0.9em;
    }
    .settings-row {
        justify-content: space-around;
        width: 100%;
        border-bottom: 1px dashed var(--border-color);
        padding-bottom: 8px;
        margin-bottom: 8px;
    }
    .settings-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
        margin-bottom: 0;
    }
    .setting-item {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-basis: 48%;
        flex-grow: 1;
        justify-content: center;
    }
    .group-management {
        border-top: 1px dashed var(--border-color);
        padding-top: 8px;
        margin-top: 8px;
    }
    .group-management button {
        margin-right: 4px;
    }
    .group-management button.active {
        border-color: var(--active-border-color);
        background-color: var(--active-bg-color);
        color: var(--text-color);
        font-weight: bold;
    }
    /* Mode selection moved */
    label {
        margin-right: 3px;
        font-weight: 500;
        color: var(--text-secondary-color);
        white-space: nowrap;
        font-size: 0.85em;
    }
    input[type="number"],
    input[type="text"],
    select {
        padding: 4px 6px;
        border: 1px solid var(--input-border-color);
        border-radius: 3px;
        background-color: var(--input-bg-color);
        color: var(--text-color);
        font-size: 0.85em;
        box-sizing: border-box;
    }
    select {
        appearance: none;
        background-repeat: no-repeat;
        background-position: right 0.5em top 50%;
        background-size: 0.5em auto;
        padding-right: 1.6em;
    }
    input[type="number"] {
        width: 65px;
    }
    select {
        min-width: 50px;
        text-align: center;
        text-align-last: center;
    }
    input[type="text"] {
        flex-grow: 1;
        min-width: 70px;
    }
    button {
        padding: 6px 10px;
        cursor: pointer;
        background-color: var(--primary-color);
        color: #fff;
        border: 1px solid var(--primary-color);
        border-radius: 3px;
        transition:
            background-color 0.2s ease,
            border-color 0.2s ease;
        font-size: 0.85em;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    button:hover:not(:disabled) {
        background-color: var(--primary-hover-color);
        border-color: var(--primary-hover-color);
    }
    button:disabled {
        background-color: #555;
        border-color: #555;
        color: #999;
        cursor: not-allowed;
        opacity: 0.7;
    }
    button.secondary {
        background-color: var(--secondary-color);
        border-color: var(--secondary-color);
        color: var(--text-color);
    }
    button.secondary:hover:not(:disabled) {
        background-color: var(--secondary-hover-color);
        border-color: var(--secondary-hover-color);
    }
    button.danger {
        background-color: var(--danger-color);
        border-color: var(--danger-color);
        color: #fff;
    }
    button.danger:hover:not(:disabled) {
        background-color: var(--danger-hover-color);
        border-color: var(--danger-hover-color);
    }
    button.micro {
        padding: 2px 5px;
        font-size: 0.75em;
        line-height: 1.2;
        margin-left: -4px;
    }
    button.nudge {
        background-color: var(--warning-color);
        border-color: var(--warning-color);
        color: var(--warning-text-color);
        font-size: 1em;
        font-weight: bold;
        padding: 2px 6px;
        min-width: 30px;
    }
    button.nudge:hover:not(:disabled) {
        background-color: var(--warning-hover-color);
        border-color: var(--warning-hover-color);
    }

    /* Interaction Controls Bar */
    .interaction-controls {
        display: flex;
        flex-direction: column;
        gap: 5px;
        background-color: var(--bg-secondary-color);
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid var(--border-color);
    }
    .zoom-pan-save {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start;
    }
    .mode-buttons {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start;
        border-top: 1px dashed var(--border-color);
        padding-top: 5px;
        margin-top: 3px;
    }
    .interaction-controls button {
        padding: 4px 8px;
        font-size: 0.9em;
        min-width: 35px;
        background-color: var(--secondary-color);
        border-color: var(--secondary-color);
    }
    .interaction-controls button svg {
        margin-right: 4px;
    }
    .interaction-controls button:hover:not(:disabled) {
        background-color: var(--secondary-hover-color);
        border-color: var(--secondary-hover-color);
    }
    .interaction-controls button.active {
        background-color: var(--active-mode-bg-color);
        border-color: var(--active-mode-border-color);
        color: white;
    }
    .interaction-controls span.zoom-level {
        font-size: 0.8em;
        color: var(--text-secondary-color);
        margin: 0 5px;
        white-space: nowrap;
    }
    .interaction-controls .save-button {
        background-color: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
        margin-left: auto;
    }
    .interaction-controls .save-button:hover:not(:disabled) {
        background-color: var(--primary-hover-color);
        border-color: var(--primary-hover-color);
    }

    .instructions {
        padding: 6px 10px;
        background-color: var(--instruction-bg-color);
        border: 1px solid var(--instruction-border-color);
        border-radius: 4px;
        color: var(--instruction-text-color);
        text-align: center;
        width: 100%;
        box-sizing: border-box;
        font-size: 0.8em;
        margin-top: 3px;
        line-height: 1.4;
    }
    .instructions.info {
        background-color: #2a4a52;
        color: var(--info-text-color);
        border-color: var(--info-border-color);
    }
    .instructions.warning {
        background-color: var(--instruction-warning-bg-color);
        color: var(--instruction-warning-text-color);
        border-color: var(--instruction-warning-border-color);
    }
    .warning {
        color: var(--danger-text-color);
        background-color: var(--danger-bg-color);
        border: 1px solid var(--danger-border-color);
        padding: 5px;
        border-radius: 3px;
        text-align: center;
        margin-top: 3px;
        font-size: 0.8em;
    }

    /* Nudge Overlay */
    .nudge-overlay {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 10;
        background-color: rgba(
            51,
            51,
            51,
            0.85
        ); /* Slightly transparent background */
        border: 1px solid var(--border-color);
        border-radius: 5px;
        padding: 8px;
        box-shadow: 2px 2px 6px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
    }
    .nudge-overlay > span {
        display: block;
        text-align: center;
        width: 100%;
        margin-bottom: 3px;
        font-size: 0.9em;
        color: var(--text-secondary-color);
    }
    .nudge-grid {
        display: grid;
        grid-template-columns: repeat(3, auto);
        gap: 4px;
        justify-content: center;
        margin-bottom: 5px;
    }
    .nudge-grid button:nth-child(1) {
        grid-column: 2;
    }
    .nudge-grid button:nth-child(2) {
        grid-column: 1;
        grid-row: 2;
    }
    .nudge-grid button:nth-child(3) {
        grid-column: 3;
        grid-row: 2;
    }
    .nudge-grid button:nth-child(4) {
        grid-column: 2;
        grid-row: 3;
    }
    .nudge-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
        width: 100%;
    }
    .nudge-actions button.micro {
        margin-left: 0;
    } /* Remove neg margin */

    /* Desktop Layout */
    @media (min-width: 992px) {
        .main-layout {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            padding: 15px;
            gap: 15px;
        }
        .canvas-column {
            flex: 3;
            order: 1;
            overflow: hidden;
            min-height: 0;
            display: grid;
            grid-template-rows: auto 1fr;
        } /* Adjusted max-height */
        .canvas-area-wrapper {
            position: relative;
            display: flex; /* Let canvas-area center */
            align-items: center;
            justify-content: center;
            /* min-height: 150px; */
            min-height: 0;
        } /* Allow wrapper to grow */
        .canvas-area {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            border: 1px solid var(--canvas-border-color);
        } /* Let canvas-area size naturally within wrapper */
        canvas {
            /* Styles set dynamically, max-width/height handled by container */
        }
        .controls-column {
            flex: 1;
            max-width: 380px;
            width: auto;
            order: 2;
            overflow-y: none;
            padding-right: 5px;
            min-height: 0; /* Allow flex to shrink */
        }
        .settings-row {
            flex-direction: row;
            align-items: center;
            flex-wrap: wrap;
        }
        .setting-item {
            flex-basis: auto;
            justify-content: flex-start;
            width: auto;
        }
        .controls {
            justify-content: flex-start;
        }
        .group-management {
            justify-content: flex-start;
        }
        .interaction-controls {
            flex-direction: row;
            align-items: center;
        } /* Side-by-side on desktop */
        .mode-buttons {
            border-top: none;
            padding-top: 0;
            margin-top: 0;
            margin-left: 15px;
        }
        .zoom-pan-save .save-button {
            margin-left: auto;
        }
    }

    /* Tablet/Mobile */
    @media (max-width: 991px) {
        .canvas-area {
            max-height: 70vh;
        } /* Limit canvas height on mobile too */
        .setting-item {
            flex-basis: 100%;
            justify-content: space-between;
        }
        .setting-item label {
            flex-grow: 0;
            text-align: left;
            margin-bottom: 2px;
        }
        .setting-item input,
        .setting-item select {
            flex-grow: 1;
            width: auto;
        }
        input[type="number"] {
            width: 80px;
        }
        .mode-buttons {
            justify-content: center;
        }
        .mode-buttons button {
            flex-basis: calc(25% - 5px);
        } /* Try 4 buttons per row */
        .group-management {
            justify-content: center;
        }
        .group-management button {
            width: auto;
        }
        .zoom-pan-save .save-button {
            margin-left: 5px;
        }
    }
    @media (max-width: 480px) {
        h1 {
            font-size: 1.3em;
        }
        h2 {
            font-size: 1em;
        }
        .setting-item {
            flex-direction: column;
            align-items: stretch;
        }
        .setting-item label {
            margin-bottom: 3px;
        }
        .mode-buttons button {
            flex-basis: calc(50% - 4px);
        } /* Two per row */
        .controls-section {
            padding: 8px;
        }
        .interaction-controls {
            padding: 3px;
        }
        .zoom-pan-save,
        .mode-buttons {
            gap: 3px;
        }
        button {
            padding: 5px 8px;
            font-size: 0.8em;
        }
        button svg {
            margin-right: 2px;
        }
    }
</style>
