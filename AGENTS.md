# Eatelligence — Agent Guide

Personal nutrition tracking SPA. Built by one person, for personal use.
Hosted at `eatelligence.fendrich.se` (GitHub Pages). Source: `gurgeh/eatelligence`.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | SvelteKit 2 + Svelte 5 + TypeScript |
| Styling | Tailwind CSS 4 (utility-first, no DaisyUI) |
| Backend / DB | Supabase (Postgres + Auth + RLS) |
| AI | Google Gemini (`@google/genai`, direct frontend calls) |
| Icons | `lucide-svelte` |
| Build | `adapter-static` → static SPA |
| Hosting | GitHub Pages via `gh-pages` CLI |
| PWA | `@vite-pwa/sveltekit` (manifest + service worker) |

---

## Development Commands

```bash
npm run dev        # dev server at http://localhost:5173
npm run build      # production build into ./build
npm run preview    # preview the production build locally
npm run check      # svelte-check + type-check
npm run lint       # prettier check + eslint
npm run format     # prettier write
npm run deploy     # build + gh-pages deploy (production)
npm run test:e2e   # playwright e2e tests
```

---

## Project Structure

```
src/
  app.html                        # root HTML — manifest link is hardcoded here (do not remove)
  app.css                         # global styles
  lib/
    authStore.ts                  # Svelte store: user/session state, subscribes to supabase auth
    supabaseClient.ts             # Supabase client singleton
    types.ts                      # FoodItem, FoodLog, NutritionTarget interfaces
    utils.ts                      # calculateKcal(), ratio(), getLocalDateString(), getDateNDaysAgo()
    index.ts
    components/
      TargetDetailsModal.svelte   # modal: daily nutrient totals vs targets + progress bars
      TargetProgressBar.svelte    # visual progress bar component
  routes/
    +layout.svelte                # auth guard, nav (icons only on mobile, icons+text on lg+)
    +page.svelte                  # main log: search, log meal, recent logs, daily summaries, 7-day avg
    login/+page.svelte            # Google OAuth sign-in page
    profile/+page.svelte          # user email + sign-out button
    food-items/+page.svelte       # manage food items (CRUD + Gemini auto-fill)
    create-recipe/+page.svelte    # create recipe from existing log entries
    recipes/generate/+page.svelte # LLM → ingredient list → nutritional lookup → recipe food_item
    settings/targets/+page.svelte # nutrition targets CRUD (absolute + relative)
memory-bank/                      # Cline memory bank (keep for historical context)
static/
  CNAME                           # eatelligence.fendrich.se (required for GitHub Pages)
  .nojekyll                       # disables Jekyll so _app/ is served (required)
```

---

## Database Schema (Supabase)

All tables have `user_id UUID DEFAULT auth.uid() NOT NULL` and RLS policy
`FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`.

### `food_items`
`id, user_id, name, serving_qty, serving_unit, protein, fat, carbs, fibers, sugar,
mufa, pufa, sfa, gl, omega3, omega6, comment, created_at`

- `carbs` = **net carbs** (excluding fiber), not total carbs.
- No `calories` column — kcal is calculated dynamically.
- `serving_unit` must be one of: `g | dl | pcs | portion`.

### `food_log`
`id, user_id, food_item_id (FK → food_items.id), logged_at, multiplier, created_at`

- `multiplier` scales the food item's per-serving nutrition.
- Queries join `food_items` for nutrient data.

### `nutrition_targets`
`id, user_id, nutrient_1, nutrient_2 (nullable), min_value, max_value`
UNIQUE(`nutrient_1`, `nutrient_2`).

- `nutrient_2 IS NULL` → absolute target (grams/kcal).
- `nutrient_2 IS NOT NULL` → relative target (ratio or percentage).

---

## Kcal Calculation

**Never read kcal from the database.** Always compute via `calculateKcal()` in `src/lib/utils.ts`.

Formula (TEF-adjusted): `kcal = (protein × 3) + (carbs × 3.7) + (fibers × 2) + (fat × 9)`

`carbs` here is net carbs (fibers excluded). The function handles `null`/`undefined` inputs.

---

## Authentication

- Google OAuth via Supabase. Redirect URL is set dynamically:
  - dev → `http://localhost:5173`
  - prod → `https://eatelligence.fendrich.se`
- Both must be in Supabase "Additional Redirect URLs" and Google Cloud Console "Authorized JavaScript origins".
- `authStore.ts` holds the reactive `user` / `session` / `loading` state.
- `+layout.svelte` redirects unauthenticated users to `/login`.

---

## Gemini AI Integration

- Library: `@google/genai`, called directly from the frontend (no backend proxy).
- API key stored in browser `localStorage` under key `geminiApiKey`.
- Model: `gemini-2.5-pro-preview-03-25` with Google Search grounding enabled.
- Used in `/food-items` (nutrition auto-fill) and `/recipes/generate` (ingredient lookup).
- Prompts request data **per the user-specified serving size**, not per 100 g.
- LLM returns `carbs` as net carbs (EU standard, fibers excluded).
- LLM may append assumptions to the `comment` field, prefixed with `"LLM Assumptions: "`.

---

## Critical Rules — Read Before Writing Code

### NO COMMENTS IN SVELTE TEMPLATES

**Do not write `{/* ... */}` or `<!-- ... -->` inside Svelte template sections.**
They cause misleading parser errors that look like unrelated syntax issues.
If you absolutely need a comment in HTML, put it on its own line far from tags and logic blocks.
Standard JS comments inside `<script>` blocks are fine.

### Serving Unit Constraint

`serving_unit` must be one of: `g`, `dl`, `pcs`, `portion`. Enforce with a `<select>`, not free text.

### Static Build Constraints

This is a fully static SPA (`adapter-static`). There are no server-side routes.
Do not add `+page.server.ts` or `+layout.server.ts` — they won't work.

### PWA Manifest

The `<link rel="manifest" href="/manifest.webmanifest">` is **manually hardcoded** in `src/app.html`.
Do not try to use `virtual:pwa-info` or vite-plugin-pwa's auto-injection — it does not work with `adapter-static`.

### Icon Library

Use `lucide-svelte` exclusively. `heroicons-svelte` is not installed and had persistent import issues.

---

## Deployment

```bash
npm run deploy
# Runs: npm run build && npx gh-pages -d build --dotfiles
```

The `--dotfiles` flag is required to include `.nojekyll` in the deployed output.
`static/CNAME` must contain `eatelligence.fendrich.se` for the custom domain to work.

---

## Open Tasks (from memory-bank/progress.md)

- Setting a new Gemini API key — need a UX for non-technical users.
- Prettier interface / logo.
- Non-breaking space for `( 100 g )` display in add new item.
- Tutorial / onboarding (in README or in-app).
- Replace boilerplate README.md.
- Add a license.
- Fix `"1recipe serving"` display string (too long).
- Investigate other useful ratios for daily/weekly display.
- Consider local Svelte store for `food_items` (performance).
- Code cleanup / TODO review pass.
