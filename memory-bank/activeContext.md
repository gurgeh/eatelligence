# Active Context Summary (May 2, 2025)

This summary consolidates key decisions and implementation details from recent tasks.

## Core Features & Data Structure

*   **Omega-3/6 Tracking:**
    *   `omega3` and `omega6` numeric columns added to `food_items` table (via Supabase migration).
    *   `FoodItem` type updated.
    *   UI updated across `/food-items`, `/create-recipe`, and `/` (main log) to manage, calculate, and display these values.
    *   Main log (`/`) displays a combined "6:3" badge (orange) for individual items and a calculated daily ratio badge (orange) in summaries.
*   **Recipe Creation (`/create-recipe`):**
    *   Recipes are created as simple snapshots in `food_items` by summing selected log entries.
    *   Nutritional values are calculated based on the log multiplier and stored directly.
    *   Constituent ingredients are listed in the `comment` field.
    *   New recipes use `serving_qty: 1` and `serving_unit: 'recipe serving'`.
*   **Serving Units (`/food-items`):**
    *   `serving_unit` input changed from free text to a `<select>` dropdown.
    *   Allowed units: `["g", "dl", "pcs", "portion"]`.
    *   Applies to both creating new items and inline editing existing items.
*   **Gemini Auto-fill Nutrition (`/food-items`):**
    *   Uses `@google/genai` library for direct frontend calls to `gemini-2.5-pro-preview-03-25`.
    *   API key stored in Local Storage (`geminiApiKey`).
    *   Google Search grounding is enabled.
    *   **Prompting Strategy:**
        *   Requests nutritional data *per the user-specified serving size* (`serving_qty` and `serving_unit`) entered in the form.
        *   Includes any existing nutritional data from the form as context for the requested serving size.
        *   Instructs the model to return only a valid JSON object matching the required schema, generalizing searches and estimating missing values where necessary.
    *   The returned nutritional data (which is per the specified serving) is saved directly to the database.
    *   **Prompt Update (May 2, 2025):** The prompt no longer requests `calories` and explicitly asks for *total* carbohydrates (including fiber) for the `carbs` field to ensure correct data for dynamic kcal calculation.
    *   **Comment Integration & Assumptions (May 3, 2025):**
        *   Switched model to `gemini-2.5-pro-preview-03-25` for potentially better handling of context.
        *   The user's comment from the form is now included in the prompt sent to the LLM for additional context.
        *   The LLM is instructed to include any significant assumptions (e.g., cooking method, standard weights) in the `comment` field of its JSON response, prefixed with "LLM Assumptions: ".
        *   The frontend code now checks the `comment` field returned by the LLM. If it starts with "LLM Assumptions: ", this text is appended (with a newline) to the user's original comment in the form field. Otherwise, the user's original comment is preserved.

## Dynamic Kcal Calculation (May 2, 2025)

*   **Removed Static Field:** The `calories` column was dropped from the `food_items` database table via Supabase migration. The `calories` property was removed from the `FoodItem` type in `src/lib/types.ts`.
*   **Calculation Logic:** Kcal is now calculated dynamically on the frontend using a TEF-adjusted formula: `kcal = (protein * 3) + ((carbs - fibers) * 3.7) + (fibers * 2) + (fat * 9)`.
*   **Helper Function:** A `calculateKcal` function was created in `src/lib/utils.ts` to encapsulate this logic. It handles null/undefined nutrient values.
*   **UI Integration:** The `/`, `/food-items`, and `/create-recipe` pages were updated to use `calculateKcal` for displaying kcal values instead of relying on a database field. The input field for calories was removed from the "Create New Food Item" form in `/food-items`.

## Nutrition Targets (May 2, 2025)

*   **Database:** Created `nutrition_targets` table (via Supabase migration) with columns: `id` (uuid PK), `nutrient_1` (text), `nutrient_2` (text, nullable), `min_value` (numeric, nullable), `max_value` (numeric, nullable). Added `UNIQUE(nutrient_1, nutrient_2)` constraint.
*   **Type Definition:** Added `NutritionTarget` interface to `src/lib/types.ts`.
*   **Settings UI (`/settings/targets`):**
    *   Created new page `src/routes/settings/targets/+page.svelte`.
    *   Allows adding/editing/deleting targets.
    *   Distinguishes between "Absolute" (`nutrient_2` is NULL) and "Relative" (`nutrient_2` is NOT NULL) targets.
    *   Relative targets use a dropdown with predefined, meaningful combinations (e.g., "Fat (% of Calories)", "Omega-6 / Omega-3 Ratio (%)").
    *   Uses inline editing for min/max values in the target list.
