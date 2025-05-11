# Active Context Summary (May 11, 2025)

This summary consolidates key decisions and implementation details from recent tasks.

## Deployment to GitHub Pages (Implemented May 11, 2025)

*   **Objective:** Host the Eatelligence application on the custom domain `eatelligence.fendrich.se`.
*   **Platform Switch:** Moved from the initial idea of using a Google Cloud Storage bucket to GitHub Pages for simplicity and cost-effectiveness, as the project is already hosted on GitHub.
*   **Custom Domain:** The site is configured to be served from `eatelligence.fendrich.se`.
*   **Deployment Method:**
    *   The `gh-pages` CLI tool is used to deploy the static build output.
    *   Command: `npx gh-pages -d build --dotfiles`
    *   The `--dotfiles` flag is crucial for including necessary dotfiles like `.nojekyll`.
*   **Required Files for GitHub Pages:**
    *   **`static/CNAME`:** A file containing `eatelligence.fendrich.se` must be present in the `static` directory to be included in the build output. This file ensures GitHub Pages maps the custom domain correctly.
    *   **`static/.nojekyll`:** An empty file that must be present in the `static` directory. This file tells GitHub Pages to bypass Jekyll processing, which is essential for SvelteKit/Vite projects as Jekyll might otherwise ignore the `_app` directory.
*   **NPM Deploy Script:**
    *   To simplify deployment, a script was added to `package.json`:
        ```json
        "deploy": "npm run build && npx gh-pages -d build --dotfiles"
        ```
    *   Deployment can now be done via `npm run deploy`.
*   **HTTPS:** "Enforce HTTPS" is enabled in the GitHub Pages settings for the custom domain, providing free SSL.

## Mobile Menu Enhancement (Implemented May 11, 2025)

*   **Objective:** Improve usability of the main navigation menu on mobile devices where it was previously too wide.
*   **Icon Library:** Switched from attempted `heroicons-svelte` (due to persistent import issues) to `lucide-svelte`.
    *   Uninstalled `heroicons-svelte`.
    *   Installed `lucide-svelte`.
*   **Changes to `src/routes/+layout.svelte`:**
    *   **Logout Button:** The "Logout" button was removed from the main header navigation. Users will use the "Sign Out" button on the `/profile` page.
    *   **Icon Implementation:**
        *   Navigation links ("Log Meal", "Manage Items", "Targets", "Profile") now use icons from `lucide-svelte`.
        *   Selected icons:
            *   Log Meal: `CirclePlus`
            *   Manage Items: `Database`
            *   Targets: `Goal`
            *   Profile: `CircleUserRound`
        *   Text labels on larger screens updated: "Log Meal" to "Log", "Manage Items" to "Foods". "Targets" and "Profile" text labels remain unchanged. `title` attributes on links updated accordingly.
    *   **Responsive Display & Styling:**
        *   On small screens (default, less than 1024px wide), only icons are displayed. Links have `p-2` padding for better touch targets.
        *   On larger screens (`lg:` breakpoint - 1024px and up), icons are displayed alongside their text labels. Links have `lg:p-0` padding. Icon-to-text margin is `lg:ml-1.5`.
        *   Overall spacing between links on desktop set to `lg:space-x-4`.
    *   **Active Link Styling (using `$page.url.pathname`):**
        *   Active link text color: `text-indigo-600`.
        *   Active link icon size: `28` (inactive icons are `24`), controlled via `size` prop.
        *   Active link text label: `font-semibold`.
        *   Non-active links: `text-gray-700`, icon size `24`, normal font weight.

## Authentication & User-Specific Data (Implemented May 11, 2025)

*   **Provider:** Google OAuth provider enabled in Supabase. User provides Client ID/Secret.
*   **Database Schema:**
    *   `user_id` (UUID, references `auth.users.id`, `DEFAULT auth.uid()`, `NOT NULL`) column added to `food_items`, `food_log`, and `nutrition_targets` tables.
*   **Row Level Security (RLS):**
    *   Enabled for `food_items`, `food_log`, and `nutrition_targets`.
    *   Policies implemented: `FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`. This ensures users can only interact with their own data.
*   **Data Handling:** Existing test data in the affected tables was cleared after RLS setup.
*   **Frontend Implementation (SvelteKit):**
    *   **`src/lib/authStore.ts`:** Created a Svelte store to manage authentication state (user, session, loading, error), subscribing to Supabase auth changes.
    *   **`src/routes/login/+page.svelte`:** New page with a "Sign in with Google" button. Redirects to home if already logged in. (See "Environment-Specific Redirects for OAuth" below for recent changes).
    *   **`src/routes/profile/+page.svelte`:** New page displaying logged-in user's email and a "Sign Out" button.
    *   **`src/routes/+layout.svelte`:**
        *   Integrated `authStore` to manage UI based on authentication state.
        *   Implemented route protection: unauthenticated users are redirected to `/login`.
        *   Header dynamically shows Login/Logout and Profile links. (Note: This part was modified by the Mobile Menu Enhancement task).
    *   **`src/lib/types.ts`:** Updated `FoodItem` and `NutritionTarget` interfaces to include the `user_id: string;` field. `FoodLog` already had it.
