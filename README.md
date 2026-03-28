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
node src/cli.js ./my-ruleset

# Compile to a file (no upload)
node src/cli.js ./my-ruleset --output build.json

# Dry run — preview what would be uploaded
node src/cli.js ./my-ruleset --dry-run

# Upload to a specific ruleset by ID
node src/cli.js ./my-ruleset -e you@example.com -p yourpassword -i 64a1b2c3d4e5f6
```

## Usage

```
ruleset-compiler <directory> [options]

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
  -v, --verbose          Verbose logging
```

If you omit `--id` and `--new`, the tool will fetch your owned rulesets and let you pick one interactively.

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

### Records

Each record defines a type that players and GMs interact with (characters, items, spells, etc.). There are two kinds:

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
