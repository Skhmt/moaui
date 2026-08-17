<script lang="ts">
	import type {
		ShotGroup,
		Mode,
		LinearUnit,
		DistanceUnit,
		DiameterUnit,
		AngularUnitDisplay,
		AppearanceSettings as AppearanceSettingsType,
	} from './types';
	import GroupSettings from './GroupSettings.svelte';
	import AppearanceSettings from './AppearanceSettings.svelte';

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
	export let appearance: AppearanceSettingsType;

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
	export let onRedraw: () => void;
</script>

<div
	class="flex flex-col gap-3 lg:flex-1 lg:max-w-sm lg:order-2 lg:h-full lg:overflow-y-auto lg:pr-1 min-h-0 w-full"
>
	<GroupSettings
		{hasImage}
		{mode}
		bind:referenceLength
		bind:referenceUnit
		bind:targetDistance
		bind:targetDistanceUnit
		bind:bulletDiameter
		bind:bulletDiameterUnit
		bind:resultDisplayUnit
		bind:angularUnitDisplay
		{groups}
		{activeGroupIndex}
		{activeGroup}
		{onReferenceInputChange}
		{onEnterScaleMode}
		{onTargetDistanceChange}
		{onDiameterChange}
		{onResultUnitChange}
		{onAngularUnitChange}
		{onSwitchGroup}
		{onDeleteGroup}
		{onAddNewGroup}
		{onGroupNameInput}
	/>

	<AppearanceSettings
		bind:appearance
		{onRedraw}
	/>
</div>
