# Eatelligence — Claude Code Guide

See **[AGENTS.md](./AGENTS.md)** for the full project guide: tech stack, architecture, database schema, dev commands, and critical rules (especially the Svelte comment ban).

## Quick Reference

- Dev server: `npm run dev`
- Type-check: `npm run check`
- Deploy: `npm run deploy`
- No server-side routes — pure static SPA via `adapter-static`.
- **Never write comments inside Svelte templates** (`{/* */}` or `<!-- -->`). They cause parser errors.
- kcal is always computed from `calculateKcal()` in `src/lib/utils.ts`, never stored in the DB.
