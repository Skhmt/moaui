<!--
    Thanks Gemini 2.5 Pro.
-->

<script lang="ts">
    import { onMount, onDestroy } from "svelte";

    // --- Type Definitions ---
    interface Point {
        x: number;
        y: number;
    }

    type Mode = "loading" | "scaling" | "placing" | "results";
    type Unit = "inches" | "cm" | "mm";

    // --- State Variables ---
    let imageFile: File | null = null;
    let imageUrl: string | null = null;
    let canvasElement: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let imageElement: HTMLImageElement | null = null;
    let mode: Mode = "loading";
    let scale: number | null = null; // pixels per unit (e.g., pixels per inch)
    let referenceUnit: Unit = "inches";

    // Scaling State
    let refLineStart: Point | null = null;
    let refLineEnd: Point | null = null;
    let isDrawingRefLine: boolean = false;
    let referenceLength: number = 1;

    // Bullet Hole State
    let bulletDiameter: number = 0.22; // in referenceUnit
    let bulletHolesPixels: Point[] = [];
    let bulletHolesReal: Point[] = [];

    // Results State
    let meanRadius: number | null = null;
    let maxSpread: number | null = null;
    let centroidReal: Point | null = null;

    // Element refs
    let fileInputEl: HTMLInputElement | undefined;

    // --- Lifecycle & Setup ---
    let observer: ResizeObserver | null = null;

    onMount(() => {
        // Optional: Observe canvas resize to potentially redraw or adjust logic if needed
        // This basic observer just logs resize, more complex handling could be added
        if (canvasElement) {
            observer = new ResizeObserver((entries) => {
                // Handle resize - e.g., re-calculate coordinate scaling if needed,
                // though getCanvasCoords handles current scaling on each event.
                // console.log('Canvas resized', entries[0].contentRect);
            });
            observer.observe(canvasElement);
        }
    });

    onDestroy(() => {
        if (canvasElement && observer) {
            observer.unobserve(canvasElement);
        }
        // Clean up object URL if created
        if (imageUrl && imageUrl.startsWith("blob:")) {
            URL.revokeObjectURL(imageUrl);
        }
    });

    function setupCanvas(): void {
        if (!canvasElement || !imageUrl) return;
        ctx = canvasElement.getContext("2d");
        if (!ctx) {
            console.error("Could not get 2D context");
            alert("Error initializing canvas context.");
            reset();
            return;
        }
        imageElement = new Image();

        imageElement.onload = () => {
            if (!imageElement || !canvasElement || !ctx) return; // Type guard
            // Set canvas dimensions to image dimensions
            canvasElement.width = imageElement.naturalWidth;
            canvasElement.height = imageElement.naturalHeight;
            redrawCanvas();
            mode = "scaling"; // Move to next step
        };
        imageElement.onerror = () => {
            alert("Error loading image.");
            reset();
        };
        imageElement.src = imageUrl;
    }

    function redrawCanvas(): void {
        if (
            !ctx ||
            !canvasElement ||
            !imageElement ||
            !imageElement.complete ||
            imageElement.naturalWidth === 0
        )
            return;

        // Clear canvas
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        // Draw the image
        ctx.drawImage(
            imageElement,
            0,
            0,
            canvasElement.width,
            canvasElement.height,
        );

        // Draw Reference Line
        if (refLineStart && refLineEnd) {
            ctx.beginPath();
            ctx.moveTo(refLineStart.x, refLineStart.y);
            ctx.lineTo(refLineEnd.x, refLineEnd.y);
            ctx.strokeStyle = "lime";
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = "lime";
            ctx.fillRect(refLineStart.x - 3, refLineStart.y - 3, 6, 6);
            ctx.fillRect(refLineEnd.x - 3, refLineEnd.y - 3, 6, 6);
        }

        // Draw Bullet Holes
        if (scale && (mode === "placing" || mode === "results")) {
            const bulletRadiusPixels = (bulletDiameter / 2) * scale;
            ctx.fillStyle = "rgba(255, 0, 0, 0.8)";
            ctx.strokeStyle = "red";
            ctx.lineWidth = 1;

            bulletHolesPixels.forEach((hole: Point) => {
                ctx?.beginPath();
                // Ensure radius is visible, at least 2px or calculated size
                const radius = Math.max(2, bulletRadiusPixels);
                ctx?.arc(hole.x, hole.y, radius, 0, Math.PI * 2);
                ctx?.fill();
                ctx?.stroke();
            });

            // Draw Centroid
            if (mode === "results" && centroidReal && scale) {
                const centroidPixels: Point = {
                    x: centroidReal.x * scale,
                    y: centroidReal.y * scale,
                };
                ctx.fillStyle = "blue";
                ctx.fillRect(centroidPixels.x - 4, centroidPixels.y - 4, 8, 8);
            }
        }
    }

    // --- Event Handlers ---
    function handleFileSelect(event: Event): void {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (file && file.type.startsWith("image/")) {
            imageFile = file;
            // Clean up previous object URL if it exists
            if (imageUrl && imageUrl.startsWith("blob:")) {
                URL.revokeObjectURL(imageUrl);
            }
            imageUrl = URL.createObjectURL(file); // More efficient than FileReader for immediate display
            resetState();
            mode = "loading"; // Show loading state
            // Delay setupCanvas slightly to allow Svelte to update DOM if needed
            requestAnimationFrame(setupCanvas);
        } else {
            alert("Please select a valid image file.");
            if (target) target.value = ""; // Reset file input
            imageFile = null;
            imageUrl = null;
        }
    }

    function getCanvasCoords(event: PointerEvent): Point | null {
        if (!canvasElement) return null;

        const rect = canvasElement.getBoundingClientRect();
        // Ratio of canvas drawing buffer size to displayed size
        const scaleX = canvasElement.width / rect.width;
        const scaleY = canvasElement.height / rect.height;

        // Calculate pointer position relative to the canvas element, scaled to drawing buffer coords
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;

        return { x, y };
    }

    function handlePointerDown(event: PointerEvent): void {
        if (mode !== "scaling" || !canvasElement) return;
        // Ensure pointer capture for consistent move/up events, especially on touch
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        isDrawingRefLine = true;
        const coords = getCanvasCoords(event);
        if (coords) {
            refLineStart = coords;
            refLineEnd = coords; // Initialize end point
            redrawCanvas(); // Show starting point
        }
    }

    function handlePointerMove(event: PointerEvent): void {
        if (mode !== "scaling" || !isDrawingRefLine || !canvasElement) return;
        // Only process if the primary button is down (prevents issues with multi-touch/stylus buttons)
        // The check `isDrawingRefLine` should mostly cover this for our logic flow.
        // if (event.buttons !== 1 && event.pointerType === 'mouse') return; // Might be too restrictive for touch?

        const coords = getCanvasCoords(event);
        if (coords) {
            refLineEnd = coords;
            redrawCanvas(); // Draw line dynamically
        }
    }

    function handlePointerUp(event: PointerEvent): void {
        if (mode !== "scaling" || !isDrawingRefLine || !canvasElement) return;
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        isDrawingRefLine = false;
        const coords = getCanvasCoords(event);
        if (coords) {
            refLineEnd = coords; // Finalize end point based on up location
        }
        redrawCanvas(); // Draw final line
    }

    // Handle cases where the pointer leaves the canvas or capture is lost
    function handlePointerLeaveOrLost(event: PointerEvent): void {
        if (isDrawingRefLine) {
            // Treat as pointer up if drawing was in progress
            handlePointerUp(event);
        }
    }

    function handleCanvasClick(event: PointerEvent): void {
        if (mode !== "placing" || !scale || !canvasElement) return;

        // Prevent placing hole if user was dragging (even slightly) - optional
        // if (event.movementX !== 0 || event.movementY !== 0) return;

        const coordsPixels = getCanvasCoords(event);
        if (!coordsPixels) return;

        bulletHolesPixels = [...bulletHolesPixels, coordsPixels];

        const coordsReal: Point = {
            x: coordsPixels.x / scale,
            y: coordsPixels.y / scale,
        };
        bulletHolesReal = [...bulletHolesReal, coordsReal];

        // Trigger redraw
        bulletHolesPixels = bulletHolesPixels;
        bulletHolesReal = bulletHolesReal;
        redrawCanvas();
    }

    // --- Logic Functions ---
    function calculateScale(): void {
        if (
            !refLineStart ||
            !refLineEnd ||
            !referenceLength ||
            referenceLength <= 0
        ) {
            alert(
                "Please draw a reference line and enter its real-world length (must be > 0).",
            );
            return;
        }
        const dx = refLineEnd.x - refLineStart.x;
        const dy = refLineEnd.y - refLineStart.y;
        const lineLengthPixels = Math.sqrt(dx * dx + dy * dy);

        if (lineLengthPixels < 1) {
            alert("Reference line is too short. Please draw a longer line.");
            // Optionally reset the line
            // refLineStart = null;
            // refLineEnd = null;
            // redrawCanvas();
            return;
        }

        scale = lineLengthPixels / referenceLength; // pixels per unit
        mode = "placing";
        alert(
            `Scale set: ${scale.toFixed(2)} pixels per ${referenceUnit}. Now tap/click to place bullet holes.`,
        );
        redrawCanvas(); // Redraw potentially with different hole sizes if diameter already set
    }

    function calculateResults(): void {
        if (bulletHolesReal.length < 2) {
            alert("Please place at least 2 bullet holes.");
            return;
        }

        // 1. Calculate Centroid
        let sumX = 0;
        let sumY = 0;
        bulletHolesReal.forEach((hole: Point) => {
            sumX += hole.x;
            sumY += hole.y;
        });
        // Assign calculated centroid - TS knows it's a Point now
        centroidReal = {
            x: sumX / bulletHolesReal.length,
            y: sumY / bulletHolesReal.length,
        };

        // 2. Calculate Mean Radius
        let sumDistFromCentroid = 0;
        // Use the non-null centroidReal
        const cx = centroidReal.x;
        const cy = centroidReal.y;
        bulletHolesReal.forEach((hole: Point) => {
            const dx = hole.x - cx;
            const dy = hole.y - cy;
            sumDistFromCentroid += Math.sqrt(dx * dx + dy * dy);
        });
        meanRadius = sumDistFromCentroid / bulletHolesReal.length;

        // 3. Calculate Max Spread
        let maxDistSq = 0;
        for (let i = 0; i < bulletHolesReal.length; i++) {
            for (let j = i + 1; j < bulletHolesReal.length; j++) {
                const dx = bulletHolesReal[i].x - bulletHolesReal[j].x;
                const dy = bulletHolesReal[i].y - bulletHolesReal[j].y;
                const distSq = dx * dx + dy * dy;
                if (distSq > maxDistSq) {
                    maxDistSq = distSq;
                }
            }
        }
        maxSpread = Math.sqrt(maxDistSq);

        mode = "results";
        redrawCanvas(); // Redraw to show centroid
    }

    function resetState(): void {
        scale = null;
        refLineStart = null;
        refLineEnd = null;
        isDrawingRefLine = false;
        // referenceLength = 1; // Keep user preferences? Resetting.
        // bulletDiameter = 0.22; // Keep user preferences? Resetting.
        bulletHolesPixels = [];
        bulletHolesReal = [];
        meanRadius = null;
        maxSpread = null;
        centroidReal = null;
        // mode is usually set by the caller after resetting state
    }

    function reset(): void {
        // Reset calculation/interaction state
        resetState();

        // Clear drawing
        if (ctx && canvasElement) {
            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            // Optionally resize canvas back to default placeholder size
            // canvasElement.width = 300;
            // canvasElement.height = 150;
        }

        // Revoke object URL if necessary
        if (imageUrl && imageUrl.startsWith("blob:")) {
            URL.revokeObjectURL(imageUrl);
        }

        // Reset component state variables
        imageFile = null;
        imageUrl = null;
        // ctx = null; // Keep ctx if canvasElement still exists? Or clear? Clearing seems safer.
        // ctx = null;
        imageElement = null; // Image object is no longer valid
        mode = "loading"; // Back to initial state

        // Clear file input using bound element reference
        if (fileInputEl) {
            fileInputEl.value = "";
        }

        // Reset user inputs to defaults
        referenceLength = 1;
        bulletDiameter = 0.22;
        referenceUnit = "inches";
    }

    function undoLastHole(): void {
        if (bulletHolesPixels.length > 0 && bulletHolesReal.length > 0) {
            bulletHolesPixels.pop();
            bulletHolesReal.pop();
            // Trigger reactivity by reassigning
            bulletHolesPixels = bulletHolesPixels;
            bulletHolesReal = bulletHolesReal;
            redrawCanvas();

            // If in results mode, revert as results are invalid
            if (mode === "results") {
                mode = "placing";
                meanRadius = null;
                maxSpread = null;
                centroidReal = null;
            }
        }
    }

    function handleDiameterChange(): void {
        // Redraw canvas if scale is set, as hole size depends on diameter
        if (scale) {
            redrawCanvas();
        }
    }
