import { readEffectsCSV } from "./csv.js";
import { createAuthenticatedClient } from "./auth.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the API payload for a single effect. Effects store their fields at
 * the top level (no `data` wrapper), so the parsed effect object is sent
 * almost as-is — only the campaign scope is attached here.
 */
function buildEffectPayload(effect, campaignId) {
  return { ...effect, campaignId };
}

/**
 * The effects API requires `name`, `description` and `stackable` when
 * *creating* an effect. The CSV importer skips empty cells (so a blank
 * column never clobbers a value on update), which means those fields can be
 * absent. Fill in safe defaults — but only on the create path, so an update
 * never overwrites an existing description / stackable flag with a default.
 */
function withCreateDefaults(payload) {
  return { description: "", stackable: false, ...payload };
}

/**
 * Run the effects import action — upserts effects by name into a campaign.
 */
export async function runEffects(csvFile, opts) {
  const effects = await readEffectsCSV(csvFile);
  if (opts.verbose) console.error(`Parsed ${effects.length} effects from CSV.`);

  if (!opts.campaign && !opts.invite) {
    throw new Error("Provide a campaign with --campaign <id> or --invite <code>.");
  }

  // Resolve the campaign. An invite code must be looked up via the API,
  // which requires authentication.
  let client;
  let campaignId = opts.campaign;

  if (!campaignId && opts.invite) {
    client = await createAuthenticatedClient(opts);
    if (opts.verbose) console.error(`Resolving invite code "${opts.invite}"...`);
    campaignId = await client.getCampaignByInviteCode(opts.invite);
    console.error(`Resolved invite code "${opts.invite}" to campaign ${campaignId}.`);
  }

  const payloads = effects.map((e) => buildEffectPayload(e, campaignId));

  if (opts.dryRun) {
    process.stdout.write(JSON.stringify(payloads, null, 2));
    process.stdout.write("\n");
    console.error(`[dry-run] Would import ${payloads.length} effects (create or update).`);
    return;
  }

  if (!client) client = await createAuthenticatedClient(opts);
  const delay = parseInt(opts.delay, 10) || 250;
  const results = { created: 0, updated: 0, failed: [] };

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const tag = `[${i + 1}/${payloads.length}]`;
    try {
      if (!payload.name) {
        throw new Error('row is missing a "name" value');
      }
      const existing = await client.findEffect(campaignId, payload.name);
      if (existing) {
        const result = await client.updateEffect(existing._id, payload);
        results.updated++;
        console.error(`  ${tag} Updated "${payload.name}" (${result._id})`);
      } else {
        const result = await client.createEffect(withCreateDefaults(payload));
        results.created++;
        console.error(`  ${tag} Created "${payload.name}" (${result._id})`);
      }
    } catch (err) {
      results.failed.push({ index: i + 1, name: payload.name || "(no name)", error: err.message });
      console.error(`  ${tag} FAILED "${payload.name || "(no name)"}": ${err.message}`);
    }

    if (i < payloads.length - 1) await sleep(delay);
  }

  console.error(
    `\nDone. ${results.created} created, ${results.updated} updated, ${results.failed.length} failed.`
  );
  if (results.failed.length > 0) {
    console.error("Failures:");
    for (const f of results.failed) {
      console.error(`  Row ${f.index} "${f.name}": ${f.error}`);
    }
  }
}
