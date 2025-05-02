We use Supabase as a database and authentication service.
I do no think we need a backend API, as all CRUD can be done by Supabase and the logic on the frontend.

The Supabase project ID is in ./.env

**Frontend Framework:** SvelteKit
**CSS Framework:** Tailwind CSS

We chose SvelteKit for its modern approach, performance focus (compiling to vanilla JS), and suitability for building SPAs that interact directly with Supabase. SvelteKit's `adapter-static` will be used to build the application for static hosting (e.g., GCP bucket).

Tailwind CSS was chosen for its utility-first approach, enabling rapid development and responsive design.

## Svelte Development Notes / Pitfalls

*   **Svelte Comment Placement (`{/* ... */}`):** Be extremely cautious when using Svelte or HTML comments within the template (`<script>` and `<style>` sections are generally fine). Placing them directly inside or immediately adjacent to HTML tags, or within complex logic blocks (`{#if}`, `{#each}`), can lead to misleading "Unexpected token" parsing errors. The parser may report the error on a nearby line, causing confusion.
    *   **Best Practice:** Place Svelte comments on their own separate lines, well away from HTML tags and logic blocks.

**EVEN WITH THE ABOVE NOTE, THE LLM KEEPS PLACING SVELTE COMMENTS AND THEN CATCHING ITSELF. NO COMMENTS IN SVELTE!**

*   **Parser Error Debugging:** If the Svelte parser reports an "Unexpected token" or similar error, **the first step should always be to check for recently added or modified Svelte comments (`{/* ... */}`) or HTML comments in the template section.** These are a common source of misleading parser errors. Only after confirming comments are correctly placed should other potential syntax issues be investigated.