</script>

<div class="container">
    <h1>Shot Group Analyzer (TS)</h1>

    <!-- 1. File Input -->
    <div class="controls">
        <label for="fileInput">Load Target Image:</label>
        <input
            bind:this={fileInputEl}
            type="file"
            id="fileInput"
            accept="image/*"
            on:change={handleFileSelect}
        />
        <!-- Basic Camera Access Hint (implementation complex) -->
        <!-- <input type="file" accept="image/*" capture="environment"> -->
        <button class="danger" on:click={reset} title="Reset everything"
            >Start Over</button
        >
    </div>

    {#if mode === "loading" && imageUrl}
        <p>Loading image...</p>
    {/if}

    <!-- Canvas for Image and Interaction -->
    <!-- Conditionally render canvas *only* when imageUrl is set to avoid blank box -->
    {#if imageUrl}
        <canvas
            bind:this={canvasElement}
            on:pointerdown={handlePointerDown}
            on:pointermove={handlePointerMove}
            on:pointerup={handlePointerUp}
            on:pointerleave={handlePointerLeaveOrLost}
            on:lostpointercapture={handlePointerLeaveOrLost}
            on:pointerdown={handleCanvasClick}
            class:scaling-mode-active={mode === "scaling" && isDrawingRefLine}
            class:scaling-mode-idle={mode === "scaling" && !isDrawingRefLine}
            class:placing-mode={mode === "placing"}
            width="300"
            height="150"
        ></canvas><!-- Default/placeholder size, resized on image load -->
    {:else if mode !== "loading"}
        <div class="instructions">
            Please load an image using the button above.
        </div>
    {/if}

    <!-- 2. Scaling Controls -->
    {#if mode === "scaling" && imageUrl}
        <div class="instructions">
            Click and drag on the image to draw a line corresponding to a known
            length. Then enter that length below and click "Set Scale".
        </div>
        <div class="controls">
            <label for="refLength">Reference Length:</label>
            <input
                type="number"
                id="refLength"
                bind:value={referenceLength}
                min="0.01"
                step="any"
            />
            <select bind:value={referenceUnit}>
                <option value="inches">inches</option>
                <option value="cm">cm</option>
                <option value="mm">mm</option>
            </select>
            <button
                on:click={calculateScale}
                disabled={!refLineEnd || referenceLength <= 0}>Set Scale</button
            >
        </div>
    {/if}

    <!-- 3. Bullet Diameter & Placement Controls -->
    {#if (mode === "placing" || mode === "results") && imageUrl}
        <div class="controls">
            <label for="bulletDiam">Bullet Diameter ({referenceUnit}):</label>
            <input
                type="number"
                id="bulletDiam"
                bind:value={bulletDiameter}
                min="0.01"
                step="any"
                on:input={handleDiameterChange}
            />
        </div>
    {/if}

    <!-- 4. Placing Mode Actions -->
    {#if mode === "placing" && imageUrl}
        <div class="instructions">
            Scale set ({scale?.toFixed(2)} px/{referenceUnit}). Tap/Click on
            each bullet hole. Current Diameter: {bulletDiameter}
            {referenceUnit}.
        </div>
        <div class="controls">
            <button
                on:click={calculateResults}
                disabled={bulletHolesReal.length < 2}>Calculate Group</button
            >
            <button
                class="secondary"
                on:click={undoLastHole}
                disabled={bulletHolesReal.length === 0}>Undo Last Hole</button
            >
        </div>
    {/if}

    <!-- 5. Results Display & Actions -->
    {#if mode === "results" && imageUrl}
        <div class="instructions">
            Calculation complete. You can add more holes, recalculate, undo, or
            start over.
        </div>
        <div class="controls">
            <!-- Allow adding more holes after calculation -->
            <button on:click={() => (mode = "placing")} class="secondary"
                >Add More Holes</button
            >
            <button
                on:click={calculateResults}
                disabled={bulletHolesReal.length < 2}>Recalculate</button
            >
            <button
                class="secondary"
                on:click={undoLastHole}
                disabled={bulletHolesReal.length === 0}>Undo Last Hole</button
            >
        </div>
        {#if meanRadius !== null && maxSpread !== null && centroidReal !== null}
            <div class="results-display">
                <h3>Results</h3>
                <p>
                    <strong>Number of Shots:</strong>
                    {bulletHolesReal.length}
                </p>
                <!-- Display centroid relative to top-left of image -->
                <p>
                    <strong>Center of Group (X, Y):</strong>
                    ({centroidReal.x.toFixed(2)}, {centroidReal.y.toFixed(2)}) {referenceUnit}
                </p>
                <p>
                    <strong>Mean Radius:</strong>
                    {meanRadius.toFixed(3)}
                    {referenceUnit}
                </p>
                <p>
                    <strong>Max Spread (Group Size):</strong>
                    {maxSpread.toFixed(3)}
                    {referenceUnit}
                </p>
            </div>
        {:else}
            <p class="warning">
                Could not calculate results (need at least 2 holes).
            </p>
        {/if}
    {/if}
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
        font-family: sans-serif;
    }
    canvas {
        border: 1px solid #ccc;
        max-width: 100%;
        height: auto;
        display: block; /* Prevents extra space below canvas */
        touch-action: none; /* Prevent browser default touch actions like scroll/zoom */
    }
    canvas.scaling-mode-active {
        cursor: grabbing;
    }
    canvas.scaling-mode-idle {
        cursor: crosshair;
    }
    canvas.placing-mode {
        cursor: pointer;
    }
    .controls,
    /* .results {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        padding: 10px;
        border: 1px solid #eee;
        border-radius: 5px;
        background-color: #f9f9f9;
        max-width: 90%;
        justify-content: center;
    } */
    label {
        margin-right: 5px;
    }
    input[type="number"] {
        width: 70px; /* Slightly wider for decimals */
    }
    button {
        padding: 8px 15px;
        cursor: pointer;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        transition: background-color 0.2s ease;
    }
    button:hover:not(:disabled) {
        background-color: #0056b3;
    }
    button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
    }
    button.secondary {
        background-color: #6c757d;
    }
    button.secondary:hover:not(:disabled) {
        background-color: #5a6268;
    }
    /* button.warning {
        background-color: #ffc107;
        color: black;
    } */
    /* button.warning:hover:not(:disabled) {
        background-color: #e0a800;
    } */
    button.danger {
        background-color: #dc3545;
    }
    button.danger:hover:not(:disabled) {
        background-color: #c82333;
    }
    .results-display {
        margin-top: 15px;
        padding: 15px;
        border: 1px solid #17a2b8;
        background-color: #e2f7fa;
        border-radius: 5px;
        width: 80%;
        max-width: 500px;
    }
    .results-display h3 {
        margin-top: 0;
        color: #0c5460;
        text-align: center;
    }
    .instructions {
        padding: 10px;
        background-color: #fff3cd;
        border: 1px solid #ffeeba;
        border-radius: 5px;
        color: #856404;
        text-align: center;
        width: 80%;
        max-width: 600px;
    }
</style>
