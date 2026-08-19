<script lang="ts">
	import type { Mode } from './types';
	import { MAX_ZOOM } from './constants';

	export let hasImage: boolean = false;
	export let viewScale: number = 1.0;
	export let fitScaleValue: number = 1.0;
	export let mode: Mode = 'loading';
	export let scale: number | null = null;

	export let onZoomIn: (e: MouseEvent) => void;
	export let onZoomOut: (e: MouseEvent) => void;
	export let onResetZoom: () => void;
	export let onTogglePan: () => void;
	export let onSelectMode: (m: Mode) => void;
</script>

<div
	class="card bg-base-100 shadow-md p-2 lg:p-3 flex flex-col sm:flex-row sm:flex-wrap gap-2 xs:items-center"
>
	<div
		class="flex gap-1 items-center flex-wrap justify-center lg:justify-start"
	>
		<button
			class="btn btn-secondary btn-sm btn-square"
			on:click={onZoomIn}
			disabled={!hasImage || viewScale >= MAX_ZOOM}
			title="Zoom In (+Wheel Up)">➕</button
		>
		<span
			class="text-xs text-base-content/70 mx-1 whitespace-nowrap w-8"
			title="Current Zoom Level"
			>{Math.round(viewScale * 100)}%</span
		>
		<button
			class="btn btn-secondary btn-sm btn-square"
			on:click={onZoomOut}
			disabled={!hasImage || viewScale <= fitScaleValue}
			title="Zoom Out (+Wheel Down)">➖</button
		>
		<button
			class="btn btn-secondary btn-sm"
			on:click={onResetZoom}
			disabled={!hasImage}
			title="Fit Zoom & Reset Pan">🔍 Fit</button
		>
	</div>

	<div
		class="flex flex-wrap gap-x-3 gap-y-2 items-center justify-center sm:ml-auto"
	>
		<div class="btn-group">
			<button
				class="btn btn-sm"
				class:btn-outline={mode === 'panning'}
				on:click={onTogglePan}
				title="Toggle Pan Mode (Click-drag canvas to move view)"
				disabled={!scale}
			>
				🤚 Pan
			</button>
			<button
				class="btn btn-sm"
				class:btn-outline={mode === 'placingHoles'}
				on:click={() => onSelectMode('placingHoles')}
				title="Place bullet holes (Click on image)"
				disabled={!scale}
			>
				⭕ Holes
			</button>
			<button
				class="btn btn-sm"
				class:btn-outline={mode === 'placingAim'}
				on:click={() => onSelectMode('placingAim')}
				title="Set aiming point (Click on image)"
				disabled={!scale}
			>
				🎯 Aim Pt
			</button>
			<button
				class="btn btn-sm"
				class:btn-outline={mode === 'selectingHole'}
				on:click={() => onSelectMode('selectingHole')}
				title="Select/Move hole (Click near a hole, use arrows/buttons to nudge/delete)"
				disabled={!scale}
			>
				👆 Select
			</button>
		</div>
	</div>
</div>
