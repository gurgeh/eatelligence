<script lang="ts">
  import { supabase } from '$lib/supabaseClient';
  import type { FoodItem } from '$lib/types';
  import { onMount, tick } from 'svelte'; // Import tick
  import { GoogleGenAI } from '@google/genai'; // Import Gemini
  import { calculateKcal, ratio } from '$lib/utils'; // Import calculation helper AND ratio
  import Fuse, { type FuseResult } from 'fuse.js'; // Import FuseResult type

  // Simple assertion function
  function assert(condition: any, message: string): asserts condition {
    if (!condition) {
      throw new Error(message);
    }
  }

  type ExistingItemInfo = {
    id: number;
    name: string;
    serving_qty: number | null;
    serving_unit: string | null;
    // Add fields needed for Fuse search keys if expanding later
    // protein?: number | null; fat?: number | null; carbs?: number | null; fibers?: number | null; sugar?: number | null; mufa?: number | null; pufa?: number | null; sfa?: number | null; gl?: number | null; omega3?: number | null; omega6?: number | null; comment?: string | null;
  };

  let recipeName = '';
  let userComment = '';
  let allFoodItems: ExistingItemInfo[] = []; // Store all items fetched on mount
  let fuse: Fuse<ExistingItemInfo>; // Fuse instance for searching all items

  // Update ingredient structure to include status and potentially editable fields
  type GeneratedIngredient = {
    name?: string; // For new items (before processing OR manually added new)
    quantity?: number; // For new items (before processing OR manually added new) - Original/Editable quantity
    unit?: 'g' | 'dl' | 'pcs' | 'portion'; // For new items (before processing OR manually added new) - Original/Editable unit (Allow all units)
    id?: number; // For matched items OR new items after insertion
    multiplier?: number; // For matched items OR new items after processing OR manually added existing
    matchedName?: string; // Display name for matched items
    serving_qty?: number | null; // Standard/Original serving qty (used for display and multiplier calculation)
    serving_unit?: string | null; // Standard/Original serving unit (used for display)
    status: 'idle' | 'processing' | 'done' | 'error';
    errorMsg?: string;
    isManuallyAdded?: boolean; // Flag to differentiate origin of new items
    // Store fetched/calculated nutrition for final sum
    nutrition?: Omit<FoodItem, 'id' | 'name' | 'comment' | 'serving_qty' | 'serving_unit' | 'created_at'> | null;
  };
  let generatedIngredients: GeneratedIngredient[] = [];
  let isLoadingList = false;
  let isLoadingRecipe = false; // Used for LLM list gen, processing, and saving
  let isFetchingExisting = false; // Separate flag for fetching existing item details
  // --- Manual Add State ---
  let manualAddSearchTerm = '';
  let manualAddSearchResults: FuseResult<ExistingItemInfo>[] = []; // Use imported FuseResult type
  let showManualAddResults = false;

  // --- Recipe Totals State ---
  // Define the keys we expect to sum and round (calories removed)
  const nutrientKeys: (keyof Omit<FoodItem, 'id' | 'name' | 'serving_unit' | 'serving_qty' | 'comment' | 'created_at'>)[] = [
    'protein', 'fat', 'carbs', 'fibers', 'sugar', 'mufa', 'pufa', 'sfa', 'gl', 'omega3', 'omega6'
  ];
  // Initialize totals with all expected keys set to 0, plus count and ratio
  let recipeTotals: { [K in typeof nutrientKeys[number]]?: number } & { count: number; ratio?: string } = { count: 0 };
  nutrientKeys.forEach(key => recipeTotals[key] = 0);


  let errorMessage = '';
  let successMessage = '';

   // --- Reactive State ---
   $: hasUnprocessedNewItems = generatedIngredients.some(ing => !ing.id && ing.status === 'idle');
   $: canCreateRecipe = generatedIngredients.length > 0 && !generatedIngredients.some(ing => ing.status !== 'done');


  // --- Gemini API State ---
  let geminiApiKey = '';
  let showApiKeyInput = false; // Control visibility of API key input
  let apiKeyInput = ''; // Temporary input for the API key field

  // --- Calculate Recipe Totals Function ---
  function calculateRecipeTotals() {
      // Initialize newTotals with all expected keys set to 0 for calculation
      const newTotals: { [K in typeof nutrientKeys[number]]?: number } & { count: number } = { count: 0 };
      nutrientKeys.forEach(key => newTotals[key] = 0);
      let calculatedCount = 0;

      for (const ingredient of generatedIngredients) {
          // Only include items that have been successfully processed
          if (ingredient.status === 'done' && ingredient.nutrition) {
              calculatedCount++;
              const nutrition = ingredient.nutrition;
              const multiplier = ingredient.multiplier ?? 1;

              // Helper to safely add numbers (treat null as 0)
              const add = (a: number | null | undefined, b: number | null | undefined) => (a || 0) + (b || 0);

              // Sum nutrients
              newTotals.protein = add(newTotals.protein, (nutrition.protein || 0) * multiplier);
              newTotals.fat = add(newTotals.fat, (nutrition.fat || 0) * multiplier);
              newTotals.carbs = add(newTotals.carbs, (nutrition.carbs || 0) * multiplier);
              newTotals.fibers = add(newTotals.fibers, (nutrition.fibers || 0) * multiplier);
              newTotals.sugar = add(newTotals.sugar, (nutrition.sugar || 0) * multiplier);
              newTotals.mufa = add(newTotals.mufa, (nutrition.mufa || 0) * multiplier);
              newTotals.pufa = add(newTotals.pufa, (nutrition.pufa || 0) * multiplier);
              newTotals.sfa = add(newTotals.sfa, (nutrition.sfa || 0) * multiplier);
              newTotals.gl = add(newTotals.gl, (nutrition.gl || 0) * multiplier);
              newTotals.omega3 = add(newTotals.omega3, (nutrition.omega3 || 0) * multiplier);
              newTotals.omega6 = add(newTotals.omega6, (nutrition.omega6 || 0) * multiplier);
          }
      }
      newTotals.count = calculatedCount;

      // Round the calculated totals for defined keys
      for (const key of nutrientKeys) {
          newTotals[key] = Math.round(newTotals[key]!);
      }

      // Calculate ratio
      // Calculate ratio using the new utility function
      const calculatedRatio = ratio(newTotals.omega6, newTotals.omega3); // Use the imported ratio function

      // Assign the calculated ratio (string | undefined)
      (newTotals as any).ratio = calculatedRatio; // Keep 'any' cast as type wasn't updated

      recipeTotals = newTotals; // Assign the final totals to the state variable
  }

  // --- Lifecycle ---
  onMount(async () => {
    loadApiKey(); // Load API key on mount
    await fetchAllFoodItems(); // Fetch all items for manual search
  });

  // --- Fetch All Food Items for Manual Search ---
  async function fetchAllFoodItems() {
    isFetchingExisting = true;
    errorMessage = ''; // Clear previous errors
    try {
      const { data, error } = await supabase
        .from('food_items')
        .select('id, name, serving_qty, serving_unit'); // Only fetch needed fields initially

      if (error) throw error;
      allFoodItems = data || [];

      // Initialize Fuse.js for searching
      fuse = new Fuse(allFoodItems, {
        keys: ['name'], // Search only by name for simplicity now
        includeScore: true,
        threshold: 0.4 // Adjust threshold as needed
      });

    } catch (err: any) {
      errorMessage = `Error fetching food items: ${err.message}`;
      console.error(err);
    } finally {
      isFetchingExisting = false;
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
       errorMessage = ''; // Clear any previous key errors
       alert('API Key saved successfully!');
     }
   }

  async function generateIngredientList() {
    isLoadingList = true;
    errorMessage = '';
    successMessage = '';
    generatedIngredients = [];
    calculateRecipeTotals(); // Reset totals display

    try {
      // 1. Check for API Key (Moved check earlier)
      if (!geminiApiKey) {
        errorMessage = 'Gemini API Key is missing. Please enter and save it below.';
        showApiKeyInput = true;
        isLoadingList = false;
        return;
      }

      // 2. Construct Prompt 1 (Use allFoodItems fetched onMount)
      const existingItemsString = allFoodItems
        .map(item => `ID: ${item.id}, Name: ${item.name}, Serving: ${item.serving_qty || 'N/A'} ${item.serving_unit || ''}`)
        .join('\n');

      const jsonSchema = `[
        { "name": string, "quantity": number, "unit": "g" | "dl" }, // For new items
        { "id": number, "multiplier": number } // For matched existing items
      ]`;

      const prompt = `Given the recipe name "${recipeName}" ${userComment ? `and comment "${userComment}"` : ''}, identify the main ingredients and their quantities (in grams 'g' or deciliters 'dl').
Focus *only* on ingredients that significantly contribute to the recipe's total calories and macronutrient profile (protein, fat, carbohydrates). Exclude small amounts of herbs, spices, flavorings (like garlic, salt, pepper, small amounts of chili), water, and other non-caloric or very low-calorie items.
Compare these ingredients against the following list of existing food items:
--- EXISTING ITEMS ---
${existingItemsString}
--- END EXISTING ITEMS ---

If an ingredient closely matches an existing item by name, use its ID and estimate a multiplier relative to its defined serving size.
If an ingredient does not match, provide its name (use simple, common names like "Flour" instead of specific types which are almost the same), quantity, and unit ('g' or 'dl'). Prioritize 'g' for solids and 'dl' for liquids where appropriate.

Return the result ONLY as a valid JSON array matching this structure, with no surrounding text or explanations:
${jsonSchema}`;

      // 3. Call Gemini API
      const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
      const result = await genAI.models.generateContent({
         model: "gemini-2.5-pro-preview-03-25",
         contents: [{ role: "user", parts: [{ text: prompt }] }],
         // config: { // Grounding disabled for this call
         //   tools: [{ googleSearch: {} }],
         //   thinkingConfig: { includeThoughts: false },
         // },
       });

      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!responseText) {
        throw new Error("AI response did not contain text.");
      }
      console.log('Raw Gemini Response (List):', responseText);

      // 4. Parse JSON Response
      let parsedIngredients: any[];
      try {
        const jsonRegex = /.*(\[[\s\S]*\])/s; // Find last potential JSON array
        const match = responseText.match(jsonRegex);
        if (!match || !match[1]) {
          throw new Error("AI response did not contain a recognizable JSON array structure.");
        }
        parsedIngredients = JSON.parse(match[1]);
      } catch (parseError) {
        console.error("Failed to parse extracted JSON:", parseError, "\nOriginal Response Text:", responseText);
        throw new Error("AI response contained JSON, but it was invalid or couldn't be extracted correctly.");
      }

      // 5. Map LLM response to internal structure (using allFoodItems for lookup)
      const finalIngredients: GeneratedIngredient[] = [];
      for (const ingredient of parsedIngredients) {
        if (ingredient.id) {
          const matchedItem = allFoodItems.find(item => item.id === ingredient.id); // Use allFoodItems
          finalIngredients.push({
            id: ingredient.id,
            multiplier: ingredient.multiplier, // Keep LLM multiplier for now, will be editable
            matchedName: matchedItem ? matchedItem.name : `Unknown Item (ID: ${ingredient.id})`,
            serving_qty: matchedItem ? matchedItem.serving_qty : null,
            serving_unit: matchedItem ? matchedItem.serving_unit : null,
            status: 'idle', // Will fetch nutrition later if needed or when processed
            nutrition: null
          });
        } else {
          // Ensure new items have the correct structure and calculate multiplier
          const llmQuantity = ingredient.quantity;
          const llmUnit = ingredient.unit;
          // Determine standard size for nutrition fetching later
          const standardUnit = llmUnit === 'dl' ? 'dl' : 'g';
          const standardQty = standardUnit === 'dl' ? 1 : 100;
          // Calculate multiplier based on LLM quantity vs standard quantity
          const calculatedMultiplier = llmQuantity / standardQty;

          finalIngredients.push({
             name: ingredient.name,
             quantity: llmQuantity, // Store original LLM quantity for display/retry
             unit: llmUnit,         // Store original LLM unit for display/retry
             multiplier: calculatedMultiplier, // Store calculated multiplier
             status: 'idle',
             isManuallyAdded: false, // Mark as not manually added
             nutrition: null,
             // Store the standard serving size used for multiplier calc, might be useful later?
             // serving_qty: standardQty,
             // serving_unit: standardUnit
          });
        }
      }

      generatedIngredients = finalIngredients;
      calculateRecipeTotals(); // Calculate totals after initial list generation

    } catch (err: any) {
       // Handle potential API key errors specifically
       if (err.message?.includes('API key not valid')) {
         errorMessage = 'Gemini API Key is invalid. Please check and save it again.';
         showApiKeyInput = true;
       } else {
         errorMessage = `Error generating list: ${err.message}`;
       }
      console.error(err);
    } finally {
      isLoadingList = false;
    }
  }

  function deleteIngredient(index: number) {
    generatedIngredients.splice(index, 1);
    generatedIngredients = generatedIngredients; // Trigger reactivity
    calculateRecipeTotals(); // Recalculate totals after deletion
  }

  // --- Manual Add Functions ---
  function handleSearchInput() {
    if (manualAddSearchTerm.trim() === '') {
      manualAddSearchResults = [];
      showManualAddResults = false;
      return;
    }
    // Ensure fuse is initialized before searching
    if (fuse) {
      manualAddSearchResults = fuse.search(manualAddSearchTerm.trim());
    } else {
      manualAddSearchResults = []; // Handle case where fuse might not be ready
    }
    showManualAddResults = true;
  }

  async function addExistingIngredient(itemInfo: ExistingItemInfo) {
    manualAddSearchTerm = ''; // Clear search
    manualAddSearchResults = [];
    showManualAddResults = false;
    isFetchingExisting = true; // Show loading indicator while fetching details
    errorMessage = '';

    try {
      // Fetch full nutrition details for the selected item
      const { data: fullItem, error: fetchError } = await supabase
        .from('food_items')
        .select('*') // Select all columns for nutrition
        .eq('id', itemInfo.id)
        .single();

      if (fetchError) throw fetchError;
      if (!fullItem) throw new Error(`Details not found for item ID ${itemInfo.id}`);

      // Add to the list with status 'done' and multiplier 1
      generatedIngredients = [
        ...generatedIngredients,
        {
          id: fullItem.id,
          multiplier: 1, // Default multiplier
          matchedName: fullItem.name,
          serving_qty: fullItem.serving_qty,
          serving_unit: fullItem.serving_unit,
          status: 'done',
          nutrition: { // Extract nutrition fields
            protein: fullItem.protein, fat: fullItem.fat, carbs: fullItem.carbs,
            fibers: fullItem.fibers, sugar: fullItem.sugar, mufa: fullItem.mufa,
            pufa: fullItem.pufa, sfa: fullItem.sfa, gl: fullItem.gl,
            omega3: fullItem.omega3, omega6: fullItem.omega6
          }
        }
      ];
      calculateRecipeTotals(); // Update totals

    } catch (err: any) {
      errorMessage = `Error adding existing item: ${err.message}`;
      console.error(err);
    } finally {
      isFetchingExisting = false;
    }
  }

  function addNewIngredient(name: string) {
    manualAddSearchTerm = ''; // Clear search
    manualAddSearchResults = [];
    showManualAddResults = false;

    // Add new item with default 100g and status 'idle'
    generatedIngredients = [
      ...generatedIngredients,
      {
        name: name.trim(),
        quantity: 100, // Default quantity
        unit: 'g',     // Default unit
        status: 'idle',
        isManuallyAdded: true, // Mark as manually added
        nutrition: null
      }
    ];
    // No need to calculate totals here, as it adds 0 until processed
    // calculateRecipeTotals();
  }

  // --- Handle Edits in List ---
  function handleIngredientEdit() {
    // Simply recalculate totals. The bind:value handles state update.
    // Use tick to ensure calculation happens after Svelte updates the DOM/state
    tick().then(calculateRecipeTotals);
  }


  // --- Step B Function: Process New Ingredients ---
  async function processNewIngredients() {
     // Only process items that are new AND idle
     const newIngredientJobs = generatedIngredients
       .map((ingredient, originalIndex) => ({ ingredient, originalIndex }))
       .filter(({ ingredient }) => !ingredient.id && ingredient.status === 'idle');

     // If no new items to process, check if we need to fetch existing item nutrition
     if (newIngredientJobs.length === 0) {
       await fetchNutritionForExistingIdleItems(); // Call the separated fetch logic
       // Check if *all* items are done after potentially fetching existing ones
       if (generatedIngredients.every(ing => ing.status === 'done')) {
          successMessage = "All ingredients ready."; // Update success message
       }
       return; // Exit processing early
     }

    isLoadingRecipe = true; // Indicate processing is happening
    errorMessage = '';
    successMessage = '';

    // Ensure API key exists before proceeding
    if (!geminiApiKey) {
      errorMessage = 'Gemini API Key is missing. Please enter and save it below.';
      showApiKeyInput = true;
      isLoadingRecipe = false;
      return;
    }

    const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

    try {
      // Step B: Process New Ingredients in Parallel (using the filtered newIngredientJobs)

      const processingPromises = newIngredientJobs.map(async ({ ingredient, originalIndex }) => {
          // Update status immediately for UI feedback using the original index
          // Ensure we are updating the correct object in the main array
          const targetIngredient = generatedIngredients[originalIndex];
          if (targetIngredient) {
              targetIngredient.status = 'processing';
          }
          // generatedIngredients[originalIndex].status = 'processing'; // This might modify a stale object if array ref changed
          generatedIngredients = [...generatedIngredients]; // Trigger reactivity early

          // Use the potentially edited quantity and unit from the ingredient object
          const { name, quantity, unit } = ingredient;
          if (!name || quantity === undefined || quantity === null || !unit) {
             // Throw rejection data, including the originalIndex
             throw { originalIndex, reason: `Missing data (name, quantity, or unit) for ingredient at original index ${originalIndex}` };
          }

          try {
            // Determine standard size and calculate multiplier based on potentially edited values
            const standardUnit = unit === 'dl' ? 'dl' : (unit === 'pcs' ? 'pcs' : (unit === 'portion' ? 'portion' : 'g')); // Handle pcs/portion too, default g
            const standardQty = standardUnit === 'dl' ? 1 : (standardUnit === 'pcs' ? 1 : (standardUnit === 'portion' ? 1 : 100)); // 1 for dl/pcs/portion, 100 for g
            const multiplier = quantity / standardQty;

            const jsonSchema = `{
              "protein": number | null, "fat": number | null, "carbs": number | null,
              "fibers": number | null, "sugar": number | null, "mufa": number | null,
              "pufa": number | null, "sfa": number | null, "gl": number | null,
              "omega3": number | null, "omega6": number | null, "comment"?: string | null
            }`;
            const prompt = `Provide nutritional information per ${standardQty} ${standardUnit} for the food item "${name}". For 'carbs', report carbohydrates excluding fiber. If sources do not provide a value, you MUST estimate it from best guess. If assumptions are needed, include only the most important ones in the 'comment' field prefixed with "Assumptions: ". Be brief. Do not include source references or citations. Return only a valid JSON object matching this structure:\n${jsonSchema}`;

            // Call Gemini for nutrition
            const result = await genAI.models.generateContent({
              model: "gemini-2.5-pro-preview-03-25",
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              config: { tools: [{ googleSearch: {} }], thinkingConfig: { includeThoughts: false } },
            });
            const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (!responseText) throw new Error("AI response for nutrition did not contain text.");

            // Parse nutrition JSON
            let nutritionData: Partial<FoodItem>;
            const jsonRegex = /.*(\{[\s\S]*\})/s;
            const match = responseText.match(jsonRegex);
            if (!match || !match[1]) throw new Error("AI nutrition response JSON structure not found.");
            try {
               nutritionData = JSON.parse(match[1]);
            } catch (parseError) {
             console.error("Failed to parse nutrition JSON:", parseError, "\nOriginal Response:", responseText);
             throw new Error("AI nutrition response JSON invalid.");
           }

           // --- VALIDATION ---
           // Ensure omega values are numbers as expected from the prompt/schema
           assert(
             typeof nutritionData.omega6 === 'number' || nutritionData.omega6 === null,
             `Omega 6 from AI must be a number or null, got type: ${typeof nutritionData.omega6}, value: ${nutritionData.omega6}`
           );
            assert(
             typeof nutritionData.omega3 === 'number' || nutritionData.omega3 === null,
             `Omega 3 from AI must be a number or null, got type: ${typeof nutritionData.omega3}, value: ${nutritionData.omega3}`
           );
           // --- END VALIDATION ---


           // Prepare item for DB insert
           const itemToInsert = {
             name: name,
              serving_qty: standardQty,
              serving_unit: standardUnit,
              protein: nutritionData.protein ?? null, fat: nutritionData.fat ?? null, carbs: nutritionData.carbs ?? null,
              fibers: nutritionData.fibers ?? null, sugar: nutritionData.sugar ?? null, mufa: nutritionData.mufa ?? null,
              pufa: nutritionData.pufa ?? null, sfa: nutritionData.sfa ?? null, gl: nutritionData.gl ?? null,
              omega3: nutritionData.omega3 ?? null, omega6: nutritionData.omega6 ?? null,
              comment: nutritionData.comment?.trim() || null
            };

            // Insert into DB
            const { data: insertedData, error: insertError } = await supabase
              .from('food_items')
              .insert([itemToInsert])
              .select('id')
              .single();

            if (insertError) throw insertError;
            if (!insertedData) throw new Error('Failed to insert new food item on retry, no ID returned.');

            // Return success data, including the originalIndex
            return {
              status: 'fulfilled',
              originalIndex, // Include originalIndex here
              id: insertedData.id,
              multiplier,
              serving_qty: standardQty,
              serving_unit: standardUnit,
              nutrition: {
                 protein: itemToInsert.protein, fat: itemToInsert.fat, carbs: itemToInsert.carbs,
                 fibers: itemToInsert.fibers, sugar: itemToInsert.sugar, mufa: itemToInsert.mufa,
                 pufa: itemToInsert.pufa, sfa: itemToInsert.sfa, gl: itemToInsert.gl,
                 omega3: itemToInsert.omega3, omega6: itemToInsert.omega6
              }
            };
          } catch (itemError: any) {
             console.error(`Error processing new ingredient "${name}" (original index ${originalIndex}):`, itemError); // Use originalIndex
             // Throw rejection data, including the originalIndex, so Promise.allSettled catches it as rejected
             throw { originalIndex, reason: itemError instanceof Error ? itemError.message : String(itemError) };
          }
        });

      // 2. Execute all processing promises concurrently
      const results = await Promise.allSettled(processingPromises);

      // 3. Create a new array based on results using the originalIndex
      const updatedIngredients = generatedIngredients.map((originalIngredient, index) => {
          const result = results.find(r => {
              // Find the result corresponding to this original index
              if (r.status === 'fulfilled') {
                  return (r.value as { originalIndex: number }).originalIndex === index;
              } else { // status === 'rejected'
                  return (r.reason as { originalIndex: number }).originalIndex === index;
              }
          });

          if (!result) {
              // Should not happen if logic is correct, but return original as fallback
              console.warn(`No result found for original index ${index}, returning original ingredient state.`);
              return originalIngredient;
          }

          if (result.status === 'fulfilled') {
              // Type assertion for success payload (adjust if you have a specific type)
              const value = result.value as { originalIndex: number, id: number, multiplier: number, serving_qty: number, serving_unit: string, nutrition: any };
              // Return a *new* object with all updated properties
              return {
                  ...originalIngredient, // Keep any existing properties not overwritten
                  id: value.id,
                  multiplier: value.multiplier,
                  serving_qty: value.serving_qty,
                  serving_unit: value.serving_unit,
                  status: 'done' as const,
                  nutrition: value.nutrition,
                  errorMsg: undefined // Clear any previous error
              };
          } else { // status === 'rejected'
              // Type assertion for the thrown error object
              const rejectionPayload = result.reason as { originalIndex: number, reason: string };
              // Return a *new* object with error status
              return {
                  ...originalIngredient, // Keep existing properties
                  status: 'error' as const,
                  errorMsg: rejectionPayload.reason // Extract the reason string
              };
          }
      });

      // Assign the newly created array to trigger Svelte reactivity correctly
      generatedIngredients = updatedIngredients;
      calculateRecipeTotals(); // Calculate totals after processing new items

      // 4. Check if any items failed *after* the state update
      const failedItems = generatedIngredients.filter(ing => ing.status === 'error');
      if (failedItems.length > 0) {
        const errorMessages = failedItems.map(ing => `${ing.name || `Item at index ${generatedIngredients.indexOf(ing)}`}: ${ing.errorMsg}`).join('; ');
        throw new Error(`Failed to process ${failedItems.length} new ingredient(s): ${errorMessages}`);
      }

      // --- Step C: Fetch Existing Item Nutrition --- (Now a separate function call)
      await fetchNutritionForExistingIdleItems();

      // Check for errors again after fetching existing item nutrition
      const finalFailedItemsAfterFetch = generatedIngredients.filter(ing => ing.status === 'error');
      if (finalFailedItemsAfterFetch.length > 0) {
        // Throw a combined error message if needed, or rely on the error set in fetchNutritionForExistingIdleItems
         throw new Error(`Failed to fetch nutrition for ${finalFailedItemsAfterFetch.length} existing ingredient(s). Check individual items for details.`);
      }

      // If we reach here, all items should be 'done' or were already 'done'
      if (generatedIngredients.every(ing => ing.status === 'done')) {
         successMessage = "All ingredients processed successfully. Ready to create recipe.";
      } else {
         // This case might happen if only existing items were present initially and fetch failed
         // Error message should already be set by fetchNutritionForExistingIdleItems
         console.warn("Processing finished, but not all items are 'done'. Check for errors.");
      }


    } catch (err: any) {
       // Handle potential API key errors specifically
       if (err.message?.includes('API key not valid')) {
         errorMessage = 'Gemini API Key is invalid. Please check and save it again.';
         showApiKeyInput = true;
       } else {
         errorMessage = `Error processing ingredients: ${err.message}`;
       }
       console.error(err);
    } finally {
       isLoadingRecipe = false; // Finish loading after processing this batch
    }
     // Note: Saving is still a separate button click.
  }

  // --- Helper Function to Fetch Nutrition for Existing Idle Items ---
  async function fetchNutritionForExistingIdleItems() {
     const nutrientFields = 'protein, fat, carbs, fibers, sugar, mufa, pufa, sfa, gl, omega3, omega6';
     const existingItemIdsToFetch = generatedIngredients
       .filter(ing => ing.id && ing.status === 'idle') // Only fetch for matched items not yet processed
       .map(ing => ing.id!); // Use non-null assertion as we filter for ing.id

     if (existingItemIdsToFetch.length === 0) {
       return; // Nothing to fetch
     }

     isFetchingExisting = true; // Indicate fetching
     errorMessage = ''; // Clear previous errors specific to this step

     try {
       const { data: existingNutrients, error: fetchError } = await supabase
         .from('food_items')
         .select(`id, ${nutrientFields}`)
         .in('id', existingItemIdsToFetch);

       if (fetchError) throw new Error(`Failed to fetch nutrition for existing items: ${fetchError.message}`);

       // Store fetched nutrition in the generatedIngredients array
       let needsReactivityUpdate = false;
       for (let i = 0; i < generatedIngredients.length; i++) {
         const ingredient = generatedIngredients[i];
         if (ingredient.id && ingredient.status === 'idle') {
           const fetched = existingNutrients?.find(n => n.id === ingredient.id);
           if (fetched) {
             // Create a *new* object for the updated ingredient to ensure reactivity
             generatedIngredients[i] = {
               ...ingredient,
               nutrition: { // Extract only nutrient fields
                 protein: fetched.protein, fat: fetched.fat, carbs: fetched.carbs,
                 fibers: fetched.fibers, sugar: fetched.sugar, mufa: fetched.mufa,
                 pufa: fetched.pufa, sfa: fetched.sfa, gl: fetched.gl,
                 omega3: fetched.omega3, omega6: fetched.omega6
               },
               status: 'done' // Mark as done
             };
             needsReactivityUpdate = true;
           } else {
             // Update status to error directly on the existing object reference
             ingredient.status = 'error';
             ingredient.errorMsg = `Nutrition data not found for existing item ID ${ingredient.id}`;
             needsReactivityUpdate = true; // Still need to trigger update
           }
         }
       }

       if (needsReactivityUpdate) {
         generatedIngredients = [...generatedIngredients]; // Trigger reactivity
         calculateRecipeTotals(); // Recalculate totals after fetching existing item data
       }

     } catch (err: any) {
        // Handle errors during fetch, potentially marking items as failed
        errorMessage = err.message; // Display the fetch error
        // Mark the items we tried to fetch as errored
        let errorUpdateNeeded = false;
        for (let i = 0; i < generatedIngredients.length; i++) {
           const ingredient = generatedIngredients[i];
           // Check if this item was one we attempted to fetch
           if (ingredient.id && existingItemIdsToFetch.includes(ingredient.id) && ingredient.status === 'idle') {
              ingredient.status = 'error';
              ingredient.errorMsg = `Failed to fetch nutrition: ${err.message}`;
              errorUpdateNeeded = true;
           }
        }
        if (errorUpdateNeeded) {
           generatedIngredients = [...generatedIngredients];
           calculateRecipeTotals(); // Recalculate totals if errors occurred
        }
        // Re-throw the error so the calling function knows something went wrong
        throw err;
     } finally {
        isFetchingExisting = false;
     }
  }


  // --- Step C Function: Save Final Recipe ---
  async function saveFinalRecipe() {
     // Use the reactive variable `canCreateRecipe` which already checks status
     if (!canCreateRecipe) {
        errorMessage = "Cannot create recipe: Ensure all ingredients are processed successfully (status 'done') and have no errors.";
        return;
     }

     isLoadingRecipe = true;
     errorMessage = '';
     successMessage = '';

     try {
        // Redundant check (already covered by canCreateRecipe), but safe to keep
        // const finalFailedItems = generatedIngredients.filter(ing => ing.status === 'error');
        // if (finalFailedItems.length > 0) {
        //    throw new Error(`Cannot create recipe: ${finalFailedItems.length} ingredient(s) still have errors.`);
        // }

        // Prepare and Insert Final Recipe Item
        const ingredientSummary = generatedIngredients
          .filter(ing => ing.status === 'done')
          .map(ing => {
            const displayName = ing.matchedName || ing.name || 'Unknown';
            const qty = ing.serving_qty || '?';
            const unit = ing.serving_unit || 'unit';
            const mult = ing.multiplier || 1;
            const formattedMultiplier = Number.isInteger(mult) ? mult : mult.toFixed(2);
            return `${formattedMultiplier}x ${displayName} (${qty} ${unit})`;
          }).join(', ');

        const finalComment = userComment
          ? `${userComment}\n---\nIngredients: ${ingredientSummary}`
          : `Ingredients: ${ingredientSummary}`;

        // Use the already calculated recipeTotals for insertion
        const recipeToInsert = {
          name: recipeName.trim(),
          serving_qty: 1,
          serving_unit: 'portion',
          comment: finalComment,
          protein: recipeTotals.protein ?? null,
          fat: recipeTotals.fat ?? null,
          carbs: recipeTotals.carbs ?? null,
          fibers: recipeTotals.fibers ?? null,
          sugar: recipeTotals.sugar ?? null,
          mufa: recipeTotals.mufa ?? null,
          pufa: recipeTotals.pufa ?? null,
          sfa: recipeTotals.sfa ?? null,
          gl: recipeTotals.gl ?? null,
          omega3: recipeTotals.omega3 ?? null,
          omega6: recipeTotals.omega6 ?? null,
        };

        const { error: recipeInsertError } = await supabase
          .from('food_items')
          .insert([recipeToInsert]);

        if (recipeInsertError) throw recipeInsertError;

        successMessage = `Recipe "${recipeName}" created successfully!`;
        generatedIngredients = []; // Clear the list on success
        calculateRecipeTotals(); // Reset totals display

     } catch (err: any) {
        errorMessage = `Error saving recipe: ${err.message}`;
        console.error(err);
     } finally {
        isLoadingRecipe = false;
     }
  }


  // --- Retry Function ---
  async function retryProcessIngredient(index: number) {
    const ingredient = generatedIngredients[index];
    if (!ingredient || ingredient.status !== 'error') return; // Only retry errors

    console.log(`Retrying ingredient at index ${index}:`, ingredient.name || ingredient.matchedName);
    // Reset status for retry attempt
    ingredient.status = 'processing';
    ingredient.errorMsg = undefined;
    generatedIngredients = [...generatedIngredients]; // Update UI to show 'processing'

    // Ensure API key exists
     if (!geminiApiKey) {
       ingredient.status = 'error';
       ingredient.errorMsg = 'API Key missing for retry.';
       generatedIngredients = [...generatedIngredients];
       showApiKeyInput = true;
       return;
     }

     // Ensure needed data exists (should exist if it failed before, but check again)
     // For retry, we need the original name, quantity, and unit stored before processing started
     const { name, quantity, unit } = ingredient; // These might be undefined if the initial object structure was different
     if (!name || !quantity || !unit) { // Check if original data is available
        ingredient.status = 'error';
        // Attempt to get name for error message if possible
        const errorName = ingredient.name || ingredient.matchedName || `Item at index ${index}`;
        ingredient.errorMsg = `Cannot retry ${errorName}: Missing original name, quantity, or unit.`;
        generatedIngredients = [...generatedIngredients];
        return;
     }

     const genAI = new GoogleGenAI({ apiKey: geminiApiKey });

     try {
        // Re-run the processing logic for this specific ingredient
        const standardUnit = unit === 'dl' ? 'dl' : 'g';
        const standardQty = standardUnit === 'dl' ? 1 : 100;
        const multiplier = quantity / standardQty;

        const jsonSchema = `{ "protein": number | null, "fat": number | null, "carbs": number | null, "fibers": number | null, "sugar": number | null, "mufa": number | null, "pufa": number | null, "sfa": number | null, "gl": number | null, "omega3": number | null, "omega6": number | null, "comment"?: string | null }`;
        const prompt = `Provide nutritional information per ${standardQty} ${standardUnit} for the food item "${name}". For 'carbs', report total carbohydrates (including fiber). If assumptions are needed, include only the most important ones in the 'comment' field prefixed with "Assumptions: ". Be brief. Do not include source references or citations. Return only a valid JSON object matching this structure:\n${jsonSchema}`;

        const result = await genAI.models.generateContent({
          model: "gemini-2.5-pro-preview-03-25",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { tools: [{ googleSearch: {} }], thinkingConfig: { includeThoughts: false } },
        });
        const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!responseText) throw new Error("AI response for nutrition did not contain text.");

        let nutritionData: Partial<FoodItem>;
        const jsonRegex = /.*(\{[\s\S]*\})/s;
        const match = responseText.match(jsonRegex);
        if (!match || !match[1]) throw new Error("AI nutrition response JSON structure not found.");
         try {
            nutritionData = JSON.parse(match[1]);
         } catch (parseError) {
            console.error("Failed to parse nutrition JSON on retry:", parseError, "\nOriginal Response:", responseText);
            throw new Error("AI nutrition response JSON invalid on retry.");
         }

         // --- VALIDATION (Retry) ---
         assert(
           typeof nutritionData.omega6 === 'number' || nutritionData.omega6 === null,
           `Omega 6 from AI (retry) must be a number or null, got type: ${typeof nutritionData.omega6}, value: ${nutritionData.omega6}`
         );
          assert(
           typeof nutritionData.omega3 === 'number' || nutritionData.omega3 === null,
           `Omega 3 from AI (retry) must be a number or null, got type: ${typeof nutritionData.omega3}, value: ${nutritionData.omega3}`
         );
         // --- END VALIDATION (Retry) ---

         const itemToInsert = {
           name: name, serving_qty: standardQty, serving_unit: standardUnit,
           protein: nutritionData.protein ?? null, fat: nutritionData.fat ?? null, carbs: nutritionData.carbs ?? null,
          fibers: nutritionData.fibers ?? null, sugar: nutritionData.sugar ?? null, mufa: nutritionData.mufa ?? null,
          pufa: nutritionData.pufa ?? null, sfa: nutritionData.sfa ?? null, gl: nutritionData.gl ?? null,
          omega3: nutritionData.omega3 ?? null, omega6: nutritionData.omega6 ?? null,
          comment: nutritionData.comment?.trim() || null
        };

        const { data: insertedData, error: insertError } = await supabase
          .from('food_items')
          .insert([itemToInsert])
          .select('id')
          .single();

        if (insertError) throw insertError;
        if (!insertedData) throw new Error('Failed to insert new food item on retry, no ID returned.');

        // Update ingredient on successful retry
        ingredient.status = 'done';
        ingredient.id = insertedData.id;
        ingredient.multiplier = multiplier;
        ingredient.serving_qty = standardQty;
        ingredient.serving_unit = standardUnit;
        ingredient.nutrition = {
           protein: itemToInsert.protein, fat: itemToInsert.fat, carbs: itemToInsert.carbs,
           fibers: itemToInsert.fibers, sugar: itemToInsert.sugar, mufa: itemToInsert.mufa,
           pufa: itemToInsert.pufa, sfa: itemToInsert.sfa, gl: itemToInsert.gl,
           omega3: itemToInsert.omega3, omega6: itemToInsert.omega6
        };
        ingredient.errorMsg = undefined; // Clear previous error

     } catch (retryError: any) {
        console.error(`Retry failed for ingredient "${name}" (index ${index}):`, retryError);
        ingredient.status = 'error';
        ingredient.errorMsg = `Retry failed: ${retryError.message}`;
     } finally {
        generatedIngredients = [...generatedIngredients]; // Update UI with final status (done or error)
        calculateRecipeTotals(); // Recalculate totals after retry attempt
     }
  }

