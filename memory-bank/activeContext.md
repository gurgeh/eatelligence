# Active Context - Recipe Creation from Log

**Current Focus:** Implementing the ability to create new "recipe" food items by selecting existing entries from the food log.

**Decisions Made:**
*   **Approach:** Decided against using a complex relational structure or JSONB column initially. Instead, recipes will be created as simple snapshots in the `food_items` table based on selected log entries. The nutritional values will be calculated and stored directly on the new recipe item, and the constituent ingredients will be listed in the `comment` field for human readability. This prioritizes simplicity and preserves the immutability of past logs.
*   **UI Workflow:** Created a dedicated page (`/create-recipe`) for this feature instead of cluttering the main log page. A link ("Create Recipe") was added to the main log page (`/`) to navigate to the new route.

**Implementation Details (`/create-recipe/+page.svelte`):**
*   Created the Svelte component `src/routes/create-recipe/+page.svelte`.
*   Added logic to fetch the 100 most recent log entries (similar to the main page, but without pagination for now) including their joined `food_items` data.
*   Implemented UI to display fetched log entries as selectable buttons.
*   Used a `Set<number>` (`selectedLogIds`) to track selected log entry IDs.
*   Implemented `toggleSelection` function to add/remove IDs from the set on button click.
*   Implemented `calculateTotals` function:
    *   Iterates through selected log entries.
    *   Sums the nutritional values (calories, protein, fat, etc.) based on the logged `multiplier` and the base values from the joined `food_items`.
    *   Stores the running totals in a `totals` object.
    *   Rounds calculated totals to one decimal place.
*   Added a display area to show the running nutritional summary for selected items, styled using standard Tailwind utility classes (e.g., `bg-blue-200`, `px-1.5`, `rounded-md`) consistent with the main log page.
*   Added an input field for the user to enter the `recipeName`.
*   Implemented the `createRecipe` async function:
    *   Triggered by the "Create Recipe" button.
    *   Calculates final totals based on the `totals` object.
    *   Generates a multi-line comment string listing the source ingredients and quantities (e.g., "Made from:\n- 1 x 100g Chicken Breast\n- 0.5 x 1 portion Rice").
    *   Prepares a `newFoodItemData` object containing the recipe name, calculated nutritional values, the generated comment, and sets `serving_qty` to 1 and `serving_unit` to "recipe serving".
    *   Inserts this new object as a row into the `food_items` table using `supabase.from('food_items').insert()`.
    *   On success, clears the selection, recipe name, and totals display, showing a success message.
    *   Includes error handling and loading state (`isCreating`).
*   Styled the page elements (input, selection buttons, create button) using standard Tailwind utility classes, removing initial incorrect usage of DaisyUI classes.
*   Resolved accessibility warnings by wrapping list item content in `<button>` elements instead of adding click handlers directly to `<li>`.

**Troubleshooting:**
*   Initially used DaisyUI classes (`btn`, `badge`, `bg-primary`) assuming it was installed, leading to unstyled components on the `/create-recipe` page.
*   Attempted to fix by installing DaisyUI, configuring `tailwind.config.js`, and adding `data-theme` to `app.html`. This did not resolve the issue on the specific page.
*   Investigated CSS processing:
    *   Checked `app.css` and initially removed Tailwind v3 directives (`@import`, `@plugin`), assuming v4 handled it automatically via the Vite plugin. This broke all styling.
    *   Reverted `app.css` to include `@import 'tailwindcss';` and `@plugin '@tailwindcss/forms';`.
    *   Removed DaisyUI package and configuration from `tailwind.config.js` and `app.html`.
    *   Corrected styling on `/create-recipe` page to use standard Tailwind utility classes consistent with `/+page.svelte`.
    *   Resolved Svelte parser errors caused by misplaced comments (`/* ... */` and `<!-- ... -->`) within HTML tags, adhering to the rule in `techstack.md`.
    *   Resolved CSS error "Unknown at rule @plugin" by removing `@plugin '@tailwindcss/forms';` from `app.css` and adding `require('@tailwindcss/forms')` to the `plugins` array in `tailwind.config.js`, aligning with Tailwind v4 practices. Confirmed form styling still works.

