#!/usr/bin/env node

import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { compile } from "./compiler.js";
import { RulesetAPIClient } from "./api-client.js";
import { prompt, promptPassword, promptSelect } from "./prompts.js";

const program = new Command();

program
  .name("ruleset-compiler")
  .description("Compile a ruleset directory and push to Realm VTT API")
  .argument("<directory>", "Path to ruleset directory")
  .option("-e, --email <email>", "Realm VTT email")
  .option("-p, --password <password>", "Realm VTT password")
  .option("-t, --token <token>", "JWT token (bypasses login)")
  .option("-i, --id <rulesetId>", "Ruleset ID to update")
  .option("--new", "Create a new ruleset")
  .option("--url <url>", "API base URL", "https://utilities.realmvtt.com")
  .option("--dry-run", "Build JSON and write to stdout (no upload)")
  .option("--output <file>", "Build JSON and write to file (no upload)")
  .option("-v, --verbose", "Verbose logging")
  .action(run);

async function run(directory, opts) {
  try {
    // 1. Compile
    if (opts.verbose) console.error("Compiling...\n");
    const payload = await compile(directory, { verbose: opts.verbose });
    if (opts.verbose) console.error("");

    // 2. Dry run — write to stdout
    if (opts.dryRun) {
      process.stdout.write(JSON.stringify(payload, null, 2));
      process.stdout.write("\n");
      return;
    }

    // 3. Output to file
    if (opts.output) {
      await writeFile(opts.output, JSON.stringify(payload, null, 2), "utf-8");
      console.error(`Written to ${opts.output}`);
      return;
    }

    // 4. Authenticate
    const client = new RulesetAPIClient(opts.url);

    if (opts.token) {
      client.setToken(opts.token);
      if (opts.verbose) console.error("Using provided token.");
    } else {
      const email = opts.email || (await prompt("Email: "));
      const password = opts.password || (await promptPassword("Password: "));
      if (opts.verbose) console.error("Logging in...");
      await client.login(email, password);
      console.error("Logged in successfully.");
    }

    // 5. Select target
    let rulesetId = opts.id;
    let isNew = opts.new;

    if (!rulesetId && !isNew) {
      // Fetch owned rulesets and let user pick
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
  } catch (err) {
    console.error(`Error: ${err.message}`);
    if (opts.verbose && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

program.parse();