*   **Log View Integration (`/`):**
    *   Fetches defined `nutritionTargets` on mount.
    *   Daily summary rows are now clickable.
    *   Clicking a summary row opens the `TargetDetailsModal`.
*   **Target Details Modal (`src/lib/components/TargetDetailsModal.svelte`):**
    *   Receives daily nutrient totals, defined targets, and date string as props.
    *   Calculates the `actualValue` for each target based on the day's totals (handling absolute vs. relative logic, including kcal conversions for percentage targets).
    *   Displays each target's label, range, actual value (rounded to nearest integer using `Math.round()`), and a visual progress bar.
    *   Calculates the visual display range (`displayMin`, `displayMax`) for the progress bar:
        *   `displayMin` is always 0 for both absolute and relative targets.
        *   `displayMax` is calculated based on target range and `actualValue * 1.05` padding, then rounded up to the nearest "pretty" integer based on magnitude (e.g., <30 rounds up to integer, <300 rounds up to 10s, <3500 rounds up to 100s, >=3500 rounds up to 1000s).
*   **Progress Bar (`src/lib/components/TargetProgressBar.svelte`):**
    *   Visualizes target progress using colored segments (red/green) and an indicator line.
    *   Accepts `displayMin` and `displayMax` props to control the visual scale.
    *   Displays the min/max values of the visual scale below the bar.
*   **Navigation:** Added a "Targets" link to the main layout (`src/routes/+layout.svelte`) pointing to `/settings/targets`.

## Key Implementation Patterns & Notes

*   **Inline Editing:** Implemented in `/food-items`, `/`, and `/settings/targets` using conditional rendering of input/select elements, `bind:value`, and `on:blur`/`on:change`/`on:keydown` handlers calling save functions. Uses `tick()` for focus management.
*   **Calculations:** Aggregate calculations (daily totals, recipe creation) sum nutritional values based on `log_multiplier * stored_nutrition_per_defined_serving`. Target modal performs specific calculations for relative targets (percentages, ratios).
*   **Styling:** Primarily uses standard Tailwind utility classes. Resolved previous issues with DaisyUI attempts and Tailwind plugin configuration (`@tailwindcss/forms` added via `tailwind.config.js`).
*   **Svelte:** Adhering strictly to the rule of **NO SVELTE COMMENTS (`{/*...*}` or `<!--...-->`) within the template/HTML sections** to avoid parser errors (see `techstack.md`). Standard HTML comments are safer if needed within HTML structure, but best placed on separate lines away from tags/logic blocks. Fixed comment-related parser errors during target implementation.
*   **Accessibility:** Removed `autofocus` attribute from the inline `serving_unit` select element in `/food-items` to resolve Svelte accessibility warning (May 2, 2025). Added basic keyboard navigation (`role="button"`, `tabindex`, `on:keydown`) to clickable summary row in `/`.
*   **Log Display Updates (`/`, May 2, 2025):**
    *   Individual log items now display the base `serving_qty` and `serving_unit` *before* the multiplier (e.g., `(100g) x1.5`). This requires the data to be present in the `food_items` table.
    *   Fixed calorie calculation discrepancy between individual log items and the daily summary. Both now calculate calories based on the exact nutrient amounts for their scope (multiplied for individual, summed for daily) and rely on the single `Math.round()` within `calculateKcal`.
    *   Reintroduced `Math.round()` for the *display* of individual summed nutrients (PFC, FiS, etc.) in the daily summary row for visual clarity, while ensuring the calorie calculation uses the unrounded sums.
*   **Omega-3/6 Ratio Fix (`/recipes/generate`, May 4, 2025):**
    *   Added a dedicated `ratio` function to `src/lib/utils.ts` to format the 6:3 ratio string purely for display purposes, taking numeric grams as input.
    *   Updated the `calculateRecipeTotals` function in `src/routes/recipes/generate/+page.svelte` to use this new `ratio` function for displaying the summary ratio, ensuring the calculation remains based on summed grams. This fixes a bug where the previous formatter was incorrectly applied to summed totals.
    *   Added `assert` checks within the LLM response parsing logic (`processNewIngredients` and `retryProcessIngredient`) in `src/routes/recipes/generate/+page.svelte` to ensure `omega3` and `omega6` values received from the AI are numbers (or null), preventing potential type errors downstream.

## Next Steps

*   Proceed with the next task from `progress.md`.
