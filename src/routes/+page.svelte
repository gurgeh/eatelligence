<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte'; // Import tick
	import { supabase } from '$lib/supabaseClient'; // Use $lib alias
	import Fuse from 'fuse.js';
	import { debounce } from 'lodash-es'; // Using lodash for debouncing search input
	import { calculateKcal, getErrorMessage, ratio } from '$lib/utils';
	import TargetDetailsModal from '$lib/components/TargetDetailsModal.svelte';
	import NutrientBadges from '$lib/components/NutrientBadges.svelte';
	import type { NutritionTarget, FoodLog, FoodItem } from '$lib/types';

	// Define types for better clarity
	type FoodLogRow = Omit<FoodLog, 'food_items'> & {
		food_items: FoodItem | FoodItem[] | null;
	};
	type SearchFoodItem = Pick<FoodItem, 'id' | 'name'>;

	// Define a type for the raw nutrient totals used in summaries and modal
	type NutrientTotals = {
		protein?: number;
		fat?: number;
		carbs?: number;
		fibers?: number;
		sugar?: number;
		mufa?: number;
		pufa?: number;
		sfa?: number;
		gl?: number;
		omega3?: number;
		omega6?: number;
		// Note: calories are calculated dynamically
	};

	function getJoinedFoodItem(foodItems: FoodLogRow['food_items']): FoodItem | null {
		if (Array.isArray(foodItems)) return foodItems[0] ?? null;
		return foodItems ?? null;
	}

	let searchTerm = '';
	let searchResults: SearchFoodItem[] = [];
	let recentLogs: FoodLog[] = [];
	// Define a type for the summary object including the ratio
	type SummaryItem = {
		type: 'summary';
		date: string;
		totals: NutrientTotals; // Use the specific NutrientTotals type
		ratio?: string; // Add optional ratio string
	};

	let displayItems: (
		| { type: 'log'; data: FoodLog }
		| SummaryItem // Use the defined SummaryItem type
	)[] = []; // Combined array for display
	let allFoodItems: SearchFoodItem[] = []; // Store all items for Fuse.js
	let fuse: Fuse<SearchFoodItem> | null = null; // Fuse instance

	// --- Target Modal State ---
	let nutritionTargets: NutritionTarget[] = [];
	let isModalOpen = false;
	let selectedDailyTotals: NutrientTotals = {};
	let selectedDateString = '';

	// --- Target Modal Functions ---
	function openTargetModal(date: string, totals: NutrientTotals) {
		selectedDateString = date;
		selectedDailyTotals = totals;
		isModalOpen = true;
	}

	function closeTargetModal() {
		isModalOpen = false;
		// Optionally clear selected data
		// selectedDateString = '';
		// selectedDailyTotals = {};
	}

	let loadingLogs = true;
	let loadingFoodItems = true;
	let logError: string | null = null;
	let foodItemError: string | null = null;
	let isLogging = false; // To prevent double clicks
	let loadingMore = false; // State for loading more logs
	let canLoadMore = true; // Assume we can load more initially
	const logsPerPage = 50; // Number of logs to fetch per page
	let currentPage = 0; // Current page index for pagination

	// --- 7-Day Average State ---
	let last7DaysLogs: FoodLog[] = [];
	let loading7DayLogs = true;
	let error7DayLogs: string | null = null;
	let sevenDayAverages: (NutrientTotals & { ratio?: string; daysWithLogs: number }) | null = null; // Store calculated averages

	// --- Inline Editing State ---
	let editingLogId: number | null = null;
	let editingProperty: 'multiplier' | 'timestamp' | null = null;
	let editingValue: string | number = ''; // Use string to accommodate datetime-local

	// --- Helper Functions ---

	// Get the date string for N days ago from today
	function getDateNDaysAgo(days: number): string {
		const date = new Date();
		date.setDate(date.getDate() - days);
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

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

	function handleSpanKeydown(
		event: KeyboardEvent,
		log: FoodLog,
		property: 'multiplier' | 'timestamp'
	) {
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
		} else {
			// property === 'timestamp'
			editingValue = isoToDateTimeLocalString(log.logged_at); // Use new helper for datetime-local
			// Wait for Svelte to update the DOM and render the input
			await tick();
			// Now find the input and show the picker
			const inputElement = document.getElementById(
				`datetime-edit-${log.id}`
			) as HTMLInputElement | null;
			if (inputElement) {
				try {
					// Attempt to show the native date/time picker
					inputElement.showPicker();
				} catch (e) {
					console.error(
						"Browser might not support showPicker() or input isn't ready/interactive.",
						e
					);
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
		} else {
			// editingProperty === 'timestamp'
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
			const { error } = await supabase.from('food_log').update(updateData).eq('id', editingLogId);

			if (error) throw error;

			// Exit editing mode and refresh data
			cancelEdit();
			await fetchRecentLogs();
		} catch (err: unknown) {
			console.error('Error updating log:', err);
			logError = `Failed to update log: ${getErrorMessage(err)}`;
			// Keep editing mode active on error? Or cancel?
			// cancelEdit();
		}
	}

	// --- Data Fetching ---

	async function fetchLast7DaysLogData() {
		loading7DayLogs = true;
		error7DayLogs = null;
		last7DaysLogs = []; // Clear previous data

		const sevenDaysAgo = getDateNDaysAgo(6); // Start of the 7-day period (inclusive)
		const todayEnd = new Date(); // Use current time as end boundary for today
		todayEnd.setHours(23, 59, 59, 999); // Set to end of today

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
						id, name, protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6
					)
				`
				)
				.gte('logged_at', `${sevenDaysAgo}T00:00:00.000Z`) // From start of 7 days ago (UTC)
				.lte('logged_at', todayEnd.toISOString()) // To end of today (UTC)
				.order('logged_at', { ascending: false }); // Order doesn't strictly matter for averages but keep consistent

			if (error) throw error;

			// Process data similar to fetchRecentLogs but without pagination logic
			last7DaysLogs = data
				? (data as FoodLogRow[]).map((log) => {
						const relatedFoodItem = getJoinedFoodItem(log.food_items);
						return {
							id: log.id,
							logged_at: log.logged_at,
							multiplier: log.multiplier,
							food_item_id: log.food_item_id,
							food_items: relatedFoodItem
								? {
										id: relatedFoodItem.id,
										name: relatedFoodItem.name,
										protein: relatedFoodItem.protein,
										fat: relatedFoodItem.fat,
										carbs: relatedFoodItem.carbs,
										fibers: relatedFoodItem.fibers,
										sugar: relatedFoodItem.sugar,
										mufa: relatedFoodItem.mufa,
										pufa: relatedFoodItem.pufa,
										sfa: relatedFoodItem.sfa,
										gl: relatedFoodItem.gl,
										omega3: relatedFoodItem.omega3,
										omega6: relatedFoodItem.omega6
										// serving_qty/unit not needed for average calculation
									}
								: null
						};
					})
				: [];
		} catch (err: unknown) {
			console.error('Error fetching last 7 days logs:', err);
			error7DayLogs = getErrorMessage(err) || 'Failed to fetch 7-day log data.';
			last7DaysLogs = [];
		} finally {
			loading7DayLogs = false;
			// Calculation will happen in the reactive block
		}
	}

	async function fetchNutritionTargets() {
		try {
			const { data, error } = await supabase.from('nutrition_targets').select('*');

			if (error) throw error;
			nutritionTargets = data || [];
		} catch (err: unknown) {
			console.error('Error fetching nutrition targets:', err);
			nutritionTargets = []; // Ensure empty array on error
		}
	}

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
            protein,
            fat,
            carbs,
            fibers,
            sugar,
            mufa,
            pufa,
            sfa,
            gl,
            omega3,
            omega6,
            serving_qty,
            serving_unit
          )
        `
				)
				.order('logged_at', { ascending: false })
				.range(from, to); // Use range for pagination

			if (error) throw error;

			const newLogs = data
				? (data as FoodLogRow[]).map((log) => {
						const relatedFoodItem = getJoinedFoodItem(log.food_items);
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
										// calories removed from mapping
										protein: relatedFoodItem.protein,
										fat: relatedFoodItem.fat,
										carbs: relatedFoodItem.carbs,
										fibers: relatedFoodItem.fibers,
										sugar: relatedFoodItem.sugar,
										mufa: relatedFoodItem.mufa,
										pufa: relatedFoodItem.pufa,
										sfa: relatedFoodItem.sfa,
										gl: relatedFoodItem.gl,
										omega3: relatedFoodItem.omega3, // Added omega3
										omega6: relatedFoodItem.omega6, // Added omega6
										serving_qty: relatedFoodItem.serving_qty, // Added serving_qty
										serving_unit: relatedFoodItem.serving_unit // Added serving_unit
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
		} catch (err: unknown) {
			console.error('Error fetching recent logs:', err);
			logError = getErrorMessage(err) || 'Failed to fetch recent logs.';
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
			'protein',
			'fat',
			'carbs',
			'fibers',
			'sugar',
			'mufa',
			'pufa',
			'sfa',
			'gl',
			'omega3', // Added omega3
			'omega6' // Added omega6
		] as const; // Use 'as const' for stricter typing of keys

		// Use the NutrientTotals type defined earlier for clarity
		const groupedLogs: {
			[date: string]: { logs: FoodLog[]; totals: NutrientTotals & { ratio?: string } }; // Combine for internal use
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
					if (typeof value === 'number') {
						// Only add if it's a valid number
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

		for (const dateStr in groupedLogs) {
			const dailyTotals = groupedLogs[dateStr].totals;
			const o3 = dailyTotals.omega3 ?? 0;
			const o6 = dailyTotals.omega6 ?? 0;
			dailyTotals.ratio = ratio(o6, o3) ?? (o6 > 0 ? '∞:1' : '-');
		}

		// Create the final display array
		const newDisplayItems: typeof displayItems = [];
		// Sort dates descending (newest first)
		const sortedDates = Object.keys(groupedLogs).sort((a, b) => b.localeCompare(a));

		for (const dateStr of sortedDates) {
			// Extract the nutrient totals matching the NutrientTotals type
			const summaryTotals: NutrientTotals = Object.fromEntries(
				nutrientKeys.map((key) => [key, groupedLogs[dateStr].totals[key] ?? 0])
			);
			// Add summary row first
			newDisplayItems.push({
				type: 'summary',
				date: dateStr,
				totals: summaryTotals, // Use the correctly typed object
				ratio: groupedLogs[dateStr].totals.ratio // Add the calculated ratio
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
		} catch (err: unknown) {
			console.error('Error fetching all food items:', err); // Keep general error log
			foodItemError = getErrorMessage(err) || 'Failed to fetch food items.';
			allFoodItems = []; // Ensure array is empty on error
			fuse = null; // Ensure fuse is null on error
		} finally {
			loadingFoodItems = false;
		}
	}

	// Fetch initial data on mount
	onMount(async () => {
		// Fetch logs first, then process
		await Promise.all([
			fetchRecentLogs(), // Already calls processLogsForDisplay on success
			fetchAllFoodItems(),
			fetchNutritionTargets(),
			fetchLast7DaysLogData() // Fetch 7-day data
		]);
	});

	// Re-process logs for main display if recentLogs array changes
	$: if (recentLogs && !loadingLogs) {
		processLogsForDisplay();
	}

	// --- 7-Day Average Calculation ---
	$: if (last7DaysLogs && !loading7DayLogs) {
		const nutrientKeys = [
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
		] as const;

		const dailyTotalsMap: { [date: string]: NutrientTotals } = {};

		// Calculate daily totals for the 7-day period
		for (const log of last7DaysLogs) {
			if (!log.food_items) continue; // Skip logs without item data

			const dateStr = getLocalDateString(log.logged_at);
			if (!dailyTotalsMap[dateStr]) {
				// Initialize totals for this day
				dailyTotalsMap[dateStr] = Object.fromEntries(
					nutrientKeys.map((key) => [key, 0])
				) as NutrientTotals;
			}

			nutrientKeys.forEach((key) => {
				const value = log.food_items?.[key];
				if (typeof value === 'number') {
					// Ensure the key exists before adding (should always exist due to initialization)
					if (dailyTotalsMap[dateStr][key] !== undefined) {
						dailyTotalsMap[dateStr][key]! += value * log.multiplier;
					}
				}
			});
		}

		const daysWithLogs = Object.keys(dailyTotalsMap).length;

		if (daysWithLogs > 0) {
			const summedTotals: NutrientTotals = Object.fromEntries(
				nutrientKeys.map((key) => [key, 0])
			) as NutrientTotals;

			// Sum totals across all days with logs
			for (const dateStr in dailyTotalsMap) {
				nutrientKeys.forEach((key) => {
					if (summedTotals[key] !== undefined && dailyTotalsMap[dateStr][key] !== undefined) {
						summedTotals[key]! += dailyTotalsMap[dateStr][key]!;
					}
				});
			}

			// Calculate averages
			const averages: NutrientTotals = Object.fromEntries(
				nutrientKeys.map((key) => [key, (summedTotals[key] ?? 0) / daysWithLogs])
			) as NutrientTotals;

			const avgO6 = averages.omega6 ?? 0;
			const avgO3 = averages.omega3 ?? 0;
			const avgRatio = ratio(avgO6, avgO3) ?? (avgO6 > 0 ? '∞:1' : '-');
			sevenDayAverages = { ...averages, ratio: avgRatio, daysWithLogs };
		} else {
			// No logs in the last 7 days
			sevenDayAverages = null;
		}
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

	async function logSelectedItem(item: SearchFoodItem) {
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
		} catch (err: unknown) {
			console.error('Error logging item:', err);
			// Optionally show an error message to the user
			logError = `Failed to log ${item.name}: ${getErrorMessage(err)}`;
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
		} catch (err: unknown) {
			console.error('Error copying log:', err);
			logError = `Failed to copy log: ${getErrorMessage(err)}`;
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
		} catch (err: unknown) {
			console.error('Error deleting log:', err);
			logError = `Failed to delete log: ${getErrorMessage(err)}`; // Update error state
		}
	}
</script>

<div class="container mx-auto max-w-5xl p-4">
	<h1 class="mb-4 text-2xl font-bold">Log Food</h1>

	<div class="relative mb-6">
		<label for="food-search" class="mb-1 block text-sm font-medium text-gray-700"
			>Search Food Item:</label
		>
		<input
			type="text"
			id="food-search"
			bind:value={searchTerm}
			placeholder="Start typing..."
			class="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
			disabled={loadingFoodItems}
		/>
		{#if loadingFoodItems}
			<p class="mt-2 text-sm text-gray-500">Loading food items...</p>
		{:else if foodItemError}
			<p class="mt-2 text-sm text-red-600">Error loading food items: {foodItemError}</p>
		{:else if searchTerm && searchResults.length > 0}
			<!-- Positioned the list absolutely -->
			<ul
				class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
			>
				{#each searchResults as item (item.id)}
					<li>
						<button
							type="button"
							class="block w-full cursor-pointer px-4 py-2 text-left hover:bg-gray-100"
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

	<!-- 7-Day Average Section -->
	<div class="mb-6 rounded-md border bg-gray-100 p-4">
		<h2 class="mb-2 text-lg font-semibold">7-Day Average Intake</h2>
		{#if loading7DayLogs}
			<p class="text-sm text-gray-600">Calculating averages...</p>
		{:else if error7DayLogs}
			<p class="text-sm text-red-600">Error calculating averages: {error7DayLogs}</p>
		{:else if sevenDayAverages}
			<p class="mb-2 text-xs text-gray-500">
				Based on {sevenDayAverages.daysWithLogs} day(s) with logs in the last 7 days.
			</p>
			<NutrientBadges totals={sevenDayAverages} ratio={sevenDayAverages.ratio} />
		{:else}
			<p class="text-sm text-gray-600">No log data found for the last 7 days.</p>
		{/if}
	</div>

	<!-- Recent Logs Section -->
	<div>
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-xl font-semibold">Recent Logs</h2>
			<a href="/create-recipe" class="btn btn-sm btn-outline btn-primary"> Create Recipe </a>
		</div>
		{#if loadingLogs}
			<p>Loading recent logs...</p>
		{:else if logError}
			<p class="text-red-600">Error: {logError}</p>
		{:else if displayItems.length > 0}
			<ul class="space-y-2">
				{#each displayItems as item (item.type === 'log' ? item.data.id : item.date)}
					{#if item.type === 'summary'}
						<!-- Daily Summary Divider - Made clickable via button -->
						<li class="border-b-2 border-gray-300">
							<!-- Structural border only -->
							<button
								type="button"
								class="block w-full pt-4 pb-1 text-left transition duration-150 ease-in-out hover:bg-gray-100 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:outline-none"
								on:click={() => openTargetModal(item.date, item.totals)}
								on:keydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') openTargetModal(item.date, item.totals);
								}}
								title="Click to view target details for {item.date}"
							>
								<div class="mb-1 flex items-baseline justify-between">
									<h3 class="text-base font-semibold text-gray-700">{item.date}</h3>
									<!-- Reduced size from text-lg -->
									<!-- Removed "Daily Totals" span -->
								</div>
								<NutrientBadges totals={item.totals} ratio={item.ratio} pointerEventsNone />
							</button>
							<!-- Close button -->
						</li>
					{:else if item.type === 'log'}
						{@const log = item.data}
						<!-- Alias item.data to log for readability -->
						<!-- Individual Log Item -->
						<li class="rounded-md border bg-gray-50 p-2">
							<div class="flex min-h-[2.5rem] items-center justify-between">
								<!-- Main log info row -->
								<div class="mr-2 flex flex-grow items-center overflow-hidden">
									<!-- Removed space-x-3 -->
									<!-- Timestamp Display/Edit Area -->
									<div class="relative mr-2 w-12 flex-shrink-0 text-sm text-gray-600">
										<!-- Reduced width from w-16, keep mr-2 -->
										{#if editingLogId === log.id && editingProperty === 'timestamp'}
											<!-- datetime-local input, visually minimal/hidden but functional -->
											<input
												type="datetime-local"
												bind:value={editingValue}
												on:keydown={handleInputKeydown}
												on:blur={saveLogUpdate}
												on:change={saveLogUpdate}
												class="absolute -left-full h-px w-px opacity-0"
												aria-label="Edit timestamp"
												id={`datetime-edit-${log.id}`}
											/>
											<!-- Display HH:mm while editing (picker should be open). Not clickable. -->
											<span class="block rounded px-1" title="Editing time...">
												{formatTimestampForDisplay(log.logged_at)}
											</span>
										{:else}
											<!-- Clickable span to initiate editing -->
											<span
												class="block cursor-pointer rounded px-1 hover:bg-gray-200"
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

									<span
										class="mr-2 min-w-0 flex-shrink truncate text-sm"
										title={log.food_items?.name ?? '(Deleted item)'}
									>
										<!-- Reduced size, add mr-2 -->
										{log.food_items?.name ?? '(Deleted item)'}
									</span>

									<div class="flex-shrink-0 text-sm text-gray-600">
										{#if editingLogId === log.id && editingProperty === 'multiplier'}
											<input
												type="number"
												step="0.1"
												bind:value={editingValue}
												on:keydown={handleInputKeydown}
												on:blur={saveLogUpdate}
												class="w-16 rounded border border-blue-300 px-1 py-0 text-sm"
												aria-label="Edit multiplier"
											/>
										{:else}
											<span
												class="cursor-pointer rounded px-1 hover:bg-gray-200"
												on:click={() => startEditing(log, 'multiplier')}
												role="button"
												tabindex="0"
												on:keydown={(e) => handleSpanKeydown(e, log, 'multiplier')}
												title="Click to edit multiplier"
											>
												{#if log.food_items?.serving_qty && log.food_items?.serving_unit}
													<span class="mr-1 text-xs text-gray-500">
														({log.food_items.serving_qty}{log.food_items.serving_unit})
													</span>
												{/if}
												x{log.multiplier}
											</span>
										{/if}
									</div>
								</div>

								<div class="flex flex-shrink-0 items-center space-x-1">
									<button
										type="button"
										on:click={() => copyLog(log)}
										class="rounded bg-blue-100 p-1 text-blue-700 hover:bg-blue-200 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none"
										aria-label={`Copy log for ${log.food_items?.name ?? '(Deleted item)'} as new entry`}
										title="Copy as new entry (now)"
									>
										📋
									</button>
									<button
										type="button"
										on:click={() => deleteLog(log.id, log.food_items?.name)}
										class="rounded bg-red-100 p-1 text-red-700 hover:bg-red-200 focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:outline-none"
										aria-label={`Delete log for ${log.food_items?.name ?? '(Deleted item)'}`}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
									</button>
								</div>
							</div>
							<!-- End main log info row -->

							<!-- Nutritional Summary Row - Styled Badges -->
							{#if log.food_items}
								<div
									class="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-gray-200 pt-1 pl-1 text-xs"
								>
									<!-- Reduced gap-x -->
									<!-- Calculated Kcal -->
									<span class="rounded-md bg-blue-100 px-1 py-0.5 text-blue-800">
										<!-- Reduced px, changed Cal to C -->
										{calculateKcal({
											protein: (log.food_items.protein ?? 0) * log.multiplier,
											fat: (log.food_items.fat ?? 0) * log.multiplier,
											carbs: (log.food_items.carbs ?? 0) * log.multiplier,
											fibers: (log.food_items.fibers ?? 0) * log.multiplier
										})} C
									</span>
									<!-- Protein, Fat, Carbs -->
									<span class="rounded-md bg-green-100 px-1 py-0.5 text-green-800">
										<!-- Reduced px -->
										{Math.round((log.food_items.protein ?? 0) * log.multiplier)}, {Math.round(
											(log.food_items.fat ?? 0) * log.multiplier
										)}, {Math.round((log.food_items.carbs ?? 0) * log.multiplier)}
										<span class="text-[0.65rem] text-green-600">PFC</span>
									</span>
									<!-- Fibers, Sugar -->
									<span class="rounded-md bg-yellow-100 px-1 py-0.5 text-yellow-800">
										<!-- Reduced px -->
										{Math.round((log.food_items.fibers ?? 0) * log.multiplier)}, {Math.round(
											(log.food_items.sugar ?? 0) * log.multiplier
										)} <span class="text-[0.65rem] text-yellow-600">FiS</span>
									</span>
									<!-- MUFA, PUFA, SFA -->
									<span class="rounded-md bg-orange-100 px-1 py-0.5 text-orange-800">
										<!-- Reduced px -->
										{Math.round((log.food_items.mufa ?? 0) * log.multiplier)}, {Math.round(
											(log.food_items.pufa ?? 0) * log.multiplier
										)}, {Math.round((log.food_items.sfa ?? 0) * log.multiplier)}
										<span class="text-[0.65rem] text-orange-600">MPS</span>
									</span>
									<!-- Omega 6:3 -->
									<span class="rounded-md bg-orange-100 px-1 py-0.5 text-orange-800">
										<!-- Reduced px -->
										{#if Math.round((log.food_items.omega6 ?? 0) * log.multiplier) === 0 && Math.round((log.food_items.omega3 ?? 0) * log.multiplier) === 0}
											-
										{:else}
											{Math.round((log.food_items.omega6 ?? 0) * log.multiplier)}, {Math.round(
												(log.food_items.omega3 ?? 0) * log.multiplier
											)}
										{/if}
										<span class="text-[0.65rem] text-orange-600">6:3</span>
									</span>
									<!-- GL -->
									<span class="rounded-md bg-purple-100 px-1 py-0.5 text-purple-800">
										<!-- Reduced px -->
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
						class="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
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

	<!-- Target Details Modal Instance -->
	<TargetDetailsModal
		bind:isOpen={isModalOpen}
		dailyTotals={selectedDailyTotals}
		targets={nutritionTargets}
		dateString={selectedDateString}
		on:close={closeTargetModal}
	/>
</div>
