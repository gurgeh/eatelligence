<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { NutritionTarget } from '$lib/types';
	import { relativeTargetMappings, generateTargetLabel, getErrorMessage } from '$lib/utils';

	let targets: NutritionTarget[] = [];
	let loading = true;
	let error: string | null = null;

	// --- Form State for Adding Targets ---
	// Absolute
	let absoluteNutrient: string = 'calories';
	let absoluteMin: number | null = null;
	let absoluteMax: number | null = null;
	// Relative
	let relativeTargetType: string = 'protein_percent_calories'; // Default selection
	let relativeMin: number | null = null;
	let relativeMax: number | null = null;

	// --- Data Definitions ---
	const absoluteNutrientOptions = [
		'calories',
		'protein',
		'fat',
		'carbs',
		'fibers',
		'sugar',
		'mufa',
		'pufa',
		'sfa',
		'omega3',
		'omega6',
		'gl'
	];

	// --- Load Existing Targets ---
	onMount(async () => {
		await fetchTargets();
	});

	async function fetchTargets() {
		loading = true;
		error = null;
		try {
			const { data, error: fetchError } = await supabase
				.from('nutrition_targets')
				.select('*')
				.order('nutrient_1', { ascending: true }) // Basic ordering
				.order('nutrient_2', { ascending: true, nullsFirst: true });

			if (fetchError) throw fetchError;
			targets = data || [];
		} catch (err: unknown) {
			error = `Failed to load targets: ${getErrorMessage(err)}`;
			console.error(err);
		} finally {
			loading = false;
		}
	}

	// --- Add Target Logic ---
	async function addAbsoluteTarget() {
		if (!absoluteNutrient) return;
		error = null;
		try {
			const { error: insertError } = await supabase.from('nutrition_targets').insert({
				nutrient_1: absoluteNutrient,
				nutrient_2: null,
				min_value: absoluteMin,
				max_value: absoluteMax
			});
			if (insertError) {
				// Handle potential unique constraint violation gracefully
				if (insertError.code === '23505') {
					// unique_violation
					throw new Error(
						`A target for "${generateTargetLabel(absoluteNutrient, null)}" already exists.`
					);
				}
				throw insertError;
			}
			// Reset form and refetch
			absoluteNutrient = 'calories';
			absoluteMin = null;
			absoluteMax = null;
			await fetchTargets();
		} catch (err: unknown) {
			error = `Failed to add absolute target: ${getErrorMessage(err)}`;
			console.error(err);
		}
	}

	async function addRelativeTarget() {
		if (!relativeTargetType) return;
		error = null;
		const mapping = relativeTargetMappings[relativeTargetType];
		if (!mapping) {
			error = 'Invalid relative target type selected.';
			return;
		}

		try {
			const { error: insertError } = await supabase.from('nutrition_targets').insert({
				nutrient_1: mapping.n1,
				nutrient_2: mapping.n2,
				min_value: relativeMin,
				max_value: relativeMax
			});

			if (insertError) {
				if (insertError.code === '23505') {
					// unique_violation
					throw new Error(`A target for "${mapping.label}" already exists.`);
				}
				throw insertError;
			}
			// Reset form and refetch
			relativeTargetType = 'protein_percent_calories';
			relativeMin = null;
			relativeMax = null;
			await fetchTargets();
		} catch (err: unknown) {
			error = `Failed to add relative target: ${getErrorMessage(err)}`;
			console.error(err);
		}
	}

	// --- Delete Target Logic ---
	async function deleteTarget(id: string) {
		if (!confirm('Are you sure you want to delete this target?')) return;
		error = null;
		try {
			const { error: deleteError } = await supabase
				.from('nutrition_targets')
				.delete()
				.match({ id: id });
			if (deleteError) throw deleteError;
			await fetchTargets(); // Refresh the list
		} catch (err: unknown) {
			error = `Failed to delete target: ${getErrorMessage(err)}`;
			console.error(err);
		}
	}

	// --- Update Target Logic (Inline Editing) ---
	async function saveTargetUpdate(
		target: NutritionTarget,
		field: 'min_value' | 'max_value',
		value: number | null
	) {
		// Basic validation: ensure value is a number or null
		const updateValue = value === null || isNaN(Number(value)) ? null : Number(value);

		// Prevent saving if nothing changed (or became invalid)
		if (target[field] === updateValue) return;

		error = null;
		try {
			const { error: updateError } = await supabase
				.from('nutrition_targets')
				.update({ [field]: updateValue })
				.match({ id: target.id });

			if (updateError) throw updateError;

			// Update local state immediately for responsiveness
			const targetIndex = targets.findIndex((t) => t.id === target.id);
			if (targetIndex !== -1) {
				targets[targetIndex] = { ...targets[targetIndex], [field]: updateValue };
				targets = [...targets]; // Trigger reactivity
			} else {
				// Fallback if local state is somehow out of sync
				await fetchTargets();
			}
		} catch (err: unknown) {
			error = `Failed to update target: ${getErrorMessage(err)}`;
			console.error(err);
			// Optionally revert local state or refetch on error
			await fetchTargets();
		}
	}
</script>

<svelte:head>
	<title>Nutrition Targets - Eatelligence</title>
</svelte:head>

