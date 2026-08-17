<script lang="ts">
	import type {
		Mode,
		LinearUnit,
		DistanceUnit,
		DiameterUnit,
		AngularUnitDisplay,
		ShotGroup,
	} from './types';

	export let hasImage: boolean = false;
	export let mode: Mode = 'loading';
	export let referenceLength: number = 1;
	export let referenceUnit: LinearUnit = 'inches';
	export let targetDistance: number = 100;
	export let targetDistanceUnit: DistanceUnit = 'yards';
	export let bulletDiameter: number = 0.22;
	export let bulletDiameterUnit: DiameterUnit = 'inches';
	export let resultDisplayUnit: LinearUnit = 'inches';
	export let angularUnitDisplay: AngularUnitDisplay = 'moa';

	export let groups: ShotGroup[] = [];
	export let activeGroupIndex: number = -1;
	export let activeGroup: ShotGroup | null = null;

	export let onReferenceInputChange: () => void;
	export let onEnterScaleMode: () => void;
	export let onTargetDistanceChange: () => void;
	export let onDiameterChange: () => void;
	export let onResultUnitChange: () => void;
	export let onAngularUnitChange: () => void;
	export let onSwitchGroup: (index: number) => void;
	export let onDeleteGroup: (index: number) => void;
	export let onAddNewGroup: () => void;
	export let onGroupNameInput: () => void;
</script>

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
				on:input={onReferenceInputChange}
				disabled={!hasImage}
				class="input input-bordered input-xs w-16 text-center"
			/>
			<select
				bind:value={referenceUnit}
				on:change={onReferenceInputChange}
				disabled={!hasImage}
				class="select select-bordered select-xs"
			>
				<option value="inches">in</option>
				<option value="cm">cm</option>
				<option value="mm">mm</option>
			</select>
		</div>
		<button
			class="btn btn-secondary btn-sm"
			class:btn-active={mode === 'scaling'}
			on:click={onEnterScaleMode}
			title={mode === 'scaling'
				? 'Click-drag on image to draw reference line'
				: 'Draw reference line based on known length'}
			disabled={!hasImage}
		>
			📏 {#if mode === 'scaling'}Drawing Ref...{:else}Draw
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
					on:input={onTargetDistanceChange}
					title="Distance to target (set > 0 for MOA/MIL)"
					class="input input-bordered input-xs w-20 text-center grow sm:grow-0"
				/>
				<select
					bind:value={targetDistanceUnit}
					on:change={onTargetDistanceChange}
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
					on:input={onDiameterChange}
					title="Bullet diameter (for hole visualization)"
					class="input input-bordered input-xs w-20 text-center grow sm:grow-0"
				/>
				<select
					bind:value={bulletDiameterUnit}
					on:change={onDiameterChange}
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
				on:change={onResultUnitChange}
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
				on:change={onAngularUnitChange}
				disabled={targetDistance <= 0}
				title={targetDistance <= 0
					? 'Set Target Distance > 0 to enable MOA/MIL'
					: 'Angular units for results'}
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
					class:btn-active={index === activeGroupIndex}
					on:click={() => onSwitchGroup(index)}
					title="Switch to {group.name}"
					>{group.name}</button
				>
				{#if groups.length > 1}
					<button
						class="btn btn-error btn-xs btn-square -ml-px z-10"
						on:click|stopPropagation={() => onDeleteGroup(index)}
						title="Delete {group.name}">X</button
					>
				{/if}
			{/each}
		</div>
		<button
			class="btn btn-secondary btn-xs btn-square"
			on:click={onAddNewGroup}
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
				on:input={onGroupNameInput}
				title="Rename active group"
				class="input input-bordered input-sm flex-grow"
			/>
		</div>
	{/if}
</div>
