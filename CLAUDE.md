# Realm VTT Ruleset Compiler

CLI tool that compiles a ruleset directory into a JSON payload and uploads it to the Realm VTT API.

## Project Structure

```
src/
  cli.js         — CLI entry point (commander-based)
  compiler.js    — Reads ruleset.config.json, resolves file refs, builds API payload
  api-client.js  — Realm VTT API client (auth, campaign lookup, CRUD for rulesets + records)
  auth.js        — Builds an authenticated client from CLI options (token or email/password)
  records.js     — `records` subcommand — CSV import with upsert-by-name
  csv.js         — CSV parser (quoted fields, recordType/name/data columns)
  prompts.js     — Terminal prompts (text, password, select)
example/
  ruleset.config.json  — Reference config showing every supported setting
                         (read this first when you need to know what shape a
                         ruleset config can take).
WIKI.md          — Authoring guide for ruleset authors; deeper than the README.
```

## How It Works

1. Reads `ruleset.config.json` from the target directory
2. Resolves all `{ "file": "path" }` references — tab HTML, rollhandlers, scripts — into inline content
3. Fills in default fields for records (list vs non-list)
4. Builds a JSON payload matching the Realm VTT API schema
5. Uploads via `POST /rulesets` (new) or `PATCH /rulesets/:id` (update)

## Key Conventions

- `{ "file": "relative/path" }` anywhere in config is resolved to file contents
- `rollTypes` entries use `file` → compiled to `handleResult` (the API field name)
- Tab entries use `file` → compiled to `layout`
- Prompts write to stderr so stdout stays clean for `--dry-run` / `--output`
- Auth: email/password login or direct JWT token via `--token`

## Records Import (CSV)

`records <csvfile>` imports compendium records into a campaign.

- **CSV shape:** column 1 is `recordType`, column 2 is `name`. Each remaining header is
  a dot-separated path into the record's `data` object — e.g. header `notes` →
  `data.notes`, header `actions.0.name` → `data.actions[0].name` (numeric segments
  build arrays). Empty cells are skipped, so a blank column never clobbers an existing
  value on update.
- **Cell coercion** (`csv.js`): cells starting with `{` or `[` are parsed as JSON —
  this is how nested objects and lists are authored (e.g. an `actions` column holding a
  whole JSON array); `true`/`false` become booleans; numbers that round-trip exactly
  become numbers (`007`, `1/4`, `1e3` stay strings); everything else stays a string.
- **List `_id`s:** any object that is an element of an array and lacks an `_id` is
  stamped with a UUID — Realm VTT list entries (actions, traits, …) require one, so
  CSV authors omit `_id` and let the importer fill it in.
- **Target campaign:** pass `--campaign <id>` *or* `--invite <code>`. An invite code is
  resolved to a campaign ID via `GET /campaigns?inviteCode=` (requires auth, so an
  invite-code import authenticates even for `--dry-run`).
- **Upsert by name:** each row is looked up by name within the campaign (`findRecord`).
  If a match exists it is updated via `PATCH /<endpoint>/:id`; otherwise it is created
  via `POST`. The PATCH body omits `name`, `campaignId`, and `recordType` (immutable /
  lookup fields).
- **Endpoint routing:** `recordType` of `npcs` → `/npcs`, `tables` → `/tables`,
  everything else → `/records` (with `recordType` kept in the create body).
- `example/test-records.csv` is a runnable sample — one NPC (with a 5e/Level Up
  `actions` list) and one item.

## Dependencies

- `commander` for CLI parsing
- Node.js built-ins only (no bundler, no build step)
- Requires Node.js 18+ (uses native `fetch`)

## Combat Tracker — Initiative Mode

`settings.combatTracker.initiativeMode` selects how the tracker decides whose turn it is. Pick one of:

- **`"standard"`** — numeric initiative. Default. Each token has a per-token init value (in the `initiative` field, or whatever `combatTracker.initiative` names). Sorted by `combatTracker.order` (`"desc"` = highest acts first, `"asc"` = lowest first). Use for d20-style games where every combatant rolls their own init.
- **`"slot"`** — initiative slots. Same numeric model, but the GM assigns tokens to slot rows. `combatTracker.clearSlotsPerRound: true` resets the assignments each round.
- **`"manual"`** — GM-driven, no fixed numeric order; the GM clicks the active token. Sides come from each token's `faction` (`"friend"` / `"enemy"` / `"neutral"`). Configure via `settings.combatTracker.manualOptions`:
  - `groupBySide` (default `true`) — render the tracker as friend/enemy/neutral sections, with the side acting first this round on top. Turn off for spotlight-style flat lists (Daggerheart, PBTA).
  - `sideOrder` — `"manual"` (default) means whoever the GM (or `defaultStartSide`) chose acts first; `"rolled"` means each round the side whose token rolls best on `combatTracker.initiative` wins, with `combatTracker.order` deciding direction (`"desc"` = high wins, `"asc"` = low wins, e.g. 1d6 OSR-style). In `rolled` mode the per-token init column and Roll Init buttons stay visible, and the existing `onRollInitiative` hook drives the dice.
  - `defaultStartSide` — `"friend"` / `"enemy"` / `"neutral"`, or omitted. In `manual` order this side auto-starts each round (GM can override per-round). In `rolled` order it's the tiebreaker when faction max-init values are equal.

Back-compat: the legacy `slotBased: true` boolean is still read — if `initiativeMode` is missing it's treated as `"slot"`. New rulesets should set `initiativeMode` explicitly.

When advising on a new ruleset, pick the mode that matches the source system:

| System | initiativeMode | sideOrder | defaultStartSide |
|---|---|---|---|
| D&D 5e / PF2e / Cypher / Fate | `standard` | — | — |
| Some indie / Daggerheart-style | `slot` | — | — |
| OSR / Vagabond / OD&D (PCs always first) | `manual` | `manual` | `friend` |
| B/X / OSE (each side rolls 1d6) | `manual` | `rolled` (with `order: "asc"`) | — |
| Daggerheart / PBTA / Forged in the Dark | `manual` (with `groupBySide: false`) | `manual` | — |

The example in `example/ruleset.config.json` and the deeper docs in `WIKI.md` ("Combat tracker — initiative modes") show the full JSON shape.
