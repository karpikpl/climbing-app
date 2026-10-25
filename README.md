# Climb Comp

Climbing competition tracker: 25 attempts per climber, dynamic route values, global + group ratings.

## Run locally
```
npm install
npm start            # http://localhost:3000
```

## Configuration (env)
| Var | Default | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | – | Enables Google sign-in (OAuth web client; add your site origin) |
| `ALLOW_USERNAME_LOGIN` | `true` | Plain username login |
| `ZONES` | `low,high` | Enabled zones (`low`, `high`, `none`). Disabled zones disappear from the UI and scoring, and existing zone entries are **permanently converted to plain attempts on startup**. |
| `ADMINS` | – | Comma-separated Google emails allowed to edit routes in the Admin tab |
| `DATA_DIR` | `./data` | Where `db.json`, `routes.json` are stored |
| `SESSION_SECRET` | generated | Cookie signing key |

## Routes
`data/seed-routes.json` holds **placeholder** routes (the USAC site, https://usac.results.info/event/647, wasn't reachable when this was built). Replace them by pasting real routes (`[{id, number, category, name}]`, categories `U11, U13, U15, U17, U19, OPEN`) in the Admin tab, or by editing `routes.json` in `DATA_DIR`.

## Scoring (`scoring.js`)
`value = base(category) × difficulty × effort × crowd`
- base: U11 100, U13 140, U15 180, U17 220, U19 260, Open 300 (U11 always lowest).
- difficulty 0.8–1.3 from smoothed top rate (fewer tops → worth more); effort 0.9–1.2 from average attempts needed per top.
- crowd: after more than 2 tops, ×0.92 per extra top (floor 0.35).
- Climber gets: top = value × (1 − 5% per extra attempt, min 50%); high zone 50%; low zone 25%.
Values are recomputed live from all logged attempts.

## Deploy (Azure Container Apps, public, Azure Files storage)
```
azd env set GOOGLE_CLIENT_ID <id>   # optional
azd env set ZONES low,high          # optional
azd up
```
Runs a single replica (file storage = single writer).
