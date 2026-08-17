<script lang="ts">
	import type { AppearanceSettings as AppearanceSettingsType } from './types';

	export let appearance: AppearanceSettingsType;
	export let onRedraw: () => void;
</script>

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
				bind:value={appearance.lineWidthBase}
				min="1"
				step="1"
				max="20"
				title="Base line width (px)"
				on:input={onRedraw}
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
				bind:value={appearance.legendFontSize}
				min="12"
				step="2"
				max="100"
				title="Legend font size (px)"
				on:input={onRedraw}
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
				bind:checked={appearance.showGroupNameInLegend}
				on:change={onRedraw}
				class="toggle toggle-xs toggle-primary"
			/>
		</div>
		<div
			class="flex flex-col flex-row items-start sm:items-center gap-1 sm:gap-2 flex-1 min-w-[150px]"
		>
			<label
				for="showReferenceLine"
				class="label text-xs font-medium whitespace-nowrap shrink-0 sm:w-20 sm:text-right"
				title="Show reference measurement line on canvas?"
				>Show Ref:</label
			>
			<input
				type="checkbox"
				id="showReferenceLine"
				bind:checked={appearance.showReferenceLine}
				on:change={onRedraw}
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
				bind:value={appearance.bulletHoleColor}
				on:input={onRedraw}
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
				bind:value={appearance.selectedHoleColor}
				on:input={onRedraw}
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
				bind:value={appearance.centroidColor}
				on:input={onRedraw}
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
				bind:value={appearance.aimPointColor}
				on:input={onRedraw}
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
				bind:value={appearance.offsetLineColor}
				on:input={onRedraw}
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
				bind:value={appearance.scaleLineColor}
				on:input={onRedraw}
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
				bind:value={appearance.legendTextColor}
				on:input={onRedraw}
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
				bind:value={appearance.legendBgColor}
				on:input={onRedraw}
				class="w-8 h-6 p-0.5 border rounded bg-base-100 border-base-300 cursor-pointer"
			/>
		</div>
	</div>
</div>
