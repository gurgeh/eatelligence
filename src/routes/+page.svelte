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
			const { error } = await supabase
				.from('food_log')
				.insert([{ food_item_id: item.id, multiplier: 1 }]); // Default multiplier to 1 for now

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
</script>

<div class="container mx-auto p-4">
	<h1 class="text-2xl font-bold mb-4">Log Food</h1>

	<!-- Search Section -->
	<div class="mb-6 relative">
		{' '}
		<!-- Added relative positioning for absolute positioned list -->
		<label for="food-search" class="block text-sm font-medium text-gray-700 mb-1"
			>Search Food Item:</label
		>
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
					<li
						class="px-4 py-2 hover:bg-gray-100 cursor-pointer"
						on:click={() => logSelectedItem(item)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === 'Enter' && logSelectedItem(item)}
					>
						{item.name}
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
					<li class="p-2 border rounded-md bg-gray-50">
						<span class="font-medium">{log.food_items?.name ?? 'Unknown Item'}</span>
						<span class="text-sm text-gray-600 ml-2"
							>(x{log.multiplier}) - {new Date(log.logged_at).toLocaleString()}</span
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p>No food logged yet.</p>
		{/if}
	</div>
</div>
