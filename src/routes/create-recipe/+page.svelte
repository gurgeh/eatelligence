<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { FoodItem } from '$lib/types';
	import { getErrorMessage, ratio } from '$lib/utils';
	import NutrientBadges from '$lib/components/NutrientBadges.svelte';

	// Define a local type for the data structure used in this component
	interface RecipeLogEntry {
		id: number;
		logged_at: string;
		multiplier: number;
		food_item_id: number;
		food_items: FoodItem | null; // The nested food item (can be null if deleted)
	}

	let logEntries: RecipeLogEntry[] = [];
	let selectedLogIds = new Set<number>(); // Use number for IDs
	let recipeName = '';
	let isLoading = true;
	let isCreating = false; // Add state for creation process
	let errorMessage = '';
	let successMessage = '';
	type RecipeTotals = { [K in (typeof nutrientKeys)[number]]?: number } & {
		count: number;
		ratio?: string;
	};

	// --- Data Fetching ---
	async function fetchLogs() {
		isLoading = true;
		errorMessage = '';
		try {
			// Fetch latest 100 logs, similar to main page but without pagination for now
			const { data, error } = await supabase
				.from('food_log')
				.select(
					`
          id,
          logged_at,
          multiplier,
          food_item_id,
          food_items ( id, name, serving_qty, serving_unit, protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6 )
        ` // Removed calories from select
				)
				.order('logged_at', { ascending: false })
				.limit(100); // Limit to recent logs

			if (error) throw error;

			// Map the fetched data to our local RecipeLogEntry type
			logEntries =
				data?.map((log) => ({
					id: log.id,
					logged_at: log.logged_at,
					multiplier: log.multiplier,
					food_item_id: log.food_item_id,
					// Safely handle potential array/object discrepancy from Supabase join
					food_items: (() => {
						let relatedItem: FoodItem | null = null;
						if (log.food_items) {
							if (Array.isArray(log.food_items) && log.food_items.length > 0) {
								// If it's an array (unexpected), take the first element
								relatedItem = log.food_items[0] as FoodItem;
							} else if (!Array.isArray(log.food_items)) {
								// If it's not an array, assume it's the object
								relatedItem = log.food_items as FoodItem;
							}
						}
						return relatedItem;
					})()
				})) || [];
		} catch (err: unknown) {
			console.error('Error fetching logs:', err);
			errorMessage = getErrorMessage(err) || 'Failed to fetch logs.';
			logEntries = [];
		} finally {
			isLoading = false;
		}
	}

	onMount(fetchLogs); // Fetch logs when component mounts

	// --- Selection Logic ---
	function toggleSelection(id: number) {
		if (selectedLogIds.has(id)) {
			selectedLogIds.delete(id);
		} else {
			selectedLogIds.add(id);
		}
		selectedLogIds = selectedLogIds; // Trigger reactivity
		// Recalculate totals whenever selection changes
		calculateTotals();
	}

	// --- Totals Calculation ---
	// Define the keys we expect to sum and round (calories removed)
	const nutrientKeys: (keyof Omit<
		FoodItem,
		'id' | 'name' | 'serving_unit' | 'serving_qty' | 'comment' | 'created_at'
	>)[] = [
		'protein',
		'fat',
		'carbs',
		'fibers',
		'sugar',
		'mufa',
		'pufa',
		'sfa',
		'gl',
		'omega3',
		'omega6' // Added omega3, omega6
	];
	// Initialize totals with all expected keys set to 0, plus ratio
	let totals: RecipeTotals = { count: 0 }; // Add ratio
	nutrientKeys.forEach((key) => (totals[key] = 0));

	function calculateTotals() {
		// Initialize newTotals with all expected keys set to 0 for calculation
		const newTotals: RecipeTotals = { count: 0 };
		nutrientKeys.forEach((key) => (newTotals[key] = 0));
		let calculatedCount = 0;

		for (const entry of logEntries) {
			if (selectedLogIds.has(entry.id) && entry.food_items) {
				calculatedCount++;
				const item = entry.food_items;
				const multiplier = entry.multiplier;

				// Helper to safely add numbers (treat null as 0)
				const add = (a: number | null | undefined, b: number | null | undefined) =>
					(a || 0) + (b || 0);

				// Assign results to newTotals, not totals (calories removed)
				newTotals.protein = add(newTotals.protein, (item.protein || 0) * multiplier);
				newTotals.fat = add(newTotals.fat, (item.fat || 0) * multiplier);
				newTotals.carbs = add(newTotals.carbs, (item.carbs || 0) * multiplier);
				newTotals.fibers = add(newTotals.fibers, (item.fibers || 0) * multiplier);
				newTotals.sugar = add(newTotals.sugar, (item.sugar || 0) * multiplier);
				newTotals.mufa = add(newTotals.mufa, (item.mufa || 0) * multiplier);
				newTotals.pufa = add(newTotals.pufa, (item.pufa || 0) * multiplier);
				newTotals.sfa = add(newTotals.sfa, (item.sfa || 0) * multiplier);
				newTotals.gl = add(newTotals.gl, (item.gl || 0) * multiplier);
				newTotals.omega3 = add(newTotals.omega3, (item.omega3 || 0) * multiplier); // Added omega3
				newTotals.omega6 = add(newTotals.omega6, (item.omega6 || 0) * multiplier); // Added omega6
			}
		}
		newTotals.count = calculatedCount;
		newTotals.ratio = ratio(newTotals.omega6, newTotals.omega3) ?? (newTotals.omega6 ? '∞:1' : '-');
		totals = newTotals;
	}

	// --- Recipe Creation Function ---
	async function createRecipe() {
		if (!recipeName || selectedLogIds.size === 0) return;

		isCreating = true;
		errorMessage = '';
		successMessage = '';

		const selectedEntries = logEntries.filter((entry) => selectedLogIds.has(entry.id));

		if (selectedEntries.length === 0) {
			errorMessage = 'No valid log entries selected.';
			isCreating = false;
			return;
		}

		// Generate comment string with new format: (qty unit) x multiplier name
		const commentLines = selectedEntries.map(
			(entry) =>
				`(${entry.food_items?.serving_qty || 1} ${entry.food_items?.serving_unit || 'serving'}) x ${entry.multiplier} ${entry.food_items?.name || '(Unknown Item)'}`
		);
		const comment = `Made from:\n- ${commentLines.join('\n- ')}`;

		// Prepare the new food item data using the already calculated totals (calories removed)
		const newFoodItemData: Omit<FoodItem, 'id' | 'created_at'> = {
			name: recipeName.trim(),
			serving_qty: 1, // Recipe is one serving by definition here
			serving_unit: 'portion',
			// calories: totals.calories ?? 0, // Removed calories
			protein: totals.protein ?? 0,
			fat: totals.fat ?? 0,
			carbs: totals.carbs ?? 0,
			fibers: totals.fibers ?? 0,
			sugar: totals.sugar ?? 0,
			mufa: totals.mufa ?? 0,
			pufa: totals.pufa ?? 0,
			sfa: totals.sfa ?? 0,
			gl: totals.gl ?? 0,
			omega3: totals.omega3 ?? 0, // Added omega3
			omega6: totals.omega6 ?? 0, // Added omega6
			comment: comment
		};

		try {
			const { error } = await supabase.from('food_items').insert([newFoodItemData]);

			if (error) throw error;

			successMessage = `Recipe "${recipeName.trim()}" created successfully!`;
			// Reset state
			recipeName = '';
			selectedLogIds.clear();
			selectedLogIds = selectedLogIds; // Trigger reactivity
			calculateTotals(); // Reset totals display
		} catch (err: unknown) {
			console.error('Error creating recipe:', err);
			errorMessage = `Failed to create recipe: ${getErrorMessage(err)}`;
		} finally {
			isCreating = false;
		}
	}

	$: isCreateDisabled = !recipeName || selectedLogIds.size === 0 || isCreating;
