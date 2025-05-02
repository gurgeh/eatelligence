<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { NutritionTarget } from '$lib/types';

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
		'calories', 'protein', 'fat', 'carbs', 'fibers', 'sugar',
		'mufa', 'pufa', 'sfa', 'omega3', 'omega6', 'gl'
	];

	// Map descriptive names to nutrient_1 and nutrient_2 for relative targets
	const relativeTargetMappings: { [key: string]: { label: string; n1: string; n2: string } } = {
		protein_percent_calories: { label: 'Protein (% of Calories)', n1: 'protein', n2: 'calories' },
		fat_percent_calories: { label: 'Fat (% of Calories)', n1: 'fat', n2: 'calories' },
		carbs_percent_calories: { label: 'Carbs (% of Calories)', n1: 'carbs', n2: 'calories' },
		omega6_omega3_ratio: { label: 'Omega-6 / Omega-3 Ratio (%)', n1: 'omega6', n2: 'omega3' },
		pufa_sfa_ratio: { label: 'PUFA / SFA Ratio (%)', n1: 'pufa', n2: 'sfa' },
		mufa_percent_fat: { label: 'MUFA (% of Total Fat)', n1: 'mufa', n2: 'fat' },
		pufa_percent_fat: { label: 'PUFA (% of Total Fat)', n1: 'pufa', n2: 'fat' },
		sfa_percent_fat: { label: 'SFA (% of Total Fat)', n1: 'sfa', n2: 'fat' }
	};

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
		} catch (err: any) {
			error = `Failed to load targets: ${err.message}`;
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
			const { error: insertError } = await supabase
				.from('nutrition_targets')
				.insert({
					nutrient_1: absoluteNutrient,
					nutrient_2: null,
					min_value: absoluteMin,
					max_value: absoluteMax
				});
			if (insertError) {
                // Handle potential unique constraint violation gracefully
                if (insertError.code === '23505') { // unique_violation
                    throw new Error(`A target for "${generateTargetLabel(absoluteNutrient, null)}" already exists.`);
                }
                throw insertError;
            }
			// Reset form and refetch
			absoluteNutrient = 'calories';
			absoluteMin = null;
			absoluteMax = null;
			await fetchTargets();
		} catch (err: any) {
			error = `Failed to add absolute target: ${err.message}`;
			console.error(err);
		}
	}

	async function addRelativeTarget() {
		if (!relativeTargetType) return;
		error = null;
		const mapping = relativeTargetMappings[relativeTargetType];
		if (!mapping) {
			error = "Invalid relative target type selected.";
			return;
		}

		try {
			const { error: insertError } = await supabase
				.from('nutrition_targets')
				.insert({
					nutrient_1: mapping.n1,
					nutrient_2: mapping.n2,
					min_value: relativeMin,
					max_value: relativeMax
				});

			if (insertError) {
                 if (insertError.code === '23505') { // unique_violation
                    throw new Error(`A target for "${mapping.label}" already exists.`);
                }
				throw insertError;
            }
			// Reset form and refetch
			relativeTargetType = 'protein_percent_calories';
			relativeMin = null;
			relativeMax = null;
			await fetchTargets();
		} catch (err: any) {
			error = `Failed to add relative target: ${err.message}`;
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
		} catch (err: any) {
			error = `Failed to delete target: ${err.message}`;
			console.error(err);
		}
	}

    // --- Update Target Logic (Inline Editing) ---
    async function saveTargetUpdate(target: NutritionTarget, field: 'min_value' | 'max_value', value: number | null) {
        // Basic validation: ensure value is a number or null
        const updateValue = (value === null || isNaN(Number(value))) ? null : Number(value);

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
            const targetIndex = targets.findIndex(t => t.id === target.id);
            if (targetIndex !== -1) {
                targets[targetIndex] = { ...targets[targetIndex], [field]: updateValue };
                targets = [...targets]; // Trigger reactivity
            } else {
                // Fallback if local state is somehow out of sync
                await fetchTargets();
            }

        } catch (err: any) {
            error = `Failed to update target: ${err.message}`;
            console.error(err);
            // Optionally revert local state or refetch on error
            await fetchTargets();
        }
    }


	// --- Helper to Generate Labels ---
	function generateTargetLabel(n1: string, n2: string | null): string {
		if (n2 === null) {
			// Absolute
			const unit = n1 === 'calories' ? 'kcal' : 'g';
			return `${n1.charAt(0).toUpperCase() + n1.slice(1)} (${unit})`;
		} else {
			// Relative - find the matching label from mappings
			const mappingKey = Object.keys(relativeTargetMappings).find(
				key => relativeTargetMappings[key].n1 === n1 && relativeTargetMappings[key].n2 === n2
			);
			return mappingKey ? relativeTargetMappings[mappingKey].label : `${n1} / ${n2} (%)`; // Fallback label
		}
	}

