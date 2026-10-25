Replace the placeholder routes in `data/seed-routes.json` with the real climbs from https://usac.results.info/event/647.

Requirements:
- Inspect the page / its backing JSON API (the site is a JS app) and extract every route: number, name/colour, and category (U11, U13, U15, U17, U19, OPEN; map the site's age groups to these).
- Write `data/seed-routes.json` as `[{ "id": "r<N>", "number": N, "category": "...", "name": "..." }]`.
- Add `scripts/import-routes.js` that repeats the import so it can be re-run.
- Create an empty file `data/ROUTES_IMPORTED` so the import workflow stops re-triggering.
- If a category isn't in `CATEGORY_BASE` in `scoring.js`, add it, keeping U11 lowest.
- Run `node --check server.js` and open a PR.
If `usac.results.info` is unreachable, say so in the PR and do not invent routes.
