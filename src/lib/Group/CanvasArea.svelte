<script lang="ts">
	import type { Mode } from './types';
	import NudgeControls from './NudgeControls.svelte';

	export let canvasElement: HTMLCanvasElement | undefined = undefined;
	export let canvasAreaElement: HTMLDivElement | undefined = undefined;
	export let mode: Mode = 'loading';
	export let selectedHoleIndex: number | null = null;
	export let canvasCursor: string = 'default';

	export let onPointerDown: (e: PointerEvent) => void;
	export let onClick: (e: MouseEvent) => void;
	export let onWheel: (e: WheelEvent) => void;
	export let onNudgeKey: (key: string) => void;
	export let onDeleteHole: () => void;
</script>

<div
	class="relative w-full flex-grow flex justify-center items-center lg:min-h-0 max-h-[70vh] lg:max-h-full"
>
	<div
		class="w-full h-full overflow-hidden border border-base-300 bg-base-200 flex justify-center items-center"
		on:wheel|preventDefault={onWheel}
		on:auxclick|preventDefault
		bind:this={canvasAreaElement}
	>
		<canvas
			bind:this={canvasElement}
			on:pointerdown={onPointerDown}
			on:click={onClick}
			on:wheel|preventDefault={onWheel}
			on:auxclick|preventDefault
			on:contextmenu={(e) => { e.preventDefault(); }}
			class="block touch-none w-full h-full"
			style:cursor={canvasCursor}
			style:image-rendering="smooth"
		>
		</canvas>
	</div>

	{#if mode === 'selectingHole' && selectedHoleIndex !== null}
		<NudgeControls
			{onNudgeKey}
			{onDeleteHole}
		/>
	{/if}
</div>