</script>

<svelte:head>
	<title>Create Recipe - Eatelligence</title>
</svelte:head>

<div class="container mx-auto max-w-5xl p-4">
	<!-- Removed test button -->
	<div class="mb-4 flex items-center justify-between gap-3">
		<h1 class="text-2xl font-bold tracking-tight text-gray-900">Create Recipe from Log</h1>
		<a
			href="/recipes/generate"
			class="rounded-lg border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
		>
			Generate Recipe with AI
		</a>
	</div>

	{#if isLoading}
		<p>Loading log entries...</p>
	{:else if errorMessage && !isLoading}
		<!-- Show error only if not loading -->
		<p class="text-red-500">{errorMessage}</p>
	{:else}
		<div class="sticky top-14 z-10 mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
			<h2 class="mb-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
				Selected Items Summary ({totals.count} items)
			</h2>
			{#if totals.count > 0}
				<NutrientBadges {totals} ratio={totals.ratio} />
			{:else}
				<p class="text-sm text-gray-500">Select log entries below to see totals.</p>
			{/if}
		</div>

		<!-- Recipe Name Input -->
		<div class="mb-4">
			<label for="recipeName" class="mb-1 block text-sm font-medium">Recipe Name:</label>
			<input
				type="text"
				id="recipeName"
				bind:value={recipeName}
				class="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
				placeholder="Enter name for new recipe"
			/>
		</div>

		<div class="mb-4">
			<h2 class="mb-2 text-lg font-semibold">Select Log Entries to Include:</h2>
			<ul class="space-y-2">
				{#each logEntries as entry (entry.id)}
					<li>
						<!-- Remove styling/click from li -->
						<button
							type="button"
							class="block w-full cursor-pointer rounded-lg border border-gray-200 p-3 text-left transition-colors"
							class:bg-indigo-100={selectedLogIds.has(entry.id)}
							class:text-indigo-900={selectedLogIds.has(entry.id)}
							class:hover:bg-gray-100={!selectedLogIds.has(entry.id)}
							class:bg-white={!selectedLogIds.has(entry.id)}
							on:click={() => toggleSelection(entry.id)}
						>
							<!-- Display log entry details nicely - New format: (qty unit) x multiplier name -->
							{entry.food_items?.name || '(Deleted Item)'} - ({entry.food_items?.serving_qty || 1}
							{entry.food_items?.serving_unit || 'serving'}) x {entry.multiplier}
							<span class="mt-1 block text-xs text-gray-500"
								>Logged: {new Date(entry.logged_at).toLocaleString('sv-SE')}</span
							>
						</button>
					</li>
				{:else}
					<p>No log entries found.</p>
				{/each}
			</ul>
			<!-- TODO: Add Load More functionality if needed -->
		</div>

		{#if successMessage}
			<p class="mb-4 text-green-500">{successMessage}</p>
		{/if}

		<button
			type="button"
			class="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
			on:click={createRecipe}
			disabled={isCreateDisabled}
		>
			{#if isCreating}Creating...{:else}Create Recipe{/if}
		</button>
	{/if}
</div>