<div class="container mx-auto max-w-3xl p-4">
	<h1 class="mb-6 text-2xl font-bold tracking-tight text-gray-900">Manage Nutrition Targets</h1>

	{#if error}
		<div
			class="relative mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700"
			role="alert"
		>
			<strong class="font-bold">Error: </strong>
			<span class="block sm:inline">{error}</span>
		</div>
	{/if}

	<!-- Add New Targets Section -->
	<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
		<!-- Add Absolute Target -->
		<div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
			<h2 class="mb-3 text-lg font-semibold">Add Absolute Target</h2>
			<form on:submit|preventDefault={addAbsoluteTarget}>
				<div class="mb-3">
					<label for="absoluteNutrient" class="mb-1 block text-sm font-medium text-gray-700"
						>Nutrient</label
					>
					<select
						id="absoluteNutrient"
						bind:value={absoluteNutrient}
						class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
					>
						{#each absoluteNutrientOptions as nutrient (nutrient)}
							<option value={nutrient}
								>{nutrient.charAt(0).toUpperCase() + nutrient.slice(1)}</option
							>
						{/each}
					</select>
				</div>
				<div class="mb-3 grid grid-cols-2 gap-4">
					<div>
						<label for="absoluteMin" class="mb-1 block text-sm font-medium text-gray-700"
							>Min Value</label
						>
						<input
							type="number"
							id="absoluteMin"
							step="any"
							bind:value={absoluteMin}
							placeholder="Optional"
							class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
						/>
					</div>
					<div>
						<label for="absoluteMax" class="mb-1 block text-sm font-medium text-gray-700"
							>Max Value</label
						>
						<input
							type="number"
							id="absoluteMax"
							step="any"
							bind:value={absoluteMax}
							placeholder="Optional"
							class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
						/>
					</div>
				</div>
				<button
					type="submit"
					class="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
				>
					Add Absolute Target
				</button>
			</form>
		</div>

		<!-- Add Relative Target -->
		<div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
			<h2 class="mb-3 text-lg font-semibold">Add Relative Target</h2>
			<form on:submit|preventDefault={addRelativeTarget}>
				<div class="mb-3">
					<label for="relativeTargetType" class="mb-1 block text-sm font-medium text-gray-700"
						>Target Type</label
					>
					<select
						id="relativeTargetType"
						bind:value={relativeTargetType}
						class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
					>
						{#each Object.entries(relativeTargetMappings) as [key, mapping] (key)}
							<option value={key}>{mapping.label}</option>
						{/each}
					</select>
				</div>
				<div class="mb-3 grid grid-cols-2 gap-4">
					<div>
						<label for="relativeMin" class="mb-1 block text-sm font-medium text-gray-700"
							>Min %</label
						>
						<input
							type="number"
							id="relativeMin"
							step="any"
							bind:value={relativeMin}
							placeholder="Optional"
							class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
						/>
					</div>
					<div>
						<label for="relativeMax" class="mb-1 block text-sm font-medium text-gray-700"
							>Max %</label
						>
						<input
							type="number"
							id="relativeMax"
							step="any"
							bind:value={relativeMax}
							placeholder="Optional"
							class="focus:ring-opacity-50 mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
						/>
					</div>
				</div>
				<button
					type="submit"
					class="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
				>
					Add Relative Target
				</button>
			</form>
		</div>
	</div>

	<!-- Existing Targets Section -->
	<div>
		<h2 class="mb-4 text-xl font-semibold tracking-tight text-gray-900">Current Targets</h2>
		{#if loading}
			<p class="text-gray-500">Loading targets…</p>
		{:else if targets.length === 0}
			<div class="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
				<p class="text-sm text-gray-500">
					No targets defined yet. Add one above to start tracking against your goals.
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th
								scope="col"
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
								>Target</th
							>
							<th
								scope="col"
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
								>Min Value</th
							>
							<th
								scope="col"
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
								>Max Value</th
							>
							<th
								scope="col"
								class="px-6 py-3 text-right text-xs font-medium tracking-wider text-gray-500 uppercase"
								>Actions</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200 bg-white">
						{#each targets as target (target.id)}
							<tr>
								<td class="px-6 py-4 text-sm font-medium whitespace-nowrap text-gray-900">
									{generateTargetLabel(target.nutrient_1, target.nutrient_2)}
								</td>
								<td class="px-6 py-4 text-sm whitespace-nowrap text-gray-500">
									<input
										type="number"
										step="any"
										value={target.min_value}
										on:blur={(e) =>
											saveTargetUpdate(target, 'min_value', e.currentTarget.valueAsNumber)}
										on:keydown={(e) => {
											if (e.key === 'Enter') e.currentTarget.blur();
										}}
										placeholder="None"
										class="focus:ring-opacity-50 w-24 rounded-md border-gray-300 p-1 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
									/>
								</td>
								<td class="px-6 py-4 text-sm whitespace-nowrap text-gray-500">
									<input
										type="number"
										step="any"
										value={target.max_value}
										on:blur={(e) =>
											saveTargetUpdate(target, 'max_value', e.currentTarget.valueAsNumber)}
										on:keydown={(e) => {
											if (e.key === 'Enter') e.currentTarget.blur();
										}}
										placeholder="None"
										class="focus:ring-opacity-50 w-24 rounded-md border-gray-300 p-1 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200"
									/>
								</td>
								<td class="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
									<button
										on:click={() => deleteTarget(target.id)}
										class="text-red-600 hover:text-red-900"
									>
										Delete
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
