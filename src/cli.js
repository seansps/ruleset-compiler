#!/usr/bin/env node

import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";
import { createAuthenticatedClient } from "./auth.js";
import { promptSelect } from "./prompts.js";
import { runRecords } from "./records.js";

const program = new Command();

program
  .name("ruleset-compiler")
  .description("Realm VTT CLI — manage rulesets and records")
  .option("-e, --email <email>", "Realm VTT email")
  .option("-p, --password <password>", "Realm VTT password")
  .option("-t, --token <token>", "JWT token (bypasses login)")
  .option("--url <url>", "API base URL", "https://utilities.realmvtt.com")
  .option("-v, --verbose", "Verbose logging");

// --- rulesets subcommand ---
program
  .command("rulesets")
  .description("Compile a ruleset directory and push to Realm VTT API")
  .argument("<directory>", "Path to ruleset directory")
  .option("-i, --id <rulesetId>", "Ruleset ID to update")
  .option("--new", "Create a new ruleset")
  .option("--dry-run", "Build JSON and write to stdout (no upload)")
  .option("--output <file>", "Build JSON and write to file (no upload)")
  .action(async (directory, cmdOpts, cmd) => {
    const opts = { ...program.opts(), ...cmdOpts };
    try {
      await runRulesets(directory, opts);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (opts.verbose && err.stack) console.error(err.stack);
      process.exit(1);
    }
  });

// --- records subcommand ---
program
  .command("records")
  .description(
    "Import records from a CSV file (upserts by name: updates a record if one already exists in the campaign, otherwise creates it)"
  )
  .argument("<csvfile>", "Path to CSV file")
  .option("-c, --campaign <id>", "Campaign ID (or use --invite)")
  .option("-i, --invite <code>", "Campaign invite code — looked up to resolve the campaign ID")
  .option("--dry-run", "Print payloads to stdout (no upload)")
  .option("--delay <ms>", "Delay between API calls in ms", "250")
  .action(async (csvFile, cmdOpts, cmd) => {
    const opts = { ...program.opts(), ...cmdOpts };
    try {
      await runRecords(csvFile, opts);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (opts.verbose && err.stack) console.error(err.stack);
      process.exit(1);
    }
  })
  .addHelpText(
    "after",
    `
Examples:
  # Import by campaign ID
  $ ruleset-compiler records records.csv --campaign 65f0a1b2c3d4e5f6a7b8c9d0

  # Import by invite code (resolved to the campaign ID automatically)
  $ ruleset-compiler records records.csv --invite ABC123 --email me@example.com

  # Preview payloads without uploading
  $ ruleset-compiler records records.csv --campaign <id> --dry-run

CSV format: column 1 is recordType, column 2 is name, remaining columns
become string keys on the record's data object.`
  );

async function runRulesets(directory, opts) {
  // 1. Compile
  if (opts.verbose) console.error("Compiling...\n");
  const payload = await compile(directory, { verbose: opts.verbose });
  if (opts.verbose) console.error("");

  // 2. Output to file (no auth needed)
  if (opts.output) {
    await writeFile(opts.output, JSON.stringify(payload, null, 2), "utf-8");
    console.error(`Written to ${opts.output}`);
    return;
  }

  // 3. Authenticate (needed for both dry-run and real upload)
  const needsAuth = !opts.dryRun || opts.email || opts.password || opts.token || opts.id || opts.new;

  let client;
  if (needsAuth) {
    client = await createAuthenticatedClient(opts);
  }

  // 4. Select target
  let rulesetId = opts.id;
  let isNew = opts.new;

  if (client && !rulesetId && !isNew) {
    if (opts.verbose) console.error("Fetching owned rulesets...");
    const rulesets = await client.listOwnedRulesets();
    const items = Array.isArray(rulesets) ? rulesets : rulesets.data || [];

    if (items.length === 0) {
      console.error("No existing rulesets found. Creating new.");
      isNew = true;
    } else {
      const selected = await promptSelect(
        items,
        (r) => `${r.name} (${r._id})`
      );
      if (selected) {
        rulesetId = selected._id;
      } else {
        isNew = true;
      }
    }
  }

  // 5. Dry run
  if (opts.dryRun) {
    if (isNew) {
      console.error(`[dry-run] Would CREATE ruleset "${payload.name}"`);
    } else if (rulesetId) {
      console.error(`[dry-run] Would UPDATE ruleset ${rulesetId}`);
    } else {
      console.error(`[dry-run] No target selected`);
    }
    process.stdout.write(JSON.stringify(payload, null, 2));
    process.stdout.write("\n");
    return;
  }

  // 6. Upload
  if (isNew) {
    console.error(`Creating ruleset "${payload.name}"...`);
    const result = await client.createRuleset(payload);
    console.error(`Created! ID: ${result._id}`);
    console.error(`Name: ${result.name}`);
  } else {
    console.error(`Updating ruleset ${rulesetId}...`);
    const result = await client.updateRuleset(rulesetId, payload);
    console.error(`Updated! ID: ${result._id}`);
    console.error(`Name: ${result.name}`);
  }
}

program.parse();
