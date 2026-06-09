<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import Fuse from 'fuse.js';
	import { tick } from 'svelte';
	import type { FoodItem, ServingUnit } from '$lib/types';
	import { GoogleGenAI, Type } from '@google/genai';
	import { calculateKcal, getErrorMessage } from '$lib/utils';
	import { loadGeminiKey, saveGeminiKey } from '$lib/geminiKey';

	let foodItems: FoodItem[] = [];
	let filteredItems: FoodItem[] = [];
	let searchQuery = '';
	let loading = true;
	let error: string | null = null;
	let fuse: Fuse<FoodItem>;

	// --- Inline Editing State ---
	let editingItemId: number | null = null;
	let editingProperty: keyof FoodItem | null = null;
	let editingValue: string | number | null = null;
	let inputElement: HTMLInputElement | HTMLTextAreaElement | null = null;

	// --- Fetch Food Items ---
	async function fetchFoodItems() {
		loading = true;
		error = null;
		try {
			const { data, error: dbError } = await supabase
				.from('food_items')
				.select('*')
				.order('name', { ascending: true });

			if (dbError) throw dbError;
			if (data) {
				foodItems = data;
			}
		} catch (err: unknown) {
			console.error('Error fetching food items:', err);
			error = `Failed to load food items: ${getErrorMessage(err)}`;
			foodItems = [];
			filteredItems = [];
		} finally {
			loading = false;
		}
	}

	// --- Search/Filter ---
	// The filterItems function is removed; logic is now in the reactive statement below.

	// Reactive statements:
	// 1. Re-initialize Fuse whenever foodItems changes
	$: if (foodItems) {
		fuse = new Fuse(foodItems, {
			keys: ['name', 'comment'],
			threshold: 0.3,
			includeScore: false
		});
	}
	// 2. Calculate filteredItems whenever fuse, searchQuery, or foodItems changes
	$: filteredItems =
		!fuse || !searchQuery.trim()
			? foodItems || []
			: fuse.search(searchQuery.trim()).map((result) => result.item);

	// --- New Item Form State ---
	let isCreating = false;
	let newItem: Partial<FoodItem> = {}; // Use Partial for the new item form
	const servingUnits = ['g', 'dl', 'pcs', 'portion'] as const satisfies readonly ServingUnit[]; // Define the allowed units
	const nutrientInputFields = [
		'protein',
		'fat',
		'carbs',
		'fibers',
		'sugar',
		'mufa',
		'pufa',
		'sfa',
		'omega6',
		'omega3',
		'gl'
	] as const satisfies readonly (keyof FoodItem)[];
	const pfcFields = ['protein', 'fat', 'carbs'] as const satisfies readonly (keyof FoodItem)[];
	const fiberSugarFields = ['fibers', 'sugar'] as const satisfies readonly (keyof FoodItem)[];
	const fatDetailFields = ['mufa', 'pufa', 'sfa'] as const satisfies readonly (keyof FoodItem)[];
	const omegaFields = ['omega6', 'omega3'] as const satisfies readonly (keyof FoodItem)[];

	// --- Gemini API State ---
	let geminiApiKey = '';
	let isAutoFilling = false;
	let autoFillError: string | null = null;
	let showApiKeyInput = false; // Control visibility of API key input
	let apiKeyInput = ''; // Temporary input for the API key field

	// --- Inline Editing Functions (Adapted from log view) ---
	function startEditing(item: FoodItem, property: keyof FoodItem) {
		isCreating = false; // Ensure we are not in create mode
		editingItemId = item.id;
		editingProperty = property;
		editingValue = item[property] as string | number; // Type assertion might be needed
		tick().then(() => {
			inputElement?.focus();
			inputElement?.select(); // Select text for easy replacement
		});
	}

	function cancelEdit() {
		editingItemId = null;
		editingProperty = null;
		editingValue = null;
	}

	async function saveItemUpdate() {
		if (editingItemId === null || editingProperty === null || editingValue === null) return;

		const originalItem = foodItems.find((item) => item.id === editingItemId);
		if (!originalItem) return;

		// Basic validation/conversion (expand as needed)
		let updateValue: FoodItem[keyof FoodItem] = editingValue;
		// Removed 'calories' from this list as it's now calculated
		const numericFields: (keyof FoodItem)[] = [
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
			'omega6'
		]; // Added omega3, omega6
		if (numericFields.includes(editingProperty)) {
			updateValue = parseFloat(editingValue as string);
			if (isNaN(updateValue)) {
				console.error('Invalid number format for', editingProperty);
				// Optionally show user error
				cancelEdit();
				return;
			}
		}

		// Avoid saving if value hasn't changed
		if (originalItem[editingProperty] === updateValue) {
			cancelEdit();
			return;
		}

		try {
			const { error: updateError } = await supabase
				.from('food_items')
				.update({ [editingProperty]: updateValue })
				.eq('id', editingItemId);

			if (updateError) throw updateError;

			// Update local state optimistically (or re-fetch)
			const itemIndex = foodItems.findIndex((item) => item.id === editingItemId);
			if (itemIndex > -1) {
				foodItems[itemIndex] = { ...foodItems[itemIndex], [editingProperty]: updateValue };
				foodItems = [...foodItems]; // Trigger reactivity for fuse re-initialization and filtering
			}
			cancelEdit();
		} catch (err: unknown) {
			console.error(`Error updating ${editingProperty}:`, err);
			// Optionally show user error
			cancelEdit(); // Cancel edit on error
		}
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			saveItemUpdate();
		} else if (event.key === 'Escape') {
			cancelEdit();
		}
	}

	// --- Delete Function ---
	async function deleteItem(itemId: number) {
		if (!window.confirm('Are you sure you want to delete this food item? This cannot be undone.')) {
			return;
		}

		try {
			const { error: deleteError } = await supabase.from('food_items').delete().eq('id', itemId);

			if (deleteError) throw deleteError;

			// Remove from local state
			foodItems = foodItems.filter((item) => item.id !== itemId); // Trigger reactivity for fuse re-initialization and filtering
		} catch (err: unknown) {
			console.error('Error deleting item:', err);
			error = `Failed to delete item: ${getErrorMessage(err)}`;
			// Optionally show user error
		}
	}

	// --- Create Item Functions ---
	function showCreateForm() {
		cancelEdit(); // Cancel any ongoing edit
		isCreating = true;
		newItem = {
			// Reset form fields
			name: '',
			serving_unit: 'g', // Default serving unit for 100 qty
			serving_qty: 100,
			// calories removed - will be calculated
			protein: null,
			fat: null,
			carbs: null,
			fibers: null,
			sugar: null,
			mufa: null,
			pufa: null,
			sfa: null,
			gl: null,
			omega3: null,
			omega6: null,
			comment: null // Added omega3, omega6
		};
		// Optionally focus the first input field after tick
		tick().then(() => {
			const nameInput = document.getElementById('new-item-name');
			nameInput?.focus();
		});
	}

	function cancelCreate() {
		isCreating = false;
		newItem = {};
	}

	// --- Handle Unit Change for Default Quantity ---
	function handleUnitChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		const selectedUnit = target.value;

		switch (selectedUnit) {
			case 'g':
				newItem.serving_qty = 100;
				break;
			case 'dl':
			case 'pcs':
			case 'portion':
				newItem.serving_qty = 1;
				break;
			default:
				// Keep existing value or set a default if needed
				newItem.serving_qty = newItem.serving_qty ?? 1; // Keep existing or default to 1
		}
		// Trigger reactivity by reassigning (though direct mutation often works in Svelte 3/4)
		newItem = { ...newItem };
	}

	async function saveNewItem() {
		// Basic validation (add more as needed)
		if (!newItem.name?.trim()) {
			alert('Item name is required.');
			return;
		}
		if (newItem.serving_qty == null || newItem.serving_qty <= 0) {
			alert('Serving quantity must be a positive number.');
			return;
		}
		if (!newItem.serving_unit?.trim()) {
			alert('Serving unit is required.');
			return;
		}

		// Prepare data for Supabase (convert nulls if needed, ensure correct types)
		const itemToInsert = {
			name: newItem.name.trim(),
			serving_unit: newItem.serving_unit.trim(),
			serving_qty: newItem.serving_qty,
			// calories removed - will be calculated
			protein: newItem.protein ?? null,
			fat: newItem.fat ?? null,
			carbs: newItem.carbs ?? null,
			fibers: newItem.fibers ?? null,
			sugar: newItem.sugar ?? null,
			mufa: newItem.mufa ?? null,
			pufa: newItem.pufa ?? null,
			sfa: newItem.sfa ?? null,
			gl: newItem.gl ?? null,
			omega3: newItem.omega3 ?? null, // Added omega3
			omega6: newItem.omega6 ?? null, // Added omega6
			comment: newItem.comment?.trim() || null
		};

		try {
			const { data, error: insertError } = await supabase
				.from('food_items')
				.insert([itemToInsert])
				.select(); // Select to get the newly created item back

			if (insertError) throw insertError;

			// Add the new item to the local list and reset form
			if (data && data.length > 0) {
				foodItems = [data[0] as FoodItem, ...foodItems]; // Add to beginning
			}
			cancelCreate(); // Hide form and reset newItem
			// Reactivity will update filteredItems
		} catch (err: unknown) {
			console.error('Error saving new item:', err);
			error = `Failed to save new item: ${getErrorMessage(err)}`; // Show error
		}
	}

	function loadApiKey() {
		geminiApiKey = loadGeminiKey();
		apiKeyInput = geminiApiKey;
	}

	function saveApiKey() {
		saveGeminiKey(apiKeyInput);
		geminiApiKey = apiKeyInput;
		showApiKeyInput = false;
		autoFillError = null;
		alert('API Key saved successfully!');
	}

	// --- Gemini Auto-fill Function ---
	async function autoFillNutrition() {
		if (!newItem.name?.trim()) {
			autoFillError = 'Please enter a food item name first.';
			return;
		}
		if (!geminiApiKey) {
			autoFillError = 'Gemini API Key is missing. Please enter and save it below.';
			showApiKeyInput = true;
			return;
		}

		isAutoFilling = true;
		autoFillError = null;

		try {
			// Correct initialization: pass options object
			const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
			// Remove incorrect getGenerativeModel call

			// Gather existing data from the form (calories removed from fields)
			const existingData: { [key: string]: number } = {};
			const fields: (keyof FoodItem)[] = [
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
				'omega6'
			];
			fields.forEach((field) => {
				const value = newItem[field];
				if (typeof value === 'number' && !isNaN(value)) {
					existingData[field] = value;
				}
			});

			let existingDataPrompt = '';
			if (Object.keys(existingData).length > 0) {
				// Add the existing data back into the prompt for context
				existingDataPrompt = `\n\nUse the following already known values (for the requested ${newItem.serving_qty} ${newItem.serving_unit} serving) to help inform your search and estimations:\n${JSON.stringify(existingData)}`;
			}

			// Ensure serving_qty and serving_unit are valid before using them in the prompt
			const servingQty = newItem.serving_qty ?? 1; // Default to 1 if undefined
			const servingUnit = newItem.serving_unit?.trim() || 'unit'; // Default to 'unit' if empty/undefined
			const userComment = newItem.comment?.trim() || ''; // Get user comment
			const commentPrompt = userComment
				? `\n\nConsider the following user-provided comment for additional context: "${userComment}"`
				: ''; // Add comment to prompt if present

			const prompt = `Provide nutritional information per ${servingQty} ${servingUnit} for the food item "${newItem.name.trim()}".${commentPrompt}
Use web search (grounding) to find the most accurate data.${existingDataPrompt}
IMPORTANT: For the 'carbs' field, provide the value for carbohydrates excluding fiber. In the EU and UK, this is the standard definition, but in US sources, it may include fiber.
If specific data for fields like MUFA, PUFA, SFA, or GL is not found for the exact name, search for a more general category (e.g., search for "cheese" if "Brand X Swiss Cheese" data is missing).
You MUST estimate any remaining nutritional values you cannot find through search, using any provided known values as context. You are good at this. Ensure ALL nutritional fields are populated with a numerical value.
If you make any significant assumptions during estimation (e.g., assuming 'baked' for cooking method if unspecified, assuming a standard weight for '1 medium banana'), include them in the 'comment' field prefixed with "LLM Assumptions: ". If no significant assumptions were made, set 'comment' to null.
Do not reference sources or provide citations in the comment field. Be brief.`;

			const result = await genAI.models.generateContent({
				model: 'gemini-3.5-flash',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: {
					tools: [{ googleSearch: {} }],
					thinkingConfig: { includeThoughts: false },
					responseMimeType: 'application/json',
					responseSchema: {
						type: Type.OBJECT,
						properties: {
							protein: { type: Type.NUMBER, nullable: true },
							fat: { type: Type.NUMBER, nullable: true },
							carbs: { type: Type.NUMBER, nullable: true },
							fibers: { type: Type.NUMBER, nullable: true },
							sugar: { type: Type.NUMBER, nullable: true },
							mufa: { type: Type.NUMBER, nullable: true },
							pufa: { type: Type.NUMBER, nullable: true },
							sfa: { type: Type.NUMBER, nullable: true },
							gl: { type: Type.NUMBER, nullable: true },
							omega3: { type: Type.NUMBER, nullable: true },
							omega6: { type: Type.NUMBER, nullable: true },
							comment: { type: Type.STRING, nullable: true }
						},
						required: [
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
							'omega6'
						]
					}
				}
			});

			const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
			if (!responseText) {
				throw new Error('AI response did not contain text.');
			}

			let nutritionData: Partial<FoodItem>;
			try {
				nutritionData = JSON.parse(responseText);
			} catch (parseError) {
				console.error(
					'Failed to parse Gemini JSON response:',
					parseError,
					'\nResponse:',
					responseText
				);
				throw new Error('AI returned invalid JSON.');
			}

			// Update newItem state, converting nulls from JSON if necessary (calories removed)
			newItem.protein = nutritionData.protein ?? null;
			newItem.fat = nutritionData.fat ?? null;
			newItem.carbs = nutritionData.carbs ?? null;
			newItem.fibers = nutritionData.fibers ?? null;
			newItem.sugar = nutritionData.sugar ?? null;
			newItem.mufa = nutritionData.mufa ?? null;
			newItem.pufa = nutritionData.pufa ?? null;
			newItem.sfa = nutritionData.sfa ?? null;
			newItem.gl = nutritionData.gl ?? null;
			const originalUserComment = newItem.comment?.trim() || ''; // Store original comment before potential overwrite

			newItem.omega3 = nutritionData.omega3 ?? null; // Added omega3
			newItem.omega6 = nutritionData.omega6 ?? null; // Added omega6

			// Check if LLM returned assumptions in its comment field
			const llmComment = nutritionData.comment?.trim() || '';
			let finalComment = originalUserComment; // Default to original comment

			if (llmComment.startsWith('LLM Assumptions:')) {
				// LLM provided assumptions, append them
				const assumptionsText = llmComment; // Use the full comment from LLM
				finalComment = originalUserComment
					? `${originalUserComment}\n${assumptionsText}`
					: assumptionsText;
			}
			// If llmComment is empty or doesn't start with the prefix, finalComment remains the originalUserComment

			newItem.comment = finalComment; // Set the final comment value

			// Trigger reactivity by reassigning newItem
			newItem = { ...newItem };
		} catch (err: unknown) {
			console.error('Error during Gemini auto-fill:', err);
			autoFillError = `Failed to auto-fill: ${getErrorMessage(err)}`;
		} finally {
			isAutoFilling = false;
		}
	}

	// --- Lifecycle ---
	onMount(() => {
		fetchFoodItems();
		loadApiKey(); // Load API key on component mount
	});

	// --- Helper for badge display (similar to log view) ---
	function formatValue(value: number | null | undefined): string {
		if (value === null || value === undefined) return '-';
		// Simple integer rounding for now
		return Math.round(value).toString();
	}
