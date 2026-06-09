# Eatelligence UX Review — Backlog

A critical pass over the full UX flow. Findings are ranked by leverage for the
real audience: **one technical power user, logging on a phone (PWA), many times a
day.** The guiding principle is _optimize the logging hot path; setup screens are
touched rarely._

> Note: this came from reading the code, not running the app on a device.
> Anything about rendered/mobile behavior is an inference and marked as such.

---

## Tier 1 — Fixed

These confirmed defects have been addressed (currently in the working tree, uncommitted):

1. **Unstyled "Create Recipe" link** — `src/routes/+page.svelte` used
   `btn btn-sm btn-outline btn-primary`, but there is no DaisyUI dependency and no
   `.btn` defined anywhere (only `@tailwindcss/forms` is loaded). Replaced with
   real Tailwind outline-button classes.
2. **Silent save failure when editing a food item** — `food-items` `saveItemUpdate`
   swallowed update errors (`console.error` + revert) with no user feedback. Now
   surfaces the error in the page's error banner.
3. **Abandoned AI recipes polluted the Foods list** — `recipes/generate` inserts
   each new ingredient as a real `food_items` row at the "Fetch & Add" step.
   Cancelling never removed them. Now tracks session-inserted items and deletes
   them on Cancel, on per-ingredient delete, and when a new generation starts;
   they are kept only once the recipe is actually created.
   - **Remaining edge case:** navigating away mid-flow (route change / closing the
     tab) still orphans inserted items. A `beforeNavigate`/`onDestroy` guard or
     deferring the inserts to the "Create Recipe" step would close this fully.
4. **Pagination reset on every log** — `fetchRecentLogs()` reset to page 0 on every
   log/copy/edit/delete, collapsing the list and losing your place after "Load
   More". Added a `'refresh'` mode that refetches the whole loaded window instead.

---

## Tier 2 — Daily hot-path friction (highest remaining value)

5. **Set quantity at log time.** A search-result click logs `multiplier: 1`
   immediately (`+page.svelte` `logSelectedItem`). Most foods aren't eaten in
   exactly one serving, so the real flow is _log → find it → click multiplier →
   edit → confirm_. A quantity field or `x2 / x0.5` steppers at log time would cut
   a step from the most frequent action in the app.
   Dev. Note: The existing UI is actually comfortable. Do not fix.

6. **Quick-add for frequent / recent foods.** Search is the only entry point and is
   useless until you type. People eat the same breakfast repeatedly — a row of
   one-tap "frequent" or "recent" chips above the search would reduce most logging
   to a single tap. (The copy 📋 button partially covers this, but only for items
   still in the recent window.)
   Dev. Note: The copy button serves this purpose for now. If we add this feature later, it should be more intelligent and consider time of day and possibly weekday.

7. **Edit affordances are hover-only — invisible on touch.** All inline editing
   (timestamp, multiplier, every nutrient) is a `<span>` whose only "editable"
   signal is `hover:bg-gray-*`. On a phone there is no hover, so the primary
   editing mechanism is undiscoverable. Add a persistent visual cue (underline /
   pencil icon / subtle border). _(Inference — based on markup, not on-device.)_
   Dev. Note: It is prettier without and the few users will understand. Do not fix.

8. **"Am I on track today?" requires a click.** The daily summary shows raw badges;
   the target progress bars live behind `TargetDetailsModal`. Surface one compact
   at-a-glance signal on the summary row (e.g. a colored dot per target, or the
   single most important bar) so the app answers its core question without a tap.
   Dev.Note: Maybe later

---

## Tier 3 — Consistency & polish

10. **Three visual languages for the same nutrient data.** `NutrientBadges.svelte`
    uses `bg-*-200`; the main-page inline badges and the `food-items` badges use
    `bg-*-100`, and the main page re-implements the badge row by hand instead of
    using the component. Consolidate on `NutrientBadges` everywhere.

11. **Mixed icon vocabulary.** Copy is a 📋 emoji; delete is an inline SVG on the
    log page but a 🗑️ emoji on Foods; nav/profile use `lucide-svelte`.
    Standardize on lucide.

12. **Native `alert()` / `confirm()` break the custom UI.** Validation and "API Key
    saved" use `alert()`; deletes use `confirm()` (`food-items`, `+page.svelte`,
    `settings/targets`). For a frequently-deleted entity like a log row, an **undo
    toast** is friendlier and faster than a blocking confirm dialog.

13. **The Gemini key is editable in three places** (Foods inline, Generate-recipe
    inline, Profile) with near-duplicated logic. Profile is the natural home; the
    inline editors add surface area and muddy the "where is my key saved?" mental
    model.

---

## Tier 4 — Lower priority / already on the radar

Real, but lower value for a single technical user. Several already appear in
`memory-bank/progress.md`.

- **Empty-state cliff for a fresh account:** new user → empty search → no foods →
  dead end. A first-run hint ("Add your first food, or generate one with AI")
  helps if the audience ever widens. _(Already listed as "Tutorial / onboarding".)_
- **No link to obtain a Gemini key** anywhere in the key UI. A single "Get a key →"
  link to Google AI Studio covers the "API-key UX for non-technical users" task
  cheaply.
- **Two recipe flows** (`/create-recipe` from logs, `/recipes/generate` from a
  name) are reached via inconsistent entry points and button colors — worth
  unifying or cross-linking symmetrically.
- **Login placeholder:** "you agree to our terms and conditions" links to nothing.