</script>

<svelte:head>
	<title>Nutrition Targets - Eatelligence</title>
</svelte:head>

<div class="container mx-auto p-4 max-w-4xl">
	<h1 class="text-2xl font-bold mb-6">Manage Nutrition Targets</h1>

	{#if error}
		<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
			<strong class="font-bold">Error: </strong>
			<span class="block sm:inline">{error}</span>
		</div>
	{/if}

	<!-- Add New Targets Section -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
		<!-- Add Absolute Target -->
		<div class="border p-4 rounded shadow">
			<h2 class="text-lg font-semibold mb-3">Add Absolute Target</h2>
			<form on:submit|preventDefault={addAbsoluteTarget}>
				<div class="mb-3">
					<label for="absoluteNutrient" class="block text-sm font-medium text-gray-700 mb-1">Nutrient</label>
					<select id="absoluteNutrient" bind:value={absoluteNutrient} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
						{#each absoluteNutrientOptions as nutrient}
							<option value={nutrient}>{nutrient.charAt(0).toUpperCase() + nutrient.slice(1)}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-4 mb-3">
					<div>
						<label for="absoluteMin" class="block text-sm font-medium text-gray-700 mb-1">Min Value</label>
						<input type="number" id="absoluteMin" step="any" bind:value={absoluteMin} placeholder="Optional" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
					</div>
					<div>
						<label for="absoluteMax" class="block text-sm font-medium text-gray-700 mb-1">Max Value</label>
						<input type="number" id="absoluteMax" step="any" bind:value={absoluteMax} placeholder="Optional" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
					</div>
				</div>
				<button type="submit" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
					Add Absolute Target
				</button>
			</form>
		</div>

		<!-- Add Relative Target -->
		<div class="border p-4 rounded shadow">
			<h2 class="text-lg font-semibold mb-3">Add Relative Target</h2>
			<form on:submit|preventDefault={addRelativeTarget}>
				<div class="mb-3">
					<label for="relativeTargetType" class="block text-sm font-medium text-gray-700 mb-1">Target Type</label>
					<select id="relativeTargetType" bind:value={relativeTargetType} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
						{#each Object.entries(relativeTargetMappings) as [key, mapping]}
							<option value={key}>{mapping.label}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-4 mb-3">
					<div>
						<label for="relativeMin" class="block text-sm font-medium text-gray-700 mb-1">Min %</label>
						<input type="number" id="relativeMin" step="any" bind:value={relativeMin} placeholder="Optional" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
					</div>
					<div>
						<label for="relativeMax" class="block text-sm font-medium text-gray-700 mb-1">Max %</label>
						<input type="number" id="relativeMax" step="any" bind:value={relativeMax} placeholder="Optional" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50">
					</div>
				</div>
				<button type="submit" class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">
					Add Relative Target
				</button>
			</form>
		</div>
	</div>

	<!-- Existing Targets Section -->
	<div>
		<h2 class="text-xl font-semibold mb-4">Current Targets</h2>
		{#if loading}
			<p>Loading targets...</p>
		{:else if targets.length === 0}
			<p>No targets defined yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
							<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Min Value</th>
							<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Value</th>
							<th scope="col" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
						</tr>
					</thead>
					<tbody class="bg-white divide-y divide-gray-200">
						{#each targets as target (target.id)}
							<tr>
								<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
									{generateTargetLabel(target.nutrient_1, target.nutrient_2)}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <input
                                        type="number"
                                        step="any"
                                        value={target.min_value}
                                        on:blur={(e) => saveTargetUpdate(target, 'min_value', e.currentTarget.valueAsNumber)}
                                        on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        placeholder="None"
                                        class="p-1 w-24 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                                    >
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <input
                                        type="number"
                                        step="any"
                                        value={target.max_value}
                                        on:blur={(e) => saveTargetUpdate(target, 'max_value', e.currentTarget.valueAsNumber)}
                                        on:keydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                        placeholder="None"
                                        class="p-1 w-24 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                                    >
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
									<button on:click={() => deleteTarget(target.id)} class="text-red-600 hover:text-red-900">
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
