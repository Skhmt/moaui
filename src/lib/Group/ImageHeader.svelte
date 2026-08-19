<script lang="ts">
	export let fileInputEl: HTMLInputElement | undefined = undefined;
	export let hasImage: boolean = false;
	export let onFileSelect: (e: Event) => void;
	export let onExportJpeg: () => void;
</script>

<div class="card bg-base-100 shadow-md p-3">
	<div
		class="flex flex-wrap gap-2 items-center justify-center sm:justify-start"
	>
		<label
			for="fileInput"
			class="label text-sm font-medium mr-1">🖼️ Image:</label
		>
		<input
			bind:this={fileInputEl}
			type="file"
			id="fileInput"
			accept="image/*"
			on:change={onFileSelect}
			class="file-input file-input-bordered file-input-sm max-w-[17em] flex-grow"
		/>
		<button
			class="btn btn-primary btn-sm lg:order-last"
			on:click={onExportJpeg}
			title="Save full image + overlays as JPG"
			disabled={!hasImage}
		>
			💾 Save JPG
		</button>
	</div>
</div>
