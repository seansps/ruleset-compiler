# Realm VTT Ruleset Compiler

CLI tool that compiles a ruleset directory into a JSON payload and uploads it to the Realm VTT API.

## Project Structure

```
src/
  cli.js         — CLI entry point (commander-based)
  compiler.js    — Reads ruleset.config.json, resolves file refs, builds API payload
  api-client.js  — Realm VTT API client (auth, CRUD for rulesets)
  prompts.js     — Terminal prompts (text, password, select)
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

## Dependencies

- `commander` for CLI parsing
- Node.js built-ins only (no bundler, no build step)
- Requires Node.js 18+ (uses native `fetch`)
