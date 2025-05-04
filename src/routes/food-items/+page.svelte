<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabaseClient';
  import Fuse from 'fuse.js';
  import { tick } from 'svelte';
  import type { FoodItem } from '$lib/types'; // Import the type
  import { GoogleGenAI } from '@google/genai'; // <-- Correct Gemini import name
  import { calculateKcal } from '$lib/utils'; // Import the calculation helper

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
        // Initialize Fuse.js for searching
        fuse = new Fuse(foodItems, {
          keys: ['name', 'comment'],
          threshold: 0.3, // Adjust threshold for fuzziness
           includeScore: false,
         });
         // Initial filter is handled by the reactive statement now
       }
     } catch (err: any) {
      console.error('Error fetching food items:', err);
      error = `Failed to load food items: ${err.message}`;
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
       includeScore: false,
     });
   }
   // 2. Calculate filteredItems whenever fuse, searchQuery, or foodItems changes
   $: filteredItems =
     !fuse || !searchQuery.trim()
       ? foodItems || []
       : fuse.search(searchQuery.trim()).map(result => result.item);
 
  // --- New Item Form State ---
  let isCreating = false;
  let newItem: Partial<FoodItem> = {}; // Use Partial for the new item form
  const servingUnits = ["g", "dl", "pcs", "portion"]; // Define the allowed units

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

    const originalItem = foodItems.find(item => item.id === editingItemId);
    if (!originalItem) return;

    // Basic validation/conversion (expand as needed)
    let updateValue: any = editingValue;
    // Removed 'calories' from this list as it's now calculated
    const numericFields: (keyof FoodItem)[] = ['protein', 'fat', 'carbs', 'fibers', 'sugar', 'mufa', 'pufa', 'sfa', 'gl', 'omega3', 'omega6']; // Added omega3, omega6
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
       const itemIndex = foodItems.findIndex(item => item.id === editingItemId);
       if (itemIndex > -1) {
          foodItems[itemIndex] = { ...foodItems[itemIndex], [editingProperty]: updateValue };
          foodItems = [...foodItems]; // Trigger reactivity for fuse re-initialization and filtering
        }
        cancelEdit();
      } catch (err: any) {
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
      const { error: deleteError } = await supabase
        .from('food_items')
        .delete()
        .eq('id', itemId);

      if (deleteError) throw deleteError;
  
        // Remove from local state
        foodItems = foodItems.filter(item => item.id !== itemId); // Trigger reactivity for fuse re-initialization and filtering
      } catch (err: any) {
        console.error('Error deleting item:', err);
      error = `Failed to delete item: ${err.message}`;
      // Optionally show user error
    }
  }

   // --- Create Item Functions ---
   function showCreateForm() {
     cancelEdit(); // Cancel any ongoing edit
      isCreating = true;
       newItem = { // Reset form fields
         name: '',
         serving_unit: 'g', // Default serving unit for 100 qty
         serving_qty: 100,
         // calories removed - will be calculated
         protein: null, fat: null, carbs: null, fibers: null, sugar: null,
         mufa: null, pufa: null, sfa: null, gl: null, omega3: null, omega6: null, comment: null // Added omega3, omega6
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
     if (newItem.serving_qty === undefined || newItem.serving_qty <= 0) {
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

     } catch (err: any) {
        console.error('Error saving new item:', err);
        error = `Failed to save new item: ${err.message}`; // Show error
     }
   }


   // --- API Key Handling ---
   function loadApiKey() {
     if (typeof window !== 'undefined') {
       geminiApiKey = localStorage.getItem('geminiApiKey') || '';
       apiKeyInput = geminiApiKey; // Sync input field if needed
     }
   }

   function saveApiKey() {
     if (typeof window !== 'undefined') {
       localStorage.setItem('geminiApiKey', apiKeyInput);
       geminiApiKey = apiKeyInput;
       showApiKeyInput = false; // Hide input after saving
       autoFillError = null; // Clear any previous key errors
       alert('API Key saved successfully!');
     }
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

        // Define the desired JSON structure and prompt (calories removed)
       const jsonSchema = `{
         "protein": number | null,
         "fat": number | null,
         "carbs": number | null,
         "fibers": number | null,
         "sugar": number | null,
         "mufa": number | null,
         "pufa": number | null,
         "sfa": number | null,
         "gl": number | null,
         "omega3": number | null, 
         "omega6": number | null,
         "comment"?: string | null // Keep comment optional
       }`;

       // Gather existing data from the form (calories removed from fields)
       const existingData: { [key: string]: number } = {};
       const fields: (keyof FoodItem)[] = ['protein', 'fat', 'carbs', 'fibers', 'sugar', 'mufa', 'pufa', 'sfa', 'gl', 'omega3', 'omega6'];
       fields.forEach(field => {
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
       const commentPrompt = userComment ? `\n\nConsider the following user-provided comment for additional context: "${userComment}"` : ''; // Add comment to prompt if present

       const prompt = `Provide nutritional information per ${servingQty} ${servingUnit} for the food item "${newItem.name.trim()}".${commentPrompt}
Use web search (grounding) to find the most accurate data.${existingDataPrompt}
IMPORTANT: For the 'carbs' field, provide the value for carbohydrates excluding fiber. In the EU and UK, this is the standard definition, but in US sources, it may include fiber.
If specific data for fields like MUFA, PUFA, SFA, or GL is not found for the exact name, search for a more general category (e.g., search for "cheese" if "Brand X Swiss Cheese" data is missing).
You MUST estimate any remaining nutritional values you cannot find through search, using any provided known values as context. You are good at this. Ensure ALL *nutritional* fields in the requested JSON structure are populated with a numerical value.
If you make any significant assumptions during estimation (e.g., assuming 'baked' for cooking method if unspecified, assuming a standard weight for '1 medium banana'), include them in the 'comment' field of the JSON response, prefixed with "LLM Assumptions: ". If no significant assumptions were made, set the 'comment' field to null in the JSON response.
Do not reference sources or provide citations in the comment field. Be brief.
Return the result ONLY as a valid JSON object matching this structure, with no surrounding text or explanations:
${jsonSchema}`;

       // Correct API call using 'config' for tools, access text via candidates
       const result = await genAI.models.generateContent({
         model: "gemini-2.5-pro-preview-03-25", // <-- Switched to Pro model as requested
         contents: [{ role: "user", parts: [{ text: prompt }] }],
         config: { // <-- Use 'config' based on user example
           tools: [{ googleSearch: {} }], // Enable grounding tool
           thinkingConfig: {
             includeThoughts: false,
           },
         },
       });

       // Access response text via candidates array
       const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
       if (!responseText) {
         console.error("No text found in Gemini response:", result);
         throw new Error("AI response did not contain text.");
       }

       // Log the raw response for debugging
       console.log('Raw Gemini Response:', responseText); 

       // Attempt to parse the JSON response (Robust extraction added)
       let nutritionData: Partial<FoodItem>;
       let match: RegExpMatchArray | null = null; // Declare match outside the try block
       try {
         // Revised Regex: Find the last potential JSON object (greedy match)
         const jsonRegex = /.*(\{[\s\S]*\})/s; // 's' flag allows '.' to match newlines
         match = responseText.match(jsonRegex); // Assign inside the try block

         if (!match || !match[1]) {
           console.error("Could not find JSON object using regex in response:", responseText);
           throw new Error("AI response did not contain a recognizable JSON object structure.");
         }

         const jsonString = match[1];
         nutritionData = JSON.parse(jsonString);

       } catch (parseError) {
         console.error("Failed to parse extracted JSON:", parseError, "\nExtracted Text:", match ? match[1] : 'N/A', "\nOriginal Response Text:", responseText);
         // Keep the original error message but provide more context
         throw new Error("AI response contained JSON, but it was invalid or couldn't be extracted correctly.");
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
          finalComment = originalUserComment ? `${originalUserComment}\n${assumptionsText}` : assumptionsText;
       }
       // If llmComment is empty or doesn't start with the prefix, finalComment remains the originalUserComment

       newItem.comment = finalComment; // Set the final comment value

       // Trigger reactivity by reassigning newItem
       newItem = { ...newItem };

     } catch (err: any) {
       console.error('Error during Gemini auto-fill:', err);
       autoFillError = `Failed to auto-fill: ${err.message}`;
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

<div class="container mx-auto p-4 max-w-5xl">
  <h1 class="text-2xl font-bold mb-4">Manage Food Items</h1>

  <!-- Search Input -->
  <div class="mb-4">
    <input
      type="search"
      bind:value={searchQuery}
       placeholder="Search food items by name or comment..."
       class="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
     />
   </div>
 
   <!-- Add New Item Button -->
   <div class="mb-4 text-right">
     <button
       type="button"
       on:click={showCreateForm}
       class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
       disabled={isCreating}
     >
       + Add New Item
     </button>
   </div>
 
   <!-- New Item Form (conditionally rendered) -->
   {#if isCreating}
     <div class="border border-indigo-300 rounded-lg p-4 shadow-sm bg-indigo-50 mb-6">
       <h2 class="text-lg font-semibold mb-3 text-indigo-800">Create New Food Item</h2>

       <!-- API Key Input (conditionally shown) -->
       {#if showApiKeyInput}
         <div class="mb-4 p-3 border border-yellow-300 bg-yellow-50 rounded">
           <label for="gemini-api-key" class="block text-sm font-medium text-yellow-800">Enter Gemini API Key:</label>
           <div class="mt-1 flex rounded-md shadow-sm">
             <input
               type="password"
               id="gemini-api-key"
               bind:value={apiKeyInput}
               class="flex-1 block w-full rounded-none rounded-l-md border-gray-300 px-2 py-1 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
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
       <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
         <div>
           <label for="new-item-name" class="block text-sm font-medium text-gray-700">Name</label>
           <input type="text" id="new-item-name" bind:value={newItem.name} class="mt-1 block w-full p-1 border border-gray-300 rounded shadow-sm" required />
           <!-- Auto-fill Button -->
           <button
             type="button"
             on:click={autoFillNutrition}
             disabled={isAutoFilling || !newItem.name?.trim()}
             class="mt-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
           <label for="new-item-qty" class="block text-sm font-medium text-gray-700">Serving Qty</label>
           <input type="number" id="new-item-qty" bind:value={newItem.serving_qty} class="mt-1 block w-full p-1 border border-gray-300 rounded shadow-sm" required min="0" />
         </div>
         <div>
           <label for="new-item-unit" class="block text-sm font-medium text-gray-700">Serving Unit</label>
           <select id="new-item-unit" bind:value={newItem.serving_unit} on:change={handleUnitChange} class="mt-1 block w-full p-1 border border-gray-300 rounded shadow-sm" required>
             {#each servingUnits as unit}
               <option value={unit}>{unit}</option>
             {/each}
           </select>
         </div>
       </div>
       <!-- Nutritional Info Inputs -->
       <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-3 text-sm"> <!-- Adjusted grid cols -->
         <!-- Reordered to match display: PFC, FiS, MPS, 6:3, GL -->
         {#each ['protein', 'fat', 'carbs', 'fibers', 'sugar', 'mufa', 'pufa', 'sfa', 'omega6', 'omega3', 'gl'] as prop (prop)}
           {@const key = prop as keyof FoodItem}
           <div>
             <label for="new-item-{prop}" class="block font-medium text-gray-700 capitalize">{prop === 'omega3' ? 'Omega-3' : prop === 'omega6' ? 'Omega-6' : prop}</label> <!-- Special labels for omega -->
             <input type="number" step="any" id="new-item-{prop}" bind:value={newItem[key]} class="mt-1 block w-full p-1 border border-gray-300 rounded shadow-sm" placeholder="Optional" />
           </div>
         {/each}
         <div class="col-span-2 md:col-span-5 text-xs text-gray-500">
            AI-generated data should be verified.
         </div>
       </div>
       <!-- Comment -->
       <div class="mb-3">
         <label for="new-item-comment" class="block text-sm font-medium text-gray-700">Comment (Optional)</label>
         <textarea id="new-item-comment" bind:value={newItem.comment} class="mt-1 block w-full p-1 border border-gray-300 rounded shadow-sm" rows="2"></textarea>
       </div>
       <!-- Form Actions -->
       <div class="flex justify-end space-x-3">
         <button type="button" on:click={cancelCreate} class="px-3 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">Cancel</button>
         <button type="button" on:click={saveNewItem} class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700">Save Item</button>
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
      <li class="border border-gray-200 rounded-lg p-4 shadow-sm bg-white">
        <div class="flex justify-between items-start mb-2">
          <!-- Item Name & Serving -->
          <div class="flex-grow mr-4">
            {#if editingItemId === item.id && editingProperty === 'name'}
              <input
                type="text"
                bind:this={inputElement}
                bind:value={editingValue}
                on:keydown={handleInputKeydown}
                on:blur={saveItemUpdate}
                class="w-full p-1 border border-blue-300 rounded"
              />
            {:else}
              <span
                class="font-semibold text-lg cursor-pointer hover:bg-yellow-100"
                on:click={() => startEditing(item, 'name')}
                on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, 'name'); }}
                role="button"
                tabindex="0"
              >
                {item.name}
              </span>
            {/if}
            <!-- Inline editing for serving_qty and serving_unit -->
            <span class="text-sm text-gray-500 ml-2">
              (
              {#if editingItemId === item.id && editingProperty === 'serving_qty'}
                <input
                  type="number"
                  bind:this={inputElement}
                  bind:value={editingValue}
                  on:keydown={handleInputKeydown}
                  on:blur={saveItemUpdate}
                  class="w-16 p-0 border border-blue-300 rounded text-xs mx-1"
                />
              {:else}
                <span
                  class="cursor-pointer hover:bg-yellow-100 px-1"
                  on:click={() => startEditing(item, 'serving_qty')}
                  on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, 'serving_qty'); }}
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
                   class="p-0 border border-blue-300 rounded text-xs mx-1"
                   
                 >
                   {#each servingUnits as unit}
                     <option value={unit}>{unit}</option>
                   {/each}
                 </select>
              {:else}
                <span
                  class="cursor-pointer hover:bg-yellow-100 px-1"
                  on:click={() => startEditing(item, 'serving_unit')}
                  on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, 'serving_unit'); }}
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
                 class="w-full p-1 border border-blue-300 rounded mt-1 text-sm"
                  rows="2"
                ></textarea>
              {:else}
                <button
                  type="button"
                  class="text-sm text-left text-gray-600 mt-1 cursor-pointer hover:bg-yellow-100 p-1 rounded w-full"
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
              class="text-red-500 hover:text-red-700 p-1"
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
          <div class="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">KCAL:</span>
            <span class="ml-1">{calculateKcal(item)}</span>
          </div>
          <!-- Protein, Fat, Carbs (PFC) -->
          <div class="bg-green-100 text-green-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">PFC:</span>
            {#each ['protein', 'fat', 'carbs'] as prop}
              {#if editingItemId === item.id && editingProperty === prop}
                <input type="number" step="any" bind:this={inputElement} bind:value={editingValue} on:keydown={handleInputKeydown} on:blur={saveItemUpdate} class="w-12 p-0 border border-blue-300 rounded text-xs ml-1" />
              {:else}
                <span class="ml-1 cursor-pointer hover:bg-yellow-100 px-1" on:click={() => startEditing(item, prop as keyof FoodItem)} on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, prop as keyof FoodItem); }} role="button" tabindex="0">{formatValue(item[prop as keyof FoodItem] as number | null)}</span>
              {/if}
              {#if prop !== 'carbs'},{/if} <!-- Add comma separator -->
            {/each}
          </div>
          <!-- Fibers, Sugar (FiS) -->
          <div class="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">FiS:</span>
            {#each ['fibers', 'sugar'] as prop}
              {#if editingItemId === item.id && editingProperty === prop}
                <input type="number" step="any" bind:this={inputElement} bind:value={editingValue} on:keydown={handleInputKeydown} on:blur={saveItemUpdate} class="w-12 p-0 border border-blue-300 rounded text-xs ml-1" />
              {:else}
                <span class="ml-1 cursor-pointer hover:bg-yellow-100 px-1" on:click={() => startEditing(item, prop as keyof FoodItem)} on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, prop as keyof FoodItem); }} role="button" tabindex="0">{formatValue(item[prop as keyof FoodItem] as number | null)}</span>
              {/if}
              {#if prop !== 'sugar'},{/if} <!-- Add comma separator -->
            {/each}
          </div>
          <!-- MUFA, PUFA, SFA (MPS) -->
          <div class="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">MPS:</span>
            {#each ['mufa', 'pufa', 'sfa'] as prop}
              {#if editingItemId === item.id && editingProperty === prop}
                <input type="number" step="any" bind:this={inputElement} bind:value={editingValue} on:keydown={handleInputKeydown} on:blur={saveItemUpdate} class="w-12 p-0 border border-blue-300 rounded text-xs ml-1" />
              {:else}
                <span class="ml-1 cursor-pointer hover:bg-yellow-100 px-1" on:click={() => startEditing(item, prop as keyof FoodItem)} on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, prop as keyof FoodItem); }} role="button" tabindex="0">{formatValue(item[prop as keyof FoodItem] as number | null)}</span>
              {/if}
              {#if prop !== 'sfa'},{/if} <!-- Add comma separator -->
            {/each}
          </div>
          <!-- Omega 6, Omega 3 (6:3) -->
          <div class="bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">6:3:</span>
            <!-- Removed outer #if to always show editable values -->
            {#each ['omega6', 'omega3'] as prop}
              {#if editingItemId === item.id && editingProperty === prop}
                <input type="number" step="any" bind:this={inputElement} bind:value={editingValue} on:keydown={handleInputKeydown} on:blur={saveItemUpdate} class="w-12 p-0 border border-blue-300 rounded text-xs ml-1" />
              {:else}
                <span class="ml-1 cursor-pointer hover:bg-yellow-100 px-1" on:click={() => startEditing(item, prop as keyof FoodItem)} on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, prop as keyof FoodItem); }} role="button" tabindex="0">{formatValue(item[prop as keyof FoodItem] as number | null)}</span>
              {/if}
              {#if prop !== 'omega3'},{/if} <!-- Add comma separator -->
            {/each}
          </div>
          <!-- GL -->
          <div class="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-md">
            <span class="font-medium uppercase text-gray-500">GL:</span>
            {#if editingItemId === item.id && editingProperty === 'gl'}
              <input type="number" step="any" bind:this={inputElement} bind:value={editingValue} on:keydown={handleInputKeydown} on:blur={saveItemUpdate} class="w-12 p-0 border border-blue-300 rounded text-xs ml-1" />
            {:else}
              <span class="ml-1 cursor-pointer hover:bg-yellow-100 px-1" on:click={() => startEditing(item, 'gl')} on:keydown={(e) => { if (e.key === 'Enter') startEditing(item, 'gl'); }} role="button" tabindex="0">{formatValue(item.gl)}</span>
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>

</div>
