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

## Key Implementation Patterns & Notes

*   **Inline Editing:** Implemented in `/food-items` and `/` (main log) using conditional rendering of input/select elements, `bind:value`, and `on:blur`/`on:change`/`on:keydown` handlers calling `saveItemUpdate`. Uses `tick()` for focus management.
*   **Calculations:** Aggregate calculations (daily totals, recipe creation) sum nutritional values based on `log_multiplier * stored_nutrition_per_defined_serving`. This works because the stored nutrition corresponds directly to the `serving_qty` and `serving_unit`.
*   **Styling:** Primarily uses standard Tailwind utility classes. Resolved previous issues with DaisyUI attempts and Tailwind plugin configuration (`@tailwindcss/forms` added via `tailwind.config.js`).
*   **Svelte:** Adhering strictly to the rule of **NO SVELTE COMMENTS (`{/*...*}` or `<!--...-->`) within the template/HTML sections** to avoid parser errors (see `techstack.md`). Standard HTML comments are safer if needed within HTML structure, but best placed on separate lines away from tags/logic blocks.

## Next Steps

*   Proceed with the next task from `progress.md`.