</script>

<div class="container mx-auto max-w-5xl p-4">
	<h1 class="mb-4 text-2xl font-bold">Manage Food Items</h1>

	<!-- Search Input -->
	<div class="mb-4">
		<input
			type="search"
			bind:value={searchQuery}
			placeholder="Search food items by name or comment..."
			class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
		/>
	</div>

	<!-- Add New Item Button -->
	<div class="mb-4 text-right">
		<button
			type="button"
			on:click={showCreateForm}
			class="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
			disabled={isCreating}
		>
			+ Add New Item
		</button>
	</div>

	<!-- New Item Form (conditionally rendered) -->
	{#if isCreating}
		<div class="mb-6 rounded-lg border border-indigo-300 bg-indigo-50 p-4 shadow-sm">
			<h2 class="mb-3 text-lg font-semibold text-indigo-800">Create New Food Item</h2>

			<!-- API Key Input (conditionally shown) -->
			{#if showApiKeyInput}
				<div class="mb-4 rounded border border-yellow-300 bg-yellow-50 p-3">
					<label for="gemini-api-key" class="block text-sm font-medium text-yellow-800"
						>Enter Gemini API Key:</label
					>
					<div class="mt-1 flex rounded-md shadow-sm">
						<input
							type="password"
							id="gemini-api-key"
							bind:value={apiKeyInput}
							class="block w-full flex-1 rounded-none rounded-l-md border-gray-300 px-2 py-1 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
							placeholder="Paste your API key here"
						/>
						<button
							type="button"
							on:click={saveApiKey}
							class="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500 hover:bg-gray-100"
						>
							Save Key
						</button>
					</div>
					{#if autoFillError && autoFillError.includes('API Key')}
						<p class="mt-1 text-xs text-red-600">{autoFillError}</p>
					{/if}
				</div>
			{/if}

			<!-- Name, Serving Qty, Serving Unit -->
			<div class="mb-3 grid grid-cols-1 gap-4 md:grid-cols-3">
				<div>
					<label for="new-item-name" class="block text-sm font-medium text-gray-700">Name</label>
					<input
						type="text"
						id="new-item-name"
						bind:value={newItem.name}
						class="mt-1 block w-full rounded border border-gray-300 p-1 shadow-sm"
						required
					/>
					<!-- Auto-fill Button -->
					<button
						type="button"
						on:click={autoFillNutrition}
						disabled={isAutoFilling || !newItem.name?.trim()}
						class="mt-1 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isAutoFilling}
							<span>Filling...</span>
						{:else}
							<span>Auto-fill Nutrition (AI)</span>
						{/if}
					</button>
					{#if autoFillError && !autoFillError.includes('API Key')}
						<p class="mt-1 text-xs text-red-600">{autoFillError}</p>
					{/if}
					<p class="mt-1 text-xs text-gray-500">Uses Gemini AI. Requires saved API Key.</p>
				</div>
				<div>
					<label for="new-item-qty" class="block text-sm font-medium text-gray-700"
						>Serving Qty</label
					>
					<input
						type="number"
						id="new-item-qty"
						bind:value={newItem.serving_qty}
						class="mt-1 block w-full rounded border border-gray-300 p-1 shadow-sm"
						required
						min="0"
					/>
				</div>
				<div>
					<label for="new-item-unit" class="block text-sm font-medium text-gray-700"
						>Serving Unit</label
					>
					<select
						id="new-item-unit"
						bind:value={newItem.serving_unit}
						on:change={handleUnitChange}
						class="mt-1 block w-full rounded border border-gray-300 p-1 shadow-sm"
						required
					>
						{#each servingUnits as unit (unit)}
							<option value={unit}>{unit}</option>
						{/each}
					</select>
				</div>
			</div>
			<!-- Nutritional Info Inputs -->
			<div class="mb-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-6">
				<!-- Adjusted grid cols -->
				<!-- Reordered to match display: PFC, FiS, MPS, 6:3, GL -->
				{#each nutrientInputFields as prop (prop)}
					{@const key = prop}
					<div>
						<label for="new-item-{prop}" class="block font-medium text-gray-700 capitalize"
							>{prop === 'omega3' ? 'Omega-3' : prop === 'omega6' ? 'Omega-6' : prop}</label
						>
						<!-- Special labels for omega -->
						<input
							type="number"
							step="any"
							id="new-item-{prop}"
							bind:value={newItem[key]}
							class="mt-1 block w-full rounded border border-gray-300 p-1 shadow-sm"
							placeholder="Optional"
						/>
					</div>
				{/each}
				<div class="col-span-2 text-xs text-gray-500 md:col-span-5">
					AI-generated data should be verified.
				</div>
			</div>
			<!-- Calculated Kcal Display -->
			<div class="mb-3 pt-2">
				<p class="text-sm font-medium text-gray-700">
					Calculated Kcal:
					<span class="font-bold text-indigo-600">
						{calculateKcal({
							protein: newItem.protein,
							carbs: newItem.carbs,
							fibers: newItem.fibers,
							fat: newItem.fat
						})}
					</span>
				</p>
			</div>
			<!-- Comment -->
			<div class="mb-3">
				<label for="new-item-comment" class="block text-sm font-medium text-gray-700"
					>Comment (Optional)</label
				>
				<textarea
					id="new-item-comment"
					bind:value={newItem.comment}
					class="mt-1 block w-full rounded border border-gray-300 p-1 shadow-sm"
					rows="2"
				></textarea>
			</div>
			<!-- Form Actions -->
			<div class="flex justify-end space-x-3">
				<button
					type="button"
					on:click={cancelCreate}
					class="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50"
					>Cancel</button
				>
				<button
					type="button"
					on:click={saveNewItem}
					class="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700">Save Item</button
				>
			</div>
		</div>
	{/if}

	<!-- Loading/Error State -->
	{#if loading}
		<p class="text-center text-gray-500">Loading food items...</p>
	{:else if error}
		<p class="text-center text-red-500">{error}</p>
	{:else if filteredItems.length === 0 && searchQuery}
		<p class="text-center text-gray-500">No food items match your search "{searchQuery}".</p>
	{:else if foodItems.length === 0}
		<p class="text-center text-gray-500">No food items found. Add some!</p>
	{/if}

	<!-- Food Items List -->
	<ul class="space-y-4">
		{#each filteredItems as item (item.id)}
			<li class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
				<div class="mb-2 flex items-start justify-between">
					<!-- Item Name & Serving -->
					<div class="mr-4 flex-grow">
						{#if editingItemId === item.id && editingProperty === 'name'}
							<input
								type="text"
								bind:this={inputElement}
								bind:value={editingValue}
								on:keydown={handleInputKeydown}
								on:blur={saveItemUpdate}
								class="w-full rounded border border-blue-300 p-1"
							/>
						{:else}
							<span
								class="cursor-pointer text-lg font-semibold hover:bg-yellow-100"
								on:click={() => startEditing(item, 'name')}
								on:keydown={(e) => {
									if (e.key === 'Enter') startEditing(item, 'name');
								}}
								role="button"
								tabindex="0"
							>
								{item.name}
							</span>
						{/if}
						<!-- Inline editing for serving_qty and serving_unit -->
						<span class="ml-2 text-sm text-gray-500">
							(
							{#if editingItemId === item.id && editingProperty === 'serving_qty'}
								<input
									type="number"
									bind:this={inputElement}
									bind:value={editingValue}
									on:keydown={handleInputKeydown}
									on:blur={saveItemUpdate}
									class="mx-1 w-16 rounded border border-blue-300 p-0 text-xs"
								/>
							{:else}
								<span
									class="cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, 'serving_qty')}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, 'serving_qty');
									}}
									role="button"
									tabindex="0"
								>
									{item.serving_qty}
								</span>
							{/if}
							{#if editingItemId === item.id && editingProperty === 'serving_unit'}
								<select
									bind:value={editingValue}
									on:change={saveItemUpdate}
									on:keydown={handleInputKeydown}
									class="mx-1 rounded border border-blue-300 p-0 text-xs"
								>
									{#each servingUnits as unit (unit)}
										<option value={unit}>{unit}</option>
									{/each}
								</select>
							{:else}
								<span
									class="cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, 'serving_unit')}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, 'serving_unit');
									}}
									role="button"
									tabindex="0"
								>
									{item.serving_unit}
								</span>
							{/if}
							)
						</span>
						{#if editingItemId === item.id && editingProperty === 'comment'}
							<textarea
								bind:this={inputElement}
								bind:value={editingValue}
								on:keydown={handleInputKeydown}
								on:blur={saveItemUpdate}
								class="mt-1 w-full rounded border border-blue-300 p-1 text-sm"
								rows="2"
							></textarea>
						{:else}
							<button
								type="button"
								class="mt-1 w-full cursor-pointer rounded p-1 text-left text-sm text-gray-600 hover:bg-yellow-100"
								on:click={() => startEditing(item, 'comment')}
								aria-label="Edit comment"
							>
								{item.comment || '(Click to add comment)'}
							</button>
						{/if}
					</div>

					<!-- Action Buttons -->
					<div class="flex-shrink-0">
						<button
							on:click={() => deleteItem(item.id)}
							class="p-1 text-red-500 hover:text-red-700"
							aria-label="Delete item"
						>
							🗑️
						</button>
						<!-- Add Edit button if not using inline editing for all fields -->
					</div>
				</div>

				<!-- Nutritional Info Badges (Inline Editable) - Reordered & Styled -->
				<div class="flex flex-wrap gap-2 text-xs">
					<!-- Calculated Kcal -->
					<div class="rounded-md bg-blue-100 px-1.5 py-0.5 text-blue-800">
						<span class="font-medium text-gray-500 uppercase">KCAL:</span>
						<span class="ml-1">{calculateKcal(item)}</span>
					</div>
					<!-- Protein, Fat, Carbs (PFC) -->
					<div class="rounded-md bg-green-100 px-1.5 py-0.5 text-green-800">
						<span class="font-medium text-gray-500 uppercase">PFC:</span>
						{#each pfcFields as prop (prop)}
							{#if editingItemId === item.id && editingProperty === prop}
								<input
									type="number"
									step="any"
									bind:this={inputElement}
									bind:value={editingValue}
									on:keydown={handleInputKeydown}
									on:blur={saveItemUpdate}
									class="ml-1 w-12 rounded border border-blue-300 p-0 text-xs"
								/>
							{:else}
								<span
									class="ml-1 cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, prop)}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, prop);
									}}
									role="button"
									tabindex="0">{formatValue(item[prop] as number | null)}</span
								>
							{/if}
							{#if prop !== 'carbs'},{/if}
							<!-- Add comma separator -->
						{/each}
					</div>
					<!-- Fibers, Sugar (FiS) -->
					<div class="rounded-md bg-yellow-100 px-1.5 py-0.5 text-yellow-800">
						<span class="font-medium text-gray-500 uppercase">FiS:</span>
						{#each fiberSugarFields as prop (prop)}
							{#if editingItemId === item.id && editingProperty === prop}
								<input
									type="number"
									step="any"
									bind:this={inputElement}
									bind:value={editingValue}
									on:keydown={handleInputKeydown}
									on:blur={saveItemUpdate}
									class="ml-1 w-12 rounded border border-blue-300 p-0 text-xs"
								/>
							{:else}
								<span
									class="ml-1 cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, prop)}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, prop);
									}}
									role="button"
									tabindex="0">{formatValue(item[prop] as number | null)}</span
								>
							{/if}
							{#if prop !== 'sugar'},{/if}
							<!-- Add comma separator -->
						{/each}
					</div>
					<!-- MUFA, PUFA, SFA (MPS) -->
					<div class="rounded-md bg-orange-100 px-1.5 py-0.5 text-orange-800">
						<span class="font-medium text-gray-500 uppercase">MPS:</span>
						{#each fatDetailFields as prop (prop)}
							{#if editingItemId === item.id && editingProperty === prop}
								<input
									type="number"
									step="any"
									bind:this={inputElement}
									bind:value={editingValue}
									on:keydown={handleInputKeydown}
									on:blur={saveItemUpdate}
									class="ml-1 w-12 rounded border border-blue-300 p-0 text-xs"
								/>
							{:else}
								<span
									class="ml-1 cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, prop)}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, prop);
									}}
									role="button"
									tabindex="0">{formatValue(item[prop] as number | null)}</span
								>
							{/if}
							{#if prop !== 'sfa'},{/if}
							<!-- Add comma separator -->
						{/each}
					</div>
					<!-- Omega 6, Omega 3 (6:3) -->
					<div class="rounded-md bg-orange-100 px-1.5 py-0.5 text-orange-800">
						<span class="font-medium text-gray-500 uppercase">6:3:</span>
						<!-- Removed outer #if to always show editable values -->
						{#each omegaFields as prop (prop)}
							{#if editingItemId === item.id && editingProperty === prop}
								<input
									type="number"
									step="any"
									bind:this={inputElement}
									bind:value={editingValue}
									on:keydown={handleInputKeydown}
									on:blur={saveItemUpdate}
									class="ml-1 w-12 rounded border border-blue-300 p-0 text-xs"
								/>
							{:else}
								<span
									class="ml-1 cursor-pointer px-1 hover:bg-yellow-100"
									on:click={() => startEditing(item, prop)}
									on:keydown={(e) => {
										if (e.key === 'Enter') startEditing(item, prop);
									}}
									role="button"
									tabindex="0">{formatValue(item[prop] as number | null)}</span
								>
							{/if}
							{#if prop !== 'omega3'},{/if}
							<!-- Add comma separator -->
						{/each}
					</div>
					<!-- GL -->
					<div class="rounded-md bg-purple-100 px-1.5 py-0.5 text-purple-800">
						<span class="font-medium text-gray-500 uppercase">GL:</span>
						{#if editingItemId === item.id && editingProperty === 'gl'}
							<input
								type="number"
								step="any"
								bind:this={inputElement}
								bind:value={editingValue}
								on:keydown={handleInputKeydown}
								on:blur={saveItemUpdate}
								class="ml-1 w-12 rounded border border-blue-300 p-0 text-xs"
							/>
						{:else}
							<span
								class="ml-1 cursor-pointer px-1 hover:bg-yellow-100"
								on:click={() => startEditing(item, 'gl')}
								on:keydown={(e) => {
									if (e.key === 'Enter') startEditing(item, 'gl');
								}}
								role="button"
								tabindex="0">{formatValue(item.gl)}</span
							>
						{/if}
					</div>
				</div>
			</li>
		{/each}
	</ul>
</div>
