<script lang="ts">
  // import '../../app.css'; // Remove explicit import, rely on layout
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabaseClient';
  import type { FoodItem } from '$lib/types'; // Only need FoodItem from shared types

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
          food_items ( id, name, serving_qty, serving_unit, calories, protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6 )
        `
        )
        .order('logged_at', { ascending: false })
        .limit(100); // Limit to recent logs

      if (error) throw error;

      // Map the fetched data to our local RecipeLogEntry type
      logEntries = data?.map(log => ({
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

    } catch (err: any) {
      console.error('Error fetching logs:', err);
      errorMessage = err.message || 'Failed to fetch logs.';
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
  // Define the keys we expect to sum and round
  const nutrientKeys: (keyof FoodItem)[] = [
    'calories', 'protein', 'fat', 'carbs', 'fibers', 'sugar', 'mufa', 'pufa', 'sfa', 'gl', 'omega3', 'omega6' // Added omega3, omega6
  ];
  // Initialize totals with all expected keys set to 0
  let totals: { [K in keyof FoodItem]?: number } & { count: number } = { count: 0 };
  nutrientKeys.forEach(key => totals[key] = 0);


  function calculateTotals() {
    // Initialize newTotals with all expected keys set to 0 for calculation
    const newTotals: { [K in keyof FoodItem]?: number } & { count: number } = { count: 0 };
     nutrientKeys.forEach(key => newTotals[key] = 0);
    let calculatedCount = 0;

    for (const entry of logEntries) {
      if (selectedLogIds.has(entry.id) && entry.food_items) {
        calculatedCount++;
        const item = entry.food_items;
        const multiplier = entry.multiplier;

        // Helper to safely add numbers (treat null as 0)
        const add = (a: number | null | undefined, b: number | null | undefined) => (a || 0) + (b || 0);

        // Assign results to newTotals, not totals
        newTotals.calories = add(newTotals.calories, (item.calories || 0) * multiplier);
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

    
    // Round the calculated totals for defined keys in newTotals
    for (const key of nutrientKeys) {
        // newTotals[key] is guaranteed to be a number due to initialization and add function
        newTotals[key] = Math.round(newTotals[key]! * 10) / 10; // Round to 1 decimal place
    }
    
    totals = newTotals; // Assign the fully calculated and rounded totals
  }


  // --- Recipe Creation Function ---
  async function createRecipe() {
    if (!recipeName || selectedLogIds.size === 0) return;

    isCreating = true;
    errorMessage = '';
    successMessage = '';

    const selectedEntries = logEntries.filter(entry => selectedLogIds.has(entry.id));

    if (selectedEntries.length === 0) {
        errorMessage = "No valid log entries selected.";
        isCreating = false;
        return;
    }

    // Generate comment string
    const commentLines = selectedEntries.map(entry =>
        `${entry.multiplier} x ${entry.food_items?.serving_qty || 1}${entry.food_items?.serving_unit || 'serving'} ${entry.food_items?.name || '(Unknown Item)'}`
    );
    const comment = `Made from:\n- ${commentLines.join('\n- ')}`;

    // Prepare the new food item data using the already calculated totals
    const newFoodItemData: Omit<FoodItem, 'id' | 'created_at'> = {
        name: recipeName.trim(),
        serving_qty: 1, // Recipe is one serving by definition here
        serving_unit: 'recipe serving',
        calories: totals.calories ?? 0,
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
        const { error } = await supabase
            .from('food_items')
            .insert([newFoodItemData]);

        if (error) throw error;

        successMessage = `Recipe "${recipeName.trim()}" created successfully!`;
        // Reset state
        recipeName = '';
        selectedLogIds.clear();
        selectedLogIds = selectedLogIds; // Trigger reactivity
        calculateTotals(); // Reset totals display

    } catch (err: any) {
        console.error('Error creating recipe:', err);
        errorMessage = `Failed to create recipe: ${err.message}`;
    } finally {
        isCreating = false;
    }
  }

  $: isCreateDisabled = !recipeName || selectedLogIds.size === 0 || isCreating;

</script>

<svelte:head>
  <title>Create Recipe - Eatelligence</title>
</svelte:head>

<div class="container mx-auto p-4 max-w-5xl">
  <!-- Removed test button -->
  <h1 class="text-2xl font-bold mb-4">Create Recipe from Log</h1>

  {#if isLoading}
    <p>Loading log entries...</p>
  {:else if errorMessage && !isLoading} <!-- Show error only if not loading -->
    <p class="text-red-500">{errorMessage}</p>
  {:else}
    <!-- Totals Display - Mimic styling from main page summary -->
    <div class="mb-4 p-4 border rounded bg-gray-100 sticky top-0 z-10">
      <h2 class="text-lg font-semibold mb-2">Selected Items Summary ({totals.count} items)</h2>
      {#if totals.count > 0}
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <!-- Use similar bg/text colors and padding/rounding as main page summary -->
            <span class="bg-blue-200 text-blue-900 px-1.5 py-0.5 rounded-md font-medium">{totals.calories ?? 0} Cal</span>
            <span class="bg-green-200 text-green-900 px-1.5 py-0.5 rounded-md font-medium">{totals.protein ?? 0}, {totals.fat ?? 0}, {totals.carbs ?? 0} <span class="text-green-700 text-[0.65rem]">PFC</span></span>
            <span class="bg-yellow-200 text-yellow-900 px-1.5 py-0.5 rounded-md font-medium">{totals.fibers ?? 0}, {totals.sugar ?? 0} <span class="text-yellow-700 text-[0.65rem]">FiS</span></span>
            <span class="bg-orange-200 text-orange-900 px-1.5 py-0.5 rounded-md font-medium">{totals.mufa ?? 0}, {totals.pufa ?? 0}, {totals.sfa ?? 0} <span class="text-orange-700 text-[0.65rem]">MPS</span></span>
            <span class="bg-purple-200 text-purple-900 px-1.5 py-0.5 rounded-md font-medium">{totals.gl ?? 0} GL</span>
            <span class="bg-teal-200 text-teal-900 px-1.5 py-0.5 rounded-md font-medium">{totals.omega3 ?? 0} O3</span> <!-- Added O3 display -->
            <span class="bg-cyan-200 text-cyan-900 px-1.5 py-0.5 rounded-md font-medium">{totals.omega6 ?? 0} O6</span> <!-- Added O6 display -->
        </div>
      {:else}
        <p class="text-sm text-gray-500">Select log entries below to see totals.</p>
      {/if}
    </div>

    <!-- Recipe Name Input -->
    <div class="mb-4">
      <label for="recipeName" class="block text-sm font-medium mb-1">Recipe Name:</label>
      <input
        type="text"
        id="recipeName"
        bind:value={recipeName}
        class="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        placeholder="Enter name for new recipe"
      />
    </div>

    <div class="mb-4">
      <h2 class="text-lg font-semibold mb-2">Select Log Entries to Include:</h2>
      <ul class="space-y-2">
        {#each logEntries as entry (entry.id)}
          <li> <!-- Remove styling/click from li -->
            <button
              type="button"
              class="w-full text-left p-3 border rounded cursor-pointer transition-colors block"
              class:bg-indigo-100={selectedLogIds.has(entry.id)} 
              class:text-indigo-900={selectedLogIds.has(entry.id)} 
              class:hover:bg-gray-100={!selectedLogIds.has(entry.id)} 
              class:bg-white={!selectedLogIds.has(entry.id)} 
              on:click={() => toggleSelection(entry.id)}
            >
              <!-- Display log entry details nicely -->
              {entry.food_items?.name || '(Deleted Item)'} - {entry.multiplier} x {entry.food_items?.serving_qty || 1}{entry.food_items?.serving_unit || 'serving'}
              <span class="text-xs text-gray-500 block mt-1">Logged: {new Date(entry.logged_at).toLocaleString('sv-SE')}</span>
            </button>
          </li>
        {:else}
          <p>No log entries found.</p>
        {/each}
      </ul>
      <!-- TODO: Add Load More functionality if needed -->
    </div>

    {#if successMessage}
      <p class="text-green-500 mb-4">{successMessage}</p>
    {/if}

    <button
      type="button"
      class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
      on:click={createRecipe}
      disabled={isCreateDisabled}
    >
      {#if isCreating}Creating...{:else}Create Recipe{/if}
    </button>
  {/if}
</div>
