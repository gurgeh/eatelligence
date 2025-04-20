<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { supabase } from '$lib/supabaseClient'; // Use $lib alias
	import Fuse from 'fuse.js';
	import { debounce } from 'lodash-es'; // Using lodash for debouncing search input

	// Define types for better clarity
	type FoodItem = {
		id: number;
		name: string;
		// Add other fields from food_items if needed later
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
	let allFoodItems: FoodItem[] = []; // Store all items for Fuse.js
	let fuse: Fuse<FoodItem> | null = null; // Fuse instance

	let loadingLogs = true;
	let loadingFoodItems = true;
	let logError: string | null = null;
	let foodItemError: string | null = null;
	let isLogging = false; // To prevent double clicks

	// --- Inline Editing State ---
	let editingLogId: number | null = null;
	let editingProperty: 'multiplier' | 'timestamp' | null = null;
	let editingValue: string | number = ''; // Use string to accommodate datetime-local

	// --- Helper Functions ---

	// Timestamp formatter with "Today" / "Yesterday" logic
	function formatTimestampForDisplay(isoString: string): string {
		if (!isoString) return 'Invalid Date';
		try {
			const date = new Date(isoString);
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const yesterday = new Date(today);
			yesterday.setDate(today.getDate() - 1);

			// Get HH:mm part
			const timeFormat: Intl.DateTimeFormatOptions = {
				hour: 'numeric',
				minute: 'numeric',
				hour12: false
			};
			const timeString = date.toLocaleTimeString('sv-SE', timeFormat);

			// Compare dates (ignoring time)
			const inputDateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

			if (inputDateOnly.getTime() === today.getTime()) {
				return `Today ${timeString}`;
			} else if (inputDateOnly.getTime() === yesterday.getTime()) {
				return `Yesterday ${timeString}`;
			} else {
				// Fallback to original format for older dates
				return date.toLocaleString('sv-SE', {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: 'numeric',
					hour12: false
				});
			}
		} catch (e) {
			console.error('Error formatting date:', e);
			return 'Invalid Date';
		}
	}


	// Convert ISO string to Swedish local format (YYYY-MM-DD HH:mm)
	function isoToSwedishLocal(isoString: string): string {
		if (!isoString) return '';
		try {
			const date = new Date(isoString);
			const year = date.getFullYear();
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const hours = date.getHours().toString().padStart(2, '0');
			const minutes = date.getMinutes().toString().padStart(2, '0');
			return `${year}-${month}-${day} ${hours}:${minutes}`;
		} catch (e) {
			console.error('Error converting ISO to Swedish local:', e);
			return '';
		}
	}

	// Convert Swedish local format (YYYY-MM-DD HH:mm) string back to ISO string (UTC)
	function swedishLocalToIso(localString: string): string {
		if (!localString) return '';
		// Basic validation for format YYYY-MM-DD HH:mm
		if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(localString)) {
			console.error('Invalid Swedish local format. Expected YYYY-MM-DD HH:mm');
			return ''; // Return empty or throw error
		}
		try {
			// Replace space with 'T' to help Date parsing, assume it's local time
			const date = new Date(localString.replace(' ', 'T'));
			if (isNaN(date.getTime())) {
				throw new Error('Invalid date created from local string');
			}
			// Convert the local date object to UTC ISO string
			return date.toISOString();
		} catch (e) {
			console.error('Error converting Swedish local to ISO:', e);
			return ''; // Or handle error appropriately
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

	function startEditing(log: FoodLog, property: 'multiplier' | 'timestamp') {
		editingLogId = log.id;
		editingProperty = property;
		if (property === 'multiplier') {
			editingValue = log.multiplier;
		} else {
			editingValue = isoToSwedishLocal(log.logged_at); // Convert for input using new function
		}
		// Optional: Focus the input element after it renders (requires a tick or element reference)
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
		} else {
			// editingProperty === 'timestamp'
			finalValue = swedishLocalToIso(editingValue as string); // Convert back to ISO using new function
			if (!finalValue) {
				console.error('Invalid timestamp value. Expected format: YYYY-MM-DD HH:mm');
				logError = 'Invalid date/time format. Use YYYY-MM-DD HH:mm';
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

	async function fetchRecentLogs() {
		loadingLogs = true;
		logError = null;
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
            name
          )
        `
				)
				.order('logged_at', { ascending: false })
				.limit(20);

			if (error) throw error;

			// Safely map the data, handling potential null for food_items
			recentLogs = data
				? data.map((log) => {
						const relatedFoodItem = log.food_items as any; // Cast to any to bypass TS check
						return {
							id: log.id,
							logged_at: log.logged_at,
							multiplier: log.multiplier,
							food_item_id: log.food_item_id,
							// Access properties after casting
							food_items: relatedFoodItem ? { id: relatedFoodItem.id, name: relatedFoodItem.name } : null
						};
					})
				: []; // Handle case where data itself might be null
		} catch (err: any) {
			console.error('Error fetching recent logs:', err);
			logError = err.message || 'Failed to fetch recent logs.';
		} finally {
			loadingLogs = false;
		}
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
	onMount(() => {
		fetchRecentLogs();
		fetchAllFoodItems();
	});

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
		<h2 class="text-xl font-semibold mb-3">Recent Logs</h2>
		{#if loadingLogs}
			<p>Loading recent logs...</p>
		{:else if logError}
			<p class="text-red-600">Error: {logError}</p>
		{:else if recentLogs.length > 0}
			<ul class="space-y-2">
				{#each recentLogs as log (log.id)}
					<li class="flex justify-between items-center p-2 border rounded-md bg-gray-50 min-h-[3rem]">
						<div class="flex items-center space-x-3 flex-grow mr-2 overflow-hidden">
							<div class="text-sm text-gray-600 w-28 flex-shrink-0">
								{#if editingLogId === log.id && editingProperty === 'timestamp'}
									<input
										type="text"
										placeholder="YYYY-MM-DD HH:mm"
										bind:value={editingValue}
										on:keydown={handleInputKeydown}
										on:blur={saveLogUpdate}
										class="px-1 py-0 border border-blue-300 rounded text-sm w-full"
										aria-label="Edit timestamp (YYYY-MM-DD HH:mm)"
									/>
								{:else}
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

							<span class="font-medium truncate flex-shrink min-w-0" title={log.food_items?.name ?? 'Unknown Item'}>
								{log.food_items?.name ?? 'Unknown Item'}
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
								aria-label={`Copy log for ${log.food_items?.name ?? 'Unknown Item'} as new entry`}
								title="Copy as new entry (now)"
							>
								📋
							</button>
							<button
								type="button"
								on:click={() => deleteLog(log.id, log.food_items?.name)}
								class="p-1 text-red-700 bg-red-100 rounded hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
								aria-label={`Delete log for ${log.food_items?.name ?? 'Unknown Item'}`}
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p>No food logged yet.</p>
		{/if}
	</div>
</div>