</script>

<svelte:head>
  <title>Generate Recipe</title>
</svelte:head>

<div class="container mx-auto p-4 max-w-3xl">
  <h1 class="text-2xl font-bold mb-4">Generate Recipe from Name</h1>

  <div class="mb-4">
    <label for="recipeName" class="block text-sm font-medium text-gray-700 mb-1">Recipe Name</label>
    <input
      type="text"
      id="recipeName"
      bind:value={recipeName}
      class="w-full p-2 border border-gray-300 rounded"
      placeholder="e.g., Chicken Stir-fry"
    />
  </div>

  <div class="mb-4">
    <label for="userComment" class="block text-sm font-medium text-gray-700 mb-1">Optional Comment</label>
    <textarea
      id="userComment"
      bind:value={userComment}
      rows="3"
      class="w-full p-2 border border-gray-300 rounded"
      placeholder="Any specific notes, like 'low carb version' or 'serves 2'"
    />
  </div>

  <button
    on:click={generateIngredientList}
    disabled={!recipeName || isLoadingList || isLoadingRecipe}
    class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {#if isLoadingList}
      Generating List...
    {:else}
      Generate Ingredient List
    {/if}
  </button>

  <!-- API Key Input (conditionally shown) -->
  {#if showApiKeyInput}
    <div class="my-4 p-3 border border-yellow-300 bg-yellow-50 rounded">
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
      {#if errorMessage && (errorMessage.includes('API Key is missing') || errorMessage.includes('API Key is invalid'))}
         <p class="mt-1 text-xs text-red-600">{errorMessage}</p>
       {/if}
    </div>
  {/if}

  {#if errorMessage && !(errorMessage.includes('API Key is missing') || errorMessage.includes('API Key is invalid'))}
     <div class="mt-4 p-3 bg-red-100 text-red-700 border border-red-300 rounded">
       {errorMessage}
    </div>
  {/if}
   {#if successMessage && !isLoadingRecipe}
    <div class="mt-4 p-3 bg-green-100 text-green-700 border border-green-300 rounded">
      {successMessage}
    </div>
  {/if}

  {#if generatedIngredients.length > 0}
    <div class="mt-6">
      <h2 class="text-xl font-semibold mb-3">Generated Ingredients</h2>
      <p class="text-sm text-gray-600 mb-3">Review the list below. Remove any unwanted items before approving.</p>
      <ul class="space-y-2">
        {#each generatedIngredients as ingredient, index (index)}
          {@const isNew = !ingredient.id}
          {@const statusColor =
            ingredient.status === 'processing' ? 'bg-yellow-50 border-yellow-200' :
            ingredient.status === 'done' ? 'bg-green-50 border-green-200' :
            ingredient.status === 'error' ? 'bg-red-50 border-red-200' :
            'bg-white border-gray-200'
          }
          <li class={`p-2 border rounded ${statusColor}`}>
            <div class="flex items-center justify-between">
              <!-- Main ingredient info (potentially editable) -->
              <div class="flex-grow mr-2">
                {#if ingredient.status === 'done'}
                  <!-- DONE: Display name, serving size, and editable multiplier -->
                  {@const displayName = ingredient.matchedName || ingredient.name || 'Unknown Item'}
                  {@const displayQty = ingredient.serving_qty || '?'}
                  {@const displayUnit = ingredient.serving_unit || 'unit'}
                  <span class="mr-1">{displayName} ({displayQty} {displayUnit}) x</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    bind:value={ingredient.multiplier}
                    on:input={handleIngredientEdit}
                    class="w-16 p-1 border border-gray-300 rounded text-sm"
                    disabled={isLoadingRecipe || isLoadingList}
                  />

                {:else if ingredient.status === 'processing'}
                  <!-- PROCESSING: Display static info -->
                  {#if !ingredient.id}
                    {ingredient.quantity}{ingredient.unit} {ingredient.name} <span class="text-xs text-blue-500">(New)</span>
                  {:else}
                    {ingredient.matchedName} ({ingredient.serving_qty || '?'} {ingredient.serving_unit || 'unit'}) x {ingredient.multiplier}
                  {/if}
                  <span class="text-xs text-yellow-600 ml-2">Processing...</span>

                {:else if ingredient.status === 'error'}
                  <!-- ERROR: Display static info + error + retry -->
                  {#if !ingredient.id}
                    {ingredient.quantity}{ingredient.unit} {ingredient.name} <span class="text-xs text-blue-500">(New)</span>
                  {:else}
                    {ingredient.matchedName} ({ingredient.serving_qty || '?'} {ingredient.serving_unit || 'unit'}) x {ingredient.multiplier}
                  {/if}
                  <span class="text-xs text-red-600 ml-1" title={ingredient.errorMsg}>Error!</span>
                  <button
                    type="button"
                    on:click={() => retryProcessIngredient(index)}
                    class="ml-1 px-1 py-0 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    title="Retry processing this ingredient"
                    disabled={isLoadingRecipe}
                  >
                    🔄 Retry
                  </button>

                {:else}

                  {#if ingredient.id}

                    {@const displayName = ingredient.matchedName || `Item ID: ${ingredient.id}`}
                    {@const displayQty = ingredient.serving_qty || '?'}
                    {@const displayUnit = ingredient.serving_unit || 'unit'}
                    <span class="mr-1">{displayName} ({displayQty} {displayUnit}) x</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      bind:value={ingredient.multiplier}
                      on:input={handleIngredientEdit}
                      class="w-16 p-1 border border-gray-300 rounded text-sm"
                      disabled={isLoadingRecipe || isLoadingList}
                      title="Edit multiplier"
                    />
                    <span class="text-xs text-gray-500 ml-2">(Matched)</span>
                  {:else}

                    {#if ingredient.isManuallyAdded}

                       <input
                         type="number"
                         step="1"
                         min="1"
                         bind:value={ingredient.quantity}
                         class="w-16 p-1 border border-gray-300 rounded text-sm mr-1"
                         disabled={isLoadingRecipe || isLoadingList}
                         title="Edit quantity"
                       />
                       <select
                         bind:value={ingredient.unit}
                         class="p-1 border border-gray-300 rounded text-sm mr-1"
                         disabled={isLoadingRecipe || isLoadingList}
                         title="Edit unit"
                       >
                         <option value="g">g</option>
                         <option value="dl">dl</option>
                         <option value="pcs">pcs</option>
                         <option value="portion">portion</option>
                       </select>
                       <span>{ingredient.name}</span>
                       <span class="text-xs text-blue-500 ml-1">(New - Manual)</span>
                    {:else}

                       {@const displayName = ingredient.name || 'Unknown New Item'}
                       {@const standardDisplayUnit = ingredient.unit === 'dl' ? 'dl' : 'g'}
                       {@const standardDisplayQty = standardDisplayUnit === 'dl' ? 1 : 100}
                       <span class="mr-1">{displayName} ({standardDisplayQty} {standardDisplayUnit}) x</span>
                       <input
                         type="number"
                         step="0.1"
                         min="0.1"
                         bind:value={ingredient.multiplier}
                         on:input={handleIngredientEdit}
                         class="w-16 p-1 border border-gray-300 rounded text-sm"
                         disabled={isLoadingRecipe || isLoadingList}
                         title="Edit multiplier"
                       />
                       <span class="text-xs text-blue-500 ml-1">(New - LLM)</span>
                    {/if}
                  {/if}
                {/if}
              </div>

              <!-- Delete Button (remains the same) -->
              <button
                on:click={() => deleteIngredient(index)}
                disabled={isLoadingRecipe}
                class="text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed ml-4 flex-shrink-0"
                title="Delete Ingredient"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </li>
        {/each}
      </ul>

      <!-- Manual Add Ingredient Section -->
      <div class="mt-4 pt-4 border-t relative">
        <label for="manualAdd" class="block text-sm font-medium text-gray-700 mb-1">Add Ingredient Manually</label>
        <input
          type="text"
          id="manualAdd"
          bind:value={manualAddSearchTerm}
          on:input={handleSearchInput}
          on:focus={() => showManualAddResults = true}
          on:blur={() => setTimeout(() => showManualAddResults = false, 150)}
          class="w-full p-2 border border-gray-300 rounded"
          placeholder="Search existing or type new name..."
          disabled={isFetchingExisting || isLoadingRecipe || isLoadingList}
        />
        {#if isFetchingExisting}
          <p class="text-xs text-gray-500 italic mt-1">Loading food items...</p>
        {/if}

        <!-- Search Results Dropdown -->
        {#if showManualAddResults && (manualAddSearchResults.length > 0 || manualAddSearchTerm.trim())}
          <ul class="absolute z-10 w-full bg-white border border-gray-300 rounded mt-1 max-h-60 overflow-y-auto shadow-lg">
            {#each manualAddSearchResults as result (result.item.id)}
              <li
                class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                on:mousedown={() => addExistingIngredient(result.item)}
              >
                {result.item.name}
                <span class="text-xs text-gray-500 ml-1">
                  ({result.item.serving_qty || '?'} {result.item.serving_unit || 'unit'})
                </span>
              </li>
            {/each}
            {#if manualAddSearchTerm.trim() && !manualAddSearchResults.some(r => r.item.name.toLowerCase() === manualAddSearchTerm.trim().toLowerCase())}
              <li
                class="px-3 py-2 hover:bg-blue-100 cursor-pointer text-sm text-blue-600 italic"
                on:mousedown={() => addNewIngredient(manualAddSearchTerm)}
              >
                Add "{manualAddSearchTerm.trim()}" as a new item (default 100g)
              </li>
            {/if}
             {#if manualAddSearchResults.length === 0 && !manualAddSearchTerm.trim()}
               <li class="px-3 py-2 text-sm text-gray-500 italic">Start typing to search...</li>
             {/if}
          </ul>
        {/if}
      </div>


      <!-- Totals Display - Mimic styling from main page summary -->
      {#if recipeTotals.count > 0}
        <div class="mt-6 p-3 border rounded bg-gray-100">
          <h2 class="text-lg font-semibold mb-2">Recipe Summary ({recipeTotals.count} ingredients)</h2>
          <div class="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
              <!-- Calculated Kcal -->
              <span class="bg-blue-200 text-blue-900 px-1 py-0.5 rounded-md font-medium">
                  {calculateKcal(recipeTotals)} C
              </span>
              <!-- Protein, Fat, Carbs -->
              <span class="bg-green-200 text-green-900 px-1 py-0.5 rounded-md font-medium">
                  {recipeTotals.protein ?? 0}, {recipeTotals.fat ?? 0}, {recipeTotals.carbs ?? 0} <span class="text-green-700 text-[0.65rem]">PFC</span>
              </span>
              <!-- Fibers, Sugar -->
              <span class="bg-yellow-200 text-yellow-900 px-1 py-0.5 rounded-md font-medium">
                  {recipeTotals.fibers ?? 0}, {recipeTotals.sugar ?? 0} <span class="text-yellow-700 text-[0.65rem]">FiS</span>
              </span>
              <!-- MUFA, PUFA, SFA -->
              <span class="bg-orange-200 text-orange-900 px-1 py-0.5 rounded-md font-medium">
                  {recipeTotals.mufa ?? 0}, {recipeTotals.pufa ?? 0}, {recipeTotals.sfa ?? 0} <span class="text-orange-700 text-[0.65rem]">MPS</span>
              </span>
              <!-- Omega Ratio -->
              <span class="bg-orange-200 text-orange-900 px-1 py-0.5 rounded-md font-medium" title="Omega-6:Omega-3 Ratio">
                  {recipeTotals.ratio ?? '-'} <span class="text-orange-700 text-[0.65rem]">6:3</span>
              </span>
              <!-- GL -->
              <span class="bg-purple-200 text-purple-900 px-1 py-0.5 rounded-md font-medium">
                  {recipeTotals.gl ?? 0} GL
              </span>
          </div>
        </div>
      {/if}


      <div class="mt-4 flex space-x-3">
        {#if hasUnprocessedNewItems}
          <!-- Button to process new items -->
          <button
            on:click={processNewIngredients}
            disabled={isLoadingList || isLoadingRecipe}
            class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {#if isLoadingRecipe}
              Processing New Items...
            {:else}
              Fetch & Add New Ingredients
            {/if}
          </button>
        {:else if canCreateRecipe}
           <!-- Button to create the final recipe -->
           <button
             on:click={saveFinalRecipe}
             disabled={isLoadingList || isLoadingRecipe}
             class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
           >
             {#if isLoadingRecipe}
               Saving Recipe...
             {:else}
               Create Recipe
             {/if}
           </button>
        {/if}

        <button
          on:click={() => { generatedIngredients = []; errorMessage = ''; successMessage = ''; calculateRecipeTotals(); }}
          disabled={isLoadingList || isLoadingRecipe}
          class="bg-gray-300 hover:bg-gray-400 text-black py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

</div>
