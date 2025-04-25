<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte'; // Import tick
	import { supabase } from '$lib/supabaseClient'; // Use $lib alias
	import Fuse from 'fuse.js';
	import { debounce } from 'lodash-es'; // Using lodash for debouncing search input

	// Define types for better clarity
	type FoodItem = {
		id: number;
		name: string;
		calories?: number | null;
		protein?: number | null;
		fat?: number | null;
		carbs?: number | null;
		fibers?: number | null;
		sugar?: number | null;
		mufa?: number | null;
		pufa?: number | null;
		sfa?: number | null;
		gl?: number | null;
		comment?: string | null; // Keep comment in case needed later, though not displayed in summary
	};

	type FoodLog = {
		id: number;
		logged_at: string;
		multiplier: number;
		food_item_id: number;
		food_items: FoodItem | null; // For joined data
	};

	let searchTerm = '';
	let searchResults: FoodItem[] = [];
	let recentLogs: FoodLog[] = [];
	let displayItems: (
		| { type: 'log'; data: FoodLog }
		| { type: 'summary'; date: string; totals: Partial<FoodItem> }
	)[] = []; // Combined array for display
	let allFoodItems: FoodItem[] = []; // Store all items for Fuse.js
	let fuse: Fuse<FoodItem> | null = null; // Fuse instance

	let loadingLogs = true;
	let loadingFoodItems = true;
	let logError: string | null = null;
	let foodItemError: string | null = null;
	let isLogging = false; // To prevent double clicks
	let loadingMore = false; // State for loading more logs
	let canLoadMore = true; // Assume we can load more initially
	const logsPerPage = 50; // Number of logs to fetch per page
	let currentPage = 0; // Current page index for pagination

	// --- Inline Editing State ---
	let editingLogId: number | null = null;
	let editingProperty: 'multiplier' | 'timestamp' | null = null;
	let editingValue: string | number = ''; // Use string to accommodate datetime-local

	// --- Helper Functions ---

	// Timestamp formatter - Now only shows HH:mm
	function formatTimestampForDisplay(isoString: string): string {
		if (!isoString) return 'Invalid Time';
		try {
			const date = new Date(isoString);
			// Get HH:mm part using Swedish locale for 24h format
			const timeFormat: Intl.DateTimeFormatOptions = {
				hour: 'numeric',
				minute: 'numeric',
				hour12: false
			};
			return date.toLocaleTimeString('sv-SE', timeFormat);
		} catch (e) {
			console.error('Error formatting time:', e);
			return 'Invalid Time';
		}
	}

	// Helper to get YYYY-MM-DD from ISO string (respecting local timezone)
	function getLocalDateString(isoString: string): string {
		if (!isoString) return 'Invalid Date';
		try {
			const date = new Date(isoString);
			const year = date.getFullYear();
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			return `${year}-${month}-${day}`;
		} catch (e) {
			console.error('Error getting local date string:', e);
			return 'Invalid Date';
		}
	}

	// Convert ISO string to YYYY-MM-DDTHH:mm format (local time) for datetime-local input
	function isoToDateTimeLocalString(isoString: string): string {
		if (!isoString) return '';
		try {
			const date = new Date(isoString);
			if (isNaN(date.getTime())) return ''; // Invalid date

			const year = date.getFullYear();
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const hours = date.getHours().toString().padStart(2, '0');
			const minutes = date.getMinutes().toString().padStart(2, '0');

			return `${year}-${month}-${day}T${hours}:${minutes}`;
		} catch (e) {
			console.error('Error converting ISO to datetime-local string:', e);
			return '';
		}
	}

	// Convert YYYY-MM-DDTHH:mm string (local time) back to ISO string (UTC)
	function dateTimeLocalToIsoString(localString: string): string {
		if (!localString) return '';
		try {
			// Create date object assuming the input string is in the local timezone
			const date = new Date(localString);
			if (isNaN(date.getTime())) {
				throw new Error('Invalid date created from datetime-local string');
			}
			// Convert the local date object to UTC ISO string
			return date.toISOString();
		} catch (e) {
			console.error('Error converting datetime-local to ISO:', e);
			return '';
		}
	}

	// --- Keyboard Event Handlers for Spans (Start Edit on Enter) ---

	function handleSpanKeydown(event: KeyboardEvent, log: FoodLog, property: 'multiplier' | 'timestamp') {
		if (event.key === 'Enter') {
			event.preventDefault(); // Prevent any default 'Enter' behavior
			startEditing(log, property);
		}
	}

	// --- Keyboard Event Handlers for Inputs ---

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault(); // Prevent potential form submission if nested
			saveLogUpdate();
		} else if (event.key === 'Escape') {
			cancelEdit();
		}
	}

	// --- Inline Editing Logic ---

	async function startEditing(log: FoodLog, property: 'multiplier' | 'timestamp') {
		editingLogId = log.id;
		editingProperty = property;
		if (property === 'multiplier') {
			editingValue = log.multiplier;
			// Optional: Focus the multiplier input after a tick
			// await tick();
			// document.getElementById(`multiplier-edit-${log.id}`)?.focus();
		} else { // property === 'timestamp'
			editingValue = isoToDateTimeLocalString(log.logged_at); // Use new helper for datetime-local
			// Wait for Svelte to update the DOM and render the input
			await tick();
			// Now find the input and show the picker
			const inputElement = document.getElementById(`datetime-edit-${log.id}`) as HTMLInputElement | null;
			if (inputElement) {
				try {
					// Attempt to show the native date/time picker
					inputElement.showPicker();
				} catch (e) {
					console.error("Browser might not support showPicker() or input isn't ready/interactive.", e);
					// Fallback: Focus the element so user can interact (though it's visually hidden)
					// inputElement.focus(); // This might not be ideal if truly hidden
				}
			}
		}
	}


	function cancelEdit() {
		editingLogId = null;
		editingProperty = null;
		editingValue = '';
	}

	async function saveLogUpdate() {
		if (editingLogId === null || editingProperty === null) return;

		let updateData: { multiplier?: number; logged_at?: string } = {};
		let finalValue: number | string;

		if (editingProperty === 'multiplier') {
			finalValue = Number(editingValue); // Ensure it's a number
			if (isNaN(finalValue)) {
				console.error('Invalid multiplier value');
				logError = 'Multiplier must be a valid number.';
				// Optionally keep editing mode active or reset
				// cancelEdit(); // Or just return
				return;
			}
			updateData.multiplier = finalValue;
		} else { // editingProperty === 'timestamp'
			finalValue = dateTimeLocalToIsoString(editingValue as string); // Convert back to ISO using new helper
			if (!finalValue) {
				console.error('Invalid timestamp value from datetime-local input.');
				logError = 'Invalid date/time selected.';
				// cancelEdit(); // Or just return
				return;
			}
			updateData.logged_at = finalValue;
		}

		// Clear previous errors
		logError = null;

		try {
			const { error } = await supabase
				.from('food_log')
				.update(updateData)
				.eq('id', editingLogId);

			if (error) throw error;

			// Exit editing mode and refresh data
			cancelEdit();
			await fetchRecentLogs();
		} catch (err: any) {
			console.error('Error updating log:', err);
			logError = `Failed to update log: ${err.message}`;
			// Keep editing mode active on error? Or cancel?
			// cancelEdit();
		}
	}

	// --- Data Fetching ---

	async function fetchRecentLogs(loadMore = false) {
		if (loadMore) {
			loadingMore = true;
			currentPage++; // Increment page for the next fetch
		} else {
			loadingLogs = true;
			currentPage = 0; // Reset to first page
			recentLogs = []; // Clear existing logs for a fresh load
			displayItems = []; // Clear display items too
		}
		logError = null;

		const from = currentPage * logsPerPage;
		const to = from + logsPerPage - 1;

		try {
			const { data, error } = await supabase
				.from('food_log')
				.select(
					`
          id,
          logged_at,
          multiplier,
          food_item_id,
          food_items (
            id,
            name,
            calories,
            protein,
            fat,
            carbs,
            fibers,
            sugar,
            mufa,
            pufa,
            sfa,
            gl
          )
        `
				)
				.order('logged_at', { ascending: false })
				.range(from, to); // Use range for pagination

			if (error) throw error;

			const newLogs = data
				? data.map((log) => {
						const relatedFoodItem = log.food_items as any; // Cast to any to bypass TS check
						return {
							id: log.id,
							logged_at: log.logged_at,
							multiplier: log.multiplier,
							food_item_id: log.food_item_id,
							// Map all fetched fields
							food_items: relatedFoodItem
								? {
										id: relatedFoodItem.id,
										name: relatedFoodItem.name,
										calories: relatedFoodItem.calories,
										protein: relatedFoodItem.protein,
										fat: relatedFoodItem.fat,
										carbs: relatedFoodItem.carbs,
										fibers: relatedFoodItem.fibers,
										sugar: relatedFoodItem.sugar,
										mufa: relatedFoodItem.mufa,
										pufa: relatedFoodItem.pufa,
										sfa: relatedFoodItem.sfa,
										gl: relatedFoodItem.gl
									}
								: null
						};
					})
				: [];

			// Append or replace logs based on loadMore flag
			if (loadMore) {
				recentLogs = [...recentLogs, ...newLogs];
			} else {
				recentLogs = newLogs;
			}

			// Determine if more logs can be loaded
			canLoadMore = newLogs.length === logsPerPage;

		} catch (err: any) {
			console.error('Error fetching recent logs:', err);
			logError = err.message || 'Failed to fetch recent logs.';
			if (loadMore) currentPage--; // Decrement page if load more failed
		} finally {
			loadingLogs = false;
			loadingMore = false;
			// Process logs after fetching/appending
			processLogsForDisplay();
		}
	}

	// --- Log Processing for Display ---
	function processLogsForDisplay() {
		// Define keys for nutrients we want to sum
		const nutrientKeys = [
			'calories',
			'protein',
			'fat',
			'carbs',
			'fibers',
			'sugar',
			'mufa',
			'pufa',
			'sfa',
			'gl'
		] as const; // Use 'as const' for stricter typing of keys

		// Define a type for the totals accumulator, mapping only nutrient keys to numbers
		type DailyTotals = { [K in typeof nutrientKeys[number]]?: number };

		const groupedLogs: {
			[date: string]: { logs: FoodLog[]; totals: DailyTotals };
		} = {};

	// Group logs by date and calculate totals
	for (const log of recentLogs) {
		const dateStr = getLocalDateString(log.logged_at);
		if (!groupedLogs[dateStr]) {
				// Initialize with logs array and an empty totals object
				groupedLogs[dateStr] = { logs: [], totals: {} };
			}
			groupedLogs[dateStr].logs.push(log);

			// Add to daily totals, checking if food_items exists and initialize if needed
			if (log.food_items) {
				nutrientKeys.forEach((key) => {
					const value = log.food_items?.[key]; // Get the value (could be number | null)
					if (typeof value === 'number') { // Only add if it's a valid number
						// Initialize the specific key in totals if it doesn't exist yet
						if (groupedLogs[dateStr].totals[key] === undefined) {
							groupedLogs[dateStr].totals[key] = 0;
						}
						// Now TypeScript knows totals[key] is a number
						groupedLogs[dateStr].totals[key]! += value * log.multiplier;
					}
				});
			}
		}

		// Create the final display array
		const newDisplayItems: typeof displayItems = [];
		// Sort dates descending (newest first)
		const sortedDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a));

		for (const dateStr of sortedDates) {
			// Add summary row first
			newDisplayItems.push({
				type: 'summary',
				date: dateStr,
				// Round totals before adding to displayItems
				totals: Object.fromEntries(
					nutrientKeys.map(key => [key, Math.round(groupedLogs[dateStr].totals[key] ?? 0)]) // Use ?? 0 for rounding potentially undefined keys
				) as Partial<FoodItem> // Cast to Partial<FoodItem> as expected by displayItems
			});
			// Add individual logs for that day (order maintained from recentLogs)
			for (const log of groupedLogs[dateStr].logs) {
				newDisplayItems.push({ type: 'log', data: log });
			}
		}

		displayItems = newDisplayItems;
	}


	async function fetchAllFoodItems() {
		loadingFoodItems = true;
		foodItemError = null;
		try {
			const { data, error } = await supabase.from('food_items').select('id, name');

			if (error) {
				console.error('fetchAllFoodItems - Supabase error object:', error);
				throw error;
			}

			if (!data) {
				console.warn('fetchAllFoodItems - No data returned from food_items.');
				allFoodItems = [];
			} else {
				allFoodItems = data;
			}

			// Initialize Fuse.js only if data is available
			if (allFoodItems.length > 0) {
				fuse = new Fuse(allFoodItems, {
					keys: ['name'], // Search by the 'name' field
					includeScore: true,
					threshold: 0.4
				});
			} else {
				fuse = null; // Ensure fuse is null if no data
			}
		} catch (err: any) {
			console.error('Error fetching all food items:', err); // Keep general error log
			foodItemError = err.message || 'Failed to fetch food items.';
			allFoodItems = []; // Ensure array is empty on error
			fuse = null; // Ensure fuse is null on error
		} finally {
			loadingFoodItems = false;
		}
	}

	// Fetch initial data on mount
	onMount(async () => {
		// Fetch logs first, then process
		await fetchRecentLogs(); // Already calls processLogsForDisplay on success
		await fetchAllFoodItems();
	});

	// Re-process logs if recentLogs array changes (e.g., after add/delete/update)
	// Ensure loadingLogs is false to prevent processing incomplete data during fetch
	$: if (recentLogs && !loadingLogs) {
		processLogsForDisplay();
	}

	// --- Search Logic ---

	// Debounce the search function to avoid excessive calls
	const debouncedSearch = debounce(() => {
		if (!fuse || !searchTerm.trim()) {
			searchResults = [];
			return;
		}
		const results = fuse.search(searchTerm.trim());
		// Map results back to FoodItem and limit to top 5
		searchResults = results.slice(0, 5).map((result) => result.item);
	}, 300); // 300ms delay

	// Trigger search when searchTerm changes (via bind:value)
	$: if (searchTerm) {
		debouncedSearch();
	} else {
		searchResults = []; // Clear results if search term is empty
	}

	// Cleanup debounce timer on component destroy
	onDestroy(() => {
		debouncedSearch.cancel();
	});

	// --- Logging Logic ---

	async function logSelectedItem(item: FoodItem) {
		if (isLogging) return; // Prevent multiple submissions
		isLogging = true;

		try {
			const { error } = await supabase.from('food_log').insert([
				{
					food_item_id: item.id,
					multiplier: 1, // Default multiplier
					logged_at: new Date().toISOString() // Default timestamp to now
				}
			]);

			if (error) throw error;

			// Clear search and refresh logs on success
			searchTerm = '';
			searchResults = [];
			await fetchRecentLogs(); // Refresh the recent logs list
		} catch (err: any) {
			console.error('Error logging item:', err);
			// Optionally show an error message to the user
			logError = `Failed to log ${item.name}: ${err.message}`;
		} finally {
			isLogging = false;
		}
	}

	// --- Copy Logic ---
	async function copyLog(log: FoodLog) {
		// Use the direct food_item_id from the log entry
		if (!log.food_item_id) {
			console.error('Cannot copy log: food_item_id is missing.', log);
			logError = 'Cannot copy log: Missing food item reference.';
			return;
		}

		try {
			const { error } = await supabase.from('food_log').insert([
				{
					food_item_id: log.food_item_id,
					multiplier: log.multiplier, // Copy the multiplier
					logged_at: new Date().toISOString() // Set timestamp to now
				}
			]);

			if (error) throw error;

			// Refresh logs on success
			await fetchRecentLogs();
		} catch (err: any) {
			console.error('Error copying log:', err);
			logError = `Failed to copy log: ${err.message}`;
		}
	}

	// --- Delete Logic ---
	async function deleteLog(logId: number, foodName: string | undefined) {
		// Add a confirmation dialog
		const itemName = foodName ?? 'this item'; // Use provided name or default text
		if (!confirm(`Are you sure you want to delete the log for "${itemName}"?`)) {
			return; // Stop if the user cancels
		}

		try {
			const { error } = await supabase.from('food_log').delete().match({ id: logId });

			if (error) throw error;

			// Refresh the list after successful deletion
			await fetchRecentLogs();
		} catch (err: any) {
			console.error('Error deleting log:', err);
			logError = `Failed to delete log: ${err.message}`; // Update error state
		}
	}
