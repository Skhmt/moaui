<script lang="ts">
	export let onNudgeKey: (key: string) => void;
	export let onDeleteHole: () => void;
</script>

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
			on:click={() => onNudgeKey('ArrowUp')}
			title="Nudge Up">↑</button
		>
		<button
			class="btn btn-info btn-xs btn-square col-start-1 row-start-2"
			on:click={() => onNudgeKey('ArrowLeft')}
			title="Nudge Left">←</button
		>
		<button
			class="btn btn-info btn-xs btn-square col-start-3 row-start-2"
			on:click={() => onNudgeKey('ArrowRight')}
			title="Nudge Right">→</button
		>
		<button
			class="btn btn-info btn-xs btn-square col-start-2 row-start-3"
			on:click={() => onNudgeKey('ArrowDown')}
			title="Nudge Down">↓</button
		>
	</div>
	<div class="flex justify-center gap-2 w-full mt-2">
		<button
			class="btn btn-soft btn-error btn-xs"
			on:click={onDeleteHole}
			title="Delete selected hole (Del/Bksp)"
			>Delete</button
		>
	</div>
</div>
