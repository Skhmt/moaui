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
    const MIN_ZOOM = 0.01; // Ensure min zoom is 100%
    const MAX_ZOOM = 20.0;
    const MIN_SCALE_LINE_PIXELS = 5;
    const MAX_BUFFER_DIM = 4096; // Cap canvas buffer size for performance

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
    // let imageElement: HTMLImageElement | null = null; // Replaced by imageBitmap
    let imageBitmap: ImageBitmap | null = null; // <<< Added for performance
    let mode: Mode = "loading";
    let scale: number | null = null;
    let referenceUnit: LinearUnit = "inches";
    let referenceLength: number = 1.0;
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

    // --- Style State Variables (Added) ---
    let legendFontSize: number = 12;
    let legendTextColor: string = "#e0e0e0";
    let legendBgColor: string = "#000000";
    let legendBorderColor: string = "#555555";
    // Currently unused in drawInfoBox, but available
    let lineWidthBase: number = 2;
    let bulletHoleColor: string = "#FF4136";
    let inactiveBulletHoleColor: string = "rgba(255,65,54,0.7)"; // Derived or separate setting? Let's keep it derived for now.
    let selectedHoleColor: string = "#FFDC00";
    let selectedHoleLineWidthMultiplier: number = 2;
    let centroidColor: string = "#0074D9";
    let aimPointColor: string = "#FF851B";
    let offsetLineColor: string = "#00BFFF";
    let offsetLineWidthMultiplier: number = 0.8;
    let scaleLineColor: string = "#00FF00";
    // Default 'lime'
    let scaleLineWidth: number = 2;
    let scaleMarkerSize: number = 6;

    // --- Lifecycle & Setup ---
    let observer: ResizeObserver | null = null;

    onMount(() => {
        dpr = window.devicePixelRatio || 1;
        if (canvasAreaElement) {
            observer = new ResizeObserver(handleResize);
            observer.observe(canvasAreaElement);
        }

        window.addEventListener("pointermove", handleWindowPointerMove);
        window.addEventListener("pointerup", handleWindowPointerUp);
        window.addEventListener("keydown", handleKeyDown);
    });

    onDestroy(() => {
        if (canvasAreaElement && observer) {
            observer.unobserve(canvasAreaElement);
        }
        if (imageUrl && imageUrl.startsWith("blob:"))
            URL.revokeObjectURL(imageUrl);
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("keydown", handleKeyDown);

        // <<< Close the bitmap when component is destroyed >>>
        if (imageBitmap) {
            imageBitmap.close();
            imageBitmap = null;
        }
    });

    function handleResize() {
        if (!canvasElement || !ctx || !imageBitmap) return; // Check imageBitmap

        const displayWidth = canvasElement.clientWidth;
        const displayHeight = canvasElement.clientHeight;

        if (displayWidth <= 0 || displayHeight <= 0) {
            return;
        }

        // Recalculate buffer size based on current bitmap and display size/DPR, applying cap
        const logicalWidth = imageBitmap.width;
        const logicalHeight = imageBitmap.height;

        let bufferWidth = logicalWidth * dpr;
        let bufferHeight = logicalHeight * dpr;

        if (bufferWidth > MAX_BUFFER_DIM || bufferHeight > MAX_BUFFER_DIM) {
            const ratio = Math.min(
                MAX_BUFFER_DIM / bufferWidth,
                MAX_BUFFER_DIM / bufferHeight,
            );
            bufferWidth = Math.round(bufferWidth * ratio);
            bufferHeight = Math.round(bufferHeight * ratio);
        }

        // Only resize if needed
        if (
            canvasElement.width !== bufferWidth ||
            canvasElement.height !== bufferHeight
        ) {
            canvasElement.width = bufferWidth;
            canvasElement.height = bufferHeight;
            console.log(
                `Resized canvas buffer to ${bufferWidth}x${bufferHeight} (Display: ${displayWidth}x${displayHeight}, DPR: ${dpr})`,
            );
        }

        redrawCanvas(); // Redraw with new buffer size
    }

    function setupCanvas(): void {
        if (!canvasElement || !imageUrl || !imageFile /* Need the file */)
            return;
        const context = canvasElement.getContext("2d", { alpha: false });
        if (!context) {
            console.error("No 2D context");
            alert("Canvas init error.");
            reset();
            return;
        }
        ctx = context;

        // <<< Use createImageBitmap >>>
        self.createImageBitmap(imageFile)
            .then((bitmap) => {
                // Close previous bitmap if it exists
                if (imageBitmap) {
                    imageBitmap.close();
                }
                imageBitmap = bitmap; // Store the new bitmap

                if (!canvasElement || !ctx || !imageBitmap) return;

                const logicalWidth = imageBitmap.width;
                const logicalHeight = imageBitmap.height;

                // <<< Limit canvas buffer size >>>
                let bufferWidth = logicalWidth * dpr;
                let bufferHeight = logicalHeight * dpr;

                if (
                    bufferWidth > MAX_BUFFER_DIM ||
                    bufferHeight > MAX_BUFFER_DIM
                ) {
                    const ratio = Math.min(
                        MAX_BUFFER_DIM / bufferWidth,
                        MAX_BUFFER_DIM / bufferHeight,
                    );
                    bufferWidth = Math.round(bufferWidth * ratio);
                    bufferHeight = Math.round(bufferHeight * ratio);
                    console.warn(
                        `Large image detected. Capping canvas buffer to ${bufferWidth}x${bufferHeight}`,
                    );
                }

                // Apply the (potentially capped) buffer size
                canvasElement.width = bufferWidth;
                canvasElement.height = bufferHeight;
                // <<< End Limit >>>

                viewCenter = { x: logicalWidth / 2, y: logicalHeight / 2 };
                viewScale = 1.0;
                lastViewport = null;

                if (groups.length === 0) addNewGroup();

                requestAnimationFrame(() => {
                    setTimeout(() => {
                        if (!canvasElement || !imageBitmap) return;
                        resetZoomToFit();
                        redrawCanvas();
                    }, 10);
                });
                mode = "scaling";
            })
            .catch((err) => {
                console.error("createImageBitmap error:", err);
                alert("Image load error.");
                reset();
            });
        // <<< End createImageBitmap >>>
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
    // <<< Updated to use imageBitmap >>>
    function calculateViewport(): ViewportState | null {
        if (
            !canvasElement ||
            !imageBitmap || // Use imageBitmap
            !canvasElement.clientWidth || // Use display dimensions directly
            !canvasElement.clientHeight
        )
            return null;

        const imgW = imageBitmap.width; // Use bitmap width
        const imgH = imageBitmap.height; // Use bitmap height

        // Calculate source rect based on display size and view scale
        let sW = canvasElement.clientWidth / viewScale;
        let sH = canvasElement.clientHeight / viewScale;

        // Clamp source size to image dimensions
        sW = Math.min(sW, imgW);
        sH = Math.min(sH, imgH);

        // Calculate source top-left based on view center
        let sx = viewCenter.x - sW / 2;
        let sy = viewCenter.y - sH / 2;

        // Clamp source top-left to image bounds
        sx = Math.max(0, Math.min(sx, imgW - sW));
        sy = Math.max(0, Math.min(sy, imgH - sH));

        // Recalculate source size based on clamped top-left (handles edge cases)
        sW = Math.min(sW, imgW - sx);
        sH = Math.min(sH, imgH - sy);

        // Ensure non-zero dimensions
        if (sW <= 0) sW = 1;
        if (sH <= 0) sH = 1;

        return { sx, sy, sWidth: sW, sHeight: sH };
    }

    // --- Drawing Functions ---
    // <<< Updated to use imageBitmap >>>
    function redrawCanvas(): void {
        if (
            !ctx ||
            !canvasElement ||
            !imageBitmap // Check bitmap
        )
            return;

        const vp = calculateViewport();
        if (!vp) return; // Viewport calculation failed (e.g., canvas not ready)

        lastViewport = vp; // Store the calculated viewport state
        const { sx, sy, sWidth, sHeight } = vp;
        const cW = canvasElement.width; // Target canvas buffer width
        const cH = canvasElement.height; // Target canvas buffer height

        ctx.save();
        // Clear canvas with white (or desired background)
        ctx.fillStyle = "#FFF";
        ctx.fillRect(0, 0, cW, cH);

        // Disable smoothing for potentially sharper rendering when zooming
        ctx.imageSmoothingEnabled = false;

        // Draw the calculated portion of the image bitmap onto the canvas buffer
        ctx.drawImage(imageBitmap, sx, sy, sWidth, sHeight, 0, 0, cW, cH);

        // Draw scaling line if present
        if (refLineStart && refLineEnd) {
            const sC = imageToCanvasCoords(refLineStart);
            const eC = imageToCanvasCoords(refLineEnd);
            if (sC && eC) drawScalingLine(ctx, sC, eC);
        }

        // Draw group elements if scale is calculated
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
        // Use state variables for color and width
        ctx.strokeStyle = scaleLineColor;
        ctx.lineWidth = Math.max(dpr, lineWidthBase * dpr);
        ctx.setLineDash([]);
        ctx.stroke();
        // Use state variable for marker color and size
        ctx.fillStyle = scaleLineColor;
        const mS = Math.max(2 * dpr, lineWidthBase * dpr);
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
        if (!lastViewport) return;
        // Guard against missing viewport
        const lPR = ctx.canvas.width / lastViewport.sWidth;
        const bRCvs = bRImg * lPR;

        // Use state variables for colors
        const hC = act ? bulletHoleColor : inactiveBulletHoleColor; // Use variable (consider making inactive adjustable too)
        const hSC = selectedHoleColor;
        // Use variable
        const ceC = act ? centroidColor : "rgba(0,116,217,0.7)";
        // Use variable (adjust inactive?)
        const aiC = act ? aimPointColor : "rgba(255,133,27,0.7)";
        // Use variable (adjust inactive?)
        const ofC = offsetLineColor;
        // Use variable

        // Use state variable for base line width
        const lW = Math.max(0.5 * dpr, lineWidthBase * dpr);
        // Use variable

        ctx.save();
        // --- Draw Bullet Holes ---
        g.bulletHolesPixels.forEach((hImg: Point, hIdx) => {
            const hCvs = imageToCanvasCoords(hImg);
            if (!hCvs) return;
            const isSelected = act && hIdx === selectedHoleIndex;
            ctx.strokeStyle = isSelected ? hSC : hC; // Use selected/normal color vars

            // Use base width and multiplier for selected hole
            ctx.lineWidth = isSelected
                ? Math.max(dpr, lW * selectedHoleLineWidthMultiplier) // Use multiplier
                : lW;
            ctx.beginPath();
            ctx.arc(hCvs.x, hCvs.y, Math.max(dpr, bRCvs), 0, Math.PI * 2); // Keep bullet radius based on
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

        // --- Draw Centroid Marker ---
        if (ceCvs) {
            ctx.strokeStyle = ceC;
            // Use variable
            ctx.lineWidth = lW;
            // Use base variable
            const cs = Math.max(3 * dpr, 6 * dpr);
            // Keep size relative to DPR for visibility? Or make configurable? Let's keep for now.
            ctx.beginPath();
            ctx.moveTo(ceCvs.x - cs, ceCvs.y);
            ctx.lineTo(ceCvs.x + cs, ceCvs.y);
            ctx.moveTo(ceCvs.x, ceCvs.y - cs);
            ctx.lineTo(ceCvs.x, ceCvs.y + cs);
            ctx.stroke();
        }

        // --- Draw Aiming Point Marker ---
        if (aiCvs) {
            ctx.strokeStyle = aiC;
            // Use variable
            ctx.lineWidth = lW;
            // Use base variable
            const dS = Math.max(dpr, 3 * dpr);
            // Keep dash relative?
            ctx.setLineDash([dS, dS]);
            const cs = Math.max(4 * dpr, lineWidthBase * 4 * dpr); // Keep size relative?
            ctx.beginPath();
            ctx.moveTo(aiCvs.x - cs, aiCvs.y);
            ctx.lineTo(aiCvs.x + cs, aiCvs.y);
            ctx.moveTo(aiCvs.x, aiCvs.y - cs);
            ctx.lineTo(aiCvs.x, aiCvs.y + cs);
            ctx.stroke();
            ctx.setLineDash([]);
            // --- Draw Offset Line ---
            if (ceCvs) {
                ctx.strokeStyle = ofC;
                // Use variable
                // Use base width and offset multiplier
                ctx.lineWidth = Math.max(
                    0.5 * dpr,
                    lW * offsetLineWidthMultiplier,
                ); // Use multiplier
                const oD = Math.max(1.5 * dpr, 4 * dpr);
                // Keep dash relative?
                ctx.setLineDash([oD, oD]);
                ctx.beginPath();
                ctx.moveTo(aiCvs.x, aiCvs.y);
                ctx.lineTo(ceCvs.x, ceCvs.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // --- Draw Info Box ---
        if (g.resultsValid && (ceCvs || g.infoBoxAnchorImage)) {
            // Pass style variables to drawInfoBox
            drawInfoBox(ctx, g, {
                fontSize: legendFontSize,
                textColor: legendTextColor,
                bgColor: legendBgColor,
                borderColor: legendBorderColor, // Pass border color too
            });
        }
        ctx.restore();
    }

    // Add a new interface for style options
    interface InfoBoxStyleOptions {
        fontSize: number;
        textColor: string;
        bgColor: string;
        borderColor: string;
    }

    function drawInfoBox(
        context: CanvasRenderingContext2D,
        group: ShotGroup,
        // Add style options parameter with defaults matching state vars
        styles: InfoBoxStyleOptions = {
            fontSize: legendFontSize,
            textColor: legendTextColor,
            bgColor: legendBgColor,
            borderColor: legendBorderColor,
        },
    ) {
        const lines: string[] = [];
        // ... (generate text lines as before) ...
        lines.push(`${group.name} (${group.bulletHolesReal.length} shots)`);
        if (group.maxSpread !== null) {
            const d = convertLinearValue(
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
        } else if (group.bulletHolesReal.length < 2) {
            lines.push(`Spread: N/A (<2 shots)`);
        }
        if (group.meanRadius !== null) {
            const d = convertLinearValue(
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
            const d = convertLinearValue(
                group.offsetFromAim.distance,
                referenceUnit,
                resultDisplayUnit,
            );
            lines.push(
                `Offset: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : " " + resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
            );
        }

        context.save();
        // Use font size from styles
        const fS = styles.fontSize;
        const pad = 4; // Keep padding fixed? Or make configurable?
        const lH = fS * 1.2;
        // Line height based on font size
        context.font = `${fS}px sans-serif`;
        // Use parameter
        let maxW = 0;
        lines.forEach((ln) => {
            maxW = Math.max(maxW, context.measureText(ln).width);
        });
        const boxW = maxW + pad * 2;
        const boxH = lines.length * lH + pad * 2;
        // ... (rest of info box size and anchor calculation as before) ...
        if (
            !group.infoBoxSize ||
            group.infoBoxSize.width !== boxW ||
            group.infoBoxSize.height !== boxH
        ) {
            group.infoBoxSize = { width: boxW, height: boxH };
        }
        context.restore(); // Restore here to avoid affecting anchor calc?

        context.save(); // Re-save for drawing

        if (
            !group.infoBoxAnchorImage &&
            group.centroidReal &&
            scale &&
            lastViewport
        ) {
            const cenImg = {
                x: group.centroidReal.x * scale,
                y: group.centroidReal.y * scale,
            };
            const offX = 15; // Keep offset fixed?

            // Calculate anchor based on image coords, but offset based on display pixels
            const yOffsetPixels = boxH / 2;
            const yOffsetImage =
                (yOffsetPixels / context.canvas.clientHeight) *
                lastViewport.sHeight;

            group.infoBoxAnchorImage = {
                x: cenImg.x + offX, // Simple image offset for X
                y: cenImg.y - yOffsetImage, // Convert Y offset to image space
            };
            groups = groups; // Trigger reactivity
        }
        let pos: Point | null = null;
        if (group.infoBoxAnchorImage) {
            pos = imageToCanvasCoords(group.infoBoxAnchorImage);
        }

        if (!pos || !group.infoBoxSize) {
            context.restore(); // Make sure to restore if exiting early
            return;
        }

        // Clamp position based on calculated size (using dpr for render size)
        pos.x = Math.max(
            0,
            Math.min(
                pos.x,
                context.canvas.width - group.infoBoxSize.width * dpr, // Use box size * dpr
            ),
        );
        pos.y = Math.max(
            0,
            Math.min(
                pos.y,
                context.canvas.height - group.infoBoxSize.height * dpr, // Use box size * dpr
            ),
        );
        // context.save(); // Already saved

        // Use colors from style parameters
        // Add alpha transparency (e.g., E6 = 90%) to the background color
        const bgColorWithAlpha = styles.bgColor.startsWith("#")
            ? styles.bgColor + "E6"
            : styles.bgColor; // Handle non-hex potentially?
        context.fillStyle = bgColorWithAlpha; // Use parameter + alpha
        context.strokeStyle = styles.borderColor;
        // Use parameter
        context.lineWidth = 1 * dpr; // Keep border width fixed?
        // Or make configurable?

        context.fillRect(
            pos.x,
            pos.y,
            group.infoBoxSize.width * dpr, // Use calculated size * dpr
            group.infoBoxSize.height * dpr, // Use calculated size * dpr
        );
        context.strokeRect(
            pos.x,
            pos.y,
            group.infoBoxSize.width * dpr, // Use calculated size * dpr
            group.infoBoxSize.height * dpr, // Use calculated size * dpr
        );

        context.fillStyle = styles.textColor;
        // Use parameter
        // Use font size from styles, adjusted by dpr
        context.font = `${fS * dpr}px sans-serif`;
        // Use parameter * dpr
        context.textAlign = "left";
        context.textBaseline = "top";
        lines.forEach((line, i) => {
            // Adjust text position by dpr
            context.fillText(
                line,
                pos!.x + pad * dpr, // Use pad * dpr
                pos!.y + pad * dpr + i * lH * dpr, // Use pad, line height * dpr
            );
        });
        context.restore(); // Restore drawing state
    }

    // --- Event Handlers ---
    function getCanvasDisplayCoords(
        e: MouseEvent | PointerEvent,
    ): Point | null {
        if (!canvasElement) return null;
        const r = canvasElement.getBoundingClientRect();
        if (!r.width || !r.height) return null; // Avoid division by zero if not displayed
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function handleFileSelect(e: Event) {
        const t = e.target as HTMLInputElement;
        const f = t.files?.[0];
        if (f && f.type.startsWith("image/")) {
            imageFile = f; // Store the file object <<< Needed for createImageBitmap
            if (imageUrl && imageUrl.startsWith("blob:"))
                URL.revokeObjectURL(imageUrl);
            imageUrl = URL.createObjectURL(f); // Still useful for display elsewhere maybe?
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
        // Check for info box drag first
        for (let i = groups.length - 1; i >= 0; i--) {
            const g = groups[i];
            if (g.resultsValid && g.infoBoxAnchorImage && g.infoBoxSize) {
                const aImg = g.infoBoxAnchorImage;
                const sLog = g.infoBoxSize; // Logical size (pixels without dpr)
                const aCvsRender = imageToCanvasCoords(aImg); // Anchor position in *render* coordinates (with dpr)

                if (aCvsRender) {
                    // Calculate the bounding box in *render* coordinates
                    const boxRenderWidth = sLog.width * dpr;
                    const boxRenderHeight = sLog.height * dpr;

                    // Pointer coords are in *display* coordinates. Convert box to display coords.
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
                        e.stopPropagation(); // Prevent other actions
                        return;
                    }
                }
            }
        }

        // If not dragging info box, check for panning or drawing ref line
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
        if (!canvasElement || !lastViewport) return; // Need viewport info
        const curPtrD = getCanvasDisplayCoords(e);
        if (!curPtrD) return;

        // --- Panning Logic ---
        if (
            isPanning &&
            panStartPointerCoords &&
            panStartViewCenter &&
            canvasElement.hasPointerCapture(e.pointerId)
        ) {
            const dxD = curPtrD.x - panStartPointerCoords.x; // Delta in display pixels
            const dyD = curPtrD.y - panStartPointerCoords.y; // Delta in display pixels

            // Convert display pixel delta to image coordinate delta
            const dxI = (dxD / canvasElement.clientWidth) * lastViewport.sWidth;
            const dyI =
                (dyD / canvasElement.clientHeight) * lastViewport.sHeight;

            // Update view center based on starting point and image delta
            viewCenter.x = panStartViewCenter.x - dxI;
            viewCenter.y = panStartViewCenter.y - dyI;

            clampViewCenter(); // Keep view within bounds
            requestAnimationFrame(redrawCanvas); // Redraw efficiently
        }
        // --- Info Box Dragging Logic ---
        else if (
            isDraggingInfoBox &&
            draggingGroupIndex !== null &&
            dragStartPointerCoords &&
            dragStartInfoBoxAnchorImage &&
            canvasElement.hasPointerCapture(e.pointerId)
        ) {
            const dxD = curPtrD.x - dragStartPointerCoords.x; // Delta in display pixels
            const dyD = curPtrD.y - dragStartPointerCoords.y; // Delta in display pixels

            const g = groups[draggingGroupIndex];
            if (g && lastViewport) {
                // Check lastViewport exists
                // Convert display pixel delta to image coordinate delta
                const dxI =
                    (dxD / canvasElement.clientWidth) * lastViewport.sWidth;
                const dyI =
                    (dyD / canvasElement.clientHeight) * lastViewport.sHeight;

                // Calculate new anchor position in image coordinates
                const nAX = dragStartInfoBoxAnchorImage.x + dxI;
                const nAY = dragStartInfoBoxAnchorImage.y + dyI;

                g.infoBoxAnchorImage = { x: nAX, y: nAY };
                groups = groups; // Trigger reactivity
                requestAnimationFrame(redrawCanvas); // Redraw efficiently
            }
        }
        // --- Scaling Line Drawing Logic ---
        else if (
            mode === "scaling" &&
            isDrawingRefLine &&
            refLineStart &&
            canvasElement.hasPointerCapture(e.pointerId)
        ) {
            const curPtrI = canvasToImageCoords(curPtrD); // Convert to image coords
            if (curPtrI) {
                refLineEnd = curPtrI; // Update end point
                requestAnimationFrame(redrawCanvas); // Redraw efficiently
            }
        }
    }

    function handleWindowPointerUp(e: PointerEvent) {
        let wasDragging = false; // Flag to check if a drag operation just ended

        // --- Panning End ---
        if (isPanning && canvasElement?.hasPointerCapture(e.pointerId)) {
            canvasElement.releasePointerCapture(e.pointerId);
            isPanning = false;
            panStartPointerCoords = null;
            panStartViewCenter = null;
            // Update cursor immediately
            if (canvasElement) canvasElement.style.cursor = canvasCursor;
            wasDragging = true;
            // redrawCanvas(); // Redraw might not be needed if move handled it, but safe to keep
        }
        // --- Info Box Drag End ---
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
            redrawCanvas(); // Redraw to finalize position
        }
        // --- Scaling Line Draw End ---
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
                if (finalI) refLineEnd = finalI; // Set final end point
            }

            if (refLineStart && refLineEnd) {
                const ok = calculateScale(); // Attempt to calculate scale
                if (ok) {
                    mode = "placingHoles"; // Move to next mode if scale is valid
                } else {
                    // Reset ref line if scale calculation failed (e.g., too short)
                    refLineStart = null;
                    refLineEnd = null;
                }
            } else {
                // Reset if something went wrong
                refLineStart = null;
                refLineEnd = null;
            }
            wasDragging = true;
            redrawCanvas(); // Redraw to show final line or clear it
        }

        // Prevent click event immediately after drag/draw
        if (wasDragging) {
            ignoreNextClick = true;
            // Use a minimal timeout to reset the flag
            setTimeout(() => {
                ignoreNextClick = false;
            }, 50); // 50ms should be enough
        }
    }

    async function handleCanvasClick(e: MouseEvent) {
        if (ignoreNextClick) {
            ignoreNextClick = false;
            return; // Skip click if it followed a drag/draw end
        }

        // Ignore clicks during panning or drawing ref line (handled by pointer down/up/move)
        if (isPanning || isDrawingRefLine) return;

        if (!canvasElement || activeGroupIndex === -1) return; // Need canvas and active group

        const dCoords = getCanvasDisplayCoords(e);
        if (!dCoords) return; // Click coords invalid

        const iCoords = canvasToImageCoords(dCoords);
        if (!iCoords) return; // Image coords invalid

        const g = groups[activeGroupIndex];

        // --- Placing Holes ---
        if (mode === "placingHoles" && scale) {
            const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale }; // Calculate real coords
            g.bulletHolesPixels.push(iCoords);
            g.bulletHolesReal.push(rCoords);
            selectedHoleIndex = g.bulletHolesPixels.length - 1; // Select the new hole
            invalidateResults(activeGroupIndex);
            groups = groups; // Trigger reactivity
            await tick(); // Wait for Svelte update cycle
            calculateGroupResults(activeGroupIndex); // Recalculate after adding hole
            redrawCanvas();
        }
        // --- Placing Aim Point ---
        else if (mode === "placingAim" && scale) {
            const rCoords = { x: iCoords.x / scale, y: iCoords.y / scale }; // Calculate real coords
            g.aimingPointPixels = iCoords;
            g.aimingPointReal = rCoords;
            invalidateResults(activeGroupIndex);
            groups = groups; // Trigger reactivity
            await tick(); // Wait for Svelte update cycle
            calculateGroupResults(activeGroupIndex); // Recalculate after adding aim point
            mode = "placingHoles"; // Switch back to placing holes automatically
            redrawCanvas();
        }
        // --- Selecting Hole ---
        else if (mode === "selectingHole") {
            if (!scale || !lastViewport || !canvasElement.width) return; // Need scale and viewport

            // Define click tolerance in render pixels (adjust as needed)
            const clickToleranceRenderPixels = 15 * dpr; // Tolerance in buffer pixels
            // Convert tolerance to image pixels
            const clickToleranceImagePixels =
                (clickToleranceRenderPixels / canvasElement.width) *
                lastViewport.sWidth;
            const clickToleranceImagePixelsSq =
                clickToleranceImagePixels * clickToleranceImagePixels;

            let found = false;
            let closestIndex = -1;
            let minDistanceSq = Infinity;

            // Iterate through holes to find the closest one within tolerance
            for (let i = g.bulletHolesPixels.length - 1; i >= 0; i--) {
                const h = g.bulletHolesPixels[i];
                const dx = iCoords.x - h.x;
                const dy = iCoords.y - h.y;
                const dSq = dx * dx + dy * dy; // Distance squared in image coordinates

                if (dSq < clickToleranceImagePixelsSq && dSq < minDistanceSq) {
                    minDistanceSq = dSq;
                    closestIndex = i;
                    found = true;
                }
            }

            selectedHoleIndex = found ? closestIndex : null; // Select closest or deselect
            redrawCanvas(); // Redraw to show selection change
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (
            activeGroupIndex === -1 ||
            selectedHoleIndex === null || // Only act if a hole is selected
            !scale ||
            !lastViewport ||
            !canvasElement
        )
            return;

        let dxI = 0; // Nudge delta in image pixels
        let dyI = 0; // Nudge delta in image pixels

        // Calculate nudge amount in image pixels based on display pixel constant
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
                e.preventDefault(); // Prevent browser back navigation on Backspace
                deleteSelectedHole();
                return; // Don't nudge after delete
            default:
                return; // Ignore other keys
        }

        e.preventDefault(); // Prevent arrow keys from scrolling the page
        nudgeSelectedHolePx(dxI, dyI); // Apply the nudge
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
        const lenPx = Math.sqrt(dx * dx + dy * dy); // Length in image pixels
        if (lenPx < MIN_SCALE_LINE_PIXELS) {
            alert(
                `Reference line is too short (must be >= ${MIN_SCALE_LINE_PIXELS} pixels). Please redraw.`,
            );
            scale = null;
            return false;
        }
        const newSc = lenPx / referenceLength; // pixels per referenceUnit

        // Only recalculate if scale changes significantly (optional, avoids tiny updates)
        // if (scale && Math.abs(newSc - scale) < 1e-6) return true;

        scale = newSc;

        // Recalculate real coordinates and invalidate results for all groups
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
            // Reset info box anchor so it recalculates based on new scale/positions
            g.infoBoxAnchorImage = null;
        });
        groups = groups; // Trigger reactivity

        // Use tick to ensure Svelte updates before recalculating results
        tick().then(() => {
            groups.forEach((_, i) => calculateGroupResults(i)); // Recalculate all groups
            redrawCanvas(); // Redraw with new scale and results
        });

        console.log(`Scale set: ${scale.toFixed(3)} pixels/${referenceUnit}`);
        return true;
    }

    function calculateGroupResults(idx: number) {
        if (idx < 0 || idx >= groups.length || !scale) return; // Need valid index and scale
        const g = groups[idx];

        // Reset previous results
        g.centroidReal = null;
        g.meanRadius = null;
        g.maxSpread = null;
        g.meanRadiusMOA = null;
        g.meanRadiusMRAD = null;
        g.maxSpreadMOA = null;
        g.maxSpreadMRAD = null;
        g.offsetFromAim = null;
        g.resultsValid = false; // Mark as invalid until calculations complete

        if (g.bulletHolesReal.length === 0) {
            groups = groups; // Trigger reactivity (maybe needed for info box hide)
            redrawCanvas(); // Redraw to clear old results
            return; // No calculations needed for empty group
        }

        // --- Calculate Centroid ---
        let sumX = 0,
            sumY = 0;
        g.bulletHolesReal.forEach((h) => {
            sumX += h.x;
            sumY += h.y;
        });
        const n = g.bulletHolesReal.length;
        const centroidX = sumX / n;
        const centroidY = sumY / n;
        g.centroidReal = { x: centroidX, y: centroidY };

        // --- Calculate Mean Radius ---
        let sumDistFromCentroid = 0;
        g.bulletHolesReal.forEach((h) => {
            const dx = h.x - centroidX;
            const dy = h.y - centroidY;
            sumDistFromCentroid += Math.sqrt(dx * dx + dy * dy);
        });
        g.meanRadius = sumDistFromCentroid / n;

        // --- Calculate Max Spread (Extreme Spread) ---
        if (n >= 2) {
            let maxDistSq = 0;
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    const dx = g.bulletHolesReal[i].x - g.bulletHolesReal[j].x;
                    const dy = g.bulletHolesReal[i].y - g.bulletHolesReal[j].y;
                    maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy);
                }
            }
            g.maxSpread = Math.sqrt(maxDistSq);
        } else {
            g.maxSpread = null; // Not applicable for < 2 shots
        }

        // --- Calculate Angular Measurements (MOA/MRAD) ---
        if (targetDistance > 0) {
            const distMM = convertLinearValue(
                targetDistance,
                targetDistanceUnit,
                "mm",
            );
            if (distMM > 0) {
                // Mean Radius Angular
                if (g.meanRadius !== null) {
                    const radiusMM = convertLinearValue(
                        g.meanRadius,
                        referenceUnit,
                        "mm",
                    );
                    const angleRad = radiusMM / distMM; // Small angle approximation
                    g.meanRadiusMOA = angleRad * RAD_TO_MOA;
                    g.meanRadiusMRAD = angleRad * RAD_TO_MRAD;
                }
                // Max Spread Angular
                if (g.maxSpread !== null) {
                    const spreadMM = convertLinearValue(
                        g.maxSpread,
                        referenceUnit,
                        "mm",
                    );
                    const angleRad = spreadMM / distMM; // Small angle approximation
                    g.maxSpreadMOA = angleRad * RAD_TO_MOA;
                    g.maxSpreadMRAD = angleRad * RAD_TO_MRAD;
                }
            }
        } else {
            // Clear angular results if distance is zero or invalid
            g.meanRadiusMOA = null;
            g.meanRadiusMRAD = null;
            g.maxSpreadMOA = null;
            g.maxSpreadMRAD = null;
        }

        // --- Calculate Offset from Aim Point ---
        if (g.aimingPointReal && g.centroidReal) {
            const dx = g.centroidReal.x - g.aimingPointReal.x; // Centroid relative to Aim Point
            const dy = g.centroidReal.y - g.aimingPointReal.y;
            const dist = Math.sqrt(dx * dx + dy * dy); // Offset distance

            // Calculate angle (0 degrees = right, 90 = up, 180 = left, 270 = down)
            let angleRad = Math.atan2(-dy, dx); // Use -dy because canvas Y increases downwards
            if (angleRad < 0) angleRad += 2 * Math.PI; // Normalize to 0-2PI
            const angleDeg = angleRad * (180 / Math.PI);

            g.offsetFromAim = {
                distance: dist,
                angleDegrees: angleDeg,
            };
        } else {
            g.offsetFromAim = null; // No aim point set
        }

        g.resultsValid = true; // Mark results as valid
        groups = groups; // Trigger reactivity
        redrawCanvas(); // Redraw to display updated results
    }

    function invalidateResults(idx: number) {
        if (idx >= 0 && idx < groups.length && groups[idx].resultsValid) {
            groups[idx].resultsValid = false;
            groups = groups; // Trigger reactivity
            // Optionally clear specific fields if needed, but calculateGroupResults handles reset
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
        activeGroupIndex = groups.length - 1; // Switch to the new group
        selectedHoleIndex = null; // Deselect any holes

        // Set mode based on current state
        if (!imageBitmap)
            mode = "loading"; // Should not happen if called after load, but safe check
        else if (!scale) mode = "scaling";
        else mode = "placingHoles";

        redrawCanvas(); // Redraw to show the new group (likely empty)
    }

    function switchToGroup(idx: number) {
        if (idx >= 0 && idx < groups.length && idx !== activeGroupIndex) {
            activeGroupIndex = idx;
            selectedHoleIndex = null; // Deselect hole when switching group

            // Set mode based on current state for the switched-to group
            if (!imageBitmap) mode = "loading";
            else if (!scale) mode = "scaling";
            else mode = "placingHoles"; // Default interaction mode when switching

            redrawCanvas(); // Redraw to highlight the active group
        }
    }

    async function deleteGroup(idx: number) {
        if (idx < 0 || idx >= groups.length) return; // Invalid index

        const gName = groups[idx]?.name ?? `Group ${idx + 1}`;
        if (
            !confirm(
                `Are you sure you want to delete ${gName}? This cannot be undone.`,
            )
        )
            return;

        groups.splice(idx, 1); // Remove the group

        if (groups.length === 0) {
            // If last group was deleted, add a new one
            activeGroupIndex = -1; // Reset index before adding
            addNewGroup(); // This will set activeGroupIndex to 0
        } else {
            // Adjust active index if necessary
            if (activeGroupIndex === idx) {
                // If deleted group was active, activate the previous one (or first one)
                activeGroupIndex = Math.max(0, idx - 1);
            } else if (activeGroupIndex > idx) {
                // If deleted group was before the active one, decrement active index
                activeGroupIndex--;
            }
            // Ensure active index is valid after potential adjustments
            if (activeGroupIndex >= groups.length) {
                activeGroupIndex = groups.length - 1;
            }

            groups = groups; // Trigger reactivity
            await tick(); // Wait for Svelte update
            // No need to call switchToGroup, just update index and redraw
            redrawCanvas();
        }
    }

    // --- Point Deletion ---
    async function deleteSelectedHole() {
        if (activeGroupIndex === -1 || selectedHoleIndex === null) return; // Nothing selected

        const g = groups[activeGroupIndex];
        // Double-check index validity before splicing
        if (
            selectedHoleIndex < 0 ||
            selectedHoleIndex >= g.bulletHolesPixels.length
        ) {
            selectedHoleIndex = null; // Invalid index, just deselect
            return;
        }

        // Remove the hole from both pixel and real arrays
        g.bulletHolesPixels.splice(selectedHoleIndex, 1);
        g.bulletHolesReal.splice(selectedHoleIndex, 1);

        selectedHoleIndex = null; // Deselect after deletion
        invalidateResults(activeGroupIndex); // Mark results as needing update
        groups = groups; // Trigger reactivity

        await tick(); // Wait for Svelte update
        calculateGroupResults(activeGroupIndex); // Recalculate results
        redrawCanvas(); // Redraw the canvas
    }

    // --- Nudging ---
    // <<< Updated clamping to use imageBitmap >>>
    async function nudgeSelectedHolePx(dxI: number, dyI: number) {
        if (
            scale && // Need scale for real coords update
            activeGroupIndex !== -1 &&
            selectedHoleIndex !== null &&
            selectedHoleIndex <
                groups[activeGroupIndex].bulletHolesPixels.length // Check valid index
        ) {
            const g = groups[activeGroupIndex];
            const hPx = g.bulletHolesPixels[selectedHoleIndex];

            // Update pixel coordinates
            hPx.x += dxI;
            hPx.y += dyI;

            // Clamp pixel coordinates to image bounds
            if (imageBitmap) {
                // Check if bitmap exists
                hPx.x = Math.max(0, Math.min(hPx.x, imageBitmap.width)); // Use bitmap width
                hPx.y = Math.max(0, Math.min(hPx.y, imageBitmap.height)); // Use bitmap height
            }

            // Update corresponding real coordinates
            const hRl = g.bulletHolesReal[selectedHoleIndex];
            hRl.x = hPx.x / scale;
            hRl.y = hPx.y / scale;

            invalidateResults(activeGroupIndex); // Mark results as needing update
            groups = groups; // Trigger reactivity

            await tick(); // Wait for Svelte update
            calculateGroupResults(activeGroupIndex); // Recalculate results
            redrawCanvas(); // Redraw canvas
        }
    }

    // --- Zoom Controls ---
    // <<< Updated check to use imageBitmap >>>
    function zoom(factor: number, cX?: number, cY?: number) {
        if (!imageBitmap || !canvasElement || !lastViewport) return; // Need bitmap, canvas, viewport

        const currentScale = viewScale;
        const newScale = Math.max(
            MIN_ZOOM,
            Math.min(MAX_ZOOM, currentScale * factor),
        );

        if (newScale === currentScale) return; // No change

        let zoomCenterX = viewCenter.x; // Default to current view center
        let zoomCenterY = viewCenter.y;

        // If client coordinates are provided (e.g., from mouse wheel), zoom towards that point
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

        // Adjust view center based on zoom point and scale change
        // Formula: newCenter = zoomPoint - (zoomPoint - oldCenter) * (oldScale / newScale)
        viewCenter.x =
            zoomCenterX -
            (zoomCenterX - viewCenter.x) * (currentScale / newScale);
        viewCenter.y =
            zoomCenterY -
            (zoomCenterY - viewCenter.y) * (currentScale / newScale);

        viewScale = newScale; // Apply the new scale

        clampViewCenter(); // Ensure the new view center is valid
        redrawCanvas(); // Redraw with the new scale and center
    }

    function zoomIn(e?: MouseEvent) {
        zoom(ZOOM_FACTOR, e?.clientX, e?.clientY);
    }

    function zoomOut(e?: MouseEvent) {
        zoom(1 / ZOOM_FACTOR, e?.clientX, e?.clientY);
    }

    // <<< Updated to use imageBitmap >>>
    function resetZoomToFit() {
        if (
            !imageBitmap ||
            !canvasElement ||
            !canvasElement.clientWidth ||
            !canvasElement.clientHeight
        )
            return; // Need bitmap and display size

        const imgW = imageBitmap.width;
        const imgH = imageBitmap.height;
        const displayW = canvasElement.clientWidth;
        const displayH = canvasElement.clientHeight;

        let fitScale = 1.0; // Default to 100%

        // Calculate scale to fit image within display area
        if (imgW > 0 && imgH > 0 && displayW > 0 && displayH > 0) {
            fitScale = Math.min(displayW / imgW, displayH / imgH);
        }

        // Apply the fit scale, respecting min/max zoom limits
        viewScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
        // Center the view on the image
        viewCenter = { x: imgW / 2, y: imgH / 2 };

        clampViewCenter(); // Clamp center after scale change
        // No redraw needed here, caller (setupCanvas or resetZoom button) will redraw
    }

    function resetZoom() {
        if (!imageBitmap) return;
        resetZoomToFit();
        redrawCanvas(); // Explicitly redraw after reset button click
    }

    function handleWheel(e: WheelEvent) {
        e.preventDefault(); // Prevent page scrolling
        const delta = -Math.sign(e.deltaY); // Normalize wheel direction (-1 or 1)
        const factor = delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        zoom(factor, e.clientX, e.clientY); // Zoom towards cursor position
    }

    // --- Scale Controls ---
    function enterScaleMode() {
        mode = "scaling";
        refLineStart = null; // Clear existing line
        refLineEnd = null;
        isDrawingRefLine = false;
        selectedHoleIndex = null; // Deselect any hole
        redrawCanvas(); // Redraw to reflect mode change
    }

    // --- View Clamping ---
    // <<< Updated to use imageBitmap >>>
    function clampViewCenter() {
        if (
            !imageBitmap ||
            !canvasElement ||
            !canvasElement.clientWidth ||
            !canvasElement.clientHeight
        )
            return; // Need bitmap and display size

        const imgW = imageBitmap.width;
        const imgH = imageBitmap.height;

        // Calculate the size of the viewport in image pixels
        const viewportWidthImg = canvasElement.clientWidth / viewScale;
        const viewportHeightImg = canvasElement.clientHeight / viewScale;

        // Calculate min/max allowed center coordinates
        const minX = viewportWidthImg / 2;
        const maxX = imgW - viewportWidthImg / 2;
        const minY = viewportHeightImg / 2;
        const maxY = imgH - viewportHeightImg / 2;

        // Clamp X coordinate if image is wider than viewport
        if (imgW > viewportWidthImg) {
            viewCenter.x = Math.max(minX, Math.min(viewCenter.x, maxX));
        } else {
            // If image is narrower than viewport, center it
            viewCenter.x = imgW / 2;
        }

        // Clamp Y coordinate if image is taller than viewport
        if (imgH > viewportHeightImg) {
            viewCenter.y = Math.max(minY, Math.min(viewCenter.y, maxY));
        } else {
            // If image is shorter than viewport, center it
            viewCenter.y = imgH / 2;
        }
    }

    // --- Utility ---
    // <<< Updated to include imageBitmap reset >>>
    function resetStateForNewImage() {
        // Image and scale related
        scale = null;
        refLineStart = null;
        refLineEnd = null;
        isDrawingRefLine = false;
        if (imageBitmap) {
            // Close existing bitmap
            imageBitmap.close();
            imageBitmap = null;
        }

        // Group related
        groups = [];
        activeGroupIndex = -1;
        nextGroupId = 0;
        selectedHoleIndex = null;

        // Interaction states
        isDraggingInfoBox = false;
        draggingGroupIndex = null;
        dragStartPointerCoords = null;
        dragStartInfoBoxAnchorImage = null;
        ignoreNextClick = false;
        isPanning = false;
        panStartPointerCoords = null;
        panStartViewCenter = null;

        // Viewport related
        viewScale = 1.0;
        viewCenter = { x: 0, y: 0 }; // Will be reset in setupCanvas
        lastViewport = null;

        mode = "loading"; // Set initial mode
    }

    function reset() {
        if (
            !confirm(
                "Are you sure you want to start over? All current data will be lost.",
            )
        )
            return;

        resetStateForNewImage(); // Reset all internal state

        // Clear canvas visually
        if (ctx && canvasElement) {
            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            // Optionally reset canvas dimensions? Maybe not needed if new image loads.
            // canvasElement.width = 0;
            // canvasElement.height = 0;
        }

        // Clear file input and URL references
        if (imageUrl && imageUrl.startsWith("blob:")) {
            URL.revokeObjectURL(imageUrl);
        }
        imageFile = null;
        imageUrl = null;
        // imageBitmap is cleared in resetStateForNewImage

        ctx = null; // Release context reference

        if (fileInputEl) fileInputEl.value = ""; // Clear the file input field
    }

    // --- Input Handlers ---
    function handleDiameterChange() {
        // Only redraw if scale is set (meaning holes are potentially visible)
        if (scale) redrawCanvas();
    }

    function handleResultUnitChange() {
        // Redraw if any group has results displayed
        if (groups.some((g) => g.resultsValid)) redrawCanvas();
    }

    function handleAngularUnitChange() {
        // Redraw if any group has results displayed (as angular units might change)
        if (groups.some((g) => g.resultsValid)) redrawCanvas();
    }

    function handleTargetDistanceChange() {
        // Recalculate results for all groups if distance is valid
        if (targetDistance >= 0) {
            groups.forEach((_, i) => calculateGroupResults(i)); // This will redraw
        } else {
            // If distance becomes invalid, clear angular results but keep linear ones
            groups.forEach((g) => {
                g.maxSpreadMOA = null;
                g.maxSpreadMRAD = null;
                g.meanRadiusMOA = null;
                g.meanRadiusMRAD = null;
                // Keep g.resultsValid = true if linear results exist
            });
            groups = groups; // Trigger reactivity
            redrawCanvas(); // Redraw to update info boxes
        }
    }

    function handleReferenceInputChange() {
        // If a reference line exists, try recalculating scale
        if (refLineStart && refLineEnd) {
            calculateScale(); // This recalculates results and redraws
        } else {
            // If no ref line, changing inputs invalidates scale and results
            scale = null;
            mode = "scaling"; // Force user to redraw ref line
            groups.forEach((g, i) => {
                invalidateResults(i);
                g.infoBoxAnchorImage = null; // Reset info box position
            });
            groups = groups; // Trigger reactivity
            redrawCanvas(); // Redraw to clear results/overlays
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
    // <<< Updated to use imageBitmap >>>
    function exportCanvasAsJpeg(): void {
        // <<< Check imageBitmap >>>
        if (!canvasElement || !imageBitmap || !ctx) {
            alert("Canvas or image data is not ready for export.");
            return;
        }

        // Create a new canvas matching the original image dimensions
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = imageBitmap.width; // Use bitmap dimensions
        exportCanvas.height = imageBitmap.height; // Use bitmap dimensions

        const exportCtx = exportCanvas.getContext("2d");
        if (!exportCtx) {
            alert("Failed to create export canvas context.");
            return;
        }

        // Setup export canvas context
        exportCtx.imageSmoothingEnabled = false; // Consistent with display
        exportCtx.fillStyle = "#FFFFFF"; // Set white background for JPEG
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // Draw the original image bitmap onto the export canvas
        exportCtx.drawImage(imageBitmap, 0, 0);

        // --- Draw Overlays (Scaling Line, Groups, Info Boxes) ---
        // Use image coordinates directly, no DPR scaling needed for export
        exportCtx.save();

        // --- Draw Scaling Line (Export) ---
        if (refLineStart && refLineEnd) {
            exportCtx.beginPath();
            exportCtx.moveTo(refLineStart.x, refLineStart.y);
            exportCtx.lineTo(refLineEnd.x, refLineEnd.y);
            exportCtx.strokeStyle = scaleLineColor;
            exportCtx.lineWidth = scaleLineWidth; // Use base width, no dpr
            exportCtx.setLineDash([]);
            exportCtx.stroke();
            exportCtx.fillStyle = scaleLineColor;
            const mSize = scaleMarkerSize; // Use base size, no dpr
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

        // --- Draw Group Elements (Export) ---
        if (scale) {
            groups.forEach((group, index) => {
                const isActive = index === activeGroupIndex; // Use for color selection
                const dUnit = convertLinearValue(
                    bulletDiameter,
                    bulletDiameterUnit,
                    referenceUnit,
                );
                const bRadiusImg = (dUnit / 2) * scale!; // Bullet radius in image pixels

                // Colors (use active/inactive from state)
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

                // Line width (use base width from state, no dpr)
                const lWidth = lineWidthBase;

                // Draw Bullet Holes
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

                // Get Centroid and Aim Point in Image Pixels
                let cenImgPx: Point | null = null;
                let aimImgPx: Point | null = group.aimingPointPixels; // Already in image pixels
                if (group.resultsValid && group.centroidReal) {
                    cenImgPx = {
                        x: group.centroidReal.x * scale!,
                        y: group.centroidReal.y * scale!,
                    };
                }

                // Draw Centroid Marker
                if (cenImgPx) {
                    exportCtx.strokeStyle = cenColor;
                    exportCtx.lineWidth = lWidth;
                    const cs = 6; // Fixed size for export? Or use state var?
                    exportCtx.beginPath();
                    exportCtx.moveTo(cenImgPx.x - cs, cenImgPx.y);
                    exportCtx.lineTo(cenImgPx.x + cs, cenImgPx.y);
                    exportCtx.moveTo(cenImgPx.x, cenImgPx.y - cs);
                    exportCtx.lineTo(cenImgPx.x, cenImgPx.y + cs);
                    exportCtx.stroke();
                }

                // Draw Aim Point Marker and Offset Line
                if (aimImgPx) {
                    exportCtx.strokeStyle = aimColor;
                    exportCtx.lineWidth = lWidth;
                    exportCtx.setLineDash([3, 3]); // Fixed dash for export?
                    const cs = 8; // Fixed size for export?
                    exportCtx.beginPath();
                    exportCtx.moveTo(aimImgPx.x - cs, aimImgPx.y);
                    exportCtx.lineTo(aimImgPx.x + cs, aimImgPx.y);
                    exportCtx.moveTo(aimImgPx.x, aimImgPx.y - cs);
                    exportCtx.lineTo(aimImgPx.x, aimImgPx.y + cs);
                    exportCtx.stroke();
                    exportCtx.setLineDash([]);

                    // Draw Offset Line if Centroid exists
                    if (cenImgPx) {
                        exportCtx.strokeStyle = offColor;
                        exportCtx.lineWidth =
                            lWidth * offsetLineWidthMultiplier; // Use multiplier
                        exportCtx.setLineDash([4, 4]); // Fixed dash for export?
                        exportCtx.beginPath();
                        exportCtx.moveTo(aimImgPx.x, aimImgPx.y);
                        exportCtx.lineTo(cenImgPx.x, cenImgPx.y);
                        exportCtx.stroke();
                        exportCtx.setLineDash([]);
                    }
                }

                // --- Draw Info Box (Export) ---
                if (
                    group.resultsValid &&
                    group.infoBoxAnchorImage &&
                    group.infoBoxSize
                ) {
                    // Regenerate text lines (same logic as drawInfoBox)
                    const lines: string[] = [];
                    lines.push(
                        `${group.name} (${group.bulletHolesReal.length} shots)`,
                    );
                    if (group.maxSpread !== null) {
                        const d = convertLinearValue(
                            group.maxSpread,
                            referenceUnit,
                            resultDisplayUnit,
                        );
                        let l = `Spread: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : resultDisplayUnit}`;
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
                        let l = `Mean Radius: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : resultDisplayUnit}`;
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
                            `Offset: ${d.toFixed(3)}${resultDisplayUnit == "inches" ? '"' : resultDisplayUnit} @ ${group.offsetFromAim.angleDegrees.toFixed(1)}°`,
                        );
                    }

                    // Use stored size (logical pixels)
                    const { width: boxW, height: boxH } = group.infoBoxSize;
                    let infoX = group.infoBoxAnchorImage.x; // Anchor is in image pixels
                    let infoY = group.infoBoxAnchorImage.y;

                    // Clamp position to export canvas bounds
                    infoX = Math.max(
                        0,
                        Math.min(infoX, exportCanvas.width - boxW),
                    );
                    infoY = Math.max(
                        0,
                        Math.min(infoY, exportCanvas.height - boxH),
                    );

                    // Style variables (no dpr needed)
                    const fSize = legendFontSize;
                    const pad = 4;
                    const lH = fSize * 1.2;
                    const bgColorWithAlpha = legendBgColor.startsWith("#")
                        ? legendBgColor + "E6"
                        : legendBgColor;
                    const LborderColor = legendBorderColor;
                    const LtextColor = legendTextColor;

                    // Draw box
                    exportCtx.fillStyle = bgColorWithAlpha;
                    exportCtx.strokeStyle = LborderColor;
                    exportCtx.lineWidth = 1; // Fixed border width for export
                    exportCtx.fillRect(infoX, infoY, boxW, boxH);
                    exportCtx.strokeRect(infoX, infoY, boxW, boxH);

                    // Draw text
                    exportCtx.fillStyle = LtextColor;
                    exportCtx.font = `${fSize}px sans-serif`; // Use base font size
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
        exportCtx.restore(); // Restore context after drawing overlays

        // --- Generate Data URL and Trigger Download ---
        try {
            const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9); // Quality = 0.9
            const link = document.createElement("a");
            // Generate filename (use original filename if available)
            const baseName =
                imageFile?.name.replace(/\.[^/.]+$/, "") ?? "target-analysis";
            link.download = `${baseName}.jpg`;
            link.href = dataUrl;
            link.click(); // Simulate click to trigger download
            link.remove(); // Clean up the link element
        } catch (error) {
            console.error("Error exporting canvas:", error);
            alert("Failed to export image as JPEG.");
        }
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
          : mode === "panning"
            ? "grab"
            : mode === "scaling"
              ? "crosshair"
              : mode === "placingHoles"
                ? "copy" // Or your preferred cursor for adding points
                : mode === "placingAim"
                  ? "crosshair"
                  : mode === "selectingHole"
                    ? "pointer"
                    : "default";

    // Reactive calculation for canvas aspect ratio display
    $: canvasAspectRatio = imageBitmap
        ? imageBitmap.width / imageBitmap.height
        : 16 / 9; // Default aspect ratio
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
                    <button
                        class="danger micro"
                        on:click={reset}
                        title="Reset all data & image">Reset All</button
                    >
                </div>
            </div>

            {#if imageUrl}
                <div class="interaction-controls">
                    <div class="zoom-pan-save">
                        <button
                            on:click={exportCanvasAsJpeg}
                            title="Save full image + overlays as JPG"
                            class="save-button"
                            disabled={!imageBitmap}
                        >
                            💾 Save JPG
                        </button>
                        <button
                            on:click={zoomIn}
                            disabled={viewScale >= MAX_ZOOM || !imageBitmap}
                            title="Zoom In (+Wheel Up)">➕</button
                        >
                        <span class="zoom-level" title="Current Zoom Level"
                            >{Math.round(viewScale * 100)}%</span
                        >
                        <button
                            on:click={zoomOut}
                            disabled={viewScale <= MIN_ZOOM || !imageBitmap}
                            title="Zoom Out (+Wheel Down)">➖</button
                        >
                        <button
                            on:click={resetZoom}
                            disabled={!imageBitmap}
                            title="Fit Zoom & Reset Pan">🔍 Fit</button
                        >
                    </div>
                    <div class="controls scale-mode-controls">
                        <label for="refLength">Ref Len:</label>
                        <input
                            type="number"
                            id="refLength"
                            bind:value={referenceLength}
                            min="1"
                            step="1"
                            on:input={handleReferenceInputChange}
                            disabled={!imageBitmap}
                            style:width="60px"
                        />
                        <select
                            bind:value={referenceUnit}
                            on:change={handleReferenceInputChange}
                            disabled={!imageBitmap}
                        >
                            <option value="inches">in</option>
                            <option value="cm">cm</option>
                            <option value="mm">mm</option>
                        </select>
                        <button
                            class="secondary"
                            class:active={mode === "scaling"}
                            on:click={enterScaleMode}
                            title={mode === "scaling"
                                ? "Click-drag on image to draw reference line"
                                : "Draw reference line based on known length"}
                            disabled={!imageBitmap}
                        >
                            📏 {#if mode === "scaling"}Drawing Ref...{:else}Draw
                                Ref Line{/if}
                        </button>
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
                                title="Toggle Pan Mode (Click-drag canvas to move view)"
                                disabled={!imageBitmap}
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
                                title="Place bullet holes (Click on image)"
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
                                title="Set aiming point (Click on image)"
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
                                title="Select/Move hole (Click near a hole, use arrows/buttons to nudge/delete)"
                                disabled={!scale}
                            >
                                👆 Select
                            </button>
                        </div>
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
                            style:aspect-ratio={canvasAspectRatio}
                            style:width={imageBitmap ? "auto" : "100%"}
                            style:height={imageBitmap ? "auto" : "auto"}
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
                                    title="Deselect hole">Clear Sel.</button
                                >
                                <button
                                    class="danger micro"
                                    on:click={deleteSelectedHole}
                                    title="Delete selected hole (Del/Bksp)"
                                    >Delete Sel.</button
                                >
                            </div>
                        </div>
                    {/if}
                </div>
            {:else if mode !== "loading"}
                <div class="canvas-placeholder">
                    <div class="instructions">
                        Load an image to start analysis.
                    </div>
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
                                min="0"
                                step="any"
                                on:input={handleTargetDistanceChange}
                                title="Distance to target (set > 0 for MOA/MIL)"
                                style:width="60px"
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
                                min="0.01"
                                step="0.001"
                                on:input={handleDiameterChange}
                                title="Bullet diameter (for hole visualization)"
                                style:width="60px"
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
                                title="Units for displaying results"
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
                                    ? "Set Target Distance > 0 to enable MOA/MIL"
                                    : "Angular units for results"}
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
                                title="Rename active group"
                            />
                        </div>
                    {/if}
                </div>

                <div class="controls-section">
                    <h2>Appearance</h2>
                    <div class="controls settings-row appearance-row">
                        <div class="setting-item appearance-item">
                            <label for="lineWidthBase">Line Width:</label>
                            <input
                                type="number"
                                id="lineWidthBase"
                                bind:value={lineWidthBase}
                                min="1"
                                step="1"
                                max="20"
                                title="Base line width (px)"
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item">
                            <label for="legendFontSize">Legend Font:</label>
                            <input
                                type="number"
                                id="legendFontSize"
                                bind:value={legendFontSize}
                                min="12"
                                step="2"
                                max="100"
                                title="Legend font size (px)"
                                on:input={redrawCanvas}
                            />
                        </div>
                    </div>
                    <div class="controls settings-row appearance-row color-row">
                        <div class="setting-item appearance-item color-item">
                            <label for="bulletHoleColor" title="Bullet holes"
                                >Hole:</label
                            >
                            <input
                                type="color"
                                id="bulletHoleColor"
                                bind:value={bulletHoleColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="selectedHoleColor"
                                title="Selected hole highlight">Sel Hole:</label
                            >
                            <input
                                type="color"
                                id="selectedHoleColor"
                                bind:value={selectedHoleColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="centroidColor"
                                title="Group center marker">Center:</label
                            >
                            <input
                                type="color"
                                id="centroidColor"
                                bind:value={centroidColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="aimPointColor"
                                title="Aiming point marker">Aim Pt:</label
                            >
                            <input
                                type="color"
                                id="aimPointColor"
                                bind:value={aimPointColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                    </div>
                    <div class="controls settings-row appearance-row color-row">
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="offsetLineColor"
                                title="Offset line (aim to center)"
                                >Offset:</label
                            >
                            <input
                                type="color"
                                id="offsetLineColor"
                                bind:value={offsetLineColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="scaleLineColor"
                                title="Scale reference line">Scale Ln:</label
                            >
                            <input
                                type="color"
                                id="scaleLineColor"
                                bind:value={scaleLineColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="legendTextColor"
                                title="Legend text color">Lgd Text:</label
                            >
                            <input
                                type="color"
                                id="legendTextColor"
                                bind:value={legendTextColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                        <div class="setting-item appearance-item color-item">
                            <label
                                for="legendBgColor"
                                title="Legend background color">Lgd BG:</label
                            >
                            <input
                                type="color"
                                id="legendBgColor"
                                bind:value={legendBgColor}
                                on:input={redrawCanvas}
                            />
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* --- Root Variables (Dark Theme) --- */
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
        --danger-text-color: #f8d7da; /* For text on danger bg */
        --danger-bg-color-button: var(
            --danger-color
        ); /* Keep button background */
        --highlight-color: #ffdc00;
        --active-border-color: var(--primary-color);
        --active-bg-color: #1a4a7f;
        --active-mode-bg-color: var(--primary-color);
        --active-mode-border-color: var(--primary-hover-color);
        --canvas-border-color: #666;
        --disabled-bg-color: #555;
        --disabled-border-color: #555;
        --disabled-text-color: #999;
    }

    /* --- General Styles --- */
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-family: sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        padding: 0;
        width: 100%;
        height: calc(100vh - 2.6em); /* Ensure container takes full height */
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

    /* --- Main Layout --- */
    .main-layout {
        display: flex;
        flex-direction: column; /* Mobile first */
        width: 100%;
        padding: 8px;
        gap: 10px;
        box-sizing: border-box;
        flex-grow: 1; /* Allow layout to fill container */
        min-height: 0; /* Needed for flex-grow in flex column */
    }

    .canvas-column {
        display: flex;
        flex-direction: column;
        gap: 8px; /* Consistent gap */
        width: 100%;
        box-sizing: border-box;
        min-height: 0; /* Allow shrinking */
    }

    .canvas-area-wrapper {
        position: relative; /* For nudge overlay */
        width: 100%;
        flex-grow: 1; /* Allow wrapper to take available space */
        display: flex; /* Center canvas */
        justify-content: center;
        align-items: center;
        overflow: hidden; /* Clip canvas if needed (though aspect ratio should handle) */
        min-height: 200px; /* Minimum height */
    }

    .canvas-area {
        width: 100%;
        height: 100%; /* Fill wrapper */
        overflow: hidden; /* Clip canvas drawing */
        border: 1px solid var(--canvas-border-color);
        background-color: var(--bg-color); /* Match page bg */
        display: flex;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
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
        flex-grow: 1; /* Take space when image not loaded */
    }

    canvas {
        display: block;
        touch-action: none; /* <<< Prevent default touch actions (pull-to-refresh, etc.) >>> */
        background-color: transparent;
        image-rendering: pixelated; /* Keep pixels sharp on zoom */
        /* width/height/aspect-ratio/max-width/max-height set via style attribute */
        object-fit: contain; /* Ensure canvas scales correctly within its container */
        max-width: 100%;
        max-height: 100%;
    }

    /* --- Controls --- */
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
        justify-content: center; /* Center items by default on mobile */
    }

    .controls > span {
        /* For labels like "Groups:" */
        color: var(--text-secondary-color);
        margin-right: 4px;
        font-weight: 500;
        font-size: 0.9em;
    }

    .settings-row {
        justify-content: space-around; /* Space out items in the row */
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
        flex-basis: 48%; /* Try to fit two items per row on larger mobile */
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
        /* Active group button */
        border-color: var(--active-border-color);
        background-color: var(--active-bg-color);
        color: var(--text-color);
        font-weight: bold;
    }

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
    input:disabled,
    select:disabled {
        background-color: var(--disabled-bg-color);
        border-color: var(--disabled-border-color);
        color: var(--disabled-text-color);
        cursor: not-allowed;
        opacity: 0.7;
    }

    select {
        appearance: none; /* Custom arrow needed for consistent look */
        /* Add background SVG for arrow later if desired */
        min-width: 50px;
        text-align: center;
        text-align-last: center; /* Center text */
    }

    input[type="number"] {
        width: 65px; /* Default width, adjust as needed */
    }

    input[type="text"] {
        /* Group name */
        flex-grow: 1;
        min-width: 70px;
    }

    /* --- Buttons --- */
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
        background-color: var(--disabled-bg-color);
        border-color: var(--disabled-border-color);
        color: var(--disabled-text-color);
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
        /* For small buttons like group delete */
        padding: 2px 5px;
        font-size: 0.75em;
        line-height: 1.2;
        margin-left: -4px; /* Pull closer to associated button */
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

    /* --- Interaction Controls Bar --- */
    .interaction-controls {
        display: flex;
        flex-direction: column; /* Stack sections vertically */
        gap: 8px;
        background-color: var(--bg-secondary-color);
        padding: 6px 8px;
        border-radius: 4px;
        border: 1px solid var(--border-color);
    }
    .zoom-pan-save {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start; /* Align left on mobile */
    }
    .scale-mode-controls {
        display: flex;
        gap: 5px 8px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start;
        border-top: 1px dashed var(--border-color);
        padding-top: 8px;
        margin-top: 5px;
    }
    .mode-buttons {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-start; /* Align with scale controls */
        margin-left: 10px; /* Add space between scale and mode */
    }
    .interaction-controls button,
    .scale-mode-controls button,
    .mode-buttons button {
        padding: 4px 8px;
        font-size: 0.9em;
        min-width: 35px;
        background-color: var(--secondary-color); /* Default to secondary */
        border-color: var(--secondary-color);
        color: var(--text-color);
    }
    .interaction-controls button:hover:not(:disabled),
    .scale-mode-controls button:hover:not(:disabled),
    .mode-buttons button:hover:not(:disabled) {
        background-color: var(--secondary-hover-color);
        border-color: var(--secondary-hover-color);
    }

    /* Active mode/state buttons */
    .scale-mode-controls button.active, /* Active scaling button */
     .mode-buttons button.active {
        /* Active mode button */
        background-color: var(--active-mode-bg-color);
        border-color: var(--active-mode-border-color);
        color: white;
        font-weight: bold;
    }

    .zoom-pan-save .zoom-level {
        font-size: 0.8em;
        color: var(--text-secondary-color);
        margin: 0 5px;
        white-space: nowrap;
    }
    .zoom-pan-save .save-button {
        /* Specific style for Save */
        background-color: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
        margin-left: auto; /* Push save button to the right */
    }
    .zoom-pan-save .save-button:hover:not(:disabled) {
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

    /* --- Nudge Overlay --- */
    .nudge-overlay {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 10;
        background-color: rgba(51, 51, 51, 0.85);
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
        /* "Nudge (Arrows):" text */
        display: block;
        text-align: center;
        width: 100%;
        margin-bottom: 3px;
        font-size: 0.9em;
        color: var(--text-secondary-color);
    }
    .nudge-grid {
        display: grid;
        grid-template-columns: repeat(3, auto); /* 3 columns for arrows */
        gap: 4px;
        justify-content: center;
        margin-bottom: 5px;
    }
    /* Arrow key grid layout */
    .nudge-grid button:nth-child(1) {
        grid-column: 2;
        grid-row: 1;
    } /* Up */
    .nudge-grid button:nth-child(2) {
        grid-column: 1;
        grid-row: 2;
    } /* Left */
    .nudge-grid button:nth-child(3) {
        grid-column: 3;
        grid-row: 2;
    } /* Right */
    .nudge-grid button:nth-child(4) {
        grid-column: 2;
        grid-row: 3;
    } /* Down */

    .nudge-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
        width: 100%;
    }
    .nudge-actions button.micro {
        margin-left: 0;
    } /* Reset micro button margin */

    /* --- Appearance Controls Styling --- */
    .appearance-row {
        gap: 5px 15px; /* Adjust gap */
    }
    .appearance-item {
        flex-grow: 1;
        gap: 5px;
    }
    .appearance-item.color-item {
        flex-basis: auto; /* Let color pickers size naturally */
        flex-grow: 0;
    }
    .appearance-item label {
        min-width: 60px; /* Align labels a bit */
        text-align: right;
        font-size: 0.8em; /* Smaller labels */
    }
    .appearance-item input[type="number"] {
        width: 55px; /* Smaller number inputs */
    }
    .appearance-item input[type="color"] {
        width: 35px;
        height: 25px;
        padding: 1px 2px;
        border: 1px solid var(--input-border-color);
        border-radius: 3px;
        background-color: var(--input-bg-color);
        cursor: pointer;
    }
    .color-row {
        justify-content: space-between;
    } /* Space out colors */

    /* --- Desktop Layout --- */
    @media (min-width: 992px) {
        .main-layout {
            flex-direction: row; /* Side-by-side */
            align-items: flex-start;
            padding: 15px;
            gap: 15px;
            height: calc(100vh - 30px); /* Limit height */
            overflow: hidden; /* Prevent outer scroll */
        }

        .canvas-column {
            flex: 3; /* Take more space */
            order: 1; /* Canvas on left */
            height: 100%; /* Fill parent height */
            display: flex; /* Use flex again for vertical layout */
            flex-direction: column;
            gap: 10px; /* Adjust gap */
        }

        .canvas-area-wrapper {
            flex-grow: 1; /* Allow wrapper to fill canvas column */
            min-height: 0; /* Override min-height */
        }
        .canvas-area {
            /* max-width/max-height handled by wrapper */
        }

        .controls-column {
            flex: 1; /* Take less space */
            max-width: 380px; /* Limit width */
            order: 2; /* Controls on right */
            overflow-y: auto; /* Allow controls to scroll */
            height: 100%; /* Fill parent height */
            padding-right: 5px; /* Add padding for scrollbar */
            min-height: 0; /* Allow shrinking */
        }

        .settings-row {
            flex-direction: row; /* Items side-by-side */
            align-items: center;
            flex-wrap: wrap; /* Allow wrapping if needed */
        }
        .setting-item {
            flex-basis: auto; /* Reset basis */
            justify-content: flex-start; /* Align left */
            width: auto; /* Natural width */
        }

        .controls {
            justify-content: flex-start;
        } /* Align controls left */
        .group-management {
            justify-content: flex-start;
        }

        .interaction-controls {
            flex-direction: row; /* Side-by-side */
            align-items: center;
            flex-wrap: wrap; /* Allow wrap */
        }
        .scale-mode-controls {
            border-top: none; /* Remove border */
            padding-top: 0;
            margin-top: 0;
            flex-grow: 1; /* Allow this section to take space */
        }
        .mode-buttons {
            margin-left: auto; /* Push mode buttons to right */
        }

        .zoom-pan-save .save-button {
            margin-left: 15px;
        } /* Add some space before save */
        .appearance-item label {
            min-width: 70px;
        } /* Slightly wider labels on desktop */
    }

    /* --- Tablet/Mobile Tweaks --- */
    @media (max-width: 991px) {
        .canvas-area-wrapper {
            max-height: 70vh; /* Limit canvas height on mobile */
        }
        .setting-item {
            flex-basis: 100%; /* Full width per item */
            justify-content: space-between; /* Space label and input */
        }
        .setting-item label {
            text-align: left;
        }
        .setting-item input,
        .setting-item select {
            flex-grow: 0;
            width: auto;
        } /* Don't grow inputs */
        input[type="number"] {
            width: 80px;
        } /* Slightly wider inputs */
        .mode-buttons {
            justify-content: center;
            margin-left: 0;
        } /* Center mode buttons */
        .mode-buttons button {
            flex-basis: calc(33% - 4px);
        } /* Try 3 buttons per row */
        .group-management {
            justify-content: center;
        }
        .zoom-pan-save .save-button {
            margin-left: 5px;
        } /* Reset margin */
        .scale-mode-controls {
            justify-content: center;
        }
        .color-row {
            justify-content: center;
        }
    }

    /* --- Smaller Mobile Tweaks --- */
    @media (max-width: 480px) {
        h2 {
            font-size: 1em;
        }
        .setting-item {
            flex-direction: column;
            align-items: stretch;
        } /* Stack label and input */
        .setting-item label {
            margin-bottom: 3px;
        }
        .appearance-item label {
            min-width: unset;
            text-align: left;
        }
        .mode-buttons button {
            flex-basis: calc(50% - 4px);
        } /* Two per row */
        .controls-section {
            padding: 8px;
        }
        .interaction-controls {
            padding: 5px;
        }
        .zoom-pan-save,
        .scale-mode-controls,
        .mode-buttons {
            gap: 4px;
        }
        button {
            padding: 5px 8px;
            font-size: 0.8em;
        }
        .color-row .setting-item {
            flex-basis: 45%;
        } /* Fit two colors per row */
    }
</style>