</script>

<div class="container mx-auto p-4 max-w-5xl">
	<h1 class="text-2xl font-bold mb-4">Log Food</h1>

	<div class="mb-6 relative">
		<label for="food-search" class="block text-sm font-medium text-gray-700 mb-1">Search Food Item:</label>
		<input
			type="text"
			id="food-search"
			bind:value={searchTerm}
			placeholder="Start typing..."
			class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
			disabled={loadingFoodItems}
		/>
		{#if loadingFoodItems}
			<p class="mt-2 text-sm text-gray-500">Loading food items...</p>
		{:else if foodItemError}
			<p class="mt-2 text-sm text-red-600">Error loading food items: {foodItemError}</p>
		{:else if searchTerm && searchResults.length > 0}
			<!-- Positioned the list absolutely -->
			<ul
				class="absolute z-10 mt-1 w-full border border-gray-200 rounded-md bg-white shadow-lg max-h-60 overflow-y-auto"
			>
				{#each searchResults as item (item.id)}
					<li>
						<button
							type="button"
							class="block w-full text-left px-4 py-2 hover:bg-gray-100 cursor-pointer"
							on:click={() => logSelectedItem(item)}
							on:keydown={(e) => e.key === 'Enter' && logSelectedItem(item)}
						>
							{item.name}
						</button>
					</li>
				{/each}
			</ul>
		{:else if searchTerm && !loadingFoodItems && searchResults.length === 0}
			<p class="mt-2 text-sm text-gray-500">No matches found.</p>
		{/if}
	</div>

	<!-- Added margin-top to push content below the potentially overlapping search results -->
	<hr class="my-6 mt-12" />

	<!-- Recent Logs Section -->
	<div>
		<div class="flex justify-between items-center mb-3">
			<h2 class="text-xl font-semibold">Recent Logs</h2>
			<a href="/create-recipe" class="btn btn-sm btn-outline btn-primary">
				Create Recipe
			</a>
		</div>
		{#if loadingLogs}
			<p>Loading recent logs...</p>
		{:else if logError}
			<p class="text-red-600">Error: {logError}</p>
		{:else if displayItems.length > 0}
			<ul class="space-y-2">
				{#each displayItems as item (item.type === 'log' ? item.data.id : item.date)}
					{#if item.type === 'summary'}
						<!-- Daily Summary Divider -->
						<li class="pt-4 pb-1 border-b-2 border-gray-300">
							<div class="flex justify-between items-baseline mb-1">
								<h3 class="text-base font-semibold text-gray-700">{item.date}</h3> <!-- Reduced size from text-lg -->
								<!-- Removed "Daily Totals" span -->
							</div>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
								<!-- Calories -->
								<span class="bg-blue-200 text-blue-900 px-1.5 py-0.5 rounded-md font-medium">
									{item.totals.calories ?? 0} Cal
								</span>
								<!-- Protein, Fat, Carbs -->
								<span class="bg-green-200 text-green-900 px-1.5 py-0.5 rounded-md font-medium">
									{item.totals.protein ?? 0}, {item.totals.fat ?? 0}, {item.totals.carbs ?? 0} <span class="text-green-700 text-[0.65rem]">PFC</span>
								</span>
								<!-- Fibers, Sugar -->
								<span class="bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded-md font-medium">
									{item.totals.fibers ?? 0}, {item.totals.sugar ?? 0} <span class="text-yellow-700 text-[0.65rem]">FiS</span>
								</span>
								<!-- MUFA, PUFA, SFA -->
								<span class="bg-orange-200 text-orange-900 px-1.5 py-0.5 rounded-md font-medium">
									{item.totals.mufa ?? 0}, {item.totals.pufa ?? 0}, {item.totals.sfa ?? 0} <span class="text-orange-700 text-[0.65rem]">MPS</span>
								</span>
								<!-- GL -->
								<span class="bg-purple-200 text-purple-900 px-1.5 py-0.5 rounded-md font-medium">
									{item.totals.gl ?? 0} GL
								</span>
							</div>
						</li>
					{:else if item.type === 'log'}
						{@const log = item.data} <!-- Alias item.data to log for readability -->
						<!-- Individual Log Item -->
						<li class="p-2 border rounded-md bg-gray-50">
							<div class="flex justify-between items-center min-h-[2.5rem]"> <!-- Main log info row -->
								<div class="flex items-center flex-grow mr-2 overflow-hidden"> <!-- Removed space-x-3 -->
									<!-- Timestamp Display/Edit Area -->
									<div class="text-sm text-gray-600 w-12 flex-shrink-0 relative mr-2"> <!-- Reduced width from w-16, keep mr-2 -->
										{#if editingLogId === log.id && editingProperty === 'timestamp'}
											<!-- datetime-local input, visually minimal/hidden but functional -->
											<input
												type="datetime-local"
												bind:value={editingValue}
												on:keydown={handleInputKeydown}
												on:blur={saveLogUpdate}
												on:change={saveLogUpdate}
												class="absolute -left-full w-px h-px opacity-0"
												aria-label="Edit timestamp"
												id={`datetime-edit-${log.id}`}
											/>
											<!-- Display HH:mm while editing (picker should be open). Not clickable. -->
											<span class="px-1 rounded block" title="Editing time...">
												{formatTimestampForDisplay(log.logged_at)}
											</span>
										{:else}
											<!-- Clickable span to initiate editing -->
											<span
												class="cursor-pointer hover:bg-gray-200 px-1 rounded block"
												on:click={() => startEditing(log, 'timestamp')}
												role="button"
												tabindex="0"
												on:keydown={(e) => handleSpanKeydown(e, log, 'timestamp')}
												title="Click to edit timestamp"
											>
												{formatTimestampForDisplay(log.logged_at)}
											</span>
										{/if}
									</div>
									<!-- End Timestamp Area -->

									<span class="text-sm truncate flex-shrink min-w-0 mr-2" title={log.food_items?.name ?? '(Deleted item)'}> <!-- Reduced size, add mr-2 -->
										{log.food_items?.name ?? '(Deleted item)'}
							</span>

							<div class="text-sm text-gray-600 flex-shrink-0">
								{#if editingLogId === log.id && editingProperty === 'multiplier'}
									<input
										type="number"
										step="0.1"
										bind:value={editingValue}
										on:keydown={handleInputKeydown}
										on:blur={saveLogUpdate}
										class="px-1 py-0 border border-blue-300 rounded text-sm w-16"
										aria-label="Edit multiplier"
									/>
								{:else}
									<span
										class="cursor-pointer hover:bg-gray-200 px-1 rounded"
										on:click={() => startEditing(log, 'multiplier')}
										role="button"
										tabindex="0"
										on:keydown={(e) => handleSpanKeydown(e, log, 'multiplier')}
										title="Click to edit multiplier"
									>
										x{log.multiplier}
									</span>
								{/if}
							</div>
						</div>

						<div class="flex items-center flex-shrink-0 space-x-1">
							<button
								type="button"
								on:click={() => copyLog(log)}
								class="p-1 text-blue-700 bg-blue-100 rounded hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
								aria-label={`Copy log for ${log.food_items?.name ?? '(Deleted item)'} as new entry`}
								title="Copy as new entry (now)"
							>
								📋
							</button>
							<button
								type="button"
								on:click={() => deleteLog(log.id, log.food_items?.name)}
								class="p-1 text-red-700 bg-red-100 rounded hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
								aria-label={`Delete log for ${log.food_items?.name ?? '(Deleted item)'}`}
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						</div> <!-- End main log info row -->

						<!-- Nutritional Summary Row - Styled Badges -->
						{#if log.food_items}
						<div class="pl-1 pt-1 mt-1 border-t border-gray-200 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
							<!-- Calories -->
							<span class="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-md">
								{Math.round((log.food_items.calories ?? 0) * log.multiplier)} Cal
							</span>
							<!-- Protein, Fat, Carbs -->
							<span class="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-md">
								{Math.round((log.food_items.protein ?? 0) * log.multiplier)}, {Math.round((log.food_items.fat ?? 0) * log.multiplier)}, {Math.round((log.food_items.carbs ?? 0) * log.multiplier)} <span class="text-green-600 text-[0.65rem]">PFC</span>
							</span>
							<!-- Fibers, Sugar -->
							<span class="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-md">
								{Math.round((log.food_items.fibers ?? 0) * log.multiplier)}, {Math.round((log.food_items.sugar ?? 0) * log.multiplier)} <span class="text-yellow-600 text-[0.65rem]">FiS</span>
							</span>
							<!-- MUFA, PUFA, SFA -->
							<span class="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-md">
								{Math.round((log.food_items.mufa ?? 0) * log.multiplier)}, {Math.round((log.food_items.pufa ?? 0) * log.multiplier)}, {Math.round((log.food_items.sfa ?? 0) * log.multiplier)} <span class="text-orange-600 text-[0.65rem]">MPS</span>
							</span>
							<!-- GL -->
							<span class="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-md">
								{Math.round((log.food_items.gl ?? 0) * log.multiplier)} GL
							</span>
						</div>
						{/if}
						</li>
					{/if}
				{/each}
			</ul>
			<!-- Load More Button -->
			{#if !loadingLogs && canLoadMore}
				<div class="mt-6 text-center">
					<button
						type="button"
						class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
						on:click={() => fetchRecentLogs(true)}
						disabled={loadingMore}
					>
						{#if loadingMore}
							Loading...
						{:else}
							Load More
						{/if}
					</button>
				</div>
			{/if}
		{:else}
			<p>No food logged yet.</p>
		{/if}
	</div>
</div>