*   **Environment-Specific Redirects for OAuth (Implemented May 11, 2025):**
    *   To support OAuth (Google Sign-In) in both local development and production, the `signInWithOAuth` call in `src/routes/login/+page.svelte` was updated.
    *   It now uses `import { dev } from '$app/environment';` to determine the current environment.
    *   The `redirectTo` option in `supabase.auth.signInWithOAuth` is dynamically set:
        *   Development: `http://localhost:5173`
        *   Production: `https://eatelligence.fendrich.se`
    *   This requires both URLs to be added to the "Additional Redirect URLs" allow list in Supabase Authentication settings, and their respective origins (`http://localhost:5173` or `http://localhost`, and `https://eatelligence.fendrich.se`) to be in Google Cloud Console's "Authorized JavaScript origins".
*   **Outcome:** Application now supports user accounts via Google Sign-In. Data related to food items, food logs, and nutrition targets is isolated to individual users. OAuth redirects work correctly for both local development and the deployed production site.

## PWA Enhancements & Manifest Link Fix (Implemented May 11, 2025)

*   **Objective:** Improve "Add to Home Screen" behavior and ensure a more app-like experience on Android (including Firefox) and iOS.
*   **Manifest Updates (`vite.config.ts`):**
    *   Added `display: 'standalone'` to instruct browsers to open the app in its own window.
    *   Added `start_url: '/'` to define the application's entry point.
    *   Added `scope: '/'` to define the URLs considered part of the app.
    *   Added `background_color: '#ffffff'` for a smoother launch transition.
*   **HTML Head Updates (`src/app.html`):**
    *   Added `<meta name="apple-mobile-web-app-capable" content="yes">` for iOS standalone mode.
    *   Added `<meta name="apple-mobile-web-app-status-bar-style" content="default">` for iOS status bar styling.
    *   Added `<meta name="apple-mobile-web-app-title" content="Eatelligence">` for the app title on iOS home screens.
    *   Added `<link rel="apple-touch-icon" href="/icon-192x192.png">` for the iOS home screen icon.
    *   Added `<meta name="mobile-web-app-capable" content="yes">` for broader compatibility, as suggested by DevTools.
*   **Manifest Link Injection Fix:**
    *   Initial attempts to have `vite-plugin-pwa` or `@vite-pwa/sveltekit` automatically inject the `<link rel="manifest"...>` into the HTML output by `adapter-static` were unsuccessful in the build output, despite various configurations.
    *   Manual injection using `virtual:pwa-info` in `+layout.svelte` worked in dev mode but also failed to appear in the static build.
    *   **Solution:** The `<link rel="manifest" href="/manifest.webmanifest">` was manually added directly to the `<head>` section of `src/app.html`. This ensures `adapter-static` includes it in all generated pages.
    *   The `@vite-pwa/sveltekit` plugin (via `SvelteKitPWA` in `vite.config.ts`) remains responsible for generating the `manifest.webmanifest` file and the service worker.
*   **Type Definitions:** `src/vite-env.d.ts` was updated with `/// <reference types="vite-plugin-pwa/svelte" />`, `/// <reference types="vite-plugin-pwa/info" />`, and `/// <reference types="vite-plugin-pwa/client" />` to support virtual module imports if they are used for other PWA features (though manifest link injection is now manual).
*   **Outcome:** With the manifest link now hardcoded in `app.html`, the PWA should be correctly recognized by browsers, enabling proper installation and standalone display mode.

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
    *   **Prompt Update (Noted May 2, 2025, verified May 10, 2025):** The prompt no longer requests `calories`. For the `carbs` field, it explicitly asks for carbohydrates *excluding* fiber (net carbs), aligning with EU standards and the dynamic kcal calculation. The `fibers` field is requested separately. This ensures the `carbs` data field correctly represents net carbs.
    *   **Comment Integration & Assumptions (May 3, 2025):**
        *   Switched model to `gemini-2.5-pro-preview-03-25` for potentially better handling of context.
        *   The user's comment from the form is now included in the prompt sent to the LLM for additional context.
        *   The LLM is instructed to include any significant assumptions (e.g., cooking method, standard weights) in the `comment` field of its JSON response, prefixed with "LLM Assumptions: ".
        *   The frontend code now checks the `comment` field returned by the LLM. If it starts with "LLM Assumptions: ", this text is appended (with a newline) to the user's original comment in the form field. Otherwise, the user's original comment is preserved.

## Dynamic Kcal Calculation (May 2, 2025)

*   **Removed Static Field:** The `calories` column was dropped from the `food_items` database table via Supabase migration. The `calories` property was removed from the `FoodItem` type in `src/lib/types.ts`.
*   **Calculation Logic (Updated May 10, 2025):** Kcal is calculated dynamically on the frontend. The `carbs` field in data is treated as net carbs (i.e., carbohydrates excluding fiber). The TEF-adjusted formula in `src/lib/utils.ts` is: `kcal = (protein * 3) + (carbs * 3.7) + (fibers * 2) + (fat * 9)`.
*   **Helper Function:** The `calculateKcal` function in `src/lib/utils.ts` encapsulates this logic and handles null/undefined nutrient values.
*   **UI Integration:** The `/`, `/food-items`, and `/create-recipe` pages were updated to use `calculateKcal` for displaying kcal values instead of relying on a database field. The input field for calories was removed from the "Create New Food Item" form in `/food-items`.

## Nutrition Targets (May 2, 2025)

*   **Database:** Created `nutrition_targets` table (via Supabase migration) with columns: `id` (uuid PK), `nutrient_1` (text), `nutrient_2` (text, nullable), `min_value` (numeric, nullable), `max_value` (numeric, nullable). Added `UNIQUE(nutrient_1, nutrient_2)` constraint. (Now also includes `user_id`).
*   **Type Definition:** Added `NutritionTarget` interface to `src/lib/types.ts`. (Now also includes `user_id`).
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
