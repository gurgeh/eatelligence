We use Supabase as a database and authentication service.
I do no think we need a backend API, as all CRUD can be done by Supabase and the logic on the frontend.

**Frontend Framework:** SvelteKit
**CSS Framework:** Tailwind CSS

We chose SvelteKit for its modern approach, performance focus (compiling to vanilla JS), and suitability for building SPAs that interact directly with Supabase. SvelteKit's `adapter-static` will be used to build the application for static hosting (e.g., GCP bucket).

Tailwind CSS was chosen for its utility-first approach, enabling rapid development and responsive design.
