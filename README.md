# Realm VTT Ruleset Compiler

A CLI tool that compiles a [Realm VTT](https://www.realmvtt.com) ruleset directory into a JSON payload and uploads it to the Realm VTT API.

Instead of editing rulesets entirely through the Realm VTT web editor, you can maintain your ruleset as local files — HTML tabs, JavaScript rollhandlers, and a single `ruleset.config.json` — and use this tool to compile and push changes.

## Installation

```bash
npm install
```

Requires **Node.js 18+** (uses native `fetch`).

## Quick Start

```bash
# Compile and upload (interactive — prompts for credentials and target)
node src/cli.js rulesets ./my-ruleset

# Compile to a file (no upload)
node src/cli.js rulesets ./my-ruleset --output build.json

# Dry run — preview what would be uploaded
node src/cli.js rulesets ./my-ruleset --dry-run

# Upload to a specific ruleset by ID
node src/cli.js rulesets ./my-ruleset -e you@example.com -p yourpassword -i 64a1b2c3d4e5f6
```

## Usage

```
ruleset-compiler rulesets <directory> [options]

Arguments:
  directory              Path to ruleset directory (must contain ruleset.config.json)

Options:
  -e, --email <email>    Realm VTT email
  -p, --password <pass>  Realm VTT password
  -t, --token <token>    JWT token (bypasses login)
  -i, --id <rulesetId>   Ruleset ID to update
  --new                  Create a new ruleset
  --url <url>            API base URL (default: https://utilities.realmvtt.com)
  --dry-run              Build JSON and write to stdout (no upload)
  --output <file>        Build JSON and write to file (no upload)
  --ref <ref>            Deploy ref for REALM_DEPLOY_TOKEN deploys (default: CI commit SHA or git HEAD)
  -v, --verbose          Verbose logging
```

If you omit `--id` and `--new`, the tool will fetch your owned rulesets and let you pick one interactively.

## Deploying from CI (deploy tokens)

For CI, use a deploy token instead of your password. The ruleset owner generates one in the Realm VTT
ruleset editor under **Deploy**. A token can only replace the content of that one ruleset.

```bash
REALM_DEPLOY_TOKEN=rvtt_deploy_... node src/cli.js rulesets ./my-ruleset --id <rulesetId>
```

When `REALM_DEPLOY_TOKEN` is set:

- It sends `PUT /rulesets/:id/deploy` instead of logging in and sending `PATCH /rulesets/:id`.
- It never prompts. `--id` is required, and `--new`, `--email`, `--password`, and `--token` are rejected.
- It sends the commit SHA as `X-Deploy-Ref` (`--ref`, then `CIRCLE_SHA1` / `GITHUB_SHA`, then `git rev-parse HEAD`).
- It prints the deploy ID and warns about any fields the server ignored (for example `published`).

Without `REALM_DEPLOY_TOKEN`, everything works exactly as before.

Store the token as a secret only your `main` branch deploy can read: a GitHub Environment secret with
required reviewers, or a CircleCI restricted context behind an approval job. Never pass secrets to builds
from forked pull requests.

Example CircleCI job (pin the compiler to a commit you have reviewed):

```yaml
version: 2.1
jobs:
  deploy-ruleset:
    docker:
      - image: cimg/node:20.11
    steps:
      - checkout
      - run: |
          git clone https://github.com/seansps/ruleset-compiler.git /tmp/rc
          git -C /tmp/rc checkout <commit-sha>
          npm ci --omit=dev --prefix /tmp/rc
      - run: node /tmp/rc/src/cli.js rulesets ./ruleset --id "$REALM_RULESET_ID"
workflows:
  deploy:
    jobs:
      - hold:
          type: approval
          filters: { branches: { only: main } }
      - deploy-ruleset:
          requires: [hold]
          context: [realm-deploy]   # holds REALM_DEPLOY_TOKEN
          filters: { branches: { only: main } }
```

## Ruleset Directory Structure

A ruleset directory contains a `ruleset.config.json` and all referenced files:

```
my-ruleset/
  ruleset.config.json
  character-main.html
  character-skills.html
  character-combat.html
  items-main.html
  rollhandlers/
    common.js
    attack.js
    damage.js
  scripts/
    damage-apply.js
```

## Skins

A ruleset can ship UI skins that restyle Realm (windows, chat, sheets, tags,
macro buttons). Put each one in its own folder:

```
my-ruleset/
  skins/
    pathfinder/          # folder name = skin id (lowercase letters, digits, dashes)
      skin.json          # the manifest
      frames/paper.png   # textures and fonts the manifest points at
      fonts/Body.woff2
```

Skins upload after the ruleset on every push, with either a login or a
deploy token (`PUT /rulesets/:id/skins/:slug`). Only images and fonts are
uploaded (png, jpg, webp, avif, woff2, woff, ttf, otf); anything else in the
folder, such as a font license, is skipped. The build fails if `skin.json` is
missing, invalid JSON, or points at a file that is not in the folder. Pass
`--skip-skins` to push only the ruleset.

Set the default skin for new campaigns with `settings.skin` (the folder name):

```json
{ "settings": { "skin": "pathfinder" } }
```

Once the ruleset is published, anyone can use its skins in any campaign. GMs
can change a campaign's skin and players can pick their own in Settings.

## `ruleset.config.json`

This is the main configuration file. It defines the ruleset name, record types, and settings. Any value can reference an external file using `{ "file": "path/to/file" }` — the compiler inlines file contents automatically.

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Ruleset display name |
| `description` | string | Short description |
| `version` | number | Version number |
| `records` | array | Record type definitions (see below) |
| `settings` | object | Ruleset settings — rollTypes, damage, effects, etc. |
| `compatibility` | array | Cross-ruleset import compatibility (see below) |

### Compatibility

`compatibility` lets a ruleset import content from other rulesets, remapping record
types that are named differently. Each entry declares a source ruleset (by its
`rulesetId`, which is stable across dev/prod for official rulesets) and a `typeMap`
of `their record type → this ruleset's record type`. Record types not in the map
import unchanged (they just won't be compendium-searchable under this ruleset).

Modules built for a listed ruleset then appear in this ruleset's in-campaign Modules
window, and on import their remappable record types are converted automatically.

```json
"compatibility": [
  {
    "rulesetId": "66e37156b49c73d33593dbfd",
    "name": "D&D 5e (2024)",
    "typeMap": { "species": "heritage", "subclass": "archetypes" }
  }
]
```

Each ruleset declares its own compatibility independently — e.g. Level Up maps 5e's
`species` → `heritage`, while 5e maps Level Up's `heritage` → `species`.

### Records

Each record definition is a standard record, list, or reusable panel:

**Standard records** — full record sheets with tabs:

```json
{
  "name": "Characters",
  "type": "characters",
  "minX": 550,
  "minY": 600,
  "tabs": [
    { "name": "Main", "file": "character-main.html" },
    { "name": "Skills", "file": "character-skills.html" }
  ],
  "hideFromCompendium": false,
  "isList": false,
  "icon": "",
  "filters": {}
}
```

**List records** — embedded lists used inside other records (e.g., inventory, attack list):

```json
{
  "name": "Inventory List",
  "type": "inventory_list",
  "isList": true,
  "singleRow": false,
  "showAddButton": true,
  "showDeleteButton": true,
  "addButtonText": "Add Item",
  "newItemName": "New Item",
  "emptyListText": "Drop Items Here",
  "allowedListTypes": ["items"],
  "tabs": [{ "name": "Main", "file": "inventory-list.html" }]
}
```

List records support additional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `showAddButton` | boolean | false | Show the "Add" button |
| `showDeleteButton` | boolean | false | Show delete buttons on rows |
| `addButtonText` | string | "" | Label for the add button |
| `newItemName` | string | "" | Default name for new items |
| `emptyListText` | string | "" | Placeholder when list is empty |
| `allowedListTypes` | string[] | [] | Record types that can be dropped into this list |
| `singleRow` | boolean | false | Render as a single-row inline list |
| `maxLength` | number | 0 | Max items (0 = unlimited) |
| `stackDuplicates` | boolean | false | Stack duplicate items instead of adding new rows |
| `countFieldName` | string | "" | Field name for stack count |
| `disableDrop` | boolean | false | Prevent drag-and-drop onto this list |
| `filterCriteria` | array | [] | Filter items shown in the list |
| `orderCriteria` | array | [] | Sort order for items |

**Panel records** are reusable embedded layouts. They are not standalone
Compendium records and store their child values beneath the `<panel>` field on
the parent record:

```json
{
  "name": "Attributes Panel",
  "type": "attributes_panel",
  "isPanel": true,
  "tabs": [{ "name": "Main", "file": "panels/attributes.html" }]
}
```

Embed that layout from any record or list layout:

```html
<panel paneltype="attributes_panel" field="attributes"></panel>
```

If `attributes.html` contains `<numberfield field="strength">`, its value is
stored at `record.data.attributes.strength`. Panel definitions use their first
tab as the embedded layout. Panels can contain normal fields, lists, and other
non-recursive panels.

The `field` attribute is optional. If it is omitted or empty, panel fields stay
at the current data path, so `strength` is stored at `record.data.strength`.

### File References

Anywhere in the config, use `{ "file": "relative/path" }` to inline a file's contents:

```json
{
  "settings": {
    "otherSettings": {
      "commonScript": { "file": "rollhandlers/common.js" }
    },
    "rollTypes": [
      { "name": "attack", "file": "rollhandlers/attack.js" }
    ],
    "combatTracker": {
      "onRollInitiative": { "file": "scripts/on-roll-initiative.js" }
    }
  }
}
```

- **Tab files**: `{ "file": "character-main.html" }` → compiled to `{ "layout": "<html content>" }`
- **Roll types**: `{ "file": "rollhandlers/attack.js" }` → compiled to `{ "handleResult": "<js content>" }`
- **Everything else**: `{ "file": "..." }` → replaced with the file's text content

### Settings

The `settings` object configures gameplay mechanics. Key sections:

- **`rollTypes`** — Roll handler scripts (attack, damage, skill checks, etc.)
- **`otherSettings.commonScript`** — Shared JavaScript available to all rollhandlers
- **`healthIndicator`** — Token health bar configuration
- **`combatTracker`** — Initiative and combat tracking
- **`damage`** — Damage/healing system configuration
- **`effects`** — Status effects available in the game
- **`partySheet`** — Party sheet column configuration
- **`tokenSize`** — Available token sizes

See the [example config](example/ruleset.config.json) for a complete reference.

## Example

See the [example/](example/) directory for a minimal ruleset configuration that demonstrates the structure.