**Next Steps:**
*   Proceed with any further requested features or refinements.

---

# Active Context - Gemini Nutrition Auto-fill (April 26, 2025)

**Current Focus:** Implemented Gemini AI-powered auto-completion for nutritional data when creating new food items.

**Decisions Made:**
*   **LLM:** Gemini 2.5 Pro (specifically `gemini-2.5-pro-preview-03-25`).
*   **API Call Method:** Direct frontend API call using the `@google/genai` library. Decided against Supabase Edge Function due to cost constraints for this personal project, accepting the security implication of the API key potentially being visible in browser network requests.
*   **API Key Storage:** User's Gemini API key is stored in the browser's Local Storage.
*   **Grounding:** Enabled Google Search grounding via the `tools` configuration in the API call.
*   **Prompting Strategy:**
    *   Instructed the model to return data strictly as JSON matching a predefined schema.
    *   Included any pre-filled nutritional data from the form in the prompt to provide context for estimations.
    *   Instructed the model to generalize searches (e.g., "cheese" instead of "Brand X Swiss Cheese") if specific data is unavailable.
    *   Instructed the model to estimate any remaining missing values to ensure a complete JSON response.

**Implementation Details (`/food-items/+page.svelte`):**
*   Installed `@google/genai` dependency.
*   Added state variables for API key management (`geminiApiKey`, `apiKeyInput`, `showApiKeyInput`), loading state (`isAutoFilling`), and errors (`autoFillError`).
*   Added UI elements:
    *   A conditionally visible section to input and save the Gemini API key to Local Storage.
    *   An "Auto-fill Nutrition (AI)" button below the "Name" input in the "Create New Food Item" form.
    *   Display for loading state and error messages related to auto-fill.
    *   A note reminding the user to verify AI-generated data.
*   Implemented `loadApiKey` function (called onMount) to retrieve the key from Local Storage.
*   Implemented `saveApiKey` function triggered by the "Save Key" button.
*   Implemented `autoFillNutrition` async function:
    *   Checks for food name and API key.
    *   Initializes `GoogleGenAI` client with the key.
    *   Gathers existing numerical data from the `newItem` object.
    *   Constructs the detailed prompt including the item name, JSON schema, instructions for grounding, generalization, estimation, and inclusion of existing data.
    *   Calls `genAI.models.generateContent` with the correct parameters (`model`, `contents`, `config.tools`).
    *   Accesses the response text via `result.candidates[0].content.parts[0].text`.
    *   Includes basic cleanup (`.replace(/```json\n?/, '').replace(/```$/, '')`) and robust `try...catch` for JSON parsing.
    *   Updates the `newItem` state with the parsed data, triggering form updates.
    *   Handles errors during the process.

**Troubleshooting:**
*   Corrected initial TS errors related to `GoogleGenAI` import name and client initialization (`new GoogleGenAI({ apiKey: ... })`).
*   Corrected API call structure to use `genAI.models.generateContent` and pass parameters correctly (`model`, `contents`, `config.tools`).
*   Corrected response text access (`result.candidates[0]...`).
*   Resolved Vite dependency optimization issues after installing `@google/genai` by clearing the `node_modules/.vite` cache (`rm -rf node_modules/.vite`) and restarting the dev server.
*   Corrected the Gemini model ID from `gemini-2.5-pro-latest` to the specific preview version `gemini-2.5-pro-preview-03-25`.
*   Added `console.log` for prompt debugging, then removed it once functionality was confirmed.
*   Initial test failed to use provided data; subsequent test after ensuring page reload worked correctly.

**Next Steps:**
*   Commit changes.
*   Proceed with any further requested features or refinements.
